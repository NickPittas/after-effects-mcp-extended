import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("cep/main.js", "utf8");
const documents = "C:/Users/Test/Documents";
const heartbeatPath = documents + "/ae-mcp-bridge/ae_bridge_status.json";
const commandPath = documents + "/ae-mcp-bridge/ae_command.json";
const resultPath = documents + "/ae-mcp-bridge/ae_mcp_result.json";

function element() {
  return {
    checked: false, disabled: false, hidden: false, value: "", textContent: "",
    innerHTML: "", className: "", dataset: {}, style: {}, scrollHeight: 0,
    scrollTop: 0, clientHeight: 0,
    addEventListener() {}, appendChild() {}, replaceChildren() {}, scrollTo() {},
    focus() {}, setAttribute() {},
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
  let processCallCount = 0;
  let initializeCallCount = 0;
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
      if (script === "aeMcpChatInitializeBridgeCore()") {
        initializeCallCount++;
        if (!(processResult === "init-lost-once" && initializeCallCount === 1)) callback('{"ok":true}');
      }
      else if (script.indexOf("aeMcpChatProcessBridgeCommand(") === 0) {
        processCallCount++;
        if (processResult === "success" || processResult === "init-lost-once") {
          const command = JSON.parse(files.get(commandPath));
          command.status = "completed";
          files.set(commandPath, JSON.stringify(command));
          files.set(resultPath, JSON.stringify({ status: "success", _commandId: command.id }));
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
    window: { location: { search: "" }, cep, __adobe_cep__: host },
    document,
    localStorage: { getItem() { return null; } },
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
  };
}

const fresh = runScenario({ version: "1.10.5", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() });
assert(!fresh.hostCalls.some((call) => call.indexOf("aeMcpChatProcessBridgeCommand(") === 0), "CEP raced a healthy ScriptUI bridge");

const startupCooldown = runScenario({ version: "1.10.5", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 6000 }, "success", "pending", null, true);
assert.equal(startupCooldown.getInitializeCallCount(), 0, "CEP evaluated host code during the AE startup cooldown");
startupCooldown.advance(4001);
startupCooldown.watchdog.callback();
assert.equal(startupCooldown.getInitializeCallCount(), 1);
assert.equal(startupCooldown.getProcessCallCount(), 1);

const stale = runScenario({ version: "1.10.5", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 5000 });
assert(stale.hostCalls.includes("aeMcpChatInitializeBridgeCore()"));
assert(stale.hostCalls.some((call) => call.indexOf("aeMcpChatProcessBridgeCommand(") === 0));
assert.equal(JSON.parse(stale.files.get(commandPath)).status, "completed");
assert.match(JSON.parse(stale.files.get(commandPath)).bridgeInstanceId, /^cep-/);
assert.match(JSON.parse(stale.files.get(heartbeatPath)).instanceId, /^cep-/);

const closed = runScenario({ version: "1.10.5", state: "closed", autoRun: false, instanceId: "scriptui", updatedAt: Date.now() - 5000 });
assert(!closed.hostCalls.some((call) => call.indexOf("aeMcpChatProcessBridgeCommand(") === 0), "CEP restarted an intentionally closed bridge");
closed.files.set(heartbeatPath, JSON.stringify({ version: "1.10.5", state: "ready", autoRun: true, instanceId: "scriptui-reopened", updatedAt: closed.currentTime() }));
closed.watchdog.callback();
closed.files.set(heartbeatPath, JSON.stringify({ version: "1.10.5", state: "ready", autoRun: true, instanceId: "scriptui-reopened", updatedAt: closed.currentTime() - 6000 }));
closed.watchdog.callback();
assert(closed.hostCalls.some((call) => call.indexOf("aeMcpChatProcessBridgeCommand(") === 0), "CEP did not recover after the bridge panel reopened and later became stale");

const paused = runScenario({ version: "1.10.5", state: "paused", autoRun: false, instanceId: "scriptui", updatedAt: Date.now() - 6000 });
assert(!paused.hostCalls.some((call) => call.indexOf("aeMcpChatProcessBridgeCommand(") === 0), "CEP ignored the Auto-run pause state");

const idleStale = runScenario({ version: "1.10.5", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 6000 }, "success", "completed");
assert(!idleStale.hostCalls.includes("aeMcpChatInitializeBridgeCore()"), "CEP evaluated host code without a pending command");

const relinquish = runScenario({ version: "1.10.5", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 6000 }, "success", "completed");
relinquish.files.set(heartbeatPath, JSON.stringify({ version: "1.10.5", state: "ready", autoRun: true, instanceId: "scriptui-recovered", updatedAt: relinquish.currentTime() }));
relinquish.files.set(commandPath, JSON.stringify({ command: "aeCommand", id: "second-command", args: {}, status: "pending" }));
relinquish.watchdog.callback();
assert(!relinquish.hostCalls.some((call) => call.indexOf("aeMcpChatProcessBridgeCommand(") === 0), "CEP did not relinquish control to a recovered ScriptUI bridge");

const interrupted = runScenario({ version: "1.10.5", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 5000 }, "error");
const retried = JSON.parse(interrupted.files.get(commandPath));
assert.equal(retried.status, "pending");
assert.equal(retried.retryCount, 1);
assert.match(retried.lastHostError, /EvalScript error/);

const otherInstance = runScenario({ version: "1.10.5", state: "ready", autoRun: true, instanceId: "source-a", updatedAt: Date.now() - 6000 }, "success", "pending", "source-b");
assert(!otherInstance.hostCalls.some((call) => call.indexOf("aeMcpChatProcessBridgeCommand(") === 0), "CEP stole a command owned by another AE instance");

const callbackLost = runScenario({ version: "1.10.5", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 6000 }, "lost-callback-once");
assert.equal(callbackLost.getProcessCallCount(), 1, "first host command was not started");
const takeoverHeartbeat = JSON.parse(callbackLost.files.get(heartbeatPath));
callbackLost.files.set(commandPath, JSON.stringify({ command: "aeCommand", id: "after-lost-callback", args: {}, status: "pending", bridgeInstanceId: takeoverHeartbeat.instanceId }));
callbackLost.watchdog.callback();
assert.equal(callbackLost.getProcessCallCount(), 2, "lost CEP callback permanently wedged later bridge commands");
assert.equal(JSON.parse(callbackLost.files.get(commandPath)).status, "completed");

const initializationLost = runScenario({ version: "1.10.5", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 6000 }, "init-lost-once");
assert.equal(initializationLost.getInitializeCallCount(), 1);
assert.equal(initializationLost.getProcessCallCount(), 0);
initializationLost.advance(3501);
initializationLost.watchdog.callback();
assert.equal(initializationLost.getInitializeCallCount(), 1, "host initialization retried without backoff");
initializationLost.advance(1501);
initializationLost.watchdog.callback();
assert.equal(initializationLost.getInitializeCallCount(), 2, "lost initialization callback permanently wedged CEP takeover");
assert.equal(initializationLost.getProcessCallCount(), 1);
assert.equal(JSON.parse(initializationLost.files.get(commandPath)).status, "completed");

const runningLost = runScenario({ version: "1.10.5", state: "ready", autoRun: true, instanceId: "scriptui", updatedAt: Date.now() - 6000 }, "running-no-callback");
runningLost.advance(7001);
runningLost.watchdog.callback();
assert.equal(JSON.parse(runningLost.files.get(commandPath)).status, "error", "interrupted running command remained wedged");
assert.match(JSON.parse(runningLost.files.get(resultPath)).message, /lifecycle transition/);

console.log("CEP bridge watchdog integration tests passed.");
