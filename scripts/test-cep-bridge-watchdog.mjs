import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("cep/main.js", "utf8");
const documents = "C:/Users/Test/Documents";
const heartbeatPath = documents + "/ae-mcp-bridge/ae_bridge_status.json";
const commandPath = documents + "/ae-mcp-bridge/ae_command.json";
const resultPath = documents + "/ae-mcp-bridge/ae_mcp_result.json";

function element() {
  const handlers = {};
  const attributes = {};
  return {
    checked: false, disabled: false, hidden: false, value: "", textContent: "",
    innerHTML: "", className: "", dataset: {}, style: {}, scrollHeight: 0,
    scrollTop: 0, clientHeight: 0,
    addEventListener(name, handler) { handlers[name] = handler; },
    dispatch(name) { handlers[name]?.({key:"Enter",preventDefault(){},stopPropagation(){}}); },
    click() { this.dispatch("click"); }, appendChild() {}, replaceChildren() {}, scrollTo() {},
    focus() {}, setAttribute(name, value) { attributes[name] = value; }, attributes,
  };
}

function runScenario(initialHeartbeat, processResult = "success", commandStatus = "pending", commandBridgeInstanceId = null, testStartupCooldown = false) {
  let now = Date.now();
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const files = new Map([
    [heartbeatPath, JSON.stringify(initialHeartbeat)],
    [commandPath, JSON.stringify({ command: "aeCommand", id: "test-command", args: { operation: "inspect", action: "get" }, status: commandStatus, bridgeInstanceId: commandBridgeInstanceId })],
  ]);
  const intervals = [];
  const hostCalls = [];
  const storage = new Map();
  const windowEvents = {};
  let processCallCount = 0;
  let initializeCallCount = 0;
  let pendingInitialization = null;
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const cep = {
    fs: {
      readFile(filePath) { return files.has(filePath) ? { err: 0, data: files.get(filePath) } : { err: 1 }; },
      writeFile(filePath, data) { files.set(filePath, String(data)); return { err: 0 }; },
      makedir() { return { err: 0 }; },
      stat() { return { err: 0 }; },
    },
    process: { createProcess() { return { err: 0, data: 123 }; } },
  };
  const host = {
    getSystemPath(kind) { return kind === "myDocuments" ? documents : "C:/Extension"; },
    addEventListener() {},
    evalScript(script, callback) {
      hostCalls.push(script);
      if (script.startsWith("aeMcpChatInitializeBridgeCore(")) {
        initializeCallCount++;
        if (processResult === "init-error") callback('{"ok":false,"error":"Missing bundled core"}');
        else if (processResult === "init-slow") pendingInitialization = callback;
        else if (!(processResult === "init-lost-once" && initializeCallCount === 1)) callback('{"ok":true}');
      }
      else if (script.indexOf("aeMcpChatProcessBridgeCommand(") === 0) {
        processCallCount++;
        if (processResult === "success" || processResult === "init-lost-once") {
          const command = JSON.parse(files.get(commandPath));
          command.status = "completed";
          files.set(commandPath, JSON.stringify(command));
          files.set(resultPath, JSON.stringify({ status: "success", _commandId: command.id }));
          // The shared core temporarily writes its own instance ID. The CEP
          // callback must restore ownership immediately, without a 5s delay.
          files.set(heartbeatPath, JSON.stringify({state:"ready",autoRun:true,instanceId:"headless-core",updatedAt:FakeDate.now()}));
          callback('{"ok":true}');
        } else if (processResult === "lost-callback-once" && processCallCount === 1) {
          const command = JSON.parse(files.get(commandPath));
          command.status = "completed";
          files.set(commandPath, JSON.stringify(command));
          files.set(resultPath, JSON.stringify({ status: "success", _commandId: command.id }));
        } else if (processResult === "running-no-callback") {
          const command = JSON.parse(files.get(commandPath));
          command.status = "running";
          command.statusUpdatedAt = FakeDate.now();
          command.timeoutMs = 2000;
          files.set(commandPath, JSON.stringify(command));
        } else {
          if (processResult === "lost-callback-once") {
            const command = JSON.parse(files.get(commandPath));
            command.status = "completed";
            files.set(commandPath, JSON.stringify(command));
            files.set(resultPath, JSON.stringify({ status: "success", _commandId: command.id }));
            callback('{"ok":true}');
          } else {
            const command = JSON.parse(files.get(commandPath));
            command.status = "running";
            files.set(commandPath, JSON.stringify(command));
            callback("EvalScript error.");
          }
        }
      } else callback('{"ok":true}');
    },
  };
  const document = {
    getElementById: getElement,
    addEventListener() {},
    createElement: element,
    createDocumentFragment: element,
  };
  const sandbox = {
    window: { location: { search: "" }, cep, __adobe_cep__: host, addEventListener(name, callback) { windowEvents[name] = callback; } },
    document,
    localStorage: { getItem(key) { return storage.get(key) ?? null; }, setItem(key, value) { storage.set(key, value); } },
    console,
    JSON,
    Date: FakeDate,
    Math,
    Infinity,
    isFinite,
    decodeURIComponent,
    encodeURI,
    clearTimeout() {},
    setTimeout() { return 1; },
    setInterval(callback, delay) { intervals.push({ callback, delay }); return intervals.length; },
  };
  vm.runInNewContext(source, sandbox, { filename: "cep/main.js" });
  const watchdog = intervals.find((entry) => entry.delay === 250);
  assert(watchdog, "CEP watchdog interval was not registered");
  if (!testStartupCooldown) now += 4001;
  watchdog.callback();
  return {
    files,
    hostCalls,
    watchdog,
    advance: (milliseconds) => { now += milliseconds; },
    currentTime: () => now,
    getProcessCallCount: () => processCallCount,
    getInitializeCallCount: () => initializeCallCount,
    finishInitialization: () => pendingInitialization?.('{"ok":true}'),
    getElement, storage, windowEvents,
  };
}

