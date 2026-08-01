import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const files = new Map();

class FakeFolder {
  constructor(filePath) { this.fsName = String(filePath); this.exists = true; }
  create() { this.exists = true; return true; }
}
FakeFolder.myDocuments = new FakeFolder("C:/Documents");
FakeFolder.userData = new FakeFolder("C:/UserData");
FakeFolder.startup = new FakeFolder("C:/AfterEffects");

class FakeFile {
  constructor(filePath) {
    this.fsName = String(filePath).replace(/\\/g, "/");
    this.mode = "";
    this.buffer = "";
    this.encoding = "UTF-8";
    this.parent = new FakeFolder(this.fsName.split("/").slice(0, -1).join("/"));
  }
  get exists() { return files.has(this.fsName); }
  open(mode) {
    this.mode = mode;
    this.buffer = mode === "a" ? String(files.get(this.fsName) || "") : "";
    return true;
  }
  read() { return String(files.get(this.fsName) || ""); }
  write(value) { this.buffer += String(value); return true; }
  close() { if (this.mode === "w" || this.mode === "a") files.set(this.fsName, this.buffer); return true; }
}

const scheduled = new Map();
let nextTaskId = 1;
const sandbox = {
  console,
  JSON,
  Math,
  Date,
  File: FakeFile,
  Folder: FakeFolder,
  $: { global: { __aeMcpHeadlessBridgeMode: true } },
  app: {
    project: { numItems: 0, bitsPerChannel: 16, activeItem: null, file: null, dirty: false },
    scheduleTask(expression, delay, repeat) { const id = nextTaskId++; scheduled.set(id, { expression, delay, repeat }); return id; },
    cancelTask(id) { scheduled.delete(id); },
    newProject() { this.project = { numItems: 0, bitsPerChannel: 16, activeItem: null, file: null, dirty: false, save(file) { this.file = file || this.file; this.dirty = false; } }; return this.project; },
    open(file) { this.project = { numItems: 0, bitsPerChannel: 16, activeItem: null, file, dirty: false, save(nextFile) { this.file = nextFile || this.file; this.dirty = false; } }; return this.project; },
  },
};
vm.createContext(sandbox);
const source = fs.readFileSync("src/scripts/mcp-bridge-auto.jsx", "utf8").replace(/^#target.*$/gm, "");
vm.runInContext(source, sandbox, { filename: "mcp-bridge-auto.jsx" });

const commandPath = "C:/Documents/ae-mcp-bridge/ae_command.json";
const resultPath = "C:/Documents/ae-mcp-bridge/ae_mcp_result.json";
const heartbeatPath = "C:/Documents/ae-mcp-bridge/ae_bridge_status.json";
function writeCommand(status, bridgeInstanceId, id = "command-1") {
  files.set(commandPath, JSON.stringify({ command: "unsupported-test-command", id, args: {}, status, bridgeInstanceId }));
}
function command() { return JSON.parse(files.get(commandPath)); }
function result() { return JSON.parse(files.get(resultPath)); }

sandbox.bridgeInstanceId = "instance-a";
sandbox.$.global.__aeMcpBridgeInstanceId = "instance-a";

writeCommand("pending", "instance-b");
sandbox.checkForCommands();
assert.equal(command().status, "pending", "Wrong AE instance executed the command");

writeCommand("pending", "instance-a");
sandbox.checkForCommands();
assert.equal(command().status, "completed");
assert.equal(result()._commandId, "command-1");

writeCommand("pending", "cep-instance", "command-cep");
sandbox.checkForCommands("cep-instance");
assert.equal(command().status, "completed", "CEP takeover could not execute its owned command");

sandbox.isChecking = true;
writeCommand("pending", "instance-a", "command-interrupted-check");
sandbox.checkForCommands();
assert.equal(command().status, "completed", "Interrupted isChecking flag permanently wedged the bridge");
assert.match(sandbox.logText.text, /Recovered an interrupted bridge check/);

files.set(commandPath, "{ malformed command json");
sandbox.checkForCommands();
writeCommand("pending", "instance-a", "command-after-malformed-json");
sandbox.checkForCommands();
assert.equal(command().status, "completed", "Malformed command input permanently wedged the bridge checker");

writeCommand("running", "instance-a", "command-abandoned");
files.set(resultPath, JSON.stringify({ status: "waiting", _commandId: "command-abandoned" }));
assert.equal(sandbox.recoverInterruptedBridgeCommand(), true);
assert.equal(command().status, "error");
assert.equal(result().status, "error");
assert.match(result().message, /lifecycle transition/);

writeCommand("running", "instance-a", "command-result-written");
files.set(resultPath, JSON.stringify({ status: "success", _commandId: "command-result-written" }));
assert.equal(sandbox.recoverInterruptedBridgeCommand(), true);
assert.equal(command().status, "completed", "Existing successful result was not reconciled");

sandbox.startCommandChecker();
const task = scheduled.get(sandbox.$.global.__aeMcpBridgeCommandTaskId);
assert(task && task.repeat === true, "Bridge checker was not scheduled as a repeating task");
assert.match(task.expression, /^aeMcpBridgeScheduledTick\("[0-9-]+"\)$/);

const firstTaskId = sandbox.$.global.__aeMcpBridgeCommandTaskId;
sandbox.app.cancelTask(firstTaskId);
sandbox.bridgeLastTickAt = Date.now() - 5000;
const instanceBeforeRestart = sandbox.bridgeInstanceId;
writeCommand("pending", instanceBeforeRestart, "command-queued-during-project-transition");
assert.equal(sandbox.wakeBridgeCommandChecker(), "restarted", "stale ScriptUI task did not restart in-place");
assert.equal(sandbox.bridgeInstanceId, instanceBeforeRestart, "in-place scheduler restart changed bridge ownership");
assert.equal(command().status, "completed", "command queued during scheduler loss was stranded after restart");
const restartedTaskId = sandbox.$.global.__aeMcpBridgeCommandTaskId;
assert.notEqual(restartedTaskId, firstTaskId);
assert(scheduled.get(restartedTaskId)?.repeat === true);
assert(!scheduled.has(firstTaskId), "restarted bridge left the old repeating task registered");

const activeTaskId = sandbox.$.global.__aeMcpBridgeCommandTaskId;
sandbox.bridgeInstanceId = "older-panel-instance";
sandbox.stopCommandChecker();
assert(scheduled.has(activeTaskId), "closing an older panel instance cancelled the active panel scheduler");

sandbox.bridgeIsClosing = false;
sandbox.bridgeInstanceId = "replacement-panel-instance";
sandbox.$.global.__aeMcpBridgeInstanceId = "previous-panel-instance";
writeCommand("pending", "previous-panel-instance", "command-during-panel-takeover");
sandbox.startCommandChecker();
assert.equal(command().status, "completed", "panel takeover stranded a command owned by the previous panel instance");
assert.equal(command().bridgeInstanceId, "replacement-panel-instance");

sandbox.stopCommandChecker();
sandbox.bridgeIsClosing = false;
sandbox.bridgeInstanceId = "new-ae-process-instance";
sandbox.$.global.__aeMcpBridgeInstanceId = null;
files.set(heartbeatPath, JSON.stringify({ state: "closed", instanceId: "dead-ae-process-instance", updatedAt: Date.now() }));
writeCommand("pending", "dead-ae-process-instance", "command-survived-ae-restart");
sandbox.startCommandChecker();
assert.equal(command().status, "completed", "new AE process did not recover a pending command from the dead process");
assert.equal(command().bridgeInstanceId, "new-ae-process-instance");

sandbox.app.project.dirty = true;
assert.throws(() => sandbox.aeProjectCommand({ action: "new" }), /unsaved changes/);
sandbox.app.project.dirty = false;
const testProjectPath = "C:/Documents/bridge-open-test.aep";
files.set(testProjectPath, "test project");
const openedProject = sandbox.aeProjectCommand({ action: "open", path: testProjectPath });
assert.equal(openedProject.path, testProjectPath);
assert.equal(openedProject.dirty, false);
const newProject = sandbox.aeProjectCommand({ action: "new", path: "C:/Documents/bridge-new-test.aep" });
assert.equal(newProject.path, "C:/Documents/bridge-new-test.aep");
assert.equal(newProject.dirty, false);

console.log("ExtendScript bridge lifecycle tests passed.");
