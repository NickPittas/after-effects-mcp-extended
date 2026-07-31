import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PROVIDER_ORDER,
  buildProviderRunSpec,
  createOpenCodeMcpConfig,
  executableInvocation,
  findProviderExecutable,
  inspectProvider,
  normalizeProviderLine,
  spawnCliSync,
  visibleTerminalInvocation,
  type CliProviderId,
} from "../src/cli-providers.js";

const base = {
  promptText: "Create a composition",
  promptFile: "C:\\Temp\\prompt.txt",
  attachmentPaths: ["C:\\Temp\\viewer.png"],
  sessionId: "session-123",
  autoApprove: true,
  mcpConfigPath: "C:\\Temp\\mcp.json",
  mcpExecutable: "C:\\Program Files\\AfterEffectsMCP\\after-effects-mcp-extended.exe",
  systemPrompt: "You are embedded in Adobe After Effects.",
  systemPromptPath: "C:\\Temp\\after-effects-system-prompt.md",
  piExtensionPath: "C:\\Temp\\pi-after-effects-extension.ts",
  piSessionDir: "C:\\Temp\\pi-sessions",
};

assert.deepEqual(PROVIDER_ORDER, ["codex", "claude", "agy", "kimi", "pi", "opencode"]);

const specs = Object.fromEntries(
  (["claude", "agy", "kimi", "pi", "opencode"] as CliProviderId[]).map((provider) => [provider, buildProviderRunSpec({ ...base, provider })]),
);
const kimiCodeSpec = buildProviderRunSpec({ ...base, provider: "kimi", kimiFlavor: "kimi-code" });
assert(specs.claude.args.includes("--dangerously-skip-permissions"));
assert(specs.claude.args.includes("--resume"));
assert(specs.claude.args.includes("--mcp-config"));
assert(specs.claude.args.includes("--append-system-prompt-file") && specs.claude.args.includes(base.systemPromptPath));
assert.equal(specs.claude.stdinText, base.promptText);
assert(specs.agy.args.includes("--output-format") && specs.agy.args.includes("stream-json"));
assert(specs.agy.args.includes("--dangerously-skip-permissions"));
assert(specs.agy.args.includes("--conversation") && specs.agy.args.includes(base.sessionId));
assert(specs.agy.args.includes("-p") && specs.agy.args.includes(base.promptText));
assert(!specs.agy.args.includes("--skip-trust") && !specs.agy.args.includes("--approval-mode=yolo"));
assert(specs.kimi.args.includes("--continue"));
assert(specs.kimi.args.includes("--mcp-config-file"));
assert.equal(specs.kimi.stdinText, base.promptText);
assert(kimiCodeSpec.args.includes("--prompt") && kimiCodeSpec.args.includes(base.promptText));
assert(kimiCodeSpec.args.includes("--continue") && !kimiCodeSpec.args.includes("--mcp-config-file"));
assert.equal(kimiCodeSpec.stdinText, undefined);
assert(specs.pi.args.includes("--extension") && specs.pi.args.includes(base.piExtensionPath));
assert(specs.pi.args.includes("--print"));
assert(specs.pi.args.includes("--mode") && specs.pi.args.includes("json"));
assert(specs.pi.args.includes("--session-dir") && specs.pi.args.includes("--continue"));
assert(specs.pi.args.includes("--append-system-prompt") && specs.pi.args.includes(base.systemPromptPath));
assert(specs.opencode.args.includes("--auto") && specs.opencode.args.includes("--session"));
assert(specs.opencode.args.includes("--format") && specs.opencode.args.includes("json"));
assert.equal(specs.opencode.args.filter((value) => value === "--file").length, base.attachmentPaths.length);
assert.equal(specs.opencode.args.at(-2), "--");
assert.equal(specs.opencode.args.at(-1), base.promptText);
assert(!specs.opencode.args.includes(base.promptFile));
assert.equal(JSON.parse(specs.opencode.env?.OPENCODE_CONFIG_CONTENT || "{}").mcp.AfterEffectsMCP.type, "local");
assert.deepEqual(JSON.parse(specs.opencode.env?.OPENCODE_CONFIG_CONTENT || "{}").instructions, [base.systemPromptPath]);
assert.equal((createOpenCodeMcpConfig(base.mcpExecutable) as any).mcp.AfterEffectsMCP.enabled, true);

const terminal = visibleTerminalInvocation("C:\\Program Files\\Pi's CLI\\pi.cmd", [], "Pi Sign In");
assert.equal(terminal.command, "powershell.exe");
assert.deepEqual(terminal.args.slice(0, 2), ["-NoProfile", "-EncodedCommand"]);
const launcherScript = Buffer.from(terminal.args[2], "base64").toString("utf16le");
assert.match(launcherScript, /Start-Process/);
assert.match(launcherScript, /-WindowStyle Normal/);