const fresh = runScenario({ version: "1.10.7", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() });
assert(!fresh.hostCalls.some((call) => call.indexOf("aeMcpChatProcessBridgeCommand(") === 0), "CEP raced a healthy ScriptUI bridge");

const startupCooldown = runScenario({ version: "1.10.7", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 6000 }, "success", "pending", null, true);
assert.equal(startupCooldown.getInitializeCallCount(), 0, "CEP evaluated host code during the AE startup cooldown");
startupCooldown.advance(4001);
startupCooldown.watchdog.callback();
assert.equal(startupCooldown.getInitializeCallCount(), 1);
assert.equal(startupCooldown.getProcessCallCount(), 1);

const stale = runScenario({ version: "1.10.7", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 5000 });
assert(stale.hostCalls.includes('aeMcpChatInitializeBridgeCore("C:/Extension")'));
assert(stale.hostCalls.some((call) => call.indexOf("aeMcpChatProcessBridgeCommand(") === 0));
assert.equal(JSON.parse(stale.files.get(commandPath)).status, "completed");
assert.match(JSON.parse(stale.files.get(commandPath)).bridgeInstanceId, /^cep-/);
assert.match(JSON.parse(stale.files.get(heartbeatPath)).instanceId, /^cep-/);

const closed = runScenario({ version: "1.10.7", state: "closed", autoRun: false, instanceId: "scriptui", updatedAt: Date.now() - 5000 });
assert.equal(closed.getProcessCallCount(), 1, "closing the optional legacy panel must not disable the combined panel");
closed.files.set(heartbeatPath, JSON.stringify({ version: "1.10.7", state: "ready", autoRun: true, instanceId: "scriptui-reopened", updatedAt: closed.currentTime() }));
closed.watchdog.callback();
closed.files.set(heartbeatPath, JSON.stringify({ version: "1.10.7", state: "ready", autoRun: true, instanceId: "scriptui-reopened", updatedAt: closed.currentTime() - 6000 }));
closed.watchdog.callback();
assert(closed.hostCalls.some((call) => call.indexOf("aeMcpChatProcessBridgeCommand(") === 0), "CEP did not recover after the bridge panel reopened and later became stale");

const paused = runScenario({ version: "1.10.7", state: "paused", autoRun: false, instanceId: "scriptui", updatedAt: Date.now() + 4001 });
assert(!paused.hostCalls.some((call) => call.indexOf("aeMcpChatProcessBridgeCommand(") === 0), "CEP ignored the Auto-run pause state");
assert.equal(paused.getElement("bridgeAutoRun").disabled, true, "legacy controls must not race integrated controls");

