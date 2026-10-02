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
import { DEFAULT_MODEL_CHOICE, discoverCliModels, normalizeModelChoice, validateModelChoice, type ModelChoice, type ModelCatalog } from "./cli-models.js";

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
  status: "running" | "completed" | "failed" | "cancelled";
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
  modelChoices: Partial<Record<CliProviderId, ModelChoice>>;
  modelCatalogs: Partial<Record<CliProviderId, ModelCatalog>>;
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
  contextError?: string | null;
  viewerPath?: string;
  viewerRequested?: boolean;
  viewerError?: string | null;
  attachAeUi?: boolean;
  trustAfterEffectsMcp?: boolean;
  noApprovalPrompts?: boolean;
  decision?: "accept" | "acceptForSession" | "decline" | "cancel";
  providerId?: CliProviderId;
  modelChoice?: ModelChoice;
};

const VERSION = "1.10.11";
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
  modelChoices: {},
  modelCatalogs: {},
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

function sleepSynchronous(milliseconds: number): void {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {}
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  const serialized = JSON.stringify(value, null, 2);
  fs.writeFileSync(temporaryPath, serialized, "utf8");
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      fs.renameSync(temporaryPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      try { fs.unlinkSync(filePath); } catch {}
      try {
        fs.renameSync(temporaryPath, filePath);
        return;
      } catch (retryError) {
        lastError = retryError;
      }
      sleepSynchronous(10);
    }
  }
  try { fs.unlinkSync(temporaryPath); } catch {}
  if (filePath !== AE_COMMAND_PATH && filePath !== AE_RESULT_PATH) {
    try {
      fs.writeFileSync(filePath, serialized, "utf8");
      return;
    } catch (fallbackError) {
      lastError = fallbackError;
    }
  }
  logHostError(`Unable to atomically write ${path.basename(filePath)}`, lastError);
  throw lastError instanceof Error ? lastError : new Error(`Unable to atomically write ${filePath}`);
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
  modelChoices?: Partial<Record<CliProviderId, ModelChoice>>;
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
    modelChoices: state.modelChoices,
    trustAfterEffectsMcp: state.trustAfterEffectsMcp,
    noApprovalPrompts: state.noApprovalPrompts,
  });
}

const savedSettings = loadSettings();
for (const provider of PROVIDER_ORDER) {
  try { state.modelChoices[provider] = normalizeModelChoice(savedSettings.modelChoices?.[provider]); } catch { state.modelChoices[provider] = { ...DEFAULT_MODEL_CHOICE }; }
}
// Refresh frozen system instructions when the tool contract changes. Visible
// transcript and saved model choices remain available across this migration.
function compatibleSessionVersion(version: unknown): boolean {
  return version === VERSION;
}
const providerSessions: Partial<Record<CliProviderId, string>> = compatibleSessionVersion(savedSettings.version)
  ? savedSettings.providerSessions || {}
  : {};
let conversationGeneration = 0;
let preparingGeneration: number | null = null;
class CancelledChatRequest extends Error {}
function assertCurrentConversation(generation: number): void {
  if (generation !== conversationGeneration) throw new CancelledChatRequest("Chat request cancelled.");
}

// On Windows, kill the tree while the launcher is still alive. Killing cmd.exe
// first or returning before taskkill finishes can leave the actual CLI running.
async function terminateHarnessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform !== "win32") {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve(); }, 1000);
      child.once("close", () => { clearTimeout(timer); resolve(); });
    });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let diagnostic = "";
    killer.stderr?.on("data", chunk => { diagnostic += String(chunk); });
    const timer = setTimeout(() => { killer.kill(); reject(new Error("Timed out stopping the CLI process tree.")); }, 5000);
    killer.once("error", error => { clearTimeout(timer); reject(error); });
    killer.once("close", code => {
      clearTimeout(timer);
      if (code === 0 || child.exitCode !== null) resolve();
      else reject(new Error(diagnostic.trim() || "The CLI process tree could not be stopped."));
    });
  });
}
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
  hostPhase?: string;
  lastError?: string | null;
};