const piExtension = fs.readFileSync("assets/pi-after-effects-extension.ts", "utf8");
assert.match(piExtension, /composition: \["get", "create", "update", "duplicate", "remove"\]/);
assert.match(piExtension, /Composition creation is composition\/create, never composition\/add/);
assert.match(piExtension, /inspect\/get with parameters \{scope:'capabilities'\}/);
assert.match(piExtension, /never substitute a solid/);
assert.match(piExtension, /Unsupported action/);
assert.match(piExtension, /ae_command\.lock/);

const chatRenderer = fs.readFileSync("cep/main.js", "utf8");
assert.match(chatRenderer, /function compareTimelineItems/);
assert.match(chatRenderer, /function createToolGroup/);
assert.match(chatRenderer, /state\.activity\.kind === "responding"/);
const chatStyles = fs.readFileSync("cep/styles.css", "utf8");
assert.match(chatStyles, /\.tool-group-header/);
assert.match(chatStyles, /font-variant-numeric: tabular-nums/);
assert.match(piExtension, /ae_bridge_status\.json/);

const bridgePanel = fs.readFileSync("src/scripts/mcp-bridge-auto.jsx", "utf8");
assert.match(bridgePanel, /__aeMcpBridgeScheduledTick = scheduledBridgeTick/);
assert.match(bridgePanel, /panel\.onActivate/);
assert.match(bridgePanel, /panel\.onClose/);
assert.doesNotMatch(bridgePanel, /scheduleTask\("checkForCommands\(\)"/);

const cepMain = fs.readFileSync("cep/main.js", "utf8");
assert.doesNotMatch(cepMain, /evalHost\(|aeMcpChatGetContext|aeMcpChatCaptureViewer/);
assert.match(cepMain, /cep\.process\.createProcess/);

const cepInstaller = fs.readFileSync("install-cep.ps1", "utf8");
assert.match(cepInstaller, /after-effects-mcp-extended\.exe/);

assert.equal(normalizeProviderLine("claude", JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } } }))[0].text, "Hi");
const agyInit = normalizeProviderLine("agy", JSON.stringify({ type: "init", conversation_id: "agy-session" }));
assert.equal(agyInit[0].sessionId, "agy-session");
assert.equal(normalizeProviderLine("agy", JSON.stringify({ type: "step_update", step_type: "assistant_message", text: "Hello" }))[0].kind, "textBlock");
const agyTool = normalizeProviderLine("agy", JSON.stringify({ type: "step_update", step_type: "tool", step_id: "agy-tool", tool_info: { name: "AfterEffectsMCP", parameters: { operation: "inspect" }, output: { ok: true } } }));
assert.deepEqual(agyTool.map((event) => event.kind), ["toolStart", "toolEnd"]);
assert.equal(normalizeProviderLine("agy", JSON.stringify({ type: "result", result: "Done" }))[0].kind, "finalText");
assert.equal(normalizeProviderLine("kimi", JSON.stringify({ role: "assistant", content: "Kimi" }))[0].kind, "textBlock");
assert.equal(normalizeProviderLine("pi", JSON.stringify({ type: "session", id: "pi-session" }))[0].sessionId, "pi-session");
assert.equal(normalizeProviderLine("opencode", JSON.stringify({ type: "text", sessionID: "oc-session", part: { text: "Open" } })).at(-1)?.kind, "textBlock");

if (process.platform === "win32") {
  const npmPath = "C:\\Program Files\\nodejs\\npm.cmd";
  const invocation = executableInvocation(npmPath, ["install", "-g", "example"]);
  assert(/cmd\.exe$/i.test(invocation.command));
  assert.equal(invocation.args[0], "/d");
  assert.equal(invocation.windowsVerbatimArguments, true);
  const npmVersion = spawnCliSync(npmPath, ["--version"], { timeout: 15000 });
  assert.equal(npmVersion.status, 0, `npm.cmd execution failed: ${npmVersion.stderr || npmVersion.stdout}`);
  assert.match(String(npmVersion.stdout), /^\d+\.\d+/);
  for (const provider of PROVIDER_ORDER) {
    const executable = findProviderExecutable(provider);
    if (!executable) continue;
    assert.match(executable, /\.(cmd|exe)$/i);
    const snapshot = inspectProvider(provider);
    assert.equal(snapshot.installed, true, `${provider} was detected but could not execute`);
    assert.match(snapshot.cliPath || "", /\.(cmd|exe)$/i);
    console.log(`${provider}: ${snapshot.cliPath} (${snapshot.cliVersion})`);
  }
}

console.log("CLI provider adapters passed.");
