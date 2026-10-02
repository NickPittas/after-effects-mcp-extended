import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Deliberately include spaces so every .cmd harness is exercised with quoted
// executable, prompt, attachment, config, and session paths.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "ae multi cli host "));
const fakeHome = path.join(root, "home");
const fakeAppData = path.join(root, "appdata");
const fakeLocalAppData = path.join(root, "localappdata");
const fakeBin = path.join(root, "bin");
const bridgeDir = path.join(fakeHome, "Documents", "ae-mcp-bridge");
const chatDir = path.join(bridgeDir, "codex-chat");
const requestDir = path.join(chatDir, "requests");
for (const directory of [fakeHome, fakeAppData, fakeLocalAppData, fakeBin, requestDir]) fs.mkdirSync(directory, { recursive: true });

const heartbeatPath = path.join(bridgeDir, "ae_bridge_status.json");
const commandPath = path.join(bridgeDir, "ae_command.json");
const resultPath = path.join(bridgeDir, "ae_mcp_result.json");
function writeHeartbeat() {
  fs.writeFileSync(heartbeatPath, JSON.stringify({ state: "ready", autoRun: true, instanceId: "test-bridge", updatedAt: Date.now() }));
}
writeHeartbeat();
let bridgePaused = false;
const fakeBridge = setInterval(() => {
  writeHeartbeat();
  if (bridgePaused) return;
  try {
    const command = JSON.parse(fs.readFileSync(commandPath, "utf8"));
    if (command.status !== "pending") return;
    command.status = "completed";
    fs.writeFileSync(commandPath, JSON.stringify(command));
    fs.writeFileSync(resultPath, JSON.stringify({
      status: "success",
      operation: command.args?.operation,
      action: command.args?.action,
      data: { name: "Fixture Project", numItems: 0, items: [] },
      _commandExecuted: command.command,
      _commandId: command.id,
    }));
  } catch {}
}, 50);

