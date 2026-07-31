import { spawn, spawnSync, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import {
  PROVIDERS,
  PROVIDER_ORDER,
  buildProviderRunSpec,
  createStandardMcpConfig,
  detectKimiCliFlavor,
  inspectProvider,
  normalizeProviderLine,
  spawnCli,
  spawnCliSync,
  visibleTerminalInvocation,
  type CliProviderId,
  type ProviderSnapshot,
} from "./cli-providers.js";
import { AE_HARNESS_SYSTEM_PROMPT } from "./ae-harness-prompt.js";

type TranscriptRole = "user" | "assistant" | "system";

type TranscriptEntry = {
  id: string;
  role: TranscriptRole;
  text: string;
  time: string;
  sequence?: number;
  attachments?: Array<{ kind: "viewer" | "aeUi"; label: string; path: string }>;
  providerLabel?: string;
};

type ActivityEvent = {
  id: string;
  kind: "afterEffects" | "tool" | "command" | "files" | "search";
  label: string;
  detail: string;
  status: "running" | "completed" | "failed";
  time: string;
  sequence?: number;
};

type PendingApproval = {
  requestId: number | string;
  method: string;
  summary: string;
  details: string;
  availableDecisions?: unknown;
  questions?: Array<{ id: string; options: string[] }>;
  buttonLabels?: { accept: string; session?: string; decline: string };
  elicitationSchema?: any;
};

type ChatState = {
  version: string;
  provider: CliProviderId;
  providerName: string;
  providers: ProviderSnapshot[];
  hostStatus: "starting" | "ready" | "error";
  cliStatus: "checking" | "missing" | "signedOut" | "ready" | "installing";
  cliPath: string | null;
  cliVersion: string | null;
  mcpStatus: "unknown" | "ready" | "missing";
  bridgeStatus: "unknown" | "ready" | "paused" | "stale";
  bridgeMessage: string | null;
  threadId: string | null;
  activeTurnId: string | null;
  busy: boolean;
  statusText: string;
  activity: { kind: string; label: string; detail?: string };
  activityLog: ActivityEvent[];
  account: { type: string; label: string; email: string | null; planType: string | null } | null;
  transcript: TranscriptEntry[];
  approval: PendingApproval | null;
  trustAfterEffectsMcp: boolean;
  noApprovalPrompts: boolean;
  error: string | null;
  updatedAt: string;
};

type ChatRequest = {
  id?: string;
  action?: string;
  prompt?: string;
  context?: Record<string, unknown>;
  viewerPath?: string;
  viewerRequested?: boolean;
  viewerError?: string | null;
  attachAeUi?: boolean;
  trustAfterEffectsMcp?: boolean;
  noApprovalPrompts?: boolean;
  decision?: "accept" | "acceptForSession" | "decline" | "cancel";
  providerId?: CliProviderId;
};

const VERSION = "1.10.3";
const CHAT_DIR = path.join(os.homedir(), "Documents", "ae-mcp-bridge", "codex-chat");
const REQUEST_DIR = path.join(CHAT_DIR, "requests");
const ATTACHMENT_DIR = path.join(CHAT_DIR, "attachments");
const STATE_PATH = path.join(CHAT_DIR, "state.json");
const SETTINGS_PATH = path.join(CHAT_DIR, "settings.json");
const LOCK_PATH = path.join(CHAT_DIR, "host.lock");
const LOG_PATH = path.join(CHAT_DIR, "host.log");
const MCP_CONFIG_PATH = path.join(CHAT_DIR, "provider-mcp.json");
const PI_SESSION_DIR = path.join(CHAT_DIR, "pi-sessions");
const AE_SYSTEM_PROMPT_PATH = path.join(CHAT_DIR, "after-effects-system-prompt.md");
const AE_BRIDGE_DIR = path.join(os.homedir(), "Documents", "ae-mcp-bridge");
const AE_COMMAND_PATH = path.join(AE_BRIDGE_DIR, "ae_command.json");
const AE_RESULT_PATH = path.join(AE_BRIDGE_DIR, "ae_mcp_result.json");
const AE_COMMAND_LOCK_PATH = path.join(AE_BRIDGE_DIR, "ae_command.lock");
const AE_HEARTBEAT_PATH = path.join(AE_BRIDGE_DIR, "ae_bridge_status.json");

for (const directory of [CHAT_DIR, REQUEST_DIR, ATTACHMENT_DIR, PI_SESSION_DIR]) {
  fs.mkdirSync(directory, { recursive: true });
}
for (const instructionName of ["after-effects-system-prompt.md", "AGENTS.md", "CLAUDE.md", "GEMINI.md"]) {
  fs.writeFileSync(path.join(CHAT_DIR, instructionName), `${AE_HARNESS_SYSTEM_PROMPT}\n`, "utf8");
}

let state: ChatState = {
  version: VERSION,
  provider: "codex",
  providerName: PROVIDERS.codex.label,
  providers: [],
  hostStatus: "starting",
  cliStatus: "checking",
  cliPath: null,
  cliVersion: null,
  mcpStatus: "unknown",
  bridgeStatus: "unknown",
  bridgeMessage: null,
  threadId: null,
  activeTurnId: null,
  busy: false,
  statusText: "Starting CLI companion...",
  activity: { kind: "starting", label: "Starting" },
  activityLog: [],
  account: null,
  transcript: [],
  approval: null,
  trustAfterEffectsMcp: true,
  noApprovalPrompts: true,
  error: null,
  updatedAt: new Date().toISOString(),
};

try {
  const previousState = JSON.parse(fs.readFileSync(STATE_PATH, "utf8").replace(/^\uFEFF/, ""));
  if (Array.isArray(previousState.transcript)) state.transcript = previousState.transcript.slice(-200);
  if (Array.isArray(previousState.activityLog)) state.activityLog = previousState.activityLog.slice(-120);
} catch {}

let timelineSequence = Math.max(0, ...state.transcript.map((entry) => Number(entry.sequence) || 0), ...state.activityLog.map((event) => Number(event.sequence) || 0));

function nextTimelineSequence(): number {
  timelineSequence += 1;
  return timelineSequence;
}

function createAssistantEntry(providerLabel = state.providerName): TranscriptEntry {
  const entry: TranscriptEntry = {
    id: `${Date.now()}-assistant-${Math.random().toString(16).slice(2)}`,
    role: "assistant",
    text: "",
    time: new Date().toISOString(),
    sequence: nextTimelineSequence(),
    providerLabel,
  };
  state.transcript.push(entry);
  return entry;
}

function logHostError(context: string, error: unknown): void {
  try {
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${context}: ${String(error)}\n`, "utf8");
  } catch {}
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const serialized = JSON.stringify(value, null, 2);
  try {
    fs.writeFileSync(temporaryPath, serialized, "utf8");
    fs.renameSync(temporaryPath, filePath);
  } catch {
    // CEP reads state.json very frequently. On Windows that can briefly prevent
    // rename-overwrite even though a normal write is permitted. A direct-write
    // fallback is preferable to terminating the long-running companion.
    try {
      fs.writeFileSync(filePath, serialized, "utf8");
    } catch (fallbackError) {
      logHostError(`Unable to write ${path.basename(filePath)}`, fallbackError);
    }
    try { fs.unlinkSync(temporaryPath); } catch {}
    // The fallback is expected occasionally while CEP is reading the file.
  }
}

function saveState(): void {
  state.updatedAt = new Date().toISOString();
  if (state.transcript.length > 200) state.transcript = state.transcript.slice(-200);
  if (state.activityLog.length > 120) state.activityLog = state.activityLog.slice(-120);
  writeJsonAtomic(STATE_PATH, state);
}

function appendTranscript(
  role: TranscriptRole,
  text: string,
  attachments?: Array<{ kind: "viewer" | "aeUi"; label: string; path: string }>,
): void {
  if (!text) return;
  state.transcript.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    text,
    time: new Date().toISOString(),
    sequence: nextTimelineSequence(),
    attachments: attachments?.length ? attachments : undefined,
    providerLabel: role === "assistant" ? state.providerName : undefined,
  });
  saveState();
}

function activityArguments(value: unknown): Record<string, any> {
  if (value && typeof value === "object") return value as Record<string, any>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {}
  }
  return {};
}

function describeAfterEffectsActivity(item: any): string {
  const args = activityArguments(item.arguments);
  const action = args.action || args.operation || args.command || "Working";
  const target = args.target || args.resource || args.entity || "";
  const name = args.name || args.compName || args.layerName || "";
  return [action, target, name].filter(Boolean).map((value) => String(value)).join(" · ");
}

function addActivityEvent(item: any): void {
  if (!item?.id) return;
  let kind: ActivityEvent["kind"] | null = null;
  let label = "Codex";
  let detail = "Working";
  if (item.type === "mcpToolCall") {
    const isAe = String(item.server || "").toLowerCase() === "aftereffectsmcp";
    kind = isAe ? "afterEffects" : "tool";
    label = isAe ? "After Effects" : String(item.server || "Tool");
    detail = isAe ? describeAfterEffectsActivity(item) : String(item.tool || "Using tool");
  } else if (item.type === "commandExecution") {
    kind = "command";
    label = "Local command";
    detail = Array.isArray(item.command) ? item.command.join(" ") : String(item.command || "Running command");
  } else if (item.type === "fileChange") {
    kind = "files";
    label = "Files";
    detail = "Updating files";
  } else if (item.type === "webSearch") {
    kind = "search";
    label = "Search";
    detail = String(item.query || "Searching");
  }
  if (!kind) return;
  state.activityLog.push({
    id: String(item.id),
    kind,
    label,
    detail: detail.slice(0, 500),
    status: "running",
    time: new Date().toISOString(),
    sequence: nextTimelineSequence(),
  });
  if (state.activityLog.length > 120) state.activityLog = state.activityLog.slice(-120);
}

function completeActivityEvent(item: any): void {
  if (!item?.id) return;
  for (let index = state.activityLog.length - 1; index >= 0; index--) {
    const event = state.activityLog[index];
    if (event.id !== String(item.id)) continue;
    const failed = item.status === "failed" || item.status === "error" || Boolean(item.error);
    event.status = failed ? "failed" : "completed";
    if (item.type === "mcpToolCall" && event.kind === "afterEffects") event.detail = describeAfterEffectsActivity(item) || event.detail;
    return;
  }
}

type ChatSettings = {
  version?: string;
  threadId?: string;
  provider?: CliProviderId;
  providerSessions?: Partial<Record<CliProviderId, string>>;
  trustAfterEffectsMcp?: boolean;
  noApprovalPrompts?: boolean;
};

function loadSettings(): ChatSettings {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveSettings(): void {
  writeJsonAtomic(SETTINGS_PATH, {
    version: VERSION,
    threadId: state.threadId,
    provider: state.provider,
    providerSessions,
    trustAfterEffectsMcp: state.trustAfterEffectsMcp,
    noApprovalPrompts: state.noApprovalPrompts,
  });
}

const savedSettings = loadSettings();
// A prompt/tool-contract update must start fresh harness sessions. Several CLIs
// freeze their system prompt when a session is created, so resuming an older
// session would preserve obsolete After Effects instructions.
const providerSessions: Partial<Record<CliProviderId, string>> = savedSettings.version === VERSION
  ? savedSettings.providerSessions || {}
  : {};
const savedProvider = String(savedSettings.provider || "") === "gemini" ? "agy" : savedSettings.provider;
if (savedProvider && PROVIDERS[savedProvider]) {
  state.provider = savedProvider;
  state.providerName = PROVIDERS[savedProvider].label;
}

type BridgeHeartbeat = {
  state?: string;
  autoRun?: boolean;
  instanceId?: string;
  updatedAt?: number | string;
};

function readBridgeHeartbeat(): { status: ChatState["bridgeStatus"]; message: string; heartbeat: BridgeHeartbeat | null } {
  try {
    const heartbeat = JSON.parse(fs.readFileSync(AE_HEARTBEAT_PATH, "utf8")) as BridgeHeartbeat;
    const updatedAt = typeof heartbeat.updatedAt === "number" ? heartbeat.updatedAt : Date.parse(String(heartbeat.updatedAt || ""));
    const age = Number.isFinite(updatedAt) ? Date.now() - updatedAt : Number.POSITIVE_INFINITY;
    if (age > 4000) return { status: "stale", message: "After Effects bridge heartbeat is stale.", heartbeat };
    if (heartbeat.autoRun === false || heartbeat.state === "paused") {
      return { status: "paused", message: "After Effects bridge Auto-run is disabled.", heartbeat };
    }
    if (heartbeat.state === "ready" || heartbeat.state === "checking" || heartbeat.state === "starting") {
      return { status: "ready", message: "After Effects bridge is ready.", heartbeat };
    }
    return { status: "stale", message: `After Effects bridge reported '${heartbeat.state || "unknown"}'.`, heartbeat };
  } catch {
    return { status: "stale", message: "After Effects bridge heartbeat was not found.", heartbeat: null };
  }
}

function updateBridgeHealthState(): void {
  const health = readBridgeHeartbeat();
  state.bridgeStatus = health.status;
  state.bridgeMessage = health.message;
  if (!state.busy && state.cliStatus === "ready" && health.status !== "ready") {
    state.statusText = health.status === "paused" ? "Bridge Auto-run is off" : "After Effects bridge is unavailable";
  } else if (!state.busy && state.cliStatus === "ready" && health.status === "ready" && /bridge/i.test(state.statusText)) {
    state.statusText = "Ready";
  }
}

async function acquireAeBridgeLock(timeoutMs: number): Promise<() => void> {
  fs.mkdirSync(AE_BRIDGE_DIR, { recursive: true });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const descriptor = fs.openSync(AE_COMMAND_LOCK_PATH, "wx");
      fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), owner: "chat-host" }));
      fs.closeSync(descriptor);
      return () => {
        try {
          const lock = JSON.parse(fs.readFileSync(AE_COMMAND_LOCK_PATH, "utf8"));
          if (Number(lock.pid) === process.pid) fs.unlinkSync(AE_COMMAND_LOCK_PATH);
        } catch {}
      };
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const lock = JSON.parse(fs.readFileSync(AE_COMMAND_LOCK_PATH, "utf8"));
        const ownerPid = Number(lock.pid);
        if (!ownerPid) stale = Date.now() - fs.statSync(AE_COMMAND_LOCK_PATH).mtimeMs > 30000;
        else {
          try { process.kill(ownerPid, 0); }
          catch { stale = true; }
        }
      } catch {
        try { stale = Date.now() - fs.statSync(AE_COMMAND_LOCK_PATH).mtimeMs > 30000; } catch {}
      }
      if (stale) {
        try { fs.unlinkSync(AE_COMMAND_LOCK_PATH); } catch {}
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("Another After Effects command is still running. Wait for it to finish and try again.");
}

async function runAeBridgeCommand(operation: string, action: string, parameters: Record<string, unknown> = {}, timeoutMs = 15000): Promise<any> {
  const health = readBridgeHeartbeat();
  if (health.status !== "ready") throw new Error(`${health.message} Keep the MCP Bridge panel open with Auto-run enabled.`);
  const release = await acquireAeBridgeLock(timeoutMs + 5000);
  const commandId = `chat-${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    writeJsonAtomic(AE_RESULT_PATH, { status: "waiting", _commandId: commandId, message: "Waiting for After Effects" });
    writeJsonAtomic(AE_COMMAND_PATH, {
      command: "aeCommand",
      id: commandId,
      args: { operation, action, ...parameters },
      timestamp: new Date().toISOString(),
      status: "pending",
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let result: any = null;
      try {
        result = JSON.parse(fs.readFileSync(AE_RESULT_PATH, "utf8"));
      } catch {}
      if (result?._commandId === commandId && result.status !== "waiting") {
        if (result.status === "error") throw new Error(result.message || `After Effects ${operation}/${action} failed.`);
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`After Effects did not complete ${operation}/${action} within ${timeoutMs} ms.`);
  } finally {
    release();
  }
}

async function prepareAfterEffectsRequest(request: ChatRequest): Promise<ChatRequest> {
  const prepared: ChatRequest = { ...request };
  const project = await runAeBridgeCommand("inspect", "get", { scope: "project", maxItems: 100 });
  prepared.context = project.data || project;
  if (request.viewerRequested) {
    try {
      const capture = await runAeBridgeCommand("frame", "capture", {}, 20000);
      const viewerPath = capture?.data?.path || capture?.path;
      if (viewerPath) prepared.viewerPath = String(viewerPath);
      else prepared.viewerError = "After Effects completed the viewer capture but did not return an image path.";
    } catch (error) {
      prepared.viewerError = String(error);
    }
  }
  return prepared;
}
state.trustAfterEffectsMcp = savedSettings.trustAfterEffectsMcp !== false;
state.noApprovalPrompts = savedSettings.noApprovalPrompts !== false;

function applyProviderSnapshot(snapshot: ProviderSnapshot): void {
  state.provider = snapshot.id;
  state.providerName = snapshot.label;
  state.cliStatus = snapshot.cliStatus;
  state.cliPath = snapshot.cliPath;
  state.cliVersion = snapshot.cliVersion;
  state.mcpStatus = snapshot.mcpStatus;
  state.account = snapshot.account;
  state.error = null;
  if (snapshot.cliStatus === "ready") state.statusText = "Ready";
  else if (snapshot.cliStatus === "signedOut") state.statusText = `${snapshot.label} is installed - sign in required`;
  else if (snapshot.cliStatus === "missing") state.statusText = `${snapshot.label} is not installed`;
}

function refreshProviderCatalog(): ProviderSnapshot[] {
  const snapshots = PROVIDER_ORDER.map((providerId) => inspectProvider(providerId, providerId === state.provider));
  state.providers = snapshots;
  const current = snapshots.find((snapshot) => snapshot.id === state.provider) || snapshots[0];
  applyProviderSnapshot(current);
  if (current.cliStatus === "ready") ensureCurrentProviderMcp(current);
  saveState();
  return snapshots;
}

function ensureCurrentProviderMcp(snapshot: ProviderSnapshot): void {
  const mcpExecutable = findBundledMcpExecutable();
  if (!mcpExecutable || (snapshot.id === "pi" && !findPiExtensionPath())) {
    snapshot.mcpStatus = "missing";
    state.mcpStatus = "missing";
    return;
  }
  if (snapshot.id === "codex") {
    ensureMcpRegistration();
    snapshot.mcpStatus = state.mcpStatus;
    return;
  }
  if (snapshot.id === "agy") {
    try {
      writeAgyProjectMcpConfig(mcpExecutable);
      snapshot.mcpStatus = "ready";
    } catch {
      snapshot.mcpStatus = "missing";
    }
  } else snapshot.mcpStatus = "ready";
  state.mcpStatus = snapshot.mcpStatus;
}

function registrationOutputMatchesPath(output: string, expectedPath: string): boolean {
  const normalize = (value: string) => value.replace(/\\\\/g, "/").replace(/\\/g, "/").replace(/["']/g, "").toLowerCase();
  return normalize(output).includes(normalize(expectedPath));
}

function checkCodex(): boolean {
  state.cliStatus = "checking";
  state.statusText = "Checking Codex CLI...";
  saveState();
  const snapshot = inspectProvider("codex");
  applyProviderSnapshot(snapshot);
  if (snapshot.cliStatus === "ready") ensureCurrentProviderMcp(snapshot);
  saveState();
  return snapshot.installed;
}

function findBundledMcpExecutable(): string | null {
  const candidates = [
    path.join(path.dirname(process.execPath), "after-effects-mcp-extended.exe"),
    path.join(process.env.APPDATA || "", "AfterEffectsMCP", "after-effects-mcp-extended.exe"),
    path.join(os.homedir(), "Documents", "ae-mcp-bridge", "bin", "after-effects-mcp-extended.exe"),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function ensureMcpRegistration(): void {
  if (!state.cliPath) return;
  const mcpExecutable = findBundledMcpExecutable();
  if (!mcpExecutable) {
    state.mcpStatus = "missing";
    return;
  }
  const existing = spawnCliSync(state.cliPath, ["mcp", "get", "AfterEffectsMCP"], { timeout: 15000 });
  const existingOutput = `${existing.stdout || existing.stderr || ""}`;
  if (existing.status === 0 && registrationOutputMatchesPath(existingOutput, mcpExecutable)) {
    state.mcpStatus = "ready";
    return;
  }
  if (existing.status === 0) spawnCliSync(state.cliPath, ["mcp", "remove", "AfterEffectsMCP"], { timeout: 15000 });
  const added = spawnCliSync(state.cliPath, ["mcp", "add", "AfterEffectsMCP", "--", mcpExecutable], { timeout: 20000 });
  state.mcpStatus = added.status === 0 ? "ready" : "missing";
  if (added.status !== 0) {
    state.error = `${added.stderr || added.stdout || "Unable to register AfterEffectsMCP"}`.trim();
  }
}

function openExternalUrl(url: string): void {
  if (!/^https:\/\//i.test(url)) throw new Error("The CLI returned an invalid sign-in URL.");
  const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
    windowsHide: true,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

class AppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private assistantEntry: TranscriptEntry | null = null;
  private intentionallyStopped = new WeakSet<ChildProcessWithoutNullStreams>();
  private recoveringProtocol = false;

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.process && !this.process.killed) return;
    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startInternal(): Promise<void> {
    if (!state.cliPath && !checkCodex()) throw new Error("Codex CLI is not installed.");

    const child = spawnCli(state.cliPath!, ["app-server", "--listen", "stdio://"], {
      cwd: os.homedir(),
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    this.process = child;
    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (!text) return;
      logHostError("Codex app-server stderr", text);
      if (!this.recoveringProtocol && /Custom tool call output is missing/i.test(text)) {
        this.recoveringProtocol = true;
        appendTranscript("system", "Codex conversation context was reset after an interrupted tool call. The visible conversation was preserved.");
        this.forceStopAndRestart("Codex detected an unfinished tool call in the previous session.");
      }
    });
    child.on("error", (error) => {
      logHostError("Codex app-server process error", error);
    });
    child.on("exit", (code) => {
      const wasIntentional = this.intentionallyStopped.has(child);
      if (this.process !== child) return;
      const interruptedTurn = state.busy;
      this.process = null;
      this.rejectPending(new Error(`Codex app-server stopped (${code ?? "unknown"})`));
      if (interruptedTurn) {
        state.threadId = null;
        saveSettings();
      }
      state.busy = false;
      state.activeTurnId = null;
      state.approval = null;
      state.statusText = wasIntentional ? "Stopped" : `Codex app-server stopped (${code ?? "unknown"})`;
      state.activity = wasIntentional
        ? { kind: "idle", label: "Stopped" }
        : { kind: "error", label: "Codex stopped", detail: "The chat service will restart automatically." };
      saveState();
      if (interruptedTurn && !wasIntentional) {
        setTimeout(() => void this.start().catch((error) => logHostError("Codex recovery restart failed", error)), 500);
      }
    });

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        this.handleLine(line);
      } catch (error) {
        logHostError("Codex event handling failed", error);
        state.error = String(error);
        state.statusText = "A Codex event could not be processed";
        state.activity = { kind: "error", label: "Event error", detail: String(error) };
        saveState();
      }
    });

    await this.request("initialize", {
      clientInfo: { name: "after_effects_mcp_extended", title: "After Effects MCP Extended", version: VERSION },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized", {});
    await this.readAccount();
    if (state.cliStatus === "ready") await this.ensureThread();
  }

  private send(message: unknown): void {
    if (!this.process?.stdin.writable) throw new Error("Codex app-server is not running.");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private notify(method: string, params: unknown): void {
    this.send({ method, params });
  }

  private request(method: string, params: unknown, timeoutMs = 60000): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private applyAccount(account: any): void {
    if (!account) {
      state.account = null;
      state.cliStatus = "signedOut";
      state.statusText = "Sign in to Codex";
      state.activity = { kind: "signedOut", label: "Signed out" };
      saveState();
      return;
    }
    const type = String(account.type || "unknown");
    const email = typeof account.email === "string" && account.email ? account.email : null;
    const planType = account.planType ? String(account.planType) : null;
    const label = email || (type === "apiKey" ? "OpenAI API key" : type === "chatgpt" ? "ChatGPT account" : type);
    state.account = { type, label, email, planType };
    state.cliStatus = "ready";
    if (!state.busy) {
      state.statusText = "Ready";
      state.activity = { kind: "idle", label: "Ready" };
    }
    saveState();
  }

  private async readAccount(): Promise<void> {
    try {
      const result = await this.request("account/read", { refreshToken: false });
      this.applyAccount(result?.account || null);
    } catch {
      state.account = null;
      saveState();
    }
  }

  async startLogin(relogin: boolean): Promise<void> {
    await this.start();
    if (state.busy) throw new Error("Stop the active Codex turn before changing accounts.");
    if (relogin && state.account) {
      await this.request("account/logout", {});
      state.threadId = null;
      saveSettings();
    }
    const result = await this.request("account/login/start", {
      type: "chatgpt",
      codexStreamlinedLogin: true,
      useHostedLoginSuccessPage: true,
    });
    if (!result?.authUrl) throw new Error("Codex did not return a browser sign-in URL.");
    state.account = null;
    state.cliStatus = "signedOut";
    state.statusText = "Complete sign-in in your browser";
    state.activity = { kind: "signIn", label: "Waiting for sign-in" };
    appendTranscript("system", relogin ? "Codex account switch started in your browser." : "Codex sign-in started in your browser.");
    openExternalUrl(result.authUrl);
    saveState();
  }

  private async ensureThread(): Promise<void> {
    const currentSettings = loadSettings();
    const remembered = currentSettings.version === VERSION ? currentSettings.threadId : null;
    if (remembered) {
      try {
        const resumed = await this.request("thread/resume", { threadId: remembered });
        state.threadId = resumed.thread.id;
        saveSettings();
        saveState();
        return;
      } catch {
        // The stored thread may have been removed or created by an older Codex build.
      }
    }

    const started = await this.request("thread/start", {
      cwd: os.homedir(),
      approvalPolicy: state.noApprovalPrompts ? "never" : "on-request",
      sandbox: "workspace-write",
      serviceName: "after-effects-mcp-extended",
    });
    state.threadId = started.thread.id;
    saveSettings();
    saveState();
  }

  async sendTurn(request: ChatRequest): Promise<void> {
    await this.start();
    if (state.cliStatus !== "ready" || !state.account) throw new Error("Sign in to Codex before starting chat.");
    if (state.busy) throw new Error("Codex is already working. Stop the current turn or wait for it to finish.");

    const prompt = (request.prompt || "").trim();
    if (!prompt) throw new Error("Enter a message first.");

    const input: Array<Record<string, unknown>> = [];
    const attachments: Array<{ kind: "viewer" | "aeUi"; label: string; path: string }> = [];
    const contextText = request.context ? `\n\nAfter Effects context:\n${JSON.stringify(request.context, null, 2)}` : "";
    input.push({ type: "text", text: `${prompt}${contextText}` });
    let viewerAttached = false;
    if (request.viewerPath) {
      const viewerPath = normalizeAttachmentPath(request.viewerPath);
      const viewerReady = await waitForStableFile(viewerPath);
      if (viewerReady && appendImageInput(input, attachments, viewerPath, "viewer", "Composition Viewer")) {
        viewerAttached = true;
        // Image bytes are inlined so Codex does not need sandbox access to the path.
      } else {
        appendTranscript("system", `Viewer capture was created but could not be attached: ${viewerPath}`);
      }
    }
    if (request.viewerRequested && !viewerAttached) {
      appendTranscript("system", request.viewerError || "Viewer was requested, but After Effects did not return a frame.");
      input.push({
        type: "text",
        text: "Attachment status: the Composition Viewer image was not attached. Do not claim that you can see or inspect the Viewer frame.",
      });
    }
    if (request.attachAeUi) {
      const uiPath = await captureAfterEffectsWindow();
      if (uiPath) {
        if (!appendImageInput(input, attachments, uiPath, "aeUi", "After Effects UI")) {
          appendTranscript("system", `AE UI capture was created but could not be attached: ${uiPath}`);
        }
      }
      else appendTranscript("system", "AE UI capture was skipped because the After Effects window was unavailable or minimized.");
    }
    appendTranscript("user", prompt, attachments);

    // Do not create a response bubble until text actually arrives. Tool calls
    // may happen first, and a turn may contain several text/tool/text segments.
    this.assistantEntry = null;
    state.busy = true;
    state.statusText = "Codex is working...";
    state.activity = { kind: "thinking", label: "Thinking" };
    state.error = null;
    saveState();

    const result = await this.request("turn/start", {
      threadId: state.threadId,
      input,
      approvalPolicy: state.noApprovalPrompts ? "never" : "on-request",
    });
    state.activeTurnId = result.turn.id;
    saveState();
  }

  async stopTurn(): Promise<void> {
    if (!state.busy) return;
    const turnId = state.activeTurnId;
    state.statusText = "Stopping Codex...";
    state.activity = { kind: "stopping", label: "Stopping" };
    saveState();

    if (!state.threadId || !turnId) {
      this.forceStopAndRestart("The active turn did not expose an interrupt ID.");
      return;
    }

    try {
      await this.request("turn/interrupt", { threadId: state.threadId, turnId }, 5000);
      setTimeout(() => {
        if (state.busy && state.activeTurnId === turnId) {
          this.forceStopAndRestart("Codex did not confirm the interrupt.");
        }
      }, 4000);
    } catch (error) {
      logHostError("Turn interrupt failed", error);
      this.forceStopAndRestart("Codex did not respond to Stop.");
    }
  }

  private forceStopAndRestart(detail: string): void {
    const child = this.process;
    if (child) {
      this.intentionallyStopped.add(child);
      try { child.kill(); } catch (error) { logHostError("Unable to terminate Codex app-server", error); }
    }
    this.process = null;
    this.rejectPending(new Error(detail));
    state.threadId = null;
    saveSettings();
    state.busy = false;
    state.activeTurnId = null;
    state.approval = null;
    state.statusText = "Stopped";
    state.activity = { kind: "idle", label: "Stopped" };
    saveState();
    setTimeout(() => {
      void this.start().then(() => {
        this.recoveringProtocol = false;
      }).catch((error) => {
        this.recoveringProtocol = false;
        logHostError("Codex app-server restart failed", error);
        state.error = String(error);
        state.statusText = "Codex restart failed";
        state.activity = { kind: "error", label: "Restart failed", detail: String(error) };
        saveState();
      });
    }, 500);
  }

  respondToApproval(decision: ChatRequest["decision"]): void {
    if (!state.approval || !decision) return;
    if (state.approval.method === "mcpServer/elicitation/request") {
      if (decision === "decline" || decision === "cancel") {
        this.send({ id: state.approval.requestId, result: { action: decision } });
      } else {
        this.send({
          id: state.approval.requestId,
          result: {
            action: "accept",
            content: this.buildElicitationContent(state.approval.elicitationSchema, decision),
          },
        });
      }
    } else if (state.approval.method === "item/tool/requestUserInput") {
      const answers: Record<string, { answers: string[] }> = {};
      for (const question of state.approval.questions || []) {
        const answer = this.selectUserInputAnswer(question.options, decision);
        answers[question.id] = { answers: answer ? [answer] : [] };
      }
      this.send({ id: state.approval.requestId, result: { answers } });
    } else {
      this.send({ id: state.approval.requestId, result: { decision } });
    }
    state.approval = null;
    state.statusText = decision === "decline" || decision === "cancel" ? "Approval declined" : "Approval granted";
    saveState();
  }

  private buildElicitationContent(schema: any, decision: ChatRequest["decision"]): Record<string, unknown> {
    const content: Record<string, unknown> = {};
    const properties = schema?.properties || {};
    for (const [name, propertyValue] of Object.entries(properties)) {
      const property: any = propertyValue;
      if (property.default !== undefined && property.default !== null) {
        content[name] = property.default;
        continue;
      }
      const titledOptions = (property.oneOf || property.anyOf || []).map((option: any) => ({
        value: option.const,
        label: option.title || option.const,
      })).filter((option: any) => option.value !== undefined);
      const enumOptions = (property.enum || []).map((value: any, index: number) => ({
        value,
        label: property.enumNames?.[index] || String(value),
      }));
      const options = titledOptions.length ? titledOptions : enumOptions;
      if (options.length) {
        const pattern = decision === "acceptForSession" ? /session|always/i : /accept|allow|approve|yes|continue|run/i;
        const selected = options.find((option: any) => pattern.test(option.label)) || options[0];
        content[name] = selected.value;
      } else if (property.type === "boolean") {
        content[name] = true;
      } else if (property.type === "array") {
        content[name] = [];
      } else if (property.type === "number" || property.type === "integer") {
        content[name] = property.minimum || 0;
      } else {
        content[name] = "";
      }
    }
    return content;
  }

  private selectUserInputAnswer(options: string[], decision: ChatRequest["decision"]): string | null {
    if (!options.length) return null;
    const patterns = decision === "acceptForSession"
      ? [/session/i, /always/i, /accept|allow|approve|yes|continue|run/i]
      : decision === "accept"
        ? [/accept|allow|approve|yes|continue|run/i]
        : [/decline|deny|reject|no|cancel/i];
    for (const pattern of patterns) {
      const match = options.find((option) => pattern.test(option));
      if (match) return match;
    }
    return decision === "accept" || decision === "acceptForSession" ? options[0] : options[options.length - 1];
  }

  private handleLine(line: string): void {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(Number(message.id));
      if (!pending) return;
      this.pending.delete(Number(message.id));
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
      return;
    }

    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }

    const params = message.params || {};
    if (message.method === "turn/started") {
      state.activeTurnId = params.turn?.id || state.activeTurnId;
      state.busy = true;
      state.statusText = "Codex is thinking...";
      state.activity = { kind: "thinking", label: "Thinking" };
    } else if (message.method === "item/started") {
      const item = params.item || {};
      // Each app-server item is a distinct point in the visible chat timeline.
      // End the current text segment before a tool or a new agent-message item.
      this.assistantEntry = null;
      addActivityEvent(item);
      if (item.type === "mcpToolCall") {
        const isAe = String(item.server || "").toLowerCase() === "aftereffectsmcp";
        state.statusText = isAe ? "Codex is using After Effects..." : `Codex is using ${item.server || "a tool"}...`;
        state.activity = { kind: isAe ? "afterEffects" : "tool", label: isAe ? "Using After Effects" : "Using a tool", detail: item.tool || "" };
      } else if (item.type === "commandExecution") {
        state.statusText = "Codex is running a local command...";
        state.activity = { kind: "command", label: "Running command" };
      } else if (item.type === "fileChange") {
        state.statusText = "Codex is updating files...";
        state.activity = { kind: "files", label: "Updating files" };
      } else if (item.type === "webSearch") {
        state.statusText = "Codex is searching...";
        state.activity = { kind: "search", label: "Searching" };
      } else if (item.type === "reasoning") {
        state.statusText = "Codex is thinking...";
        state.activity = { kind: "thinking", label: "Thinking" };
      }
    } else if (message.method === "item/agentMessage/delta") {
      if (!this.assistantEntry) {
        this.assistantEntry = createAssistantEntry("Codex");
      }
      this.assistantEntry.text += params.delta || "";
      state.statusText = "Codex is responding...";
      state.activity = { kind: "responding", label: "Responding" };
    } else if (message.method === "item/completed" && params.item?.type === "agentMessage") {
      const finalText = params.item.text || params.item.content || "";
      if (finalText) {
        if (!this.assistantEntry) this.assistantEntry = createAssistantEntry("Codex");
        this.assistantEntry.text = typeof finalText === "string" ? finalText : JSON.stringify(finalText);
      }
      this.assistantEntry = null;
    } else if (message.method === "item/completed" && state.busy) {
      completeActivityEvent(params.item);
      state.statusText = "Codex is thinking...";
      state.activity = { kind: "thinking", label: "Thinking" };
    } else if (message.method === "item/mcpToolCall/progress") {
      const itemId = String(params.itemId || params.id || "");
      for (let index = state.activityLog.length - 1; index >= 0; index--) {
        if (state.activityLog[index].id !== itemId) continue;
        if (params.message) state.activityLog[index].detail = String(params.message).slice(0, 500);
        break;
      }
    } else if (message.method === "turn/completed") {
      state.busy = false;
      state.activeTurnId = null;
      state.approval = null;
      const status = params.turn?.status || "completed";
      state.statusText = status === "completed" ? "Ready" : `Turn ${status}`;
      state.activity = { kind: status === "completed" ? "idle" : "error", label: status === "completed" ? "Ready" : `Turn ${status}` };
      if (params.turn?.error?.message) state.error = params.turn.error.message;
      this.assistantEntry = null;
    } else if (message.method === "serverRequest/resolved") {
      state.approval = null;
    } else if (message.method === "account/updated") {
      void this.readAccount();
    } else if (message.method === "account/login/completed") {
      if (params.success) {
        void this.readAccount().then(() => this.ensureThread());
      } else {
        state.statusText = "Codex sign-in failed";
        state.activity = { kind: "error", label: "Sign-in failed", detail: params.error || "" };
        state.error = params.error || "Codex sign-in failed";
      }
    }
    saveState();
  }

  private handleServerRequest(message: any): void {
    const params = message.params || {};
    if (message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") {
      const command = Array.isArray(params.command) ? params.command.join(" ") : params.command;
      state.approval = {
        requestId: message.id,
        method: message.method,
        summary: params.reason || (message.method.indexOf("fileChange") >= 0 ? "Allow file changes?" : "Allow command execution?"),
        details: command || params.grantRoot || params.cwd || "Codex requested approval.",
        availableDecisions: params.availableDecisions,
      };
      state.statusText = "Approval required";
      saveState();
      return;
    }

    if (message.method === "item/tool/requestUserInput") {
      const questions = (params.questions || []).map((question: any) => ({
        id: String(question.id),
        options: (question.options || []).map((option: any) => String(option.label)),
      }));
      const allOptions = questions.reduce((result: string[], question: { options: string[] }) => result.concat(question.options), []);
      const acceptLabel = allOptions.find((label: string) => /accept|allow|approve|yes|continue|run/i.test(label)) || allOptions[0] || "Allow";
      const sessionLabel = allOptions.find((label: string) => /session|always/i.test(label));
      const declineLabel = allOptions.find((label: string) => /decline|deny|reject|no|cancel/i.test(label)) || allOptions[allOptions.length - 1] || "Decline";
      const details = (params.questions || []).map((question: any) => {
        const optionText = (question.options || []).map((option: any) => `${option.label}: ${option.description}`).join(" | ");
        return `${question.question}${optionText ? `\n${optionText}` : ""}`;
      }).join("\n\n");
      state.approval = {
        requestId: message.id,
        method: message.method,
        summary: params.questions?.[0]?.header || "Codex needs your input",
        details,
        questions,
        buttonLabels: { accept: acceptLabel, session: sessionLabel, decline: declineLabel },
      };
      state.statusText = "Approval required";
      saveState();
      return;
    }

    if (message.method === "mcpServer/elicitation/request") {
      const schema = params.requestedSchema || {};
      if (state.trustAfterEffectsMcp && String(params.serverName || "").toLowerCase() === "aftereffectsmcp") {
        this.send({
          id: message.id,
          result: {
            action: "accept",
            content: this.buildElicitationContent(schema, "acceptForSession"),
          },
        });
        state.statusText = "Running After Effects command...";
        saveState();
        return;
      }
      const optionLabels: string[] = [];
      for (const property of Object.values(schema.properties || {}) as any[]) {
        if (property.enum) optionLabels.push(...property.enum.map(String));
        if (property.enumNames) optionLabels.push(...property.enumNames.map(String));
        for (const option of property.oneOf || property.anyOf || []) {
          optionLabels.push(String(option.title || option.const || ""));
        }
      }
      const acceptLabel = optionLabels.find((label) => /accept|allow|approve|yes|continue|run/i.test(label)) || "Allow";
      const sessionLabel = optionLabels.find((label) => /session|always/i.test(label));
      const declineLabel = optionLabels.find((label) => /decline|deny|reject|no|cancel/i.test(label)) || "Decline";
      state.approval = {
        requestId: message.id,
        method: message.method,
        summary: `Request from ${params.serverName || "MCP server"}`,
        details: params.message || "The MCP server needs confirmation.",
        buttonLabels: { accept: acceptLabel, session: sessionLabel, decline: declineLabel },
        elicitationSchema: schema,
      };
      state.statusText = "Approval required";
      saveState();
      return;
    }

    // Unsupported interactive requests fail closed instead of hanging the turn.
    state.error = `Unsupported interactive request: ${message.method}`;
    appendTranscript("system", `${state.error}. The request was declined safely.`);
    this.send({ id: message.id, error: { code: -32601, message: `Unsupported interactive request: ${message.method}` } });
  }
}

function normalizeAttachmentPath(value: string): string {
  let normalized = String(value || "").trim();
  if (/^file:\/\//i.test(normalized)) {
    normalized = decodeURIComponent(normalized.replace(/^file:\/+/i, ""));
    if (/^\/[A-Za-z]:/.test(normalized)) normalized = normalized.slice(1);
  }
  return path.normalize(normalized);
}

function appendImageInput(
  input: Array<Record<string, unknown>>,
  attachments: Array<{ kind: "viewer" | "aeUi"; label: string; path: string }>,
  imagePath: string,
  kind: "viewer" | "aeUi",
  label: string,
): boolean {
  try {
    if (!fs.existsSync(imagePath)) return false;
    const bytes = fs.readFileSync(imagePath);
    if (!bytes.length) return false;
    const extension = path.extname(imagePath).toLowerCase();
    const mimeType = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
    input.push({ type: "image", url: `data:${mimeType};base64,${bytes.toString("base64")}`, detail: "high" });
    attachments.push({ kind, label, path: imagePath });
    return true;
  } catch (error) {
    logHostError(`Unable to attach ${label}`, error);
    return false;
  }
}

function waitForStableFile(filePath: string, timeoutMs = 8000): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    let lastSize = -1;
    let stableChecks = 0;
    const poll = () => {
      try {
        const size = fs.statSync(filePath).size;
        if (size > 0) {
          if (size === lastSize) stableChecks += 1;
          else { lastSize = size; stableChecks = 0; }
          if (stableChecks >= 1) {
            resolve(true);
            return;
          }
        }
      } catch {}
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(poll, 120);
    };
    poll();
  });
}

function captureAfterEffectsWindow(): Promise<string | null> {
  const outputPath = path.join(ATTACHMENT_DIR, `after-effects-ui-${Date.now()}.png`);
  const escapedPath = outputPath.replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class WinCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  public static IntPtr LargestAfterEffectsWindow() {
    IntPtr best = IntPtr.Zero;
    long bestArea = 0;
    EnumWindows(delegate(IntPtr handle, IntPtr unused) {
      if (!IsWindowVisible(handle) || IsIconic(handle)) return true;
      StringBuilder title = new StringBuilder(512);
      GetWindowText(handle, title, title.Capacity);
      if (title.ToString().IndexOf("Adobe After Effects", StringComparison.OrdinalIgnoreCase) < 0) return true;
      RECT current;
      if (!GetWindowRect(handle, out current)) return true;
      long width = current.Right - current.Left;
      long height = current.Bottom - current.Top;
      long area = width > 0 && height > 0 ? width * height : 0;
      if (area > bestArea) { best = handle; bestArea = area; }
      return true;
    }, IntPtr.Zero);
    return best;
  }
}
'@
$ProgressPreference = 'SilentlyContinue'
[WinCapture]::SetProcessDPIAware() | Out-Null
$handle = [WinCapture]::LargestAfterEffectsWindow()
if ($handle -eq [IntPtr]::Zero) { exit 2 }
$rect = New-Object WinCapture+RECT
if (-not [WinCapture]::GetWindowRect($handle, [ref]$rect)) { exit 3 }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -lt 2 -or $height -lt 2) { exit 2 }
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$deviceContext = $graphics.GetHdc()
try {
  $captured = [WinCapture]::PrintWindow($handle, $deviceContext, 2)
} finally {
  $graphics.ReleaseHdc($deviceContext)
}
if (-not $captured) {
  $graphics.Dispose()
  $bitmap.Dispose()
  exit 4
}
$bitmap.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let timer: ReturnType<typeof setTimeout>;
    const child = spawn("powershell.exe", ["-NoProfile", "-EncodedCommand", encoded], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const finish = (result: string | null, error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) logHostError("After Effects UI capture failed", error);
      resolve(result);
    };
    timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(null, `capture timed out; stdout=${stdout.trim()}; stderr=${stderr.trim()}`);
    }, 12000);
    child.on("error", (error) => finish(null, error));
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(outputPath)) finish(outputPath);
      else finish(null, `exit=${code}; stdout=${stdout.trim()}; stderr=${stderr.trim()}`);
    });
  });
}

