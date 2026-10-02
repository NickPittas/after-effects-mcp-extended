import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const elements = new Map();
function element() {
  const handlers = {};
  return { value:"", checked:false, disabled:false, hidden:false, textContent:"", innerHTML:"", style:{}, dataset:{}, scrollHeight:0, scrollTop:0, clientHeight:0,
    addEventListener(name, handler) { handlers[name] = handler; },
    dispatch(name) { handlers[name]?.({key:"Enter",preventDefault(){},stopPropagation(){}}); },
    click() { this.dispatch("click"); }, focus(){}, appendChild(){}, replaceChildren(){}, scrollTo(){}, setAttribute(){} };
}
const getElement = id => { if (!elements.has(id)) elements.set(id,element()); return elements.get(id); };
let state = { provider:"codex", providerName:"Codex", hostStatus:"ready", cliStatus:"ready", bridgeStatus:"ready", busy:false, transcript:[], activityLog:[],
  modelChoices:{codex:{model:"fixture",provider:null,effort:"high"},pi:{model:"plain",provider:"zai",effort:null}},
  modelCatalogs:{codex:{status:"ready",modelSupported:true,defaultModel:"fixture",models:[{id:"fixture",label:'Model <safe>',efforts:["low","high"]}]},
  pi:{status:"ready",modelSupported:true,models:[{id:"plain",provider:"zai",label:"zai / plain",efforts:[]}]}} };
const queued = [];
const intervals = [];
const sandbox = {
  window:{location:{search:""},cep:{fs:{makedir(){return {err:0};},readFile(file){return file.endsWith("state.json") ? {err:0,data:JSON.stringify(state)} : {err:1};},writeFile(file,data){if(file.includes("/requests/"))queued.push(JSON.parse(data));return {err:0};}}},
  __adobe_cep__:{getSystemPath(){return "C:/Test/Documents";},addEventListener(){}}},
  document:{getElementById:getElement,createElement:element,createDocumentFragment:element,addEventListener(){}},
  localStorage:{getItem(){return null;},setItem(){}},
  setInterval(callback,delay){intervals.push({callback,delay});},setTimeout(){},clearTimeout(){},
  JSON,Date,Math,Infinity,isFinite,decodeURIComponent,encodeURI,console
};
vm.runInNewContext(fs.readFileSync("cep/main.js","utf8"),sandbox);
const poll = intervals.find(item=>item.delay===180).callback;
let sequence = 0;
function render() { state.updatedAt = String(++sequence); poll(); }
render();
assert.equal(getElement("modelSelect").value,JSON.stringify(["","fixture"]));
assert.equal(getElement("modelEffortSelect").value,"high");
assert.equal(getElement("modelEffortSelect").hidden,false);
assert(getElement("modelSelect").innerHTML.includes("Model &lt;safe&gt;"));
getElement("modelSelect").value="";
getElement("modelSelect").dispatch("change");
assert.equal(queued.at(-1).action,"setModel");
assert.equal(queued.at(-1).modelChoice.model,null);
assert.equal(getElement("sendButton").disabled,true,"Send must wait for the model-setting acknowledgement");
state.modelChoices.codex = {model:null,provider:null,effort:null};
render(); render();
assert.equal(getElement("sendButton").disabled,false);
state.provider="pi"; state.providerName="Pi";
render();
assert.equal(getElement("modelSelect").value,JSON.stringify(["zai","plain"]));
assert.equal(getElement("modelEffortSelect").hidden,true,"Non-reasoning models must hide the effort control");
getElement("modelSelect").value="__custom__";
getElement("modelSelect").dispatch("change");
assert.equal(getElement("customModelRow").hidden,false);
getElement("customModelInput").value="provider/custom/model";
getElement("applyModelButton").click();
assert.equal(queued.at(-1).modelChoice.provider,"provider");
assert.equal(queued.at(-1).modelChoice.model,"custom/model");
state.modelChoices.pi=queued.at(-1).modelChoice;
render(); render();
state.busy=true;
render();
assert.equal(getElement("modelSelect").disabled,true);
assert.equal(getElement("sendButton").disabled,true);
console.log("Model selector UI interactions passed.");
