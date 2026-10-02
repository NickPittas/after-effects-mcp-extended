// Opt-in native AE test. Never targets, saves, or replaces existing compositions.
// Run only with the updated bridge open and no other chat run in progress.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";

if (!process.argv.includes("--live")) throw new Error("Native AE test requires explicit --live.");
const fixtureName = `AE_MCP_TextAnimator_Verification_${Date.now()}`;
const captureDir = await fs.mkdtemp(path.join(os.tmpdir(), "ae-native-animator-"));
const client = new Client({name:"ae-native-animator-test",version:"1.0"});
const transport = new StdioClientTransport({command:process.execPath,args:[path.resolve("build/index.js")],stderr:"pipe"});
let compId;
async function call(operation, action, parameters) {
  const result = await client.callTool({name:"after-effects",arguments:{operation,action,parameters}});
  const payload = (result.content || []).filter(c=>c.type==="text").map(c=>c.text).join("\n");
  const parsed = JSON.parse(payload);
  if (parsed.status !== "success") throw new Error(`${operation}/${action}: ${parsed.message || payload}`);
  return parsed.data;
}
async function fixtureCall(operation, action, parameters = {}) {
  assert(compId !== undefined,"Fixture was not created.");
  const fixture = await call("composition","get",{compId,compName:fixtureName});
  assert.equal(fixture.id,compId,"Fixture identity changed; refusing to mutate any composition.");
  return call(operation,action,{...parameters,compId,compName:fixtureName});
}
function find(node, matchName) {
  // Native catalog entries can be dormant, including a duplicate of an active match.
  if (node.matchName===matchName && (node.canSetExpression===true || node.canVaryOverTime===true)) return node;
  return node.properties?.map(child=>find(child,matchName)).find(Boolean);
}
try {
  await client.connect(transport);
  const capabilities = await call("inspect","get",{scope:"capabilities"});
  assert.equal(capabilities.bridgeVersion,"1.10.12","Refusing live edits with an old bridge.");
  compId = (await call("composition","create",{name:fixtureName,width:640,height:360,frameRate:25,duration:2,pixelAspect:1})).id;
  const target = {layerIndex:1};
  await fixtureCall("text","add",{name:"Fixture Text",text:"Native Position Test",position:[320,180],fontSize:48,fillColor:[1,1,1]});
  const created = await fixtureCall("text","animator",{...target,animatorAction:"add",animatorName:"Position",
    properties:[{property:"position",keyframes:[{time:0,value:[0,100,0]},{time:0.5,value:[0,-20,0]},{time:1,value:[0,0,0]}]}]});
  const position = find(created,"ADBE Text Position 3D");
  assert(position,"Native Position was not reported after creation.");
  assert.equal(position.numKeys,3,"Native Position was not writable/keyframeable.");
  await fixtureCall("property","expression",{...target,propertyPath:position.propertyPath,expression:"value + [0, Math.sin(time) * 5, 0]"});
  const before = await fixtureCall("text","animator",{...target,animatorAction:"get",animatorIndex:1});
  const beforePosition = find(before,"ADBE Text Position 3D");
  const updated = await fixtureCall("text","animator",{...target,animatorAction:"update",animatorIndex:1,properties:[{property:"opacity",value:100},{property:"position"}]});
  const afterPosition = find(updated,"ADBE Text Position 3D");
  assert.deepEqual(afterPosition.keyframes,beforePosition.keyframes,"Update reset existing Position keys.");
  assert.equal(afterPosition.expression,beforePosition.expression,"Update reset the Position expression.");
  assert.equal(afterPosition.expressionEnabled,true,"Update disabled the Position expression.");
  assert.equal(afterPosition.expressionError,"","Native Position expression failed.");
  const opacity = find(updated,"ADBE Text Opacity");
  assert(opacity,"Opacity update did not activate the dormant property.");
  await fixtureCall("property","set",{...target,propertyPath:opacity.propertyPath,value:99});
  await fixtureCall("keyframe","set",{...target,propertyPath:afterPosition.propertyPath,time:1.5,value:[0,0,0],inInterpolation:"bezier",outInterpolation:"bezier"});
  const defaultAnimator = await fixtureCall("text","animator",{...target,animatorAction:"add",animatorName:"Default Position",properties:[{property:"position"}]});
  const defaultPosition = find(defaultAnimator,"ADBE Text Position 3D");
  assert(defaultPosition,"Default-valued Position was not activated.");
  await fixtureCall("property","set",{...target,propertyPath:defaultPosition.propertyPath,value:[0,0,0]});
  await fixtureCall("text","animator",{...target,animatorAction:"remove",animatorIndex:2});
  const removedOpacity = await fixtureCall("text","animator",{...target,animatorAction:"update",animatorIndex:1,properties:[{property:"opacity",remove:true}]});
  assert.equal(find(removedOpacity,"ADBE Text Opacity"),undefined,"Removed Opacity still reported as usable.");
  assert.equal(find(removedOpacity,"ADBE Text Position 3D").numKeys,4,"Opacity removal damaged Position.");
  // The fixture must remain one text layer. No layer-3D workaround is requested.
  const composition = await fixtureCall("composition","get");
  assert.equal(composition.numLayers,1,"Animator operations created stray text layers.");
  const inspected = await fixtureCall("inspect","get",{scope:"composition"});
  assert.equal(inspected.layers[0].threeDLayer,false,"Animator operations enabled layer 3D.");
  const hashes=[];
  for (const [index,time] of [0,0.5,1].entries()) {
    const outputPath = path.join(captureDir,`frame-${index}.png`);
    await fixtureCall("frame","capture",{time,outputPath});
    hashes.push(createHash("sha256").update(await fs.readFile(outputPath)).digest("hex"));
  }
  assert(new Set(hashes).size>1,"Native animator produced identical rendered frames.");
  console.log(JSON.stringify({fixture:fixtureName,positionKeys:4,preservedExpression:true,defaultPositionWritable:true,opacityActivatedAndRemoved:true,renderedFramesDiffer:true,layerStayed2D:true,passed:true}));
} finally {
  try {
    if (compId !== undefined) {
      const item = await call("composition","get",{compId,compName:fixtureName});
      assert.equal(item.name,fixtureName,"Refusing to remove a renamed or unrelated composition.");
      assert.equal(item.id,compId,"Refusing to remove a replaced fixture.");
      await call("composition","remove",{compId,compName:fixtureName});
      console.log("Removed only the temporary verification composition; existing compositions were not edited.");
    }
  } catch (cleanupError) {
    console.error(`Fixture cleanup failed; no other composition was targeted: ${cleanupError}`);
    process.exitCode = 1;
  } finally {
    try { await client.close(); }
    finally { await fs.rm(captureDir,{recursive:true,force:true}); }
  }
}