const restarted = runScenario({ version: "1.10.9", state: "closed", autoRun: false, instanceId: "cep-previous-session", updatedAt: Date.now() - 60000 });
assert.equal(restarted.getProcessCallCount(), 1, "restored CEP panel did not acquire a fresh bridge after AE restart");
const tabCalls = restarted.hostCalls.length;
restarted.getElement("bridgeTab").click();
assert.equal(restarted.getElement("chatPanel").hidden, true);
assert.equal(restarted.getElement("bridgePanel").hidden, false);
assert.equal(restarted.getElement("bridgeTab").attributes["aria-selected"], "true");
restarted.getElement("chatTab").click();
assert.equal(restarted.getElement("chatPanel").hidden, false);
assert.equal(restarted.hostCalls.length, tabCalls, "switching tabs must not execute or reinitialize the bridge");
restarted.getElement("bridgeAutoRun").checked = false;
restarted.getElement("bridgeAutoRun").dispatch("change");
assert.equal(JSON.parse(restarted.files.get(heartbeatPath)).state, "paused");
assert.equal(restarted.storage.get("aeMcpBridgeEnabled"), "false");
const restartOwner = JSON.parse(restarted.files.get(heartbeatPath)).instanceId;
restarted.files.set(commandPath, JSON.stringify({command:"aeCommand",id:"after-pause",args:{operation:"inspect",action:"get"},status:"pending",bridgeInstanceId:restartOwner}));
restarted.advance(1000);
restarted.watchdog.callback();
assert.equal(restarted.getProcessCallCount(), 1, "paused integrated bridge executed a command");
restarted.getElement("bridgeAutoRun").checked = true;
restarted.getElement("bridgeAutoRun").dispatch("change");
assert.equal(restarted.getProcessCallCount(), 2, "resuming integrated bridge did not execute the waiting command");
assert.match(restarted.getElement("bridgeLog").textContent, /inspect\/get/);
restarted.windowEvents.beforeunload();
assert.equal(JSON.parse(restarted.files.get(heartbeatPath)).state, "closed", "closing the owning CEP panel did not release the bridge");

const noLegacy = runScenario(null);
assert.equal(noLegacy.getProcessCallCount(), 1, "combined panel still requires a separate ScriptUI panel");
const ownerAfterFirstCommand=JSON.parse(noLegacy.files.get(heartbeatPath)).instanceId;
noLegacy.files.set(commandPath,JSON.stringify({command:"aeCommand",id:"expired-edit",args:{},status:"pending",bridgeInstanceId:ownerAfterFirstCommand,timestamp:new Date(noLegacy.currentTime()-60000).toISOString(),timeoutMs:15000}));
noLegacy.watchdog.callback();
assert.equal(noLegacy.getProcessCallCount(),1,"an expired edit was replayed after recovery");
assert.match(JSON.parse(noLegacy.files.get(resultPath)).message,/expired/);
const initError = runScenario(null,"init-error");
initError.watchdog.callback();
assert.equal(initError.getProcessCallCount(),0);
assert.match(initError.getElement("bridgeStatusText").textContent,/Missing bundled core/);

const idleStale = runScenario({ version: "1.10.7", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 6000 }, "success", "completed");
assert(!idleStale.hostCalls.some(call=>call.startsWith("aeMcpChatInitializeBridgeCore(")), "CEP evaluated host code without a pending command");

const relinquish = runScenario({ version: "1.10.7", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 6000 }, "success", "completed");
relinquish.files.set(heartbeatPath, JSON.stringify({ version: "1.10.7", state: "ready", autoRun: true, instanceId: "scriptui-recovered", updatedAt: relinquish.currentTime() }));
relinquish.files.set(commandPath, JSON.stringify({ command: "aeCommand", id: "second-command", args: {}, status: "pending" }));
relinquish.watchdog.callback();
assert(!relinquish.hostCalls.some((call) => call.indexOf("aeMcpChatProcessBridgeCommand(") === 0), "CEP did not relinquish control to a recovered ScriptUI bridge");

const interrupted = runScenario({ version: "1.10.7", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 5000 }, "error");
const retried = JSON.parse(interrupted.files.get(commandPath));
assert.equal(retried.status, "pending");
assert.equal(retried.retryCount, 1);
assert.match(retried.lastHostError, /EvalScript error/);

const otherInstance = runScenario({ version: "1.10.7", state: "ready", autoRun: true, instanceId: "source-a", updatedAt: Date.now() - 6000 }, "success", "pending", "source-b");
assert(!otherInstance.hostCalls.some((call) => call.indexOf("aeMcpChatProcessBridgeCommand(") === 0), "CEP stole a command owned by another AE instance");

const callbackLost = runScenario({ version: "1.10.7", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 6000 }, "lost-callback-once");
assert.equal(callbackLost.getProcessCallCount(), 1, "first host command was not started");
const takeoverHeartbeat = JSON.parse(callbackLost.files.get(heartbeatPath));
callbackLost.files.set(commandPath, JSON.stringify({ command: "aeCommand", id: "after-lost-callback", args: {}, status: "pending", bridgeInstanceId: takeoverHeartbeat.instanceId }));
callbackLost.watchdog.callback();
assert.equal(callbackLost.getProcessCallCount(), 2, "lost CEP callback permanently wedged later bridge commands");
assert.equal(JSON.parse(callbackLost.files.get(commandPath)).status, "completed");

