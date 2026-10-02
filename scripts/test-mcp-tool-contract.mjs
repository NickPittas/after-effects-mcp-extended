// Read-only protocol check: verify the actual tools/list seen by MCP clients.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({name:"ae-contract-test",version:"1.0"});
const executable = process.argv[2];
const transport = new StdioClientTransport({command:executable || process.execPath,args:executable ? [] : [path.resolve("build/index.js")],stderr:"pipe"});
try {
  await client.connect(transport);
  const result = await client.listTools();
  assert.equal(result.tools.length,1,"MCP must retain one compact unified tool");
  const tool = result.tools[0];
  assert.equal(tool.name,"after-effects");
  assert.match(tool.description,/text=get\|add\|set\|update\|animator\|selector/);
  assert.match(tool.description,/animatorAction=get\|add\|update\|remove/);
  assert.match(tool.description,/selectorAction=get\|add\|update\|remove/);
  assert.match(tool.description,/type=range\|wiggly\|expression/);
  assert.match(tool.description,/keyframes/);
  assert.match(tool.description,/matchName/);
  assert.match(tool.description,/propertyPath/);
  assert.match(tool.description,/text\/add creates a text layer only/i);
  assert.match(tool.description,/add a native animator to an existing text layer.*operation=text, action=animator, animatorAction=add/i);
  assert.match(tool.description,/Never use effect\/add for a text animator/i);
  console.log("Live MCP tools/list exposes animator and selector contracts through exactly one tool.");
} finally { await client.close(); }

async function verifyCommandOwner(ownerValue, expectedOwner) {
  const testHome = await fs.mkdtemp(path.join(os.tmpdir(), "ae-mcp-owner-contract-"));
  const bridgeDirectory = path.join(testHome, "Documents", "ae-mcp-bridge");
  const heartbeatPath = path.join(bridgeDirectory, "ae_bridge_status.json");
  const commandPath = path.join(bridgeDirectory, "ae_command.json");
  const resultPath = path.join(bridgeDirectory, "ae_mcp_result.json");
  await fs.mkdir(bridgeDirectory, {recursive:true});
  await fs.writeFile(heartbeatPath, JSON.stringify({updatedAt:Date.now(),state:"ready",autoRun:true,instanceId:"contract-test"}));

  const env = {USERPROFILE:testHome,HOME:testHome};
  if (ownerValue !== undefined) env.AE_MCP_CHAT_OWNER_PID = ownerValue;
  const ownerClient = new Client({name:"ae-owner-contract-test",version:"1.0"});
  const ownerTransport = new StdioClientTransport({
    command:executable || process.execPath,
    args:executable ? [] : [path.resolve("build/index.js")],
    env,
    stderr:"pipe"
  });
  try {
    await ownerClient.connect(ownerTransport);
    const callPromise = ownerClient.callTool({name:"after-effects",arguments:{
      operation:"inspect",action:"get",parameters:{scope:"capabilities",timeoutMs:10000}
    }});
    const deadline = Date.now() + 15000;
    let command;
    while (Date.now() < deadline) {
      try {
        const candidate = JSON.parse(await fs.readFile(commandPath,"utf8"));
        if (candidate.command === "aeCommand" && candidate.status === "pending") { command = candidate; break; }
      } catch {}
      await delay(25);
    }
    assert(command,"MCP tool did not write a bridge command for the ownership check");
    assert.equal(command.args.operation,"inspect");
    assert.equal(command.args.action,"get");
    if (expectedOwner === undefined) assert.equal(Object.hasOwn(command,"chatOwnerPid"),false);
    else assert.equal(command.chatOwnerPid,expectedOwner);
    await fs.writeFile(resultPath,JSON.stringify({_commandId:command.id,status:"success",data:{scope:"capabilities"}}));
    const result = await callPromise;
    assert.equal(result.isError,undefined);
  } finally {
    await ownerClient.close();
    await fs.rm(testHome,{recursive:true,force:true});
  }
}

await verifyCommandOwner("31415",31415);
await verifyCommandOwner("not-a-pid",undefined);
await verifyCommandOwner(undefined,undefined);

const piExtension = await fs.readFile(path.resolve("assets/pi-after-effects-extension.ts"),"utf8");
assert.match(piExtension,/function getChatOwnerPid\(\): number \| undefined/);
assert.match(piExtension,/Number\.isSafeInteger\(ownerPid\) && ownerPid > 0/);
assert.match(piExtension,/\.\.\.\(chatOwnerPid === undefined \? \{\} : \{ chatOwnerPid \}\)/);
console.log("Bridge command ownership is emitted only for valid positive PIDs and omitted otherwise.");
