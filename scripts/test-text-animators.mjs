import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const types = {PROPERTY:1, INDEXED_GROUP:2, NAMED_GROUP:3};
let generation = 0;
// Keep this modeled AE child set explicit. A permissive addProperty mock would
// let an invalid matchName look like a passing native animator property.
const animatorPropertyMatchNames = new Set([
  "ADBE Text Anchor Point 3D", "ADBE Text Position 3D", "ADBE Text Scale 3D",
  "ADBE Text Rotation", "ADBE Text Rotation X", "ADBE Text Rotation Y",
  "ADBE Text Opacity", "ADBE Text Skew", "ADBE Text Skew Axis",
  "ADBE Text Tracking Amount", "ADBE Text Track Type", "ADBE Text Line Anchor",
  "ADBE Text Line Spacing", "ADBE Text Fill Color", "ADBE Text Fill Hue",
  "ADBE Text Fill Saturation", "ADBE Text Fill Brightness", "ADBE Text Fill Opacity",
  "ADBE Text Stroke Color", "ADBE Text Stroke Hue", "ADBE Text Stroke Saturation",
  "ADBE Text Stroke Brightness", "ADBE Text Stroke Opacity", "ADBE Text Stroke Width",
  "ADBE Text Blur", "ADBE Text Character Offset", "ADBE Text Character Replace"
]);
const selectorMatchNames = new Set([
  "ADBE Text Selector", "ADBE Text Wiggly Selector", "ADBE Text Expressible Selector"
]);
const addableChildren = {
  "ADBE Text Animators": new Set(["ADBE Text Animator"]),
  "ADBE Text Animator Properties": animatorPropertyMatchNames,
  "ADBE Text Selectors": selectorMatchNames
};
function node(matchName, children = null, value = 0) {
  const result = {matchName,name:matchName,children,value,keys:[],expression:"",enabled:true};
  for (const child of children || []) child.parent = result;
  return result;
}
function selector(matchName) {
  if (matchName === "ADBE Text Selector") return node(matchName,[
    node("ADBE Text Percent Start"),node("ADBE Text Percent End",null,100),node("ADBE Text Percent Offset"),
    node("ADBE Text Index Start"),node("ADBE Text Index End"),node("ADBE Text Index Offset"),
    node("ADBE Text Range Advanced",[
      node("ADBE Text Range Units",null,1),node("ADBE Text Range Type2",null,1),
      node("ADBE Text Range Shape",null,1),node("ADBE Text Selector Mode",null,1),
      node("ADBE Text Selector Max Amount",null,100),node("ADBE Text Selector Smoothness",null,100),
      node("ADBE Text Levels Max Ease"),node("ADBE Text Levels Min Ease"),
      node("ADBE Text Randomize Order"),node("ADBE Text Random Seed")
    ])
  ]);
  if (matchName === "ADBE Text Expressible Selector") return node(matchName,[node("ADBE Text Expressible Amount",null,[100,100,100])]);
  return node(matchName,[node("ADBE Text Wiggly Max Amount",null,100)]);
}
function wrap(target) {
  if (!target) return null;
  const revision = generation;
  const check = () => { if (revision !== generation) throw new Error("Object is invalid (simulated indexed-group recreation)"); };
  return new Proxy(target,{
    get(current,key) {
      check();
      if (key === "propertyType") return current.children ? types.INDEXED_GROUP : types.PROPERTY;
      if (key === "propertyIndex") return current.parent?.children.indexOf(current)+1 || 1;
      if (key === "numProperties") return current.children?.length || 0;
      if (key === "numKeys") return current.keys.length;
      if (key === "canSetExpression") return !current.children;
      if (key === "expressionEnabled") return Boolean(current.expression);
      if (key === "expressionError") return current.expression === "BAD" ? "invalid expression" : "";
      if (key === "property") return name => {check();return wrap(typeof name === "number" ? current.children?.[name-1] : current.children?.find(child=>child.matchName===name || child.name===name));};
      if (key === "canAddProperty") return name => {check();return Boolean(addableChildren[current.matchName]?.has(name));};
      if (key === "addProperty") return name => {
        check();
        if (!addableChildren[current.matchName]?.has(name)) throw new Error("Property is not addable to this AE group: " + name);
        let child;
        if (name === "ADBE Text Animator") child=node(name,[node("ADBE Text Animator Properties",[]),node("ADBE Text Selectors",[selector("ADBE Text Selector")])]);
        else if (/Selector$/.test(name)) child=selector(name);
        else child=node(name);
        child.parent=current;current.children.push(child);generation++;return wrap(child);
      };
      if (key === "remove") return () => {check();current.parent.children.splice(current.parent.children.indexOf(current),1);generation++;};
      if (key === "setValue") return value => {
        check();if (current.keys.length) throw new Error("Cannot set a static value on an animated property");current.value=value;
        if (current.matchName === "ADBE Text Range Units") {
          const range=current.parent.parent;
          for (const child of range.children) child.matchName=child.matchName.replace(/(Percent|Index) /,value===2 ? "Index " : "Percent ");
          generation++;
        }
      };
      if (key === "setValueAtTime") return (time,value) => {check();let entry=current.keys.find(key=>key.time===time);if(entry)entry.value=value;else current.keys.push({time,value});current.keys.sort((a,b)=>a.time-b.time);current.value=value;};
      if (key === "nearestKeyIndex") return time => {check();return current.keys.findIndex(key=>key.time===time)+1;};
      if (key === "keyTime") return index => {check();return current.keys[index-1].time;};
      if (key === "keyValue") return index => {check();return current.keys[index-1].value;};
      if (key === "removeKey") return index => {check();current.keys.splice(index-1,1);};
      if (key === "setInterpolationTypeAtKey") return (index,inType,outType) => {check();Object.assign(current.keys[index-1],{inType,outType});};
      if (key === "keyInInterpolationType" || key === "keyOutInterpolationType") return index => current.keys[index-1][key==="keyInInterpolationType" ? "inType" : "outType"] || 1;
      if (key === "keyTemporalAutoBezier" || key === "keyTemporalContinuous") return () => false;
      return current[key];
    },
    set(current,key,value) {check();current[key]=value;return true;}
  });
}
const animatorRoot = node("ADBE Text Animators",[]);
const textRoot = node("ADBE Text Properties",[node("ADBE Text Document",null,{}),animatorRoot]);
const layer = {name:"Title",index:1,property(name) {return name==="ADBE Text Properties" ? wrap(textRoot) : null;}};
class CompItem {constructor(){this.name="Text Demo";this.id=1;this.frameRate=25;this.numLayers=1;}layer(){return layer;}}
const comp = new CompItem();
comp.layers = {[1]:layer,addText(){thisOwner.numLayers++;throw new Error("Unexpected text-layer creation in mock.");}};
const thisOwner = comp;
class Folder {constructor(file){this.fsName=file;this.exists=true;}create(){return true;}}
Folder.myDocuments=new Folder("C:/Documents");Folder.userData=new Folder("C:/UserData");Folder.startup=new Folder("C:/AE");
class File {constructor(file){this.fsName=file;this.name="file";this.exists=false;this.parent=Folder.myDocuments;}}
const sandbox = {JSON,Math,Date,isFinite,File,Folder,CompItem,Shape:class{},TextDocument:class{},
  PropertyType:types,KeyframeInterpolationType:{LINEAR:1,HOLD:2,BEZIER:3},
  $:{global:{__aeMcpHeadlessBridgeMode:true}},
  app:{project:{numItems:1,items:[null,comp],activeItem:comp,item(){return comp;}},beginUndoGroup(){},endUndoGroup(){},scheduleTask(){},cancelTask(){}}
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("src/scripts/mcp-bridge-auto.jsx","utf8").replace(/^#target.*$/gm,""),sandbox);
const call = args => JSON.parse(sandbox.aeCommand({operation:"text",compName:"Text Demo",layerIndex:1,...args}));
const ok = args => {const result=call(args);assert.equal(result.status,"success",result.message);return result.data;};
const find = (tree,matchName) => tree.matchName===matchName ? tree : tree.properties?.map(child=>find(child,matchName)).find(Boolean);

const layerCountBeforeMisroutedAnimator=comp.numLayers;
const misroutedAnimator=call({action:"add",name:"Wrong Layer",text:"Hello",createLayer:{name:"Wrong Layer"},animatorName:"Reveal",
  properties:[{property:"opacity",value:0}],selectors:[{type:"range"}]});
assert.equal(misroutedAnimator.status,"error","text/add must not silently ignore animator fields");
assert.match(misroutedAnimator.message,/text action add creates a text layer only.*existing text layer.*action=animator.*layerIndex or layerName/i);
assert.equal(comp.numLayers,layerCountBeforeMisroutedAnimator,"misrouted animator request created a text layer");

const reveal=ok({action:"animator",animatorAction:"add",animatorName:"Reveal",properties:[{property:"opacity",value:0},{property:"position",value:[0,40,0]},{property:"characterValue",value:65}],
  selectors:[{type:"range",name:"Characters",settings:{basedOn:"characters",smoothness:0,start:{keyframes:[{time:0,value:0,inInterpolation:"linear"},{time:25/comp.frameRate,value:100}]}}}]});
assert.equal(animatorRoot.children.length,1);
assert.equal(find(reveal,"ADBE Text Opacity").value,0);
assert.equal(find(reveal,"ADBE Text Character Replace").value,65);
const start=find(reveal,"ADBE Text Percent Start");
assert.deepEqual(start.keyframes.map(key=>[key.time,key.value]),[[0,0],[1,100]]);
assert.equal(find(reveal,"ADBE Text Selectors").numProperties,1,"default selector was duplicated");
const genericKey=JSON.parse(sandbox.aeCommand({operation:"keyframe",action:"set",compName:"Text Demo",layerIndex:1,propertyPath:start.propertyPath,time:2,value:25}));
assert.equal(genericKey.status,"success",genericKey.message);
ok({action:"animator",animatorAction:"update",animatorName:"Reveal",newName:"Renamed",properties:[{property:"opacity",remove:true},{matchName:"ADBE Text Line Spacing",value:50}]});
const updated=ok({action:"animator",animatorIndex:1});
assert.equal(updated.name,"Renamed");assert.equal(find(updated,"ADBE Text Opacity"),undefined);
assert.equal(find(updated,"ADBE Text Line Spacing").value,50);
const indexed=ok({action:"selector",selectorAction:"update",animatorIndex:1,selectorIndex:1,settings:{units:"index",end:5,start:{clearKeys:true,value:0}}});
assert.equal(find(indexed,"ADBE Text Index End").value,5);
assert.equal(find(indexed,"ADBE Text Index Start").numKeys,0);
const expression=ok({action:"selector",selectorAction:"add",animatorIndex:1,type:"expression",selectorName:"Expr",settings:{amount:{expression:"selectorValue * Math.sin(time + textIndex)"}}});
assert.match(find(expression,"ADBE Text Expressible Amount").expression,/textIndex/);
const wiggly=ok({action:"selector",selectorAction:"add",animatorIndex:1,type:"wiggly",settings:[{propertyPath:["ADBE Text Wiggly Max Amount"],keyframes:[{time:0,value:10},{time:2,value:90}]}]});
assert.equal(find(wiggly,"ADBE Text Wiggly Max Amount").numKeys,2);
ok({action:"selector",selectorAction:"remove",animatorIndex:1,selectorName:"Expr"});
assert.equal(ok({action:"selector",animatorIndex:1}).numProperties,2);
ok({action:"animator",animatorAction:"add",animatorName:"Renamed",selectors:[]});
assert.match(call({action:"animator",animatorName:"Renamed"}).message,/Ambiguous/);
const count=animatorRoot.children.length;
assert.equal(call({action:"animator",animatorAction:"add",properties:[{matchName:"INVALID",value:1}]}).status,"error");
assert.equal(animatorRoot.children.length,count,"failed creation left a partial animator");
assert.equal(call({action:"selector",selectorAction:"add",animatorIndex:1,type:"expression",settings:{amount:{expression:"BAD"}}}).status,"error");
assert.equal(ok({action:"selector",animatorIndex:1}).numProperties,2,"failed creation left a partial selector");
assert.equal(call({action:"selector",selectorAction:"update",animatorIndex:1,selectorIndex:1,settings:{unknown:100}}).status,"error");
assert.equal(call({action:"animator",animatorAction:"update",animatorIndex:1,properties:[{property:"opacity",keyframes:[{time:"bad",value:1}]}]}).status,"error");
ok({action:"animator",animatorAction:"remove",animatorIndex:2});
assert.equal(ok({action:"animator"}).numProperties,1);
const legacy=JSON.parse(sandbox.createTextAnimator({compIndex:1,layerIndex:1,animatorName:"Legacy Native",properties:[
  {property:"opacity",value:0},{property:"characterValue",value:72}
],selector:{durationInFrames:2,from:0,to:100}}));
assert.equal(legacy.status,"success",legacy.message);
const legacyAnimator=animatorRoot.children[1];
assert.equal(legacyAnimator.name,"Legacy Native");
assert.equal(legacyAnimator.children[0].children[0].matchName,"ADBE Text Opacity");
assert.equal(legacyAnimator.children[0].children[0].value,0);
assert.equal(legacyAnimator.children[0].children[1].matchName,"ADBE Text Character Replace");
assert.equal(legacyAnimator.children[0].children[1].value,72);
ok({action:"animator",animatorAction:"remove",animatorIndex:2});
const caps=JSON.parse(sandbox.aeCommand({operation:"inspect",action:"get",scope:"capabilities"}));
assert(caps.data.operations.text.includes("animator") && caps.data.operations.text.includes("selector"));
assert.deepEqual(caps.data.textAnimators.selectorTypes,["range","wiggly","expression"]);
assert(fs.readFileSync("src/index.ts","utf8").includes('"update", "animator", "selector"'));
assert(fs.readFileSync("assets/pi-after-effects-extension.ts","utf8").includes('"update", "animator", "selector"'));
console.log("Text animator/selector lifecycle, animation, reference invalidation, rollback, and exposure tests passed.");