const initializationLost = runScenario({ version: "1.10.7", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 6000 }, "init-lost-once");
assert.equal(initializationLost.getInitializeCallCount(), 1);
assert.equal(initializationLost.getProcessCallCount(), 0);
initializationLost.advance(30001);
initializationLost.watchdog.callback();
assert.equal(initializationLost.getInitializeCallCount(), 1, "host initialization retried without backoff");
initializationLost.advance(1501);
initializationLost.watchdog.callback();
assert.equal(initializationLost.getInitializeCallCount(), 2, "lost initialization callback permanently wedged CEP takeover");
assert.equal(initializationLost.getProcessCallCount(), 1);
assert.equal(JSON.parse(initializationLost.files.get(commandPath)).status, "completed");

const slowInitialization = runScenario(null,"init-slow");
slowInitialization.advance(8000);
slowInitialization.watchdog.callback();
assert.equal(slowInitialization.getInitializeCallCount(),1,"cold initialization was duplicated/discarded after 3 seconds");
assert.equal(JSON.parse(slowInitialization.files.get(heartbeatPath)).hostPhase,"initializing");
slowInitialization.finishInitialization();
assert.equal(slowInitialization.getProcessCallCount(),1,"successful slow initialization callback was discarded");

const runningLost = runScenario({ version: "1.10.7", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 6000 }, "running-no-callback");
runningLost.advance(7001);
runningLost.watchdog.callback();
assert.equal(JSON.parse(runningLost.files.get(commandPath)).status, "error", "interrupted running command remained wedged");
assert.match(JSON.parse(runningLost.files.get(resultPath)).message, /lifecycle transition/);

// The combined panel ships its own core, and must not inherit a closed legacy
// panel's stale UI references or paused checkbox. No AE instance is required.
let coreLoads = 0;
let coreChecks = 0;
const coreSandbox = {
  File: function (filePath) {
    this.fsName = filePath;
    this.exists = filePath === "C:/Extension/jsx/mcp-bridge-core.jsx";
    this.parent = {fsName:"C:/Extension/jsx",parent:{fsName:"C:/Extension"}};
  },
  Folder:{startup:{fsName:"C:/AE/Support Files"}},
  JSON,
  aeMcpHeadlessBridgeMode:false,
  autoRunCheckbox:{value:false},
  checkForCommands() { throw new Error("Closed legacy UI must not be reused"); },
  aeCommand() {},
  $:{fileName:"C:/Extension/jsx/host.jsx",global:{},evalFile(file) {
    assert.equal(file.fsName,"C:/Extension/jsx/mcp-bridge-core.jsx");
    assert.equal(coreSandbox.$.global.__aeMcpHeadlessBridgeMode,true);
    coreLoads++;
    coreSandbox.aeMcpHeadlessBridgeMode = true;
    coreSandbox.autoRunCheckbox = {value:true};
    coreSandbox.checkForCommands = () => { coreChecks++; };
    coreSandbox.$.global.__aeMcpHeadlessCore = {headless:true,recover(){},check(){coreChecks++;return {ok:true};}};
  }},
};
vm.createContext(coreSandbox);
vm.runInContext(fs.readFileSync("cep/jsx/host.jsx", "utf8"), coreSandbox);
assert.equal(JSON.parse(coreSandbox.aeMcpChatInitializeBridgeCore("C:/Extension")).ok,true);
assert.equal(coreLoads,1);
assert.equal(coreSandbox.autoRunCheckbox.value,true);
assert.equal(JSON.parse(coreSandbox.aeMcpChatInitializeBridgeCore()).reused,true);
assert.equal(coreLoads,1,"already-loaded headless core was unnecessarily reinitialized");
delete coreSandbox.$.global.__aeMcpHeadlessCore; // scripting engine state was reset
assert.equal(JSON.parse(coreSandbox.aeMcpChatProcessBridgeCommand("cep-test")).ok,true);
assert.equal(coreLoads,2,"closed legacy state was retained after panel migration");
assert.equal(coreChecks,1);
const installerSource = fs.readFileSync("install-cep.ps1","utf8");
assert.match(installerSource,/Copy-Item[^\r\n]*bridgeCoreSource[^\r\n]*mcp-bridge-core/);
assert.match(fs.readFileSync("installer/windows/build-installer.ps1","utf8"),/cep\\jsx\\mcp-bridge-core.jsx/);
console.log("CEP bridge watchdog and combined panel integration tests passed.");
