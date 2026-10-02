import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

class FakeFolderItem {}

class FakeFootageItem {
  constructor(id, name, duration = 10) {
    this.id = id;
    this.name = name;
    this.duration = duration;
  }
}

class FakeLayer {
  constructor(index, name, source) {
    this.index = index;
    this.name = name;
    this.source = source;
    this.enabled = true;
    this.locked = false;
    this.shy = false;
    this.solo = false;
    this.threeDLayer = false;
    this.inPoint = 0;
    this.outPoint = 8;
    this.startTime = 0;
    this.stretch = 100;
    this.effectsSentinel = { preserved: true };
    this.timeRemapEnabled = false;
    this.failOnSourceId = null;
    this.replaceCalls = [];
  }
  replaceSource(source, fixExpressions) {
    this.replaceCalls.push({ source, fixExpressions });
    if (source.id === this.failOnSourceId) throw new Error("simulated replacement failure");
    this.source = source;
  }
  property(name) {
    return name === "ADBE Time Remapping" ? this.timeRemapProperty : null;
  }
}

class FakeCompItem {
  constructor(id, name, layers) {
    this.id = id;
    this.name = name;
    this.layersList = layers;
    this.numLayers = layers.length;
  }
  layer(indexOrName) {
    if (typeof indexOrName === "number") return this.layersList[indexOrName - 1] || null;
    return this.layersList.find((layer) => layer.name === indexOrName) || null;
  }
}

class FakeFolder {
  constructor(filePath) { this.fsName = String(filePath); this.exists = true; }
  create() { return true; }
}
FakeFolder.myDocuments = new FakeFolder("C:/Documents");
FakeFolder.userData = new FakeFolder("C:/UserData");
FakeFolder.startup = new FakeFolder("C:/AfterEffects");

class FakeFile {
  constructor(filePath) {
    this.fsName = String(filePath).replace(/\\/g, "/");
    this.name = this.fsName.split("/").pop();
    this.encoding = "UTF-8";
    this.parent = new FakeFolder(this.fsName.split("/").slice(0, -1).join("/"));
  }
  get exists() { return false; }
  open() { return true; }
  read() { return ""; }
  write() { return true; }
  close() { return true; }
  remove() { return true; }
  rename() { return true; }
}

const originalA = new FakeFootageItem(10, "shot-a-proxy.mov", 4);
const originalB = new FakeFootageItem(11, "shot-b-proxy.mov", 4);
const replacementA = new FakeFootageItem(20, "shot-a-final.mov", 3);
const replacementB = new FakeFootageItem(21, "shot-b-final.mov", 6);
const duplicateNameA = new FakeFootageItem(30, "duplicate.mov", 5);
const duplicateNameB = new FakeFootageItem(31, "duplicate.mov", 5);
const layerA = new FakeLayer(1, "Shot A", originalA);
const layerB = new FakeLayer(2, "Shot B", originalB);
const comp = new FakeCompItem(1, "Edit", [layerA, layerB]);
const items = [comp, originalA, originalB, replacementA, replacementB, duplicateNameA, duplicateNameB];

const project = {
  numItems: items.length,
  activeItem: comp,
  item(index) { return items[index - 1] || null; },
  itemByID(id) { return items.find((item) => item.id === id) || null; },
};

const sandbox = {
  console,
  JSON,
  Math,
  Date,
  isFinite,
  File: FakeFile,
  Folder: FakeFolder,
  CompItem: FakeCompItem,
  FootageItem: FakeFootageItem,
  FolderItem: FakeFolderItem,
  $: { global: { __aeMcpHeadlessBridgeMode: true } },
  app: {
    project,
    beginUndoGroup() {},
    endUndoGroup() {},
    scheduleTask() { return 1; },
    cancelTask() {},
  },
};
vm.createContext(sandbox);
const source = fs.readFileSync("src/scripts/mcp-bridge-auto.jsx", "utf8").replace(/^#target.*$/gm, "");
vm.runInContext(source, sandbox, { filename: "mcp-bridge-auto.jsx" });

function command(parameters) {
  return JSON.parse(sandbox.aeCommand({ operation: "layer", ...parameters }));
}

layerA.timeRemapEnabled = true;
layerA.timeRemapProperty = {
  numKeys: 2,
  keyValue(index) { return index === 1 ? 0 : 4.5; },
  keyTime(index) { return index === 1 ? 0 : 3; },
};
const sentinel = layerA.effectsSentinel;
const single = command({
  action: "replaceSource",
  compName: "Edit",
  layerIndex: 1,
  sourceItemId: 20,
  fixExpressions: false,
});
assert.equal(single.status, "success", single.message);
assert.equal(layerA.source, replacementA);
assert.equal(layerA.effectsSentinel, sentinel, "Replacement rebuilt the layer instead of preserving it");
assert.deepEqual(single.data.previousSource.id, 10);
assert.deepEqual(single.data.source.id, 20);
assert.equal(single.data.fixExpressions, false);
assert.equal(single.data.warnings[0].type, "timeRemapOutOfRange");
assert.equal(single.data.warnings[0].sourceDuration, 3);

layerA.source = originalA;
layerB.source = originalB;
const bulk = command({
  action: "replaceSource",
  compName: "Edit",
  atomic: true,
  replacements: [
    { layerIndex: 1, sourceItemIndex: 4 },
    { layerIndex: 2, sourceItemName: "shot-b-final.mov" },
  ],
});
assert.equal(bulk.status, "success");
assert.equal(bulk.data.atomic, true);
assert.equal(bulk.data.count, 2);
assert.equal(layerA.source, replacementA);
assert.equal(layerB.source, replacementB);

layerA.source = originalA;
layerB.source = originalB;
const invalidAtomic = command({
  action: "replaceSource",
  compName: "Edit",
  atomic: true,
  replacements: [
    { layerIndex: 1, sourceItemId: 20 },
    { layerIndex: 2, sourceItemName: "duplicate.mov" },
  ],
});
assert.equal(invalidAtomic.status, "error");
assert.match(invalidAtomic.message, /ambiguous/);
assert.equal(layerA.source, originalA, "Atomic validation changed a layer before the full map was valid");
assert.equal(layerB.source, originalB);

layerA.source = originalA;
layerB.source = originalB;
layerB.failOnSourceId = 21;
const rolledBack = command({
  action: "replaceSource",
  compName: "Edit",
  atomic: true,
  replacements: [
    { layerIndex: 1, sourceItemId: 20 },
    { layerIndex: 2, sourceItemId: 21 },
  ],
});
layerB.failOnSourceId = null;
assert.equal(rolledBack.status, "error");
assert.match(rolledBack.message, /rolled back/);
assert.equal(layerA.source, originalA, "Atomic runtime failure did not restore the first source");
assert.equal(layerB.source, originalB);

const unsupportedUpdate = command({
  action: "update",
  compName: "Edit",
  layerIndex: 1,
  sourceItemId: 20,
});
assert.equal(unsupportedUpdate.status, "error");
assert.match(unsupportedUpdate.message, /unsupported parameter: sourceItemId/);

const emptyUpdate = command({ action: "update", compName: "Edit", layerIndex: 1 });
assert.equal(emptyUpdate.status, "error");
assert.match(emptyUpdate.message, /at least one supported property/);

const validUpdate = command({ action: "update", compName: "Edit", layerIndex: 1, enabled: false });
assert.equal(validUpdate.status, "success");
assert.deepEqual(validUpdate.data.changedProperties, ["enabled"]);

console.log("Layer source replacement tests passed.");
