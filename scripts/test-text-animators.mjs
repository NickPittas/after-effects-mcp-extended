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
function animatorPropertyDefault(matchName) {
  if (matchName === "ADBE Text Position 3D" || matchName === "ADBE Text Anchor Point 3D") return [0,0,0];
  if (matchName === "ADBE Text Scale 3D") return [100,100,100];
  if (matchName === "ADBE Text Opacity" || matchName === "ADBE Text Fill Opacity" || matchName === "ADBE Text Stroke Opacity") return 100;
  return 0;
}
function node(matchName, children = null, value = 0, active = true) {
  const result = {matchName,name:matchName,children,value,keys:[],expression:"",expressionEnabled:false,enabled:true,active,isModified:false};
  for (const child of children || []) child.parent = result;
  return result;
}
function animatorPropertiesGroup() {
  const catalog = [...animatorPropertyMatchNames].map(matchName=>node(matchName,null,animatorPropertyDefault(matchName),false));
  while (catalog.length < 103) catalog.push(node("ADBE Text Dormant Property "+(catalog.length+1),null,0,false));
  return node("ADBE Text Animator Properties",catalog);
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
      if (key === "propertyType") return current.matchName === "ADBE Text Animator Properties" ? types.NAMED_GROUP : (current.children ? types.INDEXED_GROUP : types.PROPERTY);
      if (key === "propertyIndex") return current.parent?.children.indexOf(current)+1 || 1;
      if (key === "numProperties") return current.children?.length || 0;
      if (key === "numKeys") return current.keys.length;
      if (key === "canSetExpression") return !current.children && (current.parent?.matchName !== "ADBE Text Animator Properties" || current.active);
      if (key === "canVaryOverTime") return !current.children && (current.parent?.matchName !== "ADBE Text Animator Properties" || current.active);
      if (key === "expressionEnabled") return current.expressionEnabled;
      if (key === "expressionError") return current.expression === "BAD" ? "invalid expression" : "";
      if (key === "property") return name => {
        check();
        if (typeof name === "number") return wrap(current.children?.[name-1]);
        const named = current.children?.filter(child=>child.matchName===name || child.name===name) || [];
        return wrap(named.find(child=>child.active) || named[0]);
      };
      if (key === "canAddProperty") return name => {check();return Boolean(addableChildren[current.matchName]?.has(name));};
      if (key === "addProperty") return name => {
        check();
        if (!addableChildren[current.matchName]?.has(name)) throw new Error("Property is not addable to this AE group: " + name);
        if (current.matchName === "ADBE Text Animator Properties") {
          const dormant = current.children.find(property=>property.matchName===name && !property.active);
          if (!dormant) throw new Error("Animator property is missing or already active: " + name);
          const child = node(name,null,animatorPropertyDefault(name),true);
          child.parent=current;
          current.children.push(child);
          generation++;
          return wrap(child);
        }
        let child;
        if (name === "ADBE Text Animator") child=node(name,[animatorPropertiesGroup(),node("ADBE Text Selectors",[selector("ADBE Text Selector")])]);
        else if (/Selector$/.test(name)) child=selector(name);
        else child=node(name);
        child.parent=current;current.children.push(child);generation++;return wrap(child);
      };
      if (key === "remove") return () => {
        check();
        current.parent.children.splice(current.parent.children.indexOf(current),1);
        generation++;
      };
      if (key === "setValue") return value => {
        check();
        if (current.parent?.matchName === "ADBE Text Animator Properties" && !current.active) throw new Error("Cannot write a dormant animator property before addProperty activates it.");
        if (current.keys.length) throw new Error("Cannot set a static value on an animated property");current.value=value;current.isModified=true;
        if (current.matchName === "ADBE Text Range Units") {
          const range=current.parent.parent;
          for (const child of range.children) child.matchName=child.matchName.replace(/(Percent|Index) /,value===2 ? "Index " : "Percent ");
          generation++;
        }
      };
      if (key === "setValueAtTime") return (time,value) => {check();if(current.parent?.matchName==="ADBE Text Animator Properties"&&!current.active)throw new Error("Cannot keyframe a dormant animator property before addProperty activates it.");let entry=current.keys.find(key=>key.time===time);if(entry)entry.value=value;else current.keys.push({time,value});current.keys.sort((a,b)=>a.time-b.time);current.value=value;current.isModified=true;};
      if (key === "nearestKeyIndex") return time => {check();return current.keys.findIndex(key=>key.time===time)+1;};
      if (key === "keyTime") return index => {check();return current.keys[index-1].time;};
      if (key === "keyValue") return index => {check();return current.keys[index-1].value;};
      if (key === "removeKey") return index => {check();current.keys.splice(index-1,1);};
      if (key === "setInterpolationTypeAtKey") return (index,inType,outType) => {check();Object.assign(current.keys[index-1],{inType,outType});};
      if (key === "keyInInterpolationType" || key === "keyOutInterpolationType") return index => current.keys[index-1][key==="keyInInterpolationType" ? "inType" : "outType"] || 1;
      if (key === "keyTemporalAutoBezier" || key === "keyTemporalContinuous") return () => false;
      return current[key];
    },
    set(current,key,value) {
      check();
      if (current.parent?.matchName === "ADBE Text Animator Properties" && !current.active && (key === "expression" || key === "expressionEnabled")) throw new Error("Cannot edit a dormant animator property before addProperty activates it.");
      current[key]=value;
      if (key === "expression" || key === "expressionEnabled") current.isModified=true;
      return true;
    }
  });
}
const animatorRoot = node("ADBE Text Animators",[]);
const textRoot = node("ADBE Text Properties",[node("ADBE Text Document",null,{}),animatorRoot]);
const layer = {name:"Title",index:1,property(name) {return name==="ADBE Text Properties" ? wrap(textRoot) : null;}};
const otherAnimatorRoot = node("ADBE Text Animators",[]);
const otherTextRoot = node("ADBE Text Properties",[node("ADBE Text Document",null,{}),otherAnimatorRoot]);
const otherLayer = {name:"Other Title",index:1,property(name) {return name==="ADBE Text Properties" ? wrap(otherTextRoot) : null;}};
class CompItem {constructor(name,id,textLayer){this.name=name;this.id=id;this.frameRate=25;this.numLayers=1;this.textLayer=textLayer;}layer(index){return index===1 ? this.textLayer : null;}}
const comp = new CompItem("Text Demo",1,layer);
comp.layers = {[1]:layer,addText(){thisOwner.numLayers++;throw new Error("Unexpected text-layer creation in mock.");}};
const thisOwner = comp;
const otherComp = new CompItem("Active Comp",2,otherLayer);
otherComp.layers = {[1]:otherLayer,addText(){otherComp.numLayers++;throw new Error("Unexpected active-comp text-layer creation in mock.");}};
const projectItems = [null,comp,otherComp];
class Folder {constructor(file){this.fsName=file;this.exists=true;}create(){return true;}}
Folder.myDocuments=new Folder("C:/Documents");Folder.userData=new Folder("C:/UserData");Folder.startup=new Folder("C:/AE");
class File {constructor(file){this.fsName=file;this.name="file";this.exists=false;this.parent=Folder.myDocuments;}}
const sandbox = {JSON,Math,Date,isFinite,File,Folder,CompItem,Shape:class{},TextDocument:class{},
  PropertyType:types,KeyframeInterpolationType:{LINEAR:1,HOLD:2,BEZIER:3},
  $:{global:{__aeMcpHeadlessBridgeMode:true}},
  app:{project:{numItems:2,items:projectItems,activeItem:otherComp,item(index){return projectItems[index];}},beginUndoGroup(){},endUndoGroup(){},scheduleTask(){},cancelTask(){}}
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("src/scripts/mcp-bridge-auto.jsx","utf8").replace(/^#target.*$/gm,""),sandbox);
const call = args => {
  const defaultComp = args.compName === undefined && args.compId === undefined && args.compIndex === undefined ? {compName:"Text Demo"} : {};
  return JSON.parse(sandbox.aeCommand({operation:"text",...defaultComp,layerIndex:1,...args}));
};
const ok = args => {const result=call(args);assert.equal(result.status,"success",result.message);return result.data;};
function findAll(tree,matchName,results=[]) {
  if (tree?.matchName===matchName) results.push(tree);
  for (const child of tree?.properties || []) findAll(child,matchName,results);
  return results;
}
function find(tree,matchName) {
  const matches=findAll(tree,matchName);
  return matches.find(property=>property.canSetExpression===true || property.canVaryOverTime===true) || matches[0];
}

const layerCountBeforeMisroutedAnimator=comp.numLayers;
const misroutedAnimator=call({action:"add",name:"Wrong Layer",text:"Hello",createLayer:{name:"Wrong Layer"},animatorName:"Reveal",
  properties:[{property:"opacity",value:0}],selectors:[{type:"range"}]});
assert.equal(misroutedAnimator.status,"error","text/add must not silently ignore animator fields");
assert.match(misroutedAnimator.message,/text action add creates a text layer only.*existing text layer.*action=animator.*layerIndex or layerName/i);
assert.equal(comp.numLayers,layerCountBeforeMisroutedAnimator,"misrouted animator request created a text layer");

const reveal=ok({action:"animator",animatorAction:"add",animatorName:"Reveal",properties:[
  {property:"opacity",value:0},{property:"position",value:[0,40,0],keyframes:[{time:0,value:[0,40,0]},{time:1,value:[0,0,0]}],expression:"value"},
  {property:"characterValue",value:65}],
  selectors:[{type:"range",name:"Characters",settings:{basedOn:"characters",smoothness:0,start:{keyframes:[{time:0,value:0,inInterpolation:"linear"},{time:25/comp.frameRate,value:100}]}}}]});
assert.equal(animatorRoot.children.length,1);
assert.equal(find(reveal,"ADBE Text Opacity").value,0);
assert.equal(find(reveal,"ADBE Text Opacity").canVaryOverTime,true,"requested opacity must be activated, not mistaken for its dormant default");
assert.equal(find(reveal,"ADBE Text Position 3D").canSetExpression,true,"requested position must be an active writable animator property");
assert.equal(find(reveal,"ADBE Text Character Replace").value,65);
const revealOpacityCopies=findAll(reveal,"ADBE Text Opacity");
assert.equal(revealOpacityCopies.length,2,"active opacity must be distinct from its dormant catalog entry");
assert.equal(revealOpacityCopies.find(property=>property.canVaryOverTime===false).value,100,"dormant opacity retains its readable default");
assert.equal(find(reveal,"ADBE Text Opacity").value,0,"matchName lookup must prefer the writable active instance");
const revealPropertyGroup=find(reveal,"ADBE Text Animator Properties");
assert.equal(revealPropertyGroup.propertyCatalog.rawChildCount,106,"three activated children are distinct from the 103-child dormant catalog");
assert.equal(revealPropertyGroup.propertyCatalog.entriesMayBeDormant,true);
assert.deepEqual(reveal.animatorPropertyEdit.addedByCommand,["ADBE Text Opacity","ADBE Text Position 3D","ADBE Text Character Replace"]);
const start=find(reveal,"ADBE Text Percent Start");
assert.deepEqual(start.keyframes.map(key=>[key.time,key.value]),[[0,0],[1,100]]);
assert.equal(find(reveal,"ADBE Text Selectors").numProperties,1,"default selector was duplicated");
const genericKey=JSON.parse(sandbox.aeCommand({operation:"keyframe",action:"set",compName:"Text Demo",layerIndex:1,propertyPath:start.propertyPath,time:2,value:25}));
assert.equal(genericKey.status,"success",genericKey.message);
ok({action:"animator",animatorAction:"update",animatorName:"Reveal",newName:"Renamed",properties:[
  {property:"opacity",remove:true},{matchName:"ADBE Text Line Spacing",value:50}
]});
const updated=ok({action:"animator",animatorIndex:1});
assert.equal(updated.name,"Renamed");
assert.equal(find(updated,"ADBE Text Opacity").canVaryOverTime,false,"removed opacity remains only as a dormant catalog entry");
assert.equal(find(updated,"ADBE Text Line Spacing").value,50);
assert.equal(find(updated,"ADBE Text Position 3D").canVaryOverTime,true,"removing opacity must retain sibling position");
assert.equal(find(updated,"ADBE Text Character Replace").value,65,"property removal must not delete sibling animator properties");
const preserved=ok({action:"animator",animatorAction:"update",animatorIndex:1,properties:[{property:"position",expressionEnabled:false}]});
assert.deepEqual(preserved.animatorPropertyEdit.reusedWritableProperties,["ADBE Text Position 3D"]);
assert.equal(find(preserved,"ADBE Text Position 3D").keyframes.length,2,"updating an active property must preserve its keyframes");
assert.equal(find(preserved,"ADBE Text Position 3D").expression,"value","updating an active property must preserve its expression");
assert.equal(find(preserved,"ADBE Text Position 3D").expressionEnabled,false);
const trackingUpdate=ok({action:"animator",animatorAction:"update",animatorIndex:1,properties:[{property:"tracking",value:12}]});
assert.deepEqual(trackingUpdate.animatorPropertyEdit.addedByCommand,["ADBE Text Tracking Amount"]);
assert.deepEqual(trackingUpdate.animatorPropertyEdit.activationPendingProbe,["ADBE Text Tracking Amount"]);
assert.equal(find(ok({action:"animator",animatorIndex:1}),"ADBE Text Tracking Amount").canVaryOverTime,true,"updating a dormant property must activate it");
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
const legacyAnimator=ok({action:"animator",animatorIndex:2});
assert.equal(legacyAnimator.name,"Legacy Native");
assert.equal(find(legacyAnimator,"ADBE Text Opacity").value,0);
assert.equal(find(legacyAnimator,"ADBE Text Character Replace").value,72);
ok({action:"animator",animatorAction:"remove",animatorIndex:2});
const defaults=ok({action:"animator",animatorAction:"add",animatorName:"Default Values",selectors:[],properties:[{property:"position"},{property:"opacity"}]});
const defaultPosition=find(defaults,"ADBE Text Position 3D");
const defaultOpacity=find(defaults,"ADBE Text Opacity");
assert.deepEqual(defaultPosition.value,[0,0,0]);
assert.deepEqual(defaultOpacity.value,100);
assert.equal(defaultPosition.canVaryOverTime,true,"position must activate even when its requested value equals AE's default");
assert.equal(defaultOpacity.canSetExpression,true,"opacity must activate even when its requested value equals AE's default");
assert.equal(defaultPosition.isModified,false,"default-valued active properties are not identified by isModified");
assert.equal(defaultOpacity.isModified,false,"default-valued active opacity is not identified by isModified");
assert.deepEqual(defaults.animatorPropertyEdit.addedByCommand,["ADBE Text Position 3D","ADBE Text Opacity"]);
const defaultPositionCopies=findAll(defaults,"ADBE Text Position 3D");
assert.equal(defaultPositionCopies.length,2,"default-valued active Position remains distinct from its dormant catalog entry");
assert.equal(defaultPositionCopies.filter(property=>property.canVaryOverTime===true).length,1);
assert.equal(defaultPositionCopies[0].value[0],defaultPositionCopies[1].value[0],"dormant and active Position both retain the same default value");
ok({action:"animator",animatorAction:"remove",animatorIndex:2});
const empty=ok({action:"animator",animatorAction:"add",animatorName:"Dormant Catalog",selectors:[],properties:[]});
const emptyPropertyGroup=find(empty,"ADBE Text Animator Properties");
assert.equal(emptyPropertyGroup.propertyCatalog.rawChildCount,103);
assert.equal(emptyPropertyGroup.propertyCatalog.activationState,"unknown");
assert.equal(emptyPropertyGroup.propertyCatalog.writableCapabilitiesAreNotVisibilityProof,true);
assert.deepEqual(empty.animatorPropertyEdit.addedByCommand,[],"dormant catalog entries must not be reported as properties added by this command");
assert.deepEqual(emptyPropertyGroup.propertyCatalog.writableCapabilityCandidates,[]);
const dormantOpacity=find(empty,"ADBE Text Opacity");
assert.equal(dormantOpacity.value,100,"dormant catalog values remain readable");
assert.equal(dormantOpacity.canVaryOverTime,false,"dormant defaults must not be reported as active animator properties");
assert.equal(dormantOpacity.canSetExpression,false,"dormant defaults cannot accept expressions until activated");
assert.equal(dormantOpacity.isModified,false,"isModified is not an activation signal");
const rootCountBeforeCompId=animatorRoot.children.length;
const activeCountBeforeCompId=otherAnimatorRoot.children.length;
const byId=call({compId:comp.id,action:"animator",animatorAction:"add",animatorName:"Selected By ID",properties:[{property:"position"}],selectors:[]});
assert.equal(byId.status,"success",byId.message);
assert.equal(animatorRoot.children.length,rootCountBeforeCompId+1,"explicit compId must target its composition, not activeItem");
assert.equal(otherAnimatorRoot.children.length,activeCountBeforeCompId,"valid compId must not mutate the active but differently identified composition");
const invalidCompId=call({compId:999999,action:"animator",animatorAction:"add",animatorName:"Invalid ID",properties:[{property:"position"}],selectors:[]});
assert.equal(invalidCompId.status,"error","unknown explicit compId must fail rather than fall through to activeItem");
assert.equal(animatorRoot.children.length,rootCountBeforeCompId+1);
assert.equal(otherAnimatorRoot.children.length,activeCountBeforeCompId,"invalid compId must not mutate the active composition");
ok({compId:comp.id,action:"animator",animatorAction:"remove",animatorIndex:3});
const caps=JSON.parse(sandbox.aeCommand({operation:"inspect",action:"get",scope:"capabilities"}));
assert(caps.data.operations.text.includes("animator") && caps.data.operations.text.includes("selector"));
assert.deepEqual(caps.data.textAnimators.selectorTypes,["range","wiggly","expression"]);
assert(fs.readFileSync("src/index.ts","utf8").includes('"update", "animator", "selector"'));
assert(fs.readFileSync("assets/pi-after-effects-extension.ts","utf8").includes('"update", "animator", "selector"'));
console.log("Text animator/selector lifecycle, animation, reference invalidation, rollback, and exposure tests passed.");