function readBridgeHeartbeat(): { status: ChatState["bridgeStatus"]; message: string; heartbeat: BridgeHeartbeat | null } {
  try {
    const heartbeat = JSON.parse(fs.readFileSync(AE_HEARTBEAT_PATH, "utf8")) as BridgeHeartbeat;
    const updatedAt = typeof heartbeat.updatedAt === "number" ? heartbeat.updatedAt : Date.parse(String(heartbeat.updatedAt || ""));
    const age = Number.isFinite(updatedAt) ? Date.now() - updatedAt : Number.POSITIVE_INFINITY;
    if (age > 30000) return { status: "stale", message: "After Effects bridge heartbeat is stale.", heartbeat };
    if (heartbeat.autoRun === false || heartbeat.state === "paused") {
      return { status: "paused", message: "After Effects bridge Auto-run is disabled.", heartbeat };
    }
    if (heartbeat.lastError) return { status: "stale", message: `After Effects bridge host error: ${heartbeat.lastError}`, heartbeat };
    if (heartbeat.state === "ready" || heartbeat.state === "checking" || heartbeat.state === "starting") {
      return { status: "ready", message: heartbeat.hostPhase && heartbeat.hostPhase !== "ready" && heartbeat.hostPhase !== "executing" ? `After Effects panel is connected; host phase: ${heartbeat.hostPhase}.` : "After Effects bridge is ready.", heartbeat };
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

async function acquireAeBridgeLock(timeoutMs: number, generation = conversationGeneration): Promise<() => void> {
  fs.mkdirSync(AE_BRIDGE_DIR, { recursive: true });
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    assertCurrentConversation(generation);
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

async function runAeBridgeCommand(operation: string, action: string, parameters: Record<string, unknown> = {}, timeoutMs = 60000, generation = conversationGeneration): Promise<any> {
  const initialHealth = readBridgeHeartbeat();
  if (initialHealth.status !== "ready") throw new Error(`${initialHealth.message} Keep the combined After Effects MCP Chat panel open with Auto-run enabled in its Bridge tab (or use the optional legacy bridge).`);
  const release = await acquireAeBridgeLock(timeoutMs + 5000, generation);
  const commandId = `chat-${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    assertCurrentConversation(generation);
    // A project transition can replace the active bridge while this request is
    // waiting for the shared lock. Address the instance that owns the bridge
    // now, not the one observed before the wait.
    const health = readBridgeHeartbeat();
    if (health.status !== "ready") throw new Error(`${health.message} Keep the combined After Effects MCP Chat panel open with Auto-run enabled in its Bridge tab (or use the optional legacy bridge).`);
    writeJsonAtomic(AE_RESULT_PATH, { status: "waiting", _commandId: commandId, message: "Waiting for After Effects" });
    writeJsonAtomic(AE_COMMAND_PATH, {
      command: "aeCommand",
      id: commandId,
      chatOwnerPid: process.pid,
      args: { operation, action, ...parameters },
      bridgeInstanceId: health.heartbeat?.instanceId || null,
      timeoutMs,
      timestamp: new Date().toISOString(),
      status: "pending",
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      assertCurrentConversation(generation);
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

async function prepareAfterEffectsRequest(request: ChatRequest, generation: number): Promise<ChatRequest> {
  const prepared: ChatRequest = { ...request };
  // The CLI already has the After Effects MCP and can inspect the project when
  // the request needs it. A mandatory hidden inspection here used to block
  // every chat message while AE was busy or changing projects.
  if (request.viewerRequested) {
    try {
      const capture = await runAeBridgeCommand("frame", "capture", {}, 20000, generation);
      const viewerPath = capture?.data?.path || capture?.path;
      if (viewerPath) prepared.viewerPath = String(viewerPath);
      else prepared.viewerError = "After Effects completed the viewer capture but did not return an image path.";
    } catch (error) {
      if (error instanceof CancelledChatRequest) throw error;
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
      writeAgyMcpConfigs(mcpExecutable);
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
    path.join(process.env.APPDATA || "", "AfterEffectsMCP", "after-effects-mcp-extended.exe"),
    path.join(path.dirname(process.execPath), "after-effects-mcp-extended.exe"),
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
  private stoppingProcess: ChildProcessWithoutNullStreams | null = null;
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

    const child = spawnCli(state.cliPath!, ["app-server", "--listen", "stdio://", "-c", `mcp_servers.AfterEffectsMCP.env.AE_MCP_CHAT_OWNER_PID="${process.pid}"`], {
      cwd: os.homedir(),
      env: { ...process.env, AE_MCP_CHAT_OWNER_PID: String(process.pid) },
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
        void this.forceStopAndRestart("Codex detected an unfinished tool call in the previous session.").catch(error => logHostError("Codex recovery failed", error));
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
      if (this.process !== child) return;
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
    const generation = conversationGeneration;
    const currentSettings = loadSettings();
    const remembered = compatibleSessionVersion(currentSettings.version) ? currentSettings.threadId : null;
    if (remembered) {
      try {
        const resumed = await this.request("thread/resume", { threadId: remembered });
        assertCurrentConversation(generation);
        state.threadId = resumed.thread.id;
        saveSettings();
        saveState();
        return;
      } catch {
        assertCurrentConversation(generation);
        // The stored thread may have been removed or created by an older Codex build.
      }
    }

    const started = await this.request("thread/start", {
      cwd: os.homedir(),
      approvalPolicy: state.noApprovalPrompts ? "never" : "on-request",
      sandbox: "workspace-write",
      serviceName: "after-effects-mcp-extended",
    });
    assertCurrentConversation(generation);
    state.threadId = started.thread.id;
    saveSettings();
    saveState();
  }

  async refreshModels(): Promise<ModelCatalog> {
    await this.start();
    const models: ModelCatalog["models"] = [];
    let cursor: string | null = null;
    let defaultModel: string | undefined;
    do {
      const result = await this.request("model/list", { limit: 100, includeHidden: false, cursor }, 15000);
      for (const item of result.data || []) {
        if (item.hidden) continue;
        const id = item.model || item.id;
        if (!id) continue;
        const efforts = (item.supportedReasoningEfforts || []).map((level: any) => typeof level === "string" ? level : level.reasoningEffort).filter(Boolean);
        models.push({ id, label: item.displayName || id, efforts, defaultEffort: item.defaultReasoningEffort });
        if (item.isDefault) defaultModel = id;
      }
      cursor = result.nextCursor || null;
    } while (cursor && models.length < 500);
    let defaultEffort: string | undefined;
    try {
      const config = await this.request("config/read", { includeLayers: false }, 10000);
      defaultModel = config.config?.model || defaultModel;
      defaultEffort = config.config?.model_reasoning_effort || undefined;
    } catch { /* Older app-server versions do not expose config/read. */ }
    return { status: "ready", modelSupported: true, models, efforts: [], defaultModel, defaultEffort };
  }

  async sendTurn(request: ChatRequest, generation: number): Promise<void> {
    await this.start();
    assertCurrentConversation(generation);
    if (!state.threadId) await this.ensureThread();
    assertCurrentConversation(generation);
    if (state.cliStatus !== "ready" || !state.account) throw new Error("Sign in to Codex before starting chat.");

    const prompt = (request.prompt || "").trim();
    if (!prompt) throw new Error("Enter a message first.");
    const choice = state.modelChoices.codex || DEFAULT_MODEL_CHOICE;
    const catalog = state.modelCatalogs.codex;
    validateModelChoice(catalog, choice);

    const input: Array<Record<string, unknown>> = [];
    const attachments: Array<{ kind: "viewer" | "aeUi"; label: string; path: string }> = [];
    const contextText = request.context ? `\n\nAfter Effects context:\n${JSON.stringify(request.context, null, 2)}` : "";
    const contextNotice = request.contextError
      ? `\n\nAfter Effects context status: ${request.contextError} Continue with the request and inspect After Effects through the MCP when needed.`
      : "";
    input.push({ type: "text", text: `${prompt}${contextText}${contextNotice}` });
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
    assertCurrentConversation(generation);
    appendTranscript("user", prompt, attachments);

    // Do not create a response bubble until text actually arrives. Tool calls
    // may happen first, and a turn may contain several text/tool/text segments.
    this.assistantEntry = null;
    state.busy = true;
    state.statusText = "Codex is working...";
    state.activity = { kind: "thinking", label: "Thinking" };
    state.error = null;
    saveState();

    const model = choice.model || catalog?.defaultModel;
    const selectedModel = catalog?.models.find(item => item.id === model);
    const configuredEffort = choice.effort || (!choice.model ? catalog?.defaultEffort : undefined) || selectedModel?.defaultEffort;
    const effort = selectedModel && configuredEffort && !selectedModel.efforts?.includes(configuredEffort) ? selectedModel.defaultEffort : configuredEffort;
    let result: any;
    try { result = await this.request("turn/start", {
      threadId: state.threadId,
      input,
      approvalPolicy: state.noApprovalPrompts ? "never" : "on-request",
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
    }); } catch (error) {
      assertCurrentConversation(generation);
      state.busy = false;
      state.activeTurnId = null;
      state.approval = null;
      saveState();
      if (/timed out/.test(String(error))) await this.forceStopAndRestart("Codex did not confirm the new turn.");
      throw error;
    }
    assertCurrentConversation(generation);
    if (state.busy) state.activeTurnId = result.turn.id;
    saveState();
  }

  async stopTurn(): Promise<void> {
    if (!this.process) {
      if (this.stoppingProcess) await this.shutdown("Stopped");
      return;
    }
    const turnId = state.activeTurnId;
    state.statusText = "Stopping Codex...";
    state.activity = { kind: "stopping", label: "Stopping" };
    saveState();

    if (!state.threadId || !turnId) {
      await this.shutdown("Stopped");
      return;
    }

    try {
      await this.request("turn/interrupt", { threadId: state.threadId, turnId }, 5000);
      const deadline = Date.now() + 2000;
      while (state.activeTurnId === turnId && state.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
      if (state.activeTurnId === turnId && state.busy) await this.shutdown("Stopped");
      state.statusText = "Stopped";
      state.activity = { kind: "idle", label: "Stopped" };
      saveState();
    } catch (error) {
      logHostError("Turn interrupt failed", error);
      await this.shutdown("Stopped");
    }
  }

  async shutdown(label: string): Promise<void> {
    const child = this.process || this.stoppingProcess;
    if (child) {
      this.intentionallyStopped.add(child);
      this.process = null; // Ignore buffered output from the terminated session.
      this.stoppingProcess = child;
      this.rejectPending(new CancelledChatRequest(label));
      await terminateHarnessTree(child);
      this.stoppingProcess = null;
    }
    this.assistantEntry = null;
    state.threadId = null;
    state.activeTurnId = null;
    state.busy = false;
    state.approval = null;
    saveSettings();
  }

  private async forceStopAndRestart(detail: string): Promise<void> {
    const generation = conversationGeneration;
    state.statusText = "Stopping Codex for recovery...";
    state.activity = { kind: "stopping", label: "Stopping", detail };
    saveState();
    await this.shutdown(detail);
    if (generation !== conversationGeneration) return;
    state.statusText = "Stopped";
    state.activity = { kind: "idle", label: "Stopped" };
    state.error = null;
    saveState();
    setTimeout(() => {
      // Stop/Clear supersedes recovery; never resurrect a cancelled session.
      if (generation !== conversationGeneration || state.provider !== "codex" || state.busy) {
        this.recoveringProtocol = false;
        return;
      }
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
    if (/^(turn|item)\//.test(message.method || "")) {
      if (state.provider !== "codex" || !state.busy) return;
      if (params.threadId && params.threadId !== state.threadId) return;
      const eventTurn = params.turnId || params.turn?.id;
      if (eventTurn && state.activeTurnId && eventTurn !== state.activeTurnId) return;
    }
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
      state.error = params.turn?.error?.message || null;
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

function writeAgyMcpConfigs(mcpExecutable: string): void {
  const standard = createStandardMcpConfig(mcpExecutable) as { mcpServers: Record<string, unknown> };
  const workspaceDirectory = path.join(CHAT_DIR, ".agents");
  fs.mkdirSync(workspaceDirectory, { recursive: true });
  writeJsonAtomic(path.join(workspaceDirectory, "mcp_config.json"), standard);

  // AGY 1.1.9 does not reliably discover workspace-local MCP configuration
  // in headless print mode on Windows. Its global config is loaded reliably.
  // Merge only our named server so existing user MCP servers are preserved.
  const globalDirectory = path.join(os.homedir(), ".gemini", "config");
  const globalPath = path.join(globalDirectory, "mcp_config.json");
  fs.mkdirSync(globalDirectory, { recursive: true });
  let existing: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(globalPath, "utf8").replace(/^\uFEFF/, "").trim();
    if (raw) existing = JSON.parse(raw);
  } catch {}
  const existingServers = existing.mcpServers && typeof existing.mcpServers === "object" && !Array.isArray(existing.mcpServers)
    ? existing.mcpServers as Record<string, unknown>
    : {};
  writeJsonAtomic(globalPath, {
    ...existing,
    mcpServers: { ...existingServers, AfterEffectsMCP: standard.mcpServers.AfterEffectsMCP },
  });
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
  private stopping = false;
  private assistantEntry: TranscriptEntry | null = null;
  private hasStreamedText = false;
  private activityIds = new Set<string>();
  private providerError: string | null = null;

  async sendTurn(request: ChatRequest, generation: number): Promise<void> {
    if (state.provider === "codex") throw new Error("Codex uses the app-server adapter.");
    if (!state.cliPath || state.cliStatus !== "ready") throw new Error(`Sign in to ${state.providerName} before starting chat.`);
    const prompt = (request.prompt || "").trim();
    if (!prompt) throw new Error("Enter a message first.");
    this.providerError = null;
    this.stopping = false;
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
    const contextNotice = request.contextError
      ? `\n\nAfter Effects context status: ${request.contextError} Continue with the request and inspect After Effects through the MCP when needed.`
      : "";
    const noticeText = notices.length ? `\n\nAttachment status:\n${notices.join("\n")} Do not claim to see an image that was not attached.` : "";
    const attachmentText = attachmentPaths.length
      ? `\n\nAttached images (inspect these files as part of the request):\n${attachmentPaths.map((filePath) => `- ${filePath}`).join("\n")}`
      : "";
    const promptText = `${prompt}${contextText}${contextNotice}${attachmentText}${noticeText}`;
    const promptFile = path.join(ATTACHMENT_DIR, `${state.provider}-prompt-${Date.now()}.txt`);
    fs.writeFileSync(promptFile, promptText, "utf8");
    assertCurrentConversation(generation);
    appendTranscript("user", prompt, attachments);

    const mcpExecutable = writeProviderMcpConfig();
    const piExtensionPath = findPiExtensionPath();
    if (state.provider === "pi" && !piExtensionPath) throw new Error("The bundled Pi After Effects adapter could not be found.");
    const provider = state.provider;
    const kimiFlavor = provider === "kimi" ? detectKimiCliFlavor(state.cliPath) : undefined;
    if (kimiFlavor === "kimi-code") writeKimiCodeProjectMcpConfig(mcpExecutable);
    if (provider === "agy") writeAgyMcpConfigs(mcpExecutable);
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
      modelChoice: state.modelChoices[provider] || DEFAULT_MODEL_CHOICE,
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
      cwd: CHAT_DIR, env: { ...runSpec.env, AE_MCP_CHAT_OWNER_PID: String(process.pid) }, stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    if (runSpec.stdinText) child.stdin?.end(runSpec.stdinText);
    else child.stdin?.end();
    const output = readline.createInterface({ input: child.stdout! });
    output.on("line", (line) => { if (this.child === child && !this.stopping && generation === conversationGeneration) this.handleLine(provider, line); });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => { if (this.child === child && !this.stopping) this.finish(false, String(error)); });
    child.on("close", (code) => {
      if (this.child !== child || this.stopping) return;
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
        const detail = event.toolDetail || "Using tool";
        const isAe = /after.?effects|aftereffectsmcp/i.test(`${name} ${detail}`);
        const activityId = event.toolId || `${Date.now()}-tool`;
        this.activityIds.add(activityId);
        state.activityLog.push({
          id: activityId, kind: isAe ? "afterEffects" : "tool",
          label: isAe ? "After Effects" : name, detail: detail.slice(0, 500),
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
    if (!child) return;
    state.statusText = `Stopping ${state.providerName}...`;
    state.activity = { kind: "stopping", label: "Stopping" };
    saveState();
    this.stopping = true;
    await terminateHarnessTree(child);
    this.child = null;
    this.stopping = false;
    this.finish(true, undefined, true);
    state.statusText = "Stopped";
    state.activity = { kind: "idle", label: "Stopped" };
    saveState();
  }

  private finish(success: boolean, error?: string, cancelled = false): void {
    this.child = null;
    state.busy = false;
    state.activeTurnId = null;
    this.assistantEntry = null;
    this.hasStreamedText = false;
    this.providerError = null;
    for (const activity of state.activityLog) {
      if (this.activityIds.has(activity.id) && activity.status === "running") activity.status = cancelled ? "cancelled" : success ? "completed" : "failed";
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
const modelDiscoveries = new Map<CliProviderId, Promise<void>>();

function refreshModels(provider = state.provider, force = false): void {
  if (modelDiscoveries.has(provider) || (!force && state.modelCatalogs[provider])) return;
  const snapshot = state.providers.find(item => item.id === provider);
  const executable = snapshot?.cliPath || (provider === state.provider ? state.cliPath : null);
  if (!executable) return;
  state.modelCatalogs[provider] = { status: "loading", models: [], modelSupported: true, efforts: [] };
  saveState();
  const discovery = (provider === "codex" ? appServer.refreshModels() : discoverCliModels(provider, executable, CHAT_DIR))
    .then(catalog => { state.modelCatalogs[provider] = catalog; })
    .catch(() => {
      state.modelCatalogs[provider] = { status: "unavailable", models: [], modelSupported: true, efforts: [], message: "Model discovery unavailable. Use CLI default or a custom model ID, then refresh when signed in." };
    }).finally(() => {
      modelDiscoveries.delete(provider);
      saveState();
    });
  modelDiscoveries.set(provider, discovery);
}

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
      refreshModels(state.provider, true);
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
        const prompt = (request.prompt || "").trim();
        if (!prompt) throw new Error("Enter a message first.");
        if (state.busy) throw new Error(`${state.providerName} is already working. Stop the current turn or wait for it to finish.`);
        validateModelChoice(state.modelCatalogs[state.provider], state.modelChoices[state.provider] || DEFAULT_MODEL_CHOICE);
        const generation = conversationGeneration;
        preparingGeneration = generation;
        state.busy = true;
        state.statusText = "Preparing request...";
        state.activity = { kind: "thinking", label: "Preparing request" };
        saveState();
        try {
          const preparedRequest = await prepareAfterEffectsRequest(request, generation);
          assertCurrentConversation(generation);
          if (state.provider === "codex") await appServer.sendTurn(preparedRequest, generation);
          else await genericCli.sendTurn(preparedRequest, generation);
        } catch (error) {
          if (error instanceof CancelledChatRequest) return;
          if (generation === conversationGeneration) { state.busy = false; saveState(); }
          throw error;
        } finally {
          if (preparingGeneration === generation) preparingGeneration = null;
        }
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
    case "refreshModels":
      refreshModels(state.provider, true);
      break;
    case "setModel": {
      if (state.busy) throw new Error("Wait for the current turn to finish before changing its model.");
      if (request.providerId !== state.provider) throw new Error("The CLI selection changed. Choose the model again for the active CLI.");
      const choice = normalizeModelChoice(request.modelChoice);
      validateModelChoice(state.modelCatalogs[state.provider], choice);
      const previous = state.modelChoices[state.provider] || DEFAULT_MODEL_CHOICE;
      // A resumed CLI session can retain its previous model/effort even when
      // flags are omitted. Reset only when returning an override to default.
      if ((!choice.model && previous.model) || (!choice.effort && previous.effort)) {
        if (state.provider === "codex") state.threadId = null;
        else delete providerSessions[state.provider];
      }
      state.modelChoices[state.provider] = choice;
      state.error = null;
      saveSettings();
      saveState();
      break;
    }
    case "selectProvider": {
      if (!request.providerId || !PROVIDERS[request.providerId]) throw new Error("Unknown CLI provider.");
      // Re-selecting the active provider is a harmless duplicate request that
      // CEP can leave queued while the panel is being redrawn.
      if (request.providerId === state.provider) break;
      if (state.busy) throw new Error(`Stop the active ${state.providerName} turn before switching CLI tools.`);
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
      refreshModels();
      break;
    }
    case "openProviderDocs":
      openExternalUrl(PROVIDERS[state.provider].docsUrl);
      break;
    case "clearTranscript":
      await appServer.shutdown("New conversation");
      for (const provider of PROVIDER_ORDER) delete providerSessions[provider];
      state.transcript = [];
      state.activityLog = [];
      state.threadId = null;
      state.activeTurnId = null;
      state.approval = null;
      state.busy = false;
      state.error = null;
      state.statusText = "New conversation";
      state.activity = { kind: "idle", label: "New conversation" };
      saveSettings();
      saveState();
      break;
    default:
      throw new Error(`Unknown chat action: ${request.action}`);
  }
}

let processing = false;
let controlInProgress: Promise<void> | null = null;
function cancelOwnedPendingAeCommand(): void {
  try {
    const command = JSON.parse(fs.readFileSync(AE_COMMAND_PATH, "utf8"));
    if (command.status !== "pending" || command.chatOwnerPid !== process.pid) return;
    command.status = "error";
    command.statusUpdatedAt = Date.now();
    writeJsonAtomic(AE_COMMAND_PATH, command);
    writeJsonAtomic(AE_RESULT_PATH, { status: "error", _commandId: command.id, message: "Cancelled by the chat Stop/Clear button before execution." });
  } catch {}
}
async function pollControls(): Promise<void> {
  if (controlInProgress) return;
  for (const name of fs.readdirSync(REQUEST_DIR).filter(name => name.endsWith(".json")).sort()) {
    const filePath = path.join(REQUEST_DIR, name);
    let request: ChatRequest;
    try { request = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")); } catch { continue; }
    if (request.action !== "stop" && request.action !== "clearTranscript") continue;
    fs.unlinkSync(filePath);
    conversationGeneration++;
    // Discard sends already queued at cancellation, not future sends sharing
    // the same millisecond timestamp or requests from an unrelated MCP client.
    for (const queuedName of fs.readdirSync(REQUEST_DIR).filter(name => name.endsWith(".json"))) {
      const queuedPath = path.join(REQUEST_DIR, queuedName);
      try { if (JSON.parse(fs.readFileSync(queuedPath, "utf8")).action === "send") fs.unlinkSync(queuedPath); } catch {}
    }
    cancelOwnedPendingAeCommand();
    state.statusText = "Stopping...";
    state.activity = { kind: "stopping", label: "Stopping" };
    saveState();
    controlInProgress = (async () => {
      if (state.provider === "codex") await appServer.stopTurn();
      else await genericCli.stopTurn();
      cancelOwnedPendingAeCommand();
      for (const activity of state.activityLog) if (activity.status === "running") activity.status = "cancelled";
      preparingGeneration = null;
      state.busy = false;
      state.activeTurnId = null;
      state.approval = null;
      state.error = null;
      state.statusText = "Stopped";
      state.activity = { kind: "idle", label: "Stopped" };
      if (request.action === "clearTranscript") await handleRequest(request);
      saveState();
    })().catch(error => {
      state.error = String(error);
      state.statusText = "Unable to stop the harness";
      state.activity = { kind: "error", label: "Stop failed", detail: String(error) };
      saveState();
    }).finally(() => { controlInProgress = null; });
    // Do not await: this lane must remain available while send/preparation is
    // awaiting a host capture, app-server startup, or turn/start response.
    return;
  }
}
async function pollRequests(): Promise<void> {
  await pollControls();
  if (controlInProgress) return;
  if (processing) return;
  processing = true;
  try {
    const files = fs.readdirSync(REQUEST_DIR).filter((name) => name.toLowerCase().endsWith(".json")).sort();
    for (const name of files) {
      if (controlInProgress) break;
      const requestPath = path.join(REQUEST_DIR, name);
      try {
        if (!fs.existsSync(requestPath)) continue;
        const rawRequest = fs.readFileSync(requestPath, "utf8").replace(/^\uFEFF/, "");
        fs.unlinkSync(requestPath);
        const request = JSON.parse(rawRequest) as ChatRequest;
        await handleRequest(request);
      } catch (error) {
        if (error instanceof CancelledChatRequest) continue;
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
refreshModels();
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