fs.mkdirSync(path.join(fakeHome, ".gemini", "antigravity-cli"), { recursive: true });
fs.writeFileSync(path.join(fakeHome, ".gemini", "antigravity-cli", "settings.json"), "{}");
fs.mkdirSync(path.join(fakeHome, ".kimi", "credentials"), { recursive: true });
fs.writeFileSync(path.join(fakeHome, ".kimi", "credentials", "test.json"), "{}");
fs.mkdirSync(path.join(fakeHome, ".pi", "agent"), { recursive: true });
fs.writeFileSync(path.join(fakeHome, ".pi", "agent", "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "test-only" } }));
fs.mkdirSync(path.join(fakeAppData, "AfterEffectsMCP"), { recursive: true });
fs.writeFileSync(path.join(fakeAppData, "AfterEffectsMCP", "after-effects-mcp-extended.exe"), "fixture");
fs.copyFileSync(path.resolve("assets", "pi-after-effects-extension.ts"), path.join(fakeAppData, "AfterEffectsMCP", "pi-after-effects-extension.ts"));

const fakeRunner = path.join(fakeBin, "fake-cli.mjs");
fs.writeFileSync(fakeRunner, `
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
const [provider, ...args] = process.argv.slice(2);
const requireArg = (value) => { if (!args.includes(value)) throw new Error(provider + " missing required argument " + value + ": " + JSON.stringify(args)); };
if (args.includes("--version")) { console.log(provider + " 99.0.0"); process.exit(0); }
if (args.includes("--help")) {
  const help = provider === "kimi" ? "--prompt --output-format --continue --model"
    : provider === "opencode" && args[0] !== "run" ? "opencode commands: run, models"
    : "--model --effort (low|medium|high|max) --thinking level: off, minimal, low, medium, high, xhigh";
  if (provider === "agy") console.error(help); else console.log(help);
  process.exit(0);
}
if (args[0] === "models") {
  console.log(provider === "opencode" ? 'fixture-provider/fixture-model' : 'fixture-model\tFixture Model');
  process.exit(0);
}
if (args.includes("--list-models")) {
  console.log('provider model context max-out thinking images');
  console.log('fixture-provider fixture-model 200K 30K yes yes');
  process.exit(0);
}
if (provider === "kimi" && args[0] === "provider") {
  console.log(JSON.stringify({models:{"fixture-model":{}}}));
  process.exit(0);
}
if (provider === "claude" && args[0] === "auth") { console.log('{"loggedIn":true,"email":"claude@test"}'); process.exit(0); }
if (provider === "opencode" && args[0] === "auth") { console.log("anthropic api - 1 credentials"); process.exit(0); }
if (args[0] === "mcp") { console.log("AfterEffectsMCP ready"); process.exit(0); }
if (provider === "codex" && args[0] === "login") { console.log("Logged in"); process.exit(0); }
if (provider === "codex" && args[0] === "app-server") {
  const readline = await import("node:readline");
  let fixtureTurnTimer;
  let threadSequence=0;
  readline.createInterface({input:process.stdin}).on("line", line => {
    const request = JSON.parse(line);
    if (!request.id) return;
    let result = {};
    if (request.method === "account/read") result = {account:{type:"chatgpt",email:"fixture@test",planType:"plus"}};
    if (request.method === "thread/start") result = {thread:{id:"codex-session-"+process.pid+"-"+(++threadSequence)}};
    if (request.method === "thread/resume") result = {thread:{id:request.params.threadId}};
    if (request.method === "model/list") result = {data:[{id:"fixture-model",model:"fixture-model",displayName:"Fixture",supportedReasoningEfforts:[{reasoningEffort:"low"},{reasoningEffort:"high"}],defaultReasoningEffort:"low"},{id:"fixture-default",model:"fixture-default",isDefault:true,supportedReasoningEfforts:[{reasoningEffort:"low"},{reasoningEffort:"high"}],defaultReasoningEffort:"low"}]};
    if (request.method === "config/read") result = {config:{model:"fixture-default",model_reasoning_effort:"low"}};
    if (request.method === "turn/start") {
      fs.appendFileSync(path.join(process.env.USERPROFILE,"codex-turns.jsonl"),JSON.stringify(request.params)+"\\n");
      result = {turn:{id:"codex-turn"}};
      const prompt=JSON.stringify(request.params.input);
      if (prompt.includes("START_BLOCK_FIXTURE")) return;
      console.log(JSON.stringify({method:"turn/started",params:{turn:result.turn}}));
      fixtureTurnTimer=setTimeout(() => {
        console.log(JSON.stringify({method:"item/agentMessage/delta",params:{itemId:"fixture-message",delta:"Codex response"}}));
        console.log(JSON.stringify({method:"turn/completed",params:{turn:{id:"codex-turn",status:"completed"}}}));
      },prompt.includes("STOP_FIXTURE") ? 60000 : 40);
    }
    if (request.method === "turn/interrupt") {
      clearTimeout(fixtureTurnTimer);
      console.log(JSON.stringify({method:"turn/completed",params:{threadId:request.params.threadId,turn:{id:request.params.turnId,status:"interrupted"}}}));
    }
    console.log(JSON.stringify({id:request.id,result}));
  });
} else {
let fixtureStdin="";
if (provider === "claude") for await (const chunk of process.stdin) fixtureStdin+=String(chunk);
fs.appendFileSync(path.join(process.env.USERPROFILE,"harness-runs.jsonl"),JSON.stringify({provider,args,owner:process.env.AE_MCP_CHAT_OWNER_PID})+"\\n");
const fixturePrompt=args.join(" ")+fixtureStdin+args.filter(arg=>arg.startsWith("@")&&fs.existsSync(arg.slice(1))).map(arg=>fs.readFileSync(arg.slice(1),"utf8")).join(" ");
if (fixturePrompt.includes("STOP_FIXTURE")) {
  const worker=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});
  fs.writeFileSync(path.join(process.env.USERPROFILE,"worker-"+provider+".json"),JSON.stringify({pid:worker.pid,parent:process.pid}));
  setTimeout(()=>console.log(JSON.stringify({type:"text",sessionID:"late-session",part:{text:"SHOULD_NOT_ARRIVE"}})),500);
  setTimeout(()=>{},60000);
} else {
if (args.includes("--model")) {
  const selected = args[args.indexOf("--model") + 1];
  if (selected !== (provider === "opencode" ? "fixture-provider/fixture-model" : "fixture-model")) throw new Error("Incorrect selected model for " + provider);
}
const aePrompt = fs.readFileSync(path.join(process.cwd(), "after-effects-system-prompt.md"), "utf8");
if (!aePrompt.includes("You are embedded in Adobe After Effects") || !aePrompt.includes("shape/add")) throw new Error("Shared After Effects system prompt is incomplete");
for (const instructionFile of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) {
  if (fs.readFileSync(path.join(process.cwd(), instructionFile), "utf8") !== aePrompt) throw new Error(instructionFile + " does not match the shared After Effects prompt");
}
if (provider === "claude") {
  requireArg("-p"); requireArg("stream-json"); requireArg("--mcp-config"); requireArg("--dangerously-skip-permissions"); requireArg("--append-system-prompt-file");
  const stdin = fixtureStdin;
  if (!stdin.includes("Test claude")) throw new Error("Claude prompt was not delivered through stdin");
  console.log(JSON.stringify({type:"system",session_id:"claude-session"}));
  console.log(JSON.stringify({type:"stream_event",event:{type:"content_block_start",content_block:{type:"tool_use",id:"ae-1",name:"AfterEffectsMCP",input:{operation:"inspect"}}}}));
  console.log(JSON.stringify({type:"stream_event",event:{type:"content_block_delta",delta:{type:"text_delta",text:"Claude response"}}}));
  console.log(JSON.stringify({type:"result",session_id:"claude-session",result:"Claude response",is_error:false}));
} else if (provider === "agy") {
  requireArg("-p"); requireArg("stream-json"); requireArg("--dangerously-skip-permissions");
  const projectMcp = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".agents", "mcp_config.json"), "utf8"));
  if (!projectMcp.mcpServers?.AfterEffectsMCP?.command) throw new Error("Antigravity project MCP config is invalid");
  const globalMcp = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, ".gemini", "config", "mcp_config.json"), "utf8"));
  if (!globalMcp.mcpServers?.AfterEffectsMCP?.command) throw new Error("Antigravity global MCP config is invalid");
  console.log(JSON.stringify({event:"init",conversation_id:"agy-session",init:{cwd:process.cwd(),tools:["call_mcp_tool"]}}));
  console.log(JSON.stringify({event:"step_update",step_update:{conversation_id:"agy-session",step_index:1,state:"ACTIVE",step_type:"tool",tool_name:"call_mcp_tool",tool_info:{name:"call_mcp_tool",parameters:{ServerName:"AfterEffectsMCP",ToolName:"after-effects",Arguments:{operation:"inspect",action:"get"}}}}}));
  console.log(JSON.stringify({event:"step_update",step_update:{conversation_id:"agy-session",step_index:1,state:"DONE",step_type:"tool",tool_name:"call_mcp_tool",tool_info:{name:"call_mcp_tool",parameters:{ServerName:"AfterEffectsMCP",ToolName:"after-effects",Arguments:{operation:"inspect",action:"get"}},output:"ok"}}}));
  console.log(JSON.stringify({event:"step_update",step_update:{conversation_id:"agy-session",step_index:2,state:"ACTIVE",step_type:"agent_response",text_delta:"AGY response"}}));
  console.log(JSON.stringify({event:"step_update",step_update:{conversation_id:"agy-session",step_index:2,state:"DONE",step_type:"agent_response",text_delta:""}}));
  console.log(JSON.stringify({event:"result",result:{conversation_id:"agy-session",status:"SUCCESS",response:"AGY response"}}));
} else if (provider === "kimi") {
  requireArg("--prompt"); requireArg("stream-json");
  const projectMcp = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".kimi-code", "mcp.json"), "utf8"));
  if (!projectMcp.mcpServers?.AfterEffectsMCP?.command) throw new Error("Kimi Code project MCP config is invalid");
  console.log(JSON.stringify({role:"assistant",content:"Kimi response"}));
} else if (provider === "pi") {
  requireArg("--print"); requireArg("--mode"); requireArg("json"); requireArg("--session-dir"); requireArg("--extension"); requireArg("--append-system-prompt");
  console.log(JSON.stringify({type:"session",id:"pi-session"}));
  console.log(JSON.stringify({type:"message_update",assistantMessageEvent:{type:"text_delta",delta:"Pi begins."}}));
  console.log(JSON.stringify({type:"tool_execution_start",toolCallId:"pi-timeline-tool",toolName:"after_effects",args:{operation:"inspect",action:"get"}}));
  console.log(JSON.stringify({type:"tool_execution_end",toolCallId:"pi-timeline-tool",toolName:"after_effects",isError:false}));
  console.log(JSON.stringify({type:"message_update",assistantMessageEvent:{type:"text_delta",delta:"Pi response"}}));
  console.log(JSON.stringify({type:"agent_end"}));
} else if (provider === "opencode") {
  requireArg("run"); requireArg("--format"); requireArg("json"); requireArg("--auto");
  requireArg("--");
  const opencodeConfig = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || "{}");
  if (!opencodeConfig.mcp?.AfterEffectsMCP?.command) throw new Error("Stable OpenCode MCP config is invalid");
  if (!Array.isArray(opencodeConfig.instructions) || !opencodeConfig.instructions[0]?.endsWith("after-effects-system-prompt.md")) throw new Error("OpenCode system instructions are missing");
  const separator = args.indexOf("--");
  const prompt = args.slice(separator + 1).join(" ");
  if (/opencode-prompt-\d+\.txt/i.test(args.slice(0, separator).join(" "))) throw new Error("OpenCode prompt was incorrectly attached as a file");
  if (prompt.includes("STOP_FIXTURE")) {
    setTimeout(() => {}, 60000);
  } else {
  console.log(JSON.stringify({type:"text",sessionID:"opencode-session",part:{text:"OpenCode response"}}));
  }
}
}
}
`, "utf8");

const nodePath = process.execPath;
for (const provider of ["codex", "claude", "agy", "kimi", "pi", "opencode"]) {
  fs.writeFileSync(path.join(fakeBin, provider), "#!/bin/sh\nexit 99\n", "utf8");
  fs.writeFileSync(path.join(fakeBin, provider + ".cmd"), `@echo off\r\n"${nodePath}" "${fakeRunner}" ${provider} %*\r\n`, "utf8");
}

// Exercise the in-place provider migration from the removed Gemini adapter.
fs.writeFileSync(path.join(chatDir, "settings.json"), JSON.stringify({ version: "1.10.2", provider: "gemini", noApprovalPrompts: true, trustAfterEffectsMcp: true }));

const isolatedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => ![
  "userprofile", "home", "appdata", "localappdata", "homedrive", "homepath", "path"
].includes(key.toLowerCase())));
const env = {
  ...isolatedEnv,
  USERPROFILE: fakeHome,
  HOME: fakeHome,
  APPDATA: fakeAppData,
  LOCALAPPDATA: fakeLocalAppData,
  HOMEDRIVE: path.parse(fakeHome).root.replace(/\\$/, ""),
  HOMEPATH: fakeHome.slice(path.parse(fakeHome).root.length - 1),
  PATH: fakeBin + path.delimiter + process.env.PATH,
  AE_MCP_CLAUDE_EXECUTABLE: path.join(fakeBin, "claude.cmd"),
  AE_MCP_CODEX_EXECUTABLE: path.join(fakeBin, "codex.cmd"),
  AE_MCP_AGY_EXECUTABLE: path.join(fakeBin, "agy.cmd"),
  AE_MCP_KIMI_EXECUTABLE: path.join(fakeBin, "kimi.cmd"),
  AE_MCP_PI_EXECUTABLE: path.join(fakeBin, "pi.cmd"),
  AE_MCP_OPENCODE_EXECUTABLE: path.join(fakeBin, "opencode.cmd"),
};
const host = spawn(nodePath, [path.resolve("build", "chat-host.js")], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
let hostError = "";
host.stderr.on("data", (chunk) => { hostError += String(chunk); });

const statePath = path.join(chatDir, "state.json");
async function waitFor(predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (predicate(value)) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}. ${hostError}`);
}
function request(action, data = {}) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(path.join(requestDir, id + ".json"), JSON.stringify({ id, action, ...data }));
}

try {
  await waitFor((value) => value.hostStatus === "ready" && value.provider === "agy", "host startup and Gemini-to-AGY migration");
  const expected = { codex: "Codex response", claude: "Claude response", agy: "AGY response", kimi: "Kimi response", pi: "Pi response", opencode: "OpenCode response" };
  for (const provider of Object.keys(expected)) {
    request("selectProvider", { providerId: provider });
    const selected = await waitFor((value) => value.provider === provider && value.cliStatus === "ready" && !value.busy, provider + " selection");
    assert.match(selected.cliPath, /\.(cmd|exe)$/i, `Windows selected a non-executable shim for ${provider}: ${selected.cliPath}`);
    await waitFor(value => value.modelCatalogs?.[provider]?.status === "ready", provider + " catalog");
    const modelChoice = {model:"fixture-model",provider:provider === "pi" || provider === "opencode" ? "fixture-provider" : null,effort:provider === "codex" || provider === "agy" || provider === "pi" ? "high" : null};
    request("setModel", { providerId: provider, modelChoice });
    const savedModel = await waitFor(value => JSON.stringify(value.modelChoices?.[provider]) === JSON.stringify(modelChoice), provider + " saved model");
    assert.equal(JSON.parse(fs.readFileSync(path.join(chatDir, "settings.json"), "utf8")).modelChoices[provider].model, "fixture-model");
    request("send", { prompt: "Test " + provider, context: { fixture: true } });
    const result = await waitFor((value) => !value.busy && value.transcript?.some((entry) => entry.providerLabel && entry.text === expected[provider]), provider + " response");
    assert(result.transcript.some((entry) => entry.providerLabel && entry.text === expected[provider]));
    if (provider === "codex") {
      const turn = JSON.parse(fs.readFileSync(path.join(fakeHome,"codex-turns.jsonl"),"utf8").trim());
      assert.equal(turn.model,"fixture-model");
      assert.equal(turn.effort,"high");
    }
    if (provider === "agy") {
      const aeTool = result.activityLog.find((entry) => entry.label === "After Effects");
      assert(aeTool && aeTool.status === "completed", "AGY MCP activity was not identified as After Effects");
    }
    if (provider === "pi") {
      const firstText = result.transcript.find((entry) => entry.providerLabel === "Pi" && entry.text === "Pi begins.");
      const secondText = result.transcript.find((entry) => entry.providerLabel === "Pi" && entry.text === "Pi response");
      const tool = result.activityLog.find((entry) => entry.id === "pi-timeline-tool");
      assert(firstText && tool && secondText, "Pi text/tool/text timeline entries were not preserved");
      assert(firstText.sequence < tool.sequence && tool.sequence < secondText.sequence, "Pi timeline order is not text, tool, text");
    }
  }
  try { fs.unlinkSync(commandPath); } catch {}
  request("send", { prompt: "STOP_FIXTURE" });
  await waitFor((value) => value.provider === "opencode" && value.busy, "long-running OpenCode fixture");
  assert.equal(fs.existsSync(commandPath), false, "A normal chat send must not run a hidden blocking AE inspection");
  request("selectProvider", { providerId: "opencode" });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const duplicateSelection = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert(!String(duplicateSelection.error || "").includes("switching CLI tools"), "Re-selecting the active provider must be a no-op while busy");
  request("stop");
  await waitFor((value) => !value.busy && value.statusText === "Stopped", "process-tree stop");
  request("setModel", {providerId:"opencode",modelChoice:{model:null,provider:null,effort:null}});
  await waitFor(value => value.modelChoices?.opencode?.model === null, "return to CLI default");
  const settings = JSON.parse(fs.readFileSync(path.join(chatDir, "settings.json"), "utf8"));
  assert.equal(settings.providerSessions.opencode, undefined, "CLI default must clear a session with a sticky model override");
  assert.equal(settings.modelChoices.pi.model, "fixture-model", "Changing one harness must preserve the other model choices");
  const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
  for (const provider of ["claude","agy","kimi","pi","opencode"]) {
    request("selectProvider",{providerId:provider});
    await waitFor(value=>value.provider===provider&&!value.busy,provider+" stop test selection");
    request("send",{prompt:"STOP_FIXTURE "+provider});
    await waitFor(value=>value.busy&&fs.existsSync(path.join(fakeHome,"worker-"+provider+".json")),provider+" descendant started");
    const worker=JSON.parse(fs.readFileSync(path.join(fakeHome,"worker-"+provider+".json"),"utf8"));
    request("stop");
    await waitFor(value=>!value.busy&&value.statusText==="Stopped",provider+" verified stop",5000);
    assert.equal(alive(worker.pid),false,provider+" left its descendant alive after reporting Stopped");
    await new Promise(resolve=>setTimeout(resolve,550));
    const stopped=JSON.parse(fs.readFileSync(statePath,"utf8"));
    assert(!stopped.transcript.some(entry=>entry.text==="SHOULD_NOT_ARRIVE"),provider+" accepted buffered output after Stop");
    request("clearTranscript");
    await waitFor(value=>value.statusText==="New conversation"&&value.transcript.length===0,provider+" new conversation");
    const freshSettings=JSON.parse(fs.readFileSync(path.join(chatDir,"settings.json"),"utf8"));
    assert.deepEqual(freshSettings.providerSessions,{},"Clear retained harness sessions");
    assert.equal(freshSettings.threadId,null);
    request("send",{prompt:"Test "+provider});
    await waitFor(value=>!value.busy&&value.transcript.some(entry=>entry.text===expected[provider]),provider+" fresh response");
    const lastRun=fs.readFileSync(path.join(fakeHome,"harness-runs.jsonl"),"utf8").trim().split("\n").map(JSON.parse).filter(run=>run.provider===provider).at(-1);
    assert(!lastRun.args.some(arg=>["--continue","--resume","--conversation","--session"].includes(arg)),provider+" resumed old session after Clear");
    assert.equal(Number(lastRun.owner),host.pid,"chat owner PID was not propagated to harness");
  }
  request("selectProvider",{providerId:"codex"});
  await waitFor(value=>value.provider==="codex"&&!value.busy,"Codex cancellation selection");
  request("send",{prompt:"STOP_FIXTURE"});
  const activeCodex=await waitFor(value=>value.busy&&value.activeTurnId,"Codex active turn");
  request("stop");
  await waitFor(value=>!value.busy&&value.statusText==="Stopped","Codex graceful interrupt",5000);
  request("clearTranscript");
  await waitFor(value=>value.statusText==="New conversation"&&value.transcript.length===0,"Codex reset");
  request("send",{prompt:"Test codex"});
  const freshCodex=await waitFor(value=>!value.busy&&value.transcript.some(entry=>entry.text==="Codex response"),"Codex fresh thread");
  assert.notEqual(freshCodex.threadId,activeCodex.threadId,"Codex Clear reused the old thread");
  request("send",{prompt:"START_BLOCK_FIXTURE"});
  await waitFor(value=>value.busy,"Codex blocked turn/start");
  request("stop");
  await waitFor(value=>!value.busy&&value.statusText==="Stopped","Stop preempted blocked turn/start",5000);
  request("selectProvider",{providerId:"opencode"});
  await waitFor(value=>value.provider==="opencode"&&!value.busy,"capture cancellation selection");
  bridgePaused=true;
  request("send",{prompt:"MUST_NOT_START",viewerRequested:true});
  await waitFor(value=>value.busy&&fs.existsSync(commandPath)&&JSON.parse(fs.readFileSync(commandPath,"utf8")).status==="pending","pending viewer capture");
  request("send",{prompt:"QUEUED_MUST_NOT_START"});
  request("stop");
  await waitFor(value=>!value.busy&&value.statusText==="Stopped","Stop preempted viewer preparation",3000);
  assert.equal(JSON.parse(fs.readFileSync(commandPath,"utf8")).status,"error","Stop left the chat-owned AE request queued");
  bridgePaused=false;
  await new Promise(resolve=>setTimeout(resolve,350));
  const afterCaptureStop=JSON.parse(fs.readFileSync(statePath,"utf8"));
  assert(!afterCaptureStop.transcript.some(entry=>entry.text.includes("MUST_NOT_START")),"cancelled/queued prompt started after Stop");
  // Clear itself must terminate an active harness, not merely erase bubbles.
  fs.unlinkSync(path.join(fakeHome,"worker-opencode.json"));
  request("send",{prompt:"STOP_FIXTURE clear-directly"});
  await waitFor(value=>value.busy&&fs.existsSync(path.join(fakeHome,"worker-opencode.json")),"active Clear fixture");
  const clearWorker=JSON.parse(fs.readFileSync(path.join(fakeHome,"worker-opencode.json"),"utf8"));
  request("clearTranscript");
  await waitFor(value=>!value.busy&&value.statusText==="New conversation"&&value.transcript.length===0,"Clear terminated active tree",5000);
  assert.equal(alive(clearWorker.pid),false,"Clear left active tools running");
  // Cancellation is scoped: leave another MCP client's queued command alone.
  bridgePaused=true;
  fs.writeFileSync(commandPath,JSON.stringify({id:"external-command",status:"pending",chatOwnerPid:host.pid+1}));
  request("stop");
  await waitFor(value=>value.statusText==="Stopped","idle Stop");
  assert.equal(JSON.parse(fs.readFileSync(commandPath,"utf8")).status,"pending","Stop cancelled a command owned by another MCP client");
  console.log("Multi-CLI host integration passed.");
} finally {
  clearInterval(fakeBridge);
  host.kill();
  if (process.platform === "win32" && host.pid) spawn("taskkill.exe", ["/pid", String(host.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
}
