import { spawn, spawnSync, type ChildProcess, type SpawnOptions, type SpawnSyncOptions } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type CliProviderId = "codex" | "claude" | "gemini" | "kimi" | "pi" | "opencode";

export type ProviderDefinition = {
  id: CliProviderId;
  label: string;
  shortLabel: string;
  executableNames: string[];
  knownPaths: string[];
  versionArgs: string[];
  docsUrl: string;
  installKind: "powershell" | "npm";
  installCommand: string | string[];
  accountHint: string;
  nativeMcp: boolean;
};

export type ProviderSnapshot = {
  id: CliProviderId;
  label: string;
  shortLabel: string;
  installed: boolean;
  cliStatus: "checking" | "missing" | "signedOut" | "ready" | "installing";
  cliPath: string | null;
  cliVersion: string | null;
  mcpStatus: "unknown" | "ready" | "missing";
  account: { type: string; label: string; email: string | null; planType: string | null } | null;
  docsUrl: string;
  installKind: "powershell" | "npm";
  accountHint: string;
  nativeMcp: boolean;
};

export type ProviderRunSpec = {
  args: string[];
  env?: NodeJS.ProcessEnv;
  stdinText?: string;
};

export type KimiCliFlavor = "kimi-code" | "kimi-cli";

export type NormalizedProviderEvent = {
  kind: "textDelta" | "finalText" | "toolStart" | "toolEnd" | "error" | "complete" | "session";
  text?: string;
  sessionId?: string;
  toolId?: string;
  toolName?: string;
  toolDetail?: string;
  failed?: boolean;
};

const home = os.homedir();
const appData = process.env.APPDATA || "";
const localAppData = process.env.LOCALAPPDATA || "";

export const PROVIDERS: Record<CliProviderId, ProviderDefinition> = {
  codex: {
    id: "codex",
    label: "Codex",
    shortLabel: "Codex",
    executableNames: ["codex.exe", "codex.cmd", "codex"],
    knownPaths: [
      path.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
      path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe"),
      path.join(home, ".local", "bin", "codex.exe"),
    ],
    versionArgs: ["--version"],
    docsUrl: "https://developers.openai.com/codex/cli/",
    installKind: "powershell",
    installCommand: "irm https://chatgpt.com/codex/install.ps1 | iex",
    accountHint: "ChatGPT or OpenAI API account",
    nativeMcp: true,
  },
  claude: {
    id: "claude",
    label: "Claude Code",
    shortLabel: "Claude",
    executableNames: ["claude.exe", "claude.cmd", "claude"],
    knownPaths: [path.join(appData, "npm", "claude.cmd"), path.join(home, ".local", "bin", "claude.exe")],
    versionArgs: ["--version"],
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
    installKind: "npm",
    installCommand: ["install", "-g", "@anthropic-ai/claude-code"],
    accountHint: "Claude subscription or Anthropic API account",
    nativeMcp: true,
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    shortLabel: "Gemini",
    executableNames: ["gemini.exe", "gemini.cmd", "gemini"],
    knownPaths: [path.join(appData, "npm", "gemini.cmd"), path.join(home, ".local", "bin", "gemini.exe")],
    versionArgs: ["--version"],
    docsUrl: "https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/index.md",
    installKind: "npm",
    installCommand: ["install", "-g", "@google/gemini-cli"],
    accountHint: "Google Cloud, enterprise, or API-key authentication",
    nativeMcp: true,
  },
  kimi: {
    id: "kimi",
    label: "Kimi CLI",
    shortLabel: "Kimi",
    executableNames: ["kimi.exe", "kimi.cmd", "kimi"],
    knownPaths: [
      path.join(home, ".local", "bin", "kimi.exe"),
      path.join(home, ".kimi", "bin", "kimi.exe"),
      path.join(appData, "npm", "kimi.cmd"),
    ],
    versionArgs: ["--version"],
    docsUrl: "https://moonshotai.github.io/kimi-cli/en/",
    installKind: "powershell",
    installCommand: "irm https://code.kimi.com/kimi-code/install.ps1 | iex",
    accountHint: "Kimi Code OAuth or Moonshot API account",
    nativeMcp: true,
  },
  pi: {
    id: "pi",
    label: "Pi",
    shortLabel: "Pi",
    executableNames: ["pi.exe", "pi.cmd", "pi"],
    knownPaths: [path.join(appData, "npm", "pi.cmd"), path.join(home, ".local", "bin", "pi.exe")],
    versionArgs: ["--version"],
    docsUrl: "https://pi.dev/docs/latest/windows",
    installKind: "npm",
    installCommand: ["install", "-g", "--ignore-scripts", "@earendil-works/pi-coding-agent"],
    accountHint: "Pi provider subscription or API key",
    nativeMcp: false,
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    shortLabel: "OpenCode",
    executableNames: ["opencode.exe", "opencode.cmd", "opencode"],
    knownPaths: [
      path.join(home, ".opencode", "bin", "opencode.exe"),
      path.join(appData, "npm", "opencode.cmd"),
      path.join(localAppData, "opencode", "opencode.exe"),
    ],
    versionArgs: ["--version"],
    docsUrl: "https://opencode.ai/docs/",
    installKind: "npm",
    installCommand: ["install", "-g", "opencode-ai"],
    accountHint: "OpenCode provider or API-key authentication",
    nativeMcp: true,
  },
};