function findPiExtensionPath(): string | null {
  const candidates = [
    path.join(path.dirname(process.execPath), "pi-after-effects-extension.ts"),
    path.join(process.env.APPDATA || "", "AfterEffectsMCP", "pi-after-effects-extension.ts"),
    path.join(os.homedir(), "Documents", "ae-mcp-bridge", "bin", "pi-after-effects-extension.ts"),
    path.join(process.cwd(), "assets", "pi-after-effects-extension.ts"),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function writeProviderMcpConfig(): string {
  const mcpExecutable = findBundledMcpExecutable();
  if (!mcpExecutable) throw new Error("The bundled After Effects MCP server could not be found.");
  writeJsonAtomic(MCP_CONFIG_PATH, createStandardMcpConfig(mcpExecutable));
  return mcpExecutable;
}

function writeKimiCodeProjectMcpConfig(mcpExecutable: string): void {
  const directory = path.join(CHAT_DIR, ".kimi-code");
  fs.mkdirSync(directory, { recursive: true });
  writeJsonAtomic(path.join(directory, "mcp.json"), createStandardMcpConfig(mcpExecutable));
}

function writeAgyProjectMcpConfig(mcpExecutable: string): void {
  const directory = path.join(CHAT_DIR, ".agents");
  fs.mkdirSync(directory, { recursive: true });
  writeJsonAtomic(path.join(directory, "mcp_config.json"), createStandardMcpConfig(mcpExecutable));
}

function findNpm(): string | null {
  const candidates = [
    path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs", "npm.cmd"),
    path.join(process.env.APPDATA || "", "npm", "npm.cmd"),
  ];
  const where = spawnSync("where.exe", ["npm.cmd"], { encoding: "utf8", windowsHide: true });
  if (where.status === 0 && where.stdout) candidates.unshift(...String(where.stdout).split(/\r?\n/).filter(Boolean));
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function installCurrentProvider(): void {
  const definition = PROVIDERS[state.provider];
  if (state.cliStatus === "installing") return;
  state.cliStatus = "installing";
  state.statusText = `Installing ${definition.label}...`;
  state.error = null;
  appendTranscript("system", `Installing ${definition.label} using its official installation method...`);

  let child: ChildProcess;
  if (definition.installKind === "powershell") {
    child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", String(definition.installCommand)], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    const npm = findNpm();
    if (!npm) {
      state.cliStatus = "missing";
      state.statusText = `${definition.label} needs Node.js or manual installation`;
      appendTranscript("system", `Node.js is not installed. Opening the official ${definition.label} instructions instead.`);
      openExternalUrl(definition.docsUrl);
      saveState();
      return;
    }
    child = spawnCli(npm, definition.installCommand as string[], { stdio: ["ignore", "pipe", "pipe"] });
  }
  child.stdout?.on("data", (chunk) => appendTranscript("system", String(chunk).trim()));
  child.stderr?.on("data", (chunk) => appendTranscript("system", String(chunk).trim()));
  child.on("error", (error) => {
    state.cliStatus = "missing";
    state.error = String(error);
    state.statusText = `${definition.label} installation failed`;
    saveState();
  });
  child.on("close", (code) => {
    refreshProviderCatalog();
    if (code === 0 && state.cliStatus !== "missing") appendTranscript("system", `${definition.label} installation completed.`);
    else {
      state.error = `Installer exited with code ${code}`;
      appendTranscript("system", `${definition.label} installation did not complete. Use Official Instructions for the manual option.`);
    }
    saveState();
  });
}

async function startGenericLogin(): Promise<void> {
  if (!state.cliPath) throw new Error(`${state.providerName} is not installed.`);
  if (state.busy) throw new Error(`Stop the active ${state.providerName} turn before changing accounts.`);
  const loginArgs: Record<Exclude<CliProviderId, "codex">, string[]> = {
    claude: ["auth", "login"],
    agy: [],
    kimi: ["login"],
    pi: [],
    opencode: ["auth", "login"],
  };
  if (state.provider === "codex") return;
  const args = loginArgs[state.provider];
  const terminal = visibleTerminalInvocation(state.cliPath, args, `${state.providerName} Sign In`);
  await new Promise<void>((resolve, reject) => {
    let stderr = "";
    const launcher = spawn(terminal.command, terminal.args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    launcher.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    launcher.once("error", reject);
    launcher.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Unable to open the ${state.providerName} sign-in terminal.`));
    });
  });
  if (state.provider === "pi") {
    appendTranscript("system", "Pi opened in a terminal. Enter /login, choose and authenticate a model provider, then choose Refresh status here.");
  } else if (state.provider === "agy") {
    appendTranscript("system", "Antigravity opened in a terminal. Complete Google sign-in if prompted. To change accounts, enter /logout, then launch it again and sign in. Choose Refresh status here when finished.");
  } else {
    appendTranscript("system", `A terminal was opened intentionally for ${state.providerName} sign-in. Complete authentication there, then choose Refresh status.`);
  }
}

class GenericCliClient {
  private child: ChildProcess | null = null;
  private assistantEntry: TranscriptEntry | null = null;
  private hasStreamedText = false;
  private activityIds = new Set<string>();
  private providerError: string | null = null;

  async sendTurn(request: ChatRequest): Promise<void> {
    if (state.provider === "codex") throw new Error("Codex uses the app-server adapter.");
    if (!state.cliPath || state.cliStatus !== "ready") throw new Error(`Sign in to ${state.providerName} before starting chat.`);
    if (state.busy) throw new Error(`${state.providerName} is already working.`);
    const prompt = (request.prompt || "").trim();
    if (!prompt) throw new Error("Enter a message first.");
    this.providerError = null;
    this.hasStreamedText = false;

    const attachments: Array<{ kind: "viewer" | "aeUi"; label: string; path: string }> = [];
    const attachmentPaths: string[] = [];
    const notices: string[] = [];
    if (request.viewerPath) {
      const viewerPath = normalizeAttachmentPath(request.viewerPath);
      if (await waitForStableFile(viewerPath) && fs.existsSync(viewerPath)) {
        attachments.push({ kind: "viewer", label: "Composition Viewer", path: viewerPath });
        attachmentPaths.push(viewerPath);
      } else notices.push(request.viewerError || "The requested Composition Viewer image was unavailable.");
    } else if (request.viewerRequested) notices.push(request.viewerError || "The requested Composition Viewer image was unavailable.");
    if (request.attachAeUi) {
      const uiPath = await captureAfterEffectsWindow();
      if (uiPath) {
        attachments.push({ kind: "aeUi", label: "After Effects UI", path: uiPath });
        attachmentPaths.push(uiPath);
      } else notices.push("The After Effects UI screenshot was unavailable or minimized.");
    }
    const contextText = request.context ? `\n\nAfter Effects context:\n${JSON.stringify(request.context, null, 2)}` : "";
    const noticeText = notices.length ? `\n\nAttachment status:\n${notices.join("\n")} Do not claim to see an image that was not attached.` : "";
    const attachmentText = attachmentPaths.length
      ? `\n\nAttached images (inspect these files as part of the request):\n${attachmentPaths.map((filePath) => `- ${filePath}`).join("\n")}`
      : "";
    const promptText = `${prompt}${contextText}${attachmentText}${noticeText}`;
    const promptFile = path.join(ATTACHMENT_DIR, `${state.provider}-prompt-${Date.now()}.txt`);
    fs.writeFileSync(promptFile, promptText, "utf8");
    appendTranscript("user", prompt, attachments);

    const mcpExecutable = writeProviderMcpConfig();
    const piExtensionPath = findPiExtensionPath();
    if (state.provider === "pi" && !piExtensionPath) throw new Error("The bundled Pi After Effects adapter could not be found.");
    const provider = state.provider;
    const kimiFlavor = provider === "kimi" ? detectKimiCliFlavor(state.cliPath) : undefined;
    if (kimiFlavor === "kimi-code") writeKimiCodeProjectMcpConfig(mcpExecutable);
    if (provider === "agy") writeAgyProjectMcpConfig(mcpExecutable);
    const runSpec = buildProviderRunSpec({
      provider,
      promptText,
      promptFile,
      attachmentPaths,
      sessionId: providerSessions[provider] || null,
      autoApprove: state.noApprovalPrompts,
      mcpConfigPath: MCP_CONFIG_PATH,
      mcpExecutable,
      systemPrompt: AE_HARNESS_SYSTEM_PROMPT,
      systemPromptPath: AE_SYSTEM_PROMPT_PATH,
      piExtensionPath: piExtensionPath || "",
      piSessionDir: PI_SESSION_DIR,
      kimiFlavor,
    });

    // Delay the first assistant bubble until text arrives. This allows tools
    // that run before the response to appear before it in the chat timeline.
    this.assistantEntry = null;
    this.activityIds.clear();
    state.busy = true;
    state.activeTurnId = `${provider}-${Date.now()}`;
    state.statusText = `${state.providerName} is working...`;
    state.activity = { kind: "thinking", label: "Thinking" };
    state.error = null;
    saveState();

    const child = spawnCli(state.cliPath, runSpec.args, {
      cwd: CHAT_DIR, env: runSpec.env, stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    if (runSpec.stdinText) child.stdin?.end(runSpec.stdinText);
    else child.stdin?.end();
    const output = readline.createInterface({ input: child.stdout! });
    output.on("line", (line) => this.handleLine(provider, line));
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => this.finish(false, String(error)));
    child.on("close", (code) => {
      if (this.child !== child) return;
      const failed = code !== 0 || Boolean(this.providerError);
      this.finish(!failed, this.providerError || (failed ? stderr.trim() || `${state.providerName} exited with code ${code}` : undefined));
      if ((provider === "pi" || provider === "kimi") && code === 0) providerSessions[provider] = "continue";
      saveSettings();
    });
  }

  private handleLine(provider: CliProviderId, line: string): void {
    for (const event of normalizeProviderLine(provider, line)) {
      if (event.kind === "session" && event.sessionId) {
        providerSessions[provider] = event.sessionId;
        saveSettings();
      } else if ((event.kind === "textDelta" || event.kind === "textBlock" || event.kind === "finalText") && event.text) {
        if (event.kind === "finalText" && this.hasStreamedText) continue;
        if (event.kind === "textBlock") this.assistantEntry = null;
        if (!this.assistantEntry) this.assistantEntry = createAssistantEntry(state.providerName);
        if (event.kind === "finalText" || event.kind === "textBlock") this.assistantEntry.text = event.text;
        else {
          this.assistantEntry.text += event.text;
        }
        this.hasStreamedText = true;
        state.statusText = `${state.providerName} is responding...`;
        state.activity = { kind: "responding", label: "Responding" };
      } else if (event.kind === "toolStart") {
        // The next text belongs in a new bubble after this tool activity.
        this.assistantEntry = null;
        const name = event.toolName || "Tool";
        const isAe = /after.?effects|aftereffectsmcp/i.test(name);
        const activityId = event.toolId || `${Date.now()}-tool`;
        this.activityIds.add(activityId);
        state.activityLog.push({
          id: activityId, kind: isAe ? "afterEffects" : "tool",
          label: isAe ? "After Effects" : name, detail: (event.toolDetail || "Using tool").slice(0, 500),
          status: "running", time: new Date().toISOString(),
          sequence: nextTimelineSequence(),
        });
        state.statusText = isAe ? `${state.providerName} is using After Effects...` : `${state.providerName} is using ${name}...`;
        state.activity = { kind: isAe ? "afterEffects" : "tool", label: isAe ? "Using After Effects" : `Using ${name}` };
      } else if (event.kind === "toolEnd") {
        const match = [...state.activityLog].reverse().find((item) => item.id === event.toolId || item.label === event.toolName);
        if (match) match.status = event.failed ? "failed" : "completed";
      } else if (event.kind === "error") {
        this.providerError = event.text || `${state.providerName} reported an error`;
        state.error = this.providerError;
      }
    }
    saveState();
  }

  async stopTurn(): Promise<void> {
    const child = this.child;
    if (!child || !state.busy) return;
    state.statusText = `Stopping ${state.providerName}...`;
    state.activity = { kind: "stopping", label: "Stopping" };
    saveState();
    this.child = null;
    try { child.kill(); } catch {}
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
    }
    this.finish(true);
    state.statusText = "Stopped";
    state.activity = { kind: "idle", label: "Stopped" };
    saveState();
  }

  private finish(success: boolean, error?: string): void {
    this.child = null;
    state.busy = false;
    state.activeTurnId = null;
    this.assistantEntry = null;
    this.hasStreamedText = false;
    this.providerError = null;
    for (const activity of state.activityLog) {
      if (this.activityIds.has(activity.id) && activity.status === "running") activity.status = success ? "completed" : "failed";
    }
    this.activityIds.clear();
    if (!success || error) {
      state.error = error || `${state.providerName} failed`;
      state.statusText = `${state.providerName} request failed`;
      state.activity = { kind: "error", label: "Request failed", detail: state.error };
    } else if (state.statusText !== "Stopped") {
      state.error = null;
      state.statusText = "Ready";
      state.activity = { kind: "idle", label: "Ready" };
    }
    saveState();
  }
}

const appServer = new AppServerClient();
const genericCli = new GenericCliClient();

async function handleRequest(request: ChatRequest): Promise<void> {
  if (typeof request.trustAfterEffectsMcp === "boolean") {
    state.trustAfterEffectsMcp = request.trustAfterEffectsMcp;
  }
  if (typeof request.noApprovalPrompts === "boolean") {
    state.noApprovalPrompts = request.noApprovalPrompts;
    saveSettings();
    saveState();
  }
  switch (request.action) {
    case "status":
      refreshProviderCatalog();
      if (state.provider === "codex" && state.cliStatus === "ready") await appServer.start();
      break;
    case "installCodex":
    case "installProvider":
      installCurrentProvider();
      break;
    case "login":
      if (state.provider === "codex") await appServer.startLogin(false);
      else await startGenericLogin();
      break;
    case "relogin":
      if (state.provider === "codex") await appServer.startLogin(true);
      else await startGenericLogin();
      break;
    case "send":
      {
        const preparedRequest = await prepareAfterEffectsRequest(request);
        if (state.provider === "codex") await appServer.sendTurn(preparedRequest);
        else await genericCli.sendTurn(preparedRequest);
      }
      break;
    case "stop":
      if (state.provider === "codex") await appServer.stopTurn();
      else await genericCli.stopTurn();
      break;
    case "approval":
      appServer.respondToApproval(request.decision);
      break;
    case "updateSettings":
      break;
    case "selectProvider": {
      if (state.busy) throw new Error(`Stop the active ${state.providerName} turn before switching CLI tools.`);
      if (!request.providerId || !PROVIDERS[request.providerId]) throw new Error("Unknown CLI provider.");
      state.provider = request.providerId;
      state.providerName = PROVIDERS[request.providerId].label;
      const snapshot = inspectProvider(request.providerId);
      const existing = state.providers.findIndex((item) => item.id === request.providerId);
      if (existing >= 0) state.providers[existing] = snapshot;
      else state.providers.push(snapshot);
      applyProviderSnapshot(snapshot);
      if (snapshot.cliStatus === "ready") ensureCurrentProviderMcp(snapshot);
      state.activity = { kind: snapshot.cliStatus === "ready" ? "idle" : "setup", label: snapshot.cliStatus === "ready" ? "Ready" : "Setup required" };
      saveSettings();
      saveState();
      if (request.providerId === "codex" && snapshot.cliStatus === "ready") await appServer.start();
      break;
    }
    case "openProviderDocs":
      openExternalUrl(PROVIDERS[state.provider].docsUrl);
      break;
    case "clearTranscript":
      state.transcript = [];
      state.activityLog = [];
      saveState();
      break;
    default:
      throw new Error(`Unknown chat action: ${request.action}`);
  }
}

let processing = false;
async function pollRequests(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    const files = fs.readdirSync(REQUEST_DIR).filter((name) => name.toLowerCase().endsWith(".json")).sort();
    for (const name of files) {
      const requestPath = path.join(REQUEST_DIR, name);
      try {
        const rawRequest = fs.readFileSync(requestPath, "utf8").replace(/^\uFEFF/, "");
        fs.unlinkSync(requestPath);
        const request = JSON.parse(rawRequest) as ChatRequest;
        await handleRequest(request);
      } catch (error) {
        state.error = String(error);
        state.statusText = "Chat request failed";
        appendTranscript("system", `Request failed: ${String(error)}`);
      }
    }
  } finally {
    processing = false;
  }
}

try {
  fs.writeFileSync(LOCK_PATH, `${process.pid}\n`, { flag: "wx" });
} catch {
  let activeHost = true;
  try {
    const oldPid = Number(fs.readFileSync(LOCK_PATH, "utf8").trim());
    process.kill(oldPid, 0);
  } catch {
    activeHost = false;
  }
  if (activeHost) process.exit(0);
  try { fs.unlinkSync(LOCK_PATH); } catch {}
  fs.writeFileSync(LOCK_PATH, `${process.pid}\n`, { flag: "wx" });
}

const cleanup = () => {
  try { fs.unlinkSync(LOCK_PATH); } catch {}
};
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("uncaughtException", (error) => {
  logHostError("Uncaught companion error", error?.stack || error);
  state.error = String(error);
  state.statusText = "The chat companion recovered from an internal error";
  state.activity = { kind: "error", label: "Recovered error", detail: String(error) };
  saveState();
});
process.on("unhandledRejection", (error) => {
  logHostError("Unhandled companion promise", error);
  state.error = String(error);
  state.statusText = "The chat companion recovered from an internal error";
  state.activity = { kind: "error", label: "Recovered error", detail: String(error) };
  saveState();
});

state.hostStatus = "ready";
updateBridgeHealthState();
refreshProviderCatalog();
if (state.provider === "codex" && state.cliStatus === "ready") {
  void appServer.start().catch((error) => {
    state.error = String(error);
    state.statusText = "Codex account check failed";
    state.activity = { kind: "error", label: "Account check failed" };
    saveState();
  });
} else {
  saveState();
}
setInterval(() => {
  void pollRequests().catch((error) => {
    logHostError("Request polling failed", error);
    state.error = String(error);
    state.statusText = "Chat request processing failed";
    saveState();
  });
}, 500);

// The CEP panel uses updatedAt as a heartbeat. If this process disappears,
// the panel can relaunch it instead of leaving an old busy state on screen.
setInterval(() => {
  updateBridgeHealthState();
  saveState();
}, 2000);
