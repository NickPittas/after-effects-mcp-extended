import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";

type TranscriptRole = "user" | "assistant" | "system";

type TranscriptEntry = {
  id: string;
  role: TranscriptRole;
  text: string;
  time: string;
  attachments?: Array<{ kind: "viewer" | "aeUi"; label: string; path: string }>;
};

type ActivityEvent = {
  id: string;
  kind: "afterEffects" | "tool" | "command" | "files" | "search";
  label: string;
  detail: string;
  status: "running" | "completed" | "failed";
  time: string;
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
  hostStatus: "starting" | "ready" | "error";
  cliStatus: "checking" | "missing" | "signedOut" | "ready" | "installing";
  cliPath: string | null;
  cliVersion: string | null;
  mcpStatus: "unknown" | "ready" | "missing";
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
};

const VERSION = "1.9.10";
const CHAT_DIR = path.join(os.homedir(), "Documents", "ae-mcp-bridge", "codex-chat");
const REQUEST_DIR = path.join(CHAT_DIR, "requests");
const ATTACHMENT_DIR = path.join(CHAT_DIR, "attachments");
const STATE_PATH = path.join(CHAT_DIR, "state.json");
const SETTINGS_PATH = path.join(CHAT_DIR, "settings.json");
const LOCK_PATH = path.join(CHAT_DIR, "host.lock");
const LOG_PATH = path.join(CHAT_DIR, "host.log");

for (const directory of [CHAT_DIR, REQUEST_DIR, ATTACHMENT_DIR]) {
  fs.mkdirSync(directory, { recursive: true });
}

let state: ChatState = {
  version: VERSION,
  hostStatus: "starting",
  cliStatus: "checking",
  cliPath: null,
  cliVersion: null,
  mcpStatus: "unknown",
  threadId: null,
  activeTurnId: null,
  busy: false,
  statusText: "Starting Codex companion...",
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
    attachments: attachments?.length ? attachments : undefined,
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

function loadSettings(): { version?: string; threadId?: string; trustAfterEffectsMcp?: boolean; noApprovalPrompts?: boolean } {
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
    trustAfterEffectsMcp: state.trustAfterEffectsMcp,
    noApprovalPrompts: state.noApprovalPrompts,
  });
}

const savedSettings = loadSettings();
state.trustAfterEffectsMcp = savedSettings.trustAfterEffectsMcp !== false;
state.noApprovalPrompts = savedSettings.noApprovalPrompts !== false;

function executableCandidates(): string[] {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
    path.join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin", "codex.exe"),
    path.join(os.homedir(), ".local", "bin", "codex.exe"),
  ];

  const where = spawnSync("where.exe", ["codex.exe"], { encoding: "utf8", windowsHide: true });
  if (where.status === 0 && where.stdout) {
    candidates.unshift(...where.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean));
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

function checkCodex(): boolean {
  state.cliStatus = "checking";
  state.statusText = "Checking Codex CLI...";
  saveState();

  for (const candidate of executableCandidates()) {
    if (!fs.existsSync(candidate)) continue;
    const version = spawnSync(candidate, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
    if (version.status !== 0) continue;

    state.cliPath = candidate;
    state.cliVersion = `${version.stdout || version.stderr}`.trim() || "Installed";
    const login = spawnSync(candidate, ["login", "status"], { encoding: "utf8", windowsHide: true, timeout: 15000 });
    state.cliStatus = login.status === 0 ? "ready" : "signedOut";
    state.statusText = login.status === 0 ? "Codex is ready" : "Codex is installed — sign in required";
    state.error = null;
    if (login.status !== 0) state.account = null;
    if (login.status === 0) ensureMcpRegistration();
    saveState();
    return true;
  }

  state.cliPath = null;
  state.cliVersion = null;
  state.mcpStatus = "unknown";
  state.cliStatus = "missing";
  state.statusText = "Codex CLI is not installed";
  saveState();
  return false;
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
  const existing = spawnSync(state.cliPath, ["mcp", "get", "AfterEffectsMCP"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  if (existing.status === 0) {
    state.mcpStatus = "ready";
    return;
  }

  const mcpExecutable = findBundledMcpExecutable();
  if (!mcpExecutable) {
    state.mcpStatus = "missing";
    return;
  }
  const added = spawnSync(state.cliPath, ["mcp", "add", "AfterEffectsMCP", "--", mcpExecutable], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 20000,
  });
  state.mcpStatus = added.status === 0 ? "ready" : "missing";
  if (added.status !== 0) {
    state.error = `${added.stderr || added.stdout || "Unable to register AfterEffectsMCP"}`.trim();
  }
}

function installCodex(): void {
  if (state.cliStatus === "installing") return;
  state.cliStatus = "installing";
  state.statusText = "Installing Codex CLI...";
  state.error = null;
  appendTranscript("system", "Installing Codex CLI with the official standalone Windows installer...");

  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://chatgpt.com/codex/install.ps1 | iex"],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (chunk) => appendTranscript("system", String(chunk).trim()));
  child.stderr.on("data", (chunk) => appendTranscript("system", String(chunk).trim()));
  child.on("close", (code) => {
    if (code === 0 && checkCodex()) {
      appendTranscript("system", "Codex CLI installation completed.");
    } else {
      state.cliStatus = "missing";
      state.statusText = "Codex CLI installation failed";
      state.error = `Installer exited with code ${code}`;
      appendTranscript("system", `${state.error}. Use Open Official Instructions for the manual option.`);
      saveState();
    }
  });
}

function openExternalUrl(url: string): void {
  if (!/^https:\/\//i.test(url)) throw new Error("Codex returned an invalid sign-in URL.");
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

    const child = spawn(state.cliPath!, ["app-server", "--listen", "stdio://"], {
      cwd: os.homedir(),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
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

    this.assistantEntry = {
      id: `${Date.now()}-assistant`,
      role: "assistant",
      text: "",
      time: new Date().toISOString(),
    };
    state.transcript.push(this.assistantEntry);
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
        this.assistantEntry = { id: `${Date.now()}-assistant`, role: "assistant", text: "", time: new Date().toISOString() };
        state.transcript.push(this.assistantEntry);
      }
      this.assistantEntry.text += params.delta || "";
      state.statusText = "Codex is responding...";
      state.activity = { kind: "responding", label: "Responding" };
    } else if (message.method === "item/completed" && params.item?.type === "agentMessage") {
      const finalText = params.item.text || params.item.content || "";
      if (this.assistantEntry && finalText) this.assistantEntry.text = typeof finalText === "string" ? finalText : JSON.stringify(finalText);
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

const appServer = new AppServerClient();

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
      checkCodex();
      break;
    case "installCodex":
      installCodex();
      break;
    case "login":
      await appServer.startLogin(false);
      break;
    case "relogin":
      await appServer.startLogin(true);
      break;
    case "send":
      await appServer.sendTurn(request);
      break;
    case "stop":
      await appServer.stopTurn();
      break;
    case "approval":
      appServer.respondToApproval(request.decision);
      break;
    case "updateSettings":
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
if (checkCodex()) {
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
setInterval(() => saveState(), 2000);