export const PROVIDER_ORDER: CliProviderId[] = ["codex", "claude", "gemini", "kimi", "pi", "opencode"];

function quoteCmdArgument(value: string): string {
  if (/^[A-Za-z0-9_./:=,@+\\-]+$/.test(value)) return value;
  return `"${value.replace(/%/g, "%%").replace(/"/g, '""')}"`;
}

export function executableInvocation(executable: string, args: string[]): { command: string; args: string[]; windowsVerbatimArguments?: boolean } {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    // cmd.exe requires an outer quote pair around a command whose executable
    // path is itself quoted. windowsVerbatimArguments prevents Node from
    // turning those quotes into literal \" characters.
    const innerCommand = [quoteCmdArgument(executable), ...args.map(quoteCmdArgument)].join(" ");
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", `"${innerCommand}"`],
      windowsVerbatimArguments: true,
    };
  }
  return { command: executable, args };
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function visibleTerminalInvocation(executable: string, args: string[], title: string): { command: string; args: string[] } {
  const terminalScript = [
    `$Host.UI.RawUI.WindowTitle = ${quotePowerShellLiteral(title)}`,
    `& ${quotePowerShellLiteral(executable)} ${args.map(quotePowerShellLiteral).join(" ")}`.trim(),
  ].join("\n");
  const terminalCommand = Buffer.from(terminalScript, "utf16le").toString("base64");
  const launcherScript = [
    `$process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit','-NoProfile','-EncodedCommand',${quotePowerShellLiteral(terminalCommand)}) -WindowStyle Normal -PassThru`,
    `if ($null -eq $process) { exit 1 }`,
  ].join("\n");
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-EncodedCommand", Buffer.from(launcherScript, "utf16le").toString("base64")],
  };
}

export function spawnCli(executable: string, args: string[], options: SpawnOptions = {}): ChildProcess {
  const invocation = executableInvocation(executable, args);
  return spawn(invocation.command, invocation.args, {
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    ...options,
  });
}

export function spawnCliSync(
  executable: string,
  args: string[],
  options: SpawnSyncOptions = {},
): ReturnType<typeof spawnSync> {
  const invocation = executableInvocation(executable, args);
  return spawnSync(invocation.command, invocation.args, {
    windowsHide: true,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    encoding: "utf8",
    ...options,
  });
}

