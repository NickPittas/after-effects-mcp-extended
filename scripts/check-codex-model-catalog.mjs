// Read-only diagnostic: lists models without starting a thread or model turn.
import { spawn } from "node:child_process";
import readline from "node:readline";
const executable = process.argv[2];
if (!executable) throw new Error("Pass the path to codex.exe.");
const child = spawn(executable, ["app-server", "--listen", "stdio://"], { windowsHide:true, stdio:["pipe","pipe","ignore"] });
const pending = new Map();
let nextId = 0;
const request = (method, params) => new Promise((resolve,reject) => {
  const id = ++nextId;
  pending.set(id,{resolve,reject});
  child.stdin.write(JSON.stringify({id,method,params}) + "\n");
});
readline.createInterface({input:child.stdout}).on("line",line => {
  let message;
  try { message=JSON.parse(line); } catch {return;}
  const waiter=pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
});
const abort = reason => { for (const waiter of pending.values()) waiter.reject(new Error(reason)); pending.clear(); };
child.on("error",error => abort(error.message));
child.on("exit",() => abort("Codex exited before completing model discovery."));
const timer=setTimeout(() => { abort("Codex model discovery timed out."); child.kill(); },30000);
try {
  await request("initialize",{clientInfo:{name:"ae_model_catalog_check",version:"1.0"},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:"initialized",params:{}})+"\n");
  const models=[];
  let cursor=null;
  do {
    const response=await request("model/list",{limit:100,includeHidden:false,cursor});
    models.push(...response.data.map(model=>({id:model.model || model.id,efforts:model.supportedReasoningEfforts})));
    cursor=response.nextCursor || null;
  } while(cursor && models.length<500);
  console.log(JSON.stringify(models,null,2));
} finally { clearTimeout(timer); child.kill(); }