export function findProviderExecutable(id: CliProviderId): string | null {
  const definition = PROVIDERS[id];
  const candidates: string[] = [];
  for (const executableName of definition.executableNames) {
    const found = spawnSync("where.exe", [executableName], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    if (found.status === 0 && found.stdout) {
      candidates.push(...String(found.stdout).split(/\r?\n/).map((value) => value.trim()).filter(Boolean));
    }
  }
  candidates.push(...definition.knownPaths);
  const unique = candidates.filter((candidate, index) => {
    if (!candidate || !fs.existsSync(candidate)) return false;
    if (process.platform === "win32" && !/\.(exe|com|cmd|bat)$/i.test(candidate)) return false;
    return candidates.findIndex((other) => other.toLowerCase() === candidate.toLowerCase()) === index;
  });
  if (process.platform === "win32") {
    unique.sort((left, right) => {
      const rank = (value: string) => /\.(exe|com)$/i.test(value) ? 0 : 1;
      return rank(left) - rank(right);
    });
  }
  for (const candidate of unique) {
    const probe = spawnCliSync(candidate, definition.versionArgs, { timeout: 10000 });
    if (probe.status === 0) return candidate;
  }
  return null;
}

function directoryHasFiles(directory: string): boolean {
  try { return fs.readdirSync(directory).some((name) => !name.startsWith(".")); }
  catch { return false; }
}

function fileHasKimiCredential(filePath: string): boolean {
  try {
    const value = fs.readFileSync(filePath, "utf8");
    return /\b(?:api_key|[A-Z][A-Z0-9_]*_API_KEY)\s*=\s*["'][^"']+["']/i.test(value);
  } catch {
    return false;
  }
}

export function detectKimiCliFlavor(executable: string): KimiCliFlavor {
  const help = spawnCliSync(executable, ["--help"], { timeout: 10000 });
  const output = `${help.stdout || help.stderr || ""}`;
  return /--mcp-config-file\b|--print\b/i.test(output) ? "kimi-cli" : "kimi-code";
}

function parseAccountLabel(value: unknown, fallback: string): string {
  if (!value) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.email || record.account || record.subscriptionType || record.authMethod || fallback);
  }
  return fallback;
}

function identityFromJsonFile(filePath: string): string | null {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const queue: unknown[] = [value];
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== "object") continue;
      if (Array.isArray(current)) { queue.push(...current); continue; }
      const record = current as Record<string, unknown>;
      for (const key of ["email", "username", "userName", "account", "accountName", "displayName"]) {
        if (typeof record[key] === "string" && String(record[key]).trim()) return String(record[key]).trim();
      }
      for (const [key, nested] of Object.entries(record)) {
        if (!/(token|secret|key|credential)/i.test(key)) queue.push(nested);
      }
    }
  } catch {}
  return null;
}

function identityFromJsonDirectory(directory: string): string | null {
  try {
    for (const name of fs.readdirSync(directory)) {
      if (!name.toLowerCase().endsWith(".json")) continue;
      const identity = identityFromJsonFile(path.join(directory, name));
      if (identity) return identity;
    }
  } catch {}
  return null;
}

function piProviderNames(authPath: string): string[] {
  try {
    const value = JSON.parse(fs.readFileSync(authPath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    return Object.keys(value as Record<string, unknown>).filter((name) => name.trim() && !name.startsWith("_"));
  } catch {
    return [];
  }
}

export function inspectProvider(id: CliProviderId, checkAuthentication = true): ProviderSnapshot {
  const definition = PROVIDERS[id];
  const executable = findProviderExecutable(id);
  const missing: ProviderSnapshot = {
    id,
    label: definition.label,
    shortLabel: definition.shortLabel,
    installed: false,
    cliStatus: "missing",
    cliPath: null,
    cliVersion: null,
    mcpStatus: "unknown",
    account: null,
    docsUrl: definition.docsUrl,
    installKind: definition.installKind,
    accountHint: definition.accountHint,
    nativeMcp: definition.nativeMcp,
  };
  if (!executable) return missing;

  const versionResult = spawnCliSync(executable, definition.versionArgs, { timeout: 10000 });
  if (versionResult.status !== 0) return missing;
  const version = `${versionResult.stdout || versionResult.stderr || ""}`.trim() || "Installed";
  if (!checkAuthentication) {
    return { ...missing, installed: true, cliStatus: "signedOut", cliPath: executable, cliVersion: version };
  }
  let ready = false;
  let accountLabel = `${definition.label} CLI`;

  if (id === "codex") {
    const status = spawnCliSync(executable, ["login", "status"], { timeout: 15000 });
    ready = status.status === 0;
    accountLabel = ready ? "OpenAI account" : accountLabel;
  } else if (id === "claude") {
    const status = spawnCliSync(executable, ["auth", "status", "--json"], { timeout: 15000 });
    ready = status.status === 0;
    try {
      const parsed = JSON.parse(String(status.stdout || "{}"));
      ready = ready && parsed.loggedIn !== false;
      accountLabel = parseAccountLabel(parsed, "Claude account");
    } catch {}
  } else if (id === "gemini") {
    const accountsPath = path.join(home, ".gemini", "google_accounts.json");
    ready = Boolean(
      process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      fs.existsSync(path.join(home, ".gemini", "oauth_creds.json")) ||
      fs.existsSync(path.join(home, ".gemini", "google_accounts.json")),
    );
    accountLabel = ready ? identityFromJsonFile(accountsPath) || "Gemini authentication" : accountLabel;
  } else if (id === "kimi") {
    const codeHome = process.env.KIMI_CODE_HOME || path.join(home, ".kimi-code");
    const dataRoots = [codeHome, path.join(home, ".kimi")];
    const credentialDirectory = dataRoots.map((root) => path.join(root, "credentials")).find(directoryHasFiles);
    ready = Boolean(credentialDirectory) || dataRoots.some((root) => fileHasKimiCredential(path.join(root, "config.toml")));
    accountLabel = ready && credentialDirectory ? identityFromJsonDirectory(credentialDirectory) || "Kimi account" : ready ? "Kimi provider" : accountLabel;
  } else if (id === "pi") {
    const authPath = path.join(home, ".pi", "agent", "auth.json");
    const configuredProviders = piProviderNames(authPath);
    ready = configuredProviders.length > 0 || Boolean(
      process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.KIMI_API_KEY,
    );
    accountLabel = configuredProviders.length
      ? `Pi: ${configuredProviders.join(", ")}`
      : ready ? "Pi environment credentials" : accountLabel;
  } else if (id === "opencode") {
    const status = spawnCliSync(executable, ["auth", "list"], { timeout: 15000 });
    const output = `${status.stdout || status.stderr || ""}`.trim();
    ready = status.status === 0 && /\b[1-9]\d*\s+credentials?\b/i.test(output);
    accountLabel = ready ? "OpenCode provider" : accountLabel;
  }

  return {
    ...missing,
    installed: true,
    cliStatus: ready ? "ready" : "signedOut",
    cliPath: executable,
    cliVersion: version,
    mcpStatus: "unknown",
    account: ready ? { type: id, label: accountLabel, email: null, planType: null } : null,
  };
}

export function createStandardMcpConfig(mcpExecutable: string): Record<string, unknown> {
  return {
    mcpServers: {
      AfterEffectsMCP: { command: mcpExecutable, args: [] },
    },
  };
}

export function createOpenCodeMcpConfig(mcpExecutable: string, systemPromptPath?: string): Record<string, unknown> {
  return {
    $schema: "https://opencode.ai/config.json",
    ...(systemPromptPath ? { instructions: [systemPromptPath] } : {}),
    mcp: {
      AfterEffectsMCP: {
        type: "local",
        command: [mcpExecutable],
        enabled: true,
        timeout: 600000,
      },
    },
  };
}

export function buildProviderRunSpec(input: {
  provider: CliProviderId;
  promptText: string;
  promptFile: string;
  attachmentPaths: string[];
  sessionId: string | null;
  autoApprove: boolean;
  mcpConfigPath: string;
  mcpExecutable: string;
  systemPrompt: string;
  systemPromptPath: string;
  piExtensionPath: string;
  piSessionDir: string;
  kimiFlavor?: KimiCliFlavor;
}): ProviderRunSpec {
  const commonEnv = { ...process.env, AE_MCP_EXECUTABLE: input.mcpExecutable };
  if (input.provider === "claude") {
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--mcp-config", input.mcpConfigPath, "--append-system-prompt-file", input.systemPromptPath];
    if (input.autoApprove) args.push("--dangerously-skip-permissions");
    if (input.sessionId) args.push("--resume", input.sessionId);
    args.push("--add-dir", path.dirname(input.promptFile));
    return { args, env: commonEnv, stdinText: input.promptText };
  }
  if (input.provider === "gemini") {
    const args = ["--skip-trust", "--output-format", "stream-json", "--include-directories", path.dirname(input.promptFile), "-p", `Read and follow the request in @${input.promptFile}`];
    if (input.autoApprove) args.unshift("--approval-mode=yolo");
    if (input.sessionId) args.unshift("--resume", input.sessionId);
    return { args, env: commonEnv };
  }
  if (input.provider === "kimi") {
    if (input.kimiFlavor === "kimi-code") {
      const args = ["--output-format", "stream-json"];
      if (input.sessionId) args.push("--continue");
      args.push("--prompt", input.promptText);
      return { args, env: commonEnv };
    }
    const args = ["--print", "--output-format=stream-json", "--mcp-config-file", input.mcpConfigPath];
    if (input.sessionId) args.push("--continue");
    return { args, env: commonEnv, stdinText: input.promptText };
  }
  if (input.provider === "pi") {
    const args = ["--print", "--mode", "json", "--session-dir", input.piSessionDir, "--extension", input.piExtensionPath, "--append-system-prompt", input.systemPromptPath];
    if (input.sessionId) args.push("--continue");
    args.push(`@${input.promptFile}`);
    for (const attachmentPath of input.attachmentPaths) args.push(`@${attachmentPath}`);
    args.push("Follow the attached request and use the After Effects tool when needed.");
    return { args, env: commonEnv };
  }
  if (input.provider === "opencode") {
    const args = ["run", "--format", "json"];
    if (input.autoApprove) args.push("--auto");
    if (input.sessionId) args.push("--session", input.sessionId);
    for (const attachmentPath of input.attachmentPaths) args.push("--file", attachmentPath);
    // OpenCode's --file option accepts multiple values. Without an explicit
    // terminator it interprets the following message as another file path.
    args.push("--", input.promptText);
    return {
      args,
      env: { ...commonEnv, OPENCODE_CONFIG_CONTENT: JSON.stringify(createOpenCodeMcpConfig(input.mcpExecutable, input.systemPromptPath)) },
    };
  }
  throw new Error(`Provider ${input.provider} does not use the generic CLI adapter.`);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const record = part as Record<string, unknown>;
    return record.type === "text" ? String(record.text || "") : "";
  }).join("");
}

export function normalizeProviderLine(provider: CliProviderId, line: string): NormalizedProviderEvent[] {
  let message: any;
  try { message = JSON.parse(line); }
  catch {
    const text = line.trim();
    return text && /\b(error|failed|fatal)\b/i.test(text) ? [{ kind: "error", text }] : [];
  }
  const events: NormalizedProviderEvent[] = [];

  if (provider === "claude") {
    const sessionId = message.session_id || message.sessionId;
    if (sessionId) events.push({ kind: "session", sessionId: String(sessionId) });
    if (message.type === "stream_event") {
      const event = message.event || {};
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        events.push({ kind: "textDelta", text: String(event.delta.text || "") });
      } else if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        events.push({ kind: "toolStart", toolId: String(event.content_block.id || ""), toolName: String(event.content_block.name || "Tool"), toolDetail: JSON.stringify(event.content_block.input || {}) });
      }
    } else if (message.type === "result") {
      if (message.result) events.push({ kind: "finalText", text: String(message.result) });
      if (message.is_error) events.push({ kind: "error", text: String(message.result || "Claude Code failed") });
      events.push({ kind: "complete" });
    }
    return events;
  }

  if (provider === "gemini") {
    const sessionId = message.session_id || message.sessionId;
    if (sessionId) events.push({ kind: "session", sessionId: String(sessionId) });
    if (message.type === "message" && String(message.role || "").toLowerCase() === "assistant") {
      events.push({ kind: "textDelta", text: String(message.content || message.text || "") });
    } else if (message.type === "tool_use") {
      events.push({ kind: "toolStart", toolId: String(message.tool_id || message.id || ""), toolName: String(message.tool_name || message.name || "Tool"), toolDetail: JSON.stringify(message.parameters || message.args || {}) });
    } else if (message.type === "tool_result") {
      events.push({ kind: "toolEnd", toolId: String(message.tool_id || message.id || ""), toolName: String(message.tool_name || message.name || "Tool"), failed: Boolean(message.error) });
    } else if (message.type === "error") {
      events.push({ kind: "error", text: String(message.message || message.error || "Gemini CLI failed") });
    } else if (message.type === "result") {
      events.push({ kind: "complete" });
    }
    return events;
  }

  if (provider === "kimi") {
    if (message.session_id || message.sessionId) events.push({ kind: "session", sessionId: String(message.session_id || message.sessionId) });
    if (message.role === "assistant") {
      const text = textFromContent(message.content);
      if (text) events.push({ kind: "textDelta", text });
      for (const toolCall of message.tool_calls || []) {
        events.push({ kind: "toolStart", toolId: String(toolCall.id || ""), toolName: String(toolCall.function?.name || toolCall.name || "Tool"), toolDetail: String(toolCall.function?.arguments || "") });
      }
    } else if (message.role === "tool") {
      events.push({ kind: "toolEnd", toolId: String(message.tool_call_id || ""), toolName: "Tool", failed: Boolean(message.error) });
    }
    return events;
  }

  if (provider === "pi") {
    const eventType = message.type;
    if (message.sessionId || message.session_id || message.sessionFile || (eventType === "session" && message.id)) {
      events.push({ kind: "session", sessionId: String(message.sessionId || message.session_id || message.sessionFile || message.id) });
    }
    if (eventType === "message_update") {
      const update = message.assistantMessageEvent || {};
      if (update.type === "text_delta" || update.type === "textDelta") events.push({ kind: "textDelta", text: String(update.delta || update.text || "") });
    } else if (eventType === "tool_execution_start") {
      events.push({ kind: "toolStart", toolId: String(message.toolCallId || ""), toolName: String(message.toolName || "Tool"), toolDetail: JSON.stringify(message.args || {}) });
    } else if (eventType === "tool_execution_end") {
      events.push({ kind: "toolEnd", toolId: String(message.toolCallId || ""), toolName: String(message.toolName || "Tool"), failed: Boolean(message.isError) });
    } else if (eventType === "agent_end") {
      events.push({ kind: "complete" });
    }
    return events;
  }

  if (provider === "opencode") {
    if (message.sessionID) events.push({ kind: "session", sessionId: String(message.sessionID) });
    if (message.type === "text") {
      const text = String(message.part?.text || "");
      if (text) events.push({ kind: "textDelta", text });
    } else if (message.type === "tool_use") {
      const part = message.part || {};
      events.push({ kind: "toolStart", toolId: String(part.id || ""), toolName: String(part.tool || "Tool"), toolDetail: JSON.stringify(part.state?.input || {}) });
      events.push({ kind: "toolEnd", toolId: String(part.id || ""), toolName: String(part.tool || "Tool"), failed: part.state?.status === "error" });
    } else if (message.type === "error") {
      events.push({ kind: "error", text: String(message.error?.data?.message || message.error?.message || message.error || "OpenCode failed") });
    }
    return events;
  }
  return events;
}
