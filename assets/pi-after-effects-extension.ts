import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const bridgeDirectory = path.join(os.homedir(), "Documents", "ae-mcp-bridge");
const commandPath = path.join(bridgeDirectory, "ae_command.json");
const resultPath = path.join(bridgeDirectory, "ae_mcp_result.json");
const lockPath = path.join(bridgeDirectory, "ae_command.lock");
const heartbeatPath = path.join(bridgeDirectory, "ae_bridge_status.json");

function getChatOwnerPid(): number | undefined {
  const ownerPid = Number(process.env.AE_MCP_CHAT_OWNER_PID);
  return Number.isSafeInteger(ownerPid) && ownerPid > 0 ? ownerPid : undefined;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      await fs.rename(temporaryPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      try { await fs.unlink(filePath); } catch {}
      try {
        await fs.rename(temporaryPath, filePath);
        return;
      } catch (retryError) {
        lastError = retryError;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  try { await fs.unlink(temporaryPath); } catch {}
  throw lastError instanceof Error ? lastError : new Error(`Unable to atomically write ${filePath}`);
}

const operationActions: Record<string, readonly string[]> = {
  inspect: ["get"],
  property: ["get", "set", "expression"],
  keyframe: ["get", "set", "update", "remove", "clear"],
  effect: ["get", "add", "update", "remove", "move"],
  mask: ["get", "add", "set", "update", "remove"],
  shape: ["get", "add", "set", "update", "remove", "move", "duplicate"],
  text: ["get", "add", "set", "update", "animator", "selector"],
  layer: ["get", "add", "update", "replaceSource", "duplicate", "remove", "move", "precompose", "setTrackMatte", "removeTrackMatte", "timeRemap"],
  composition: ["get", "create", "update", "duplicate", "remove"],
  project: ["get", "new", "open", "media", "getItem", "updateItem", "import", "relink", "reload", "interpret", "proxy", "dependencies", "manifest", "cleanup", "createFolder", "save", "queueRender"],
  render: ["get", "add", "templates", "queueInAME", "show", "render", "update", "duplicate", "remove", "addOutput", "getOutput", "updateOutput", "removeOutput", "applyTemplate", "saveTemplate"],
  frame: ["copy", "capture"],
};

const actionContract = Object.entries(operationActions)
  .map(([operation, actions]) => `${operation}=${actions.join("|")}`)
  .join("; ");

async function waitForResult(commandId: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("After Effects command cancelled.");
    try {
      const parsed = JSON.parse(await fs.readFile(resultPath, "utf8"));
      if (parsed._commandId === commandId && parsed.status !== "waiting") return parsed;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  let diagnostic = "No live heartbeat was available.";
  try {
    const heartbeat = JSON.parse(await fs.readFile(heartbeatPath, "utf8"));
    diagnostic = `Bridge state=${heartbeat.state}, Auto-run=${heartbeat.autoRun}, host phase=${heartbeat.hostPhase || "not reported"}.`;
    if (heartbeat.lastError) diagnostic += ` Host error: ${heartbeat.lastError}`;
  } catch {}
  throw new Error(`Timed out waiting for After Effects to execute command ${commandId}. ${diagnostic} A timeout does not prove Auto-run is off. Check the Bridge tab in After Effects MCP Chat for the host error; do not guess or retry mutations blindly.`);
}

async function acquireBridgeLock(timeoutMs: number, signal?: AbortSignal): Promise<() => Promise<void>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("After Effects command cancelled.");
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), owner: "pi" }));
      await handle.close();
      return async () => {
        try {
          const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
          if (Number(lock.pid) === process.pid) await fs.unlink(lockPath);
        } catch {}
      };
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
        const ownerPid = Number(lock.pid);
        try { if (ownerPid > 0) process.kill(ownerPid, 0); else stale = true; }
        catch { stale = true; }
      } catch {
        try { stale = Date.now() - (await fs.stat(lockPath)).mtimeMs > 30000; } catch {}
      }
      if (stale) {
        try { await fs.unlink(lockPath); } catch {}
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("Another After Effects command is still running.");
}

async function assertBridgeAvailable(): Promise<{ instanceId?: string }> {
  try {
    const status = JSON.parse(await fs.readFile(heartbeatPath, "utf8"));
    const updatedAt = typeof status.updatedAt === "number" ? status.updatedAt : Date.parse(String(status.updatedAt || ""));
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > 30000) throw new Error("heartbeat is stale");
    if (status.autoRun === false || status.state === "paused") throw new Error("Auto-run is disabled");
    if (!["starting", "checking", "ready"].includes(String(status.state || ""))) throw new Error(`state is '${status.state || "unknown"}'`);
    return status;
  } catch (error) {
    throw new Error(`After Effects bridge is unavailable (${error instanceof Error ? error.message : String(error)}). Keep After Effects MCP Chat open with Auto-run enabled in its Bridge tab, or use the optional legacy MCP Bridge panel.`);
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "after_effects",
    label: "After Effects",
    description: `Inspect or control the open Adobe After Effects project through the local bridge. Valid operation/action pairs: ${actionContract}. Composition creation is composition/create, never composition/add.`,
    promptSnippet: "Inspect, create, animate, mask, apply effects, manage project media, render, or capture frames in After Effects.",
    promptGuidelines: [
      "You are embedded in the user's live Adobe After Effects project through this tool. Treat this tool schema as authoritative.",
      "Use after_effects for After Effects work instead of guessing project state or manipulating AE files directly.",
      "Never inspect MCP or bridge source files or run shell commands to discover capabilities. If uncertain, call inspect/get with parameters {scope:'capabilities'}.",
      "Prefer an inspect operation before edits when layer, composition, or property selectors are uncertain.",
      "Use operation=composition and action=create to create a composition; action=add is invalid for compositions.",
      "To swap media only on an existing timeline layer while preserving its effects, masks, transforms, timing, and time remapping, use layer/replaceSource with a layer selector and exactly one of sourceItemId, sourceItemIndex, or sourceItemName. Prefer sourceItemId; names must be unique. Use replacements plus atomic=true for a validated bulk swap.",
      "For composition/create, pass name, width, height, pixelAspect, duration, and frameRate in parameters. Omitted values default to Composition, 1920, 1080, 1, 10 seconds, and 25 fps.",
      "Use the native object requested. A requested vector shape must use shape/add; never substitute a solid because you are unsure of the shape parameters.",
      "text/add creates a text layer only. To add a native animator to an existing text layer, use operation=text, action=animator, animatorAction=add, and an existing layerIndex or layerName; text/add does not add animators, and animator fields must not be sent to it. Never use effect/add for a text animator. Pass each animator property explicitly: for Position use properties:[{property:'position',value:[0,0,0]}]; animatorName only names the animator. Omitted Position and Opacity values activate their native defaults [0,0,0] and 100; inspect that the requested property is active. Animator Properties reports may include dormant catalog entries: raw counts, non-null lookups, default values, and writability-capability flags do not prove activation; verify addedByCommand, returned writable property paths/keyframes, and successful writes. If an edit fails, report the exact error and preserve the user's existing layer; do not split, replace, recreate, or switch it to 3D as a workaround. Animate text characters through text/animator, not layer opacity. Set animatorAction=get|add|update|remove. For a character reveal, pass properties:[{property:'opacity',value:0}] and selectors:[{type:'range',settings:{basedOn:'characters',smoothness:0,start:{keyframes:[{time:0,value:0},{time:1,value:100}]}}}]. Times are seconds: divide frame counts by comp.frameRate. Animator property aliases cover transforms, fill/stroke, tracking, blur, and characters; matchName exposes other native properties. Bulk animator-property keyframes use keyframes:[{time,value,inEase:[{speed,influence}],outEase:[{speed,influence}]}]; ease fields are arrays of objects, not numeric pairs. keyframe/set accepts one time/value. text/selector uses selectorAction=get|add|update|remove with animatorIndex or unique animatorName and selectorIndex or unique selectorName. Types: range, wiggly, expression; settings accept friendly range fields or [{propertyPath:[native match names],value,keyframes,expression}]. Replies include propertyPath arrays for existing property/keyframe/expression tools; re-inspect paths after structural edits.",
      'For a centered 400px red vector square in an HD comp, use shape/add parameters like {"compName":"Harness Test","createLayer":{"name":"Red Square","position":[960,540]},"items":[{"type":"group","name":"Red Square","items":[{"type":"rectangle","name":"Rectangle Path","size":[400,400],"position":[0,0]},{"type":"fill","name":"Red Fill","color":[1,0,0],"opacity":100}]}]}.',
      "Verify changes by inspecting the resulting AE objects. Only claim visual verification when an actual Viewer or UI image was attached or captured and viewed.",
      `Only use these operation/action pairs: ${actionContract}.`,
    ],
    parameters: Type.Object({
      operation: Type.String({ description: "One capability area: inspect, property, keyframe, effect, mask, shape, text, layer, composition, project, render, or frame." }),
      action: Type.String({ description: `Action permitted for the chosen operation. Exact matrix: ${actionContract}.` }),
      parameters: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Operation-specific structured parameters. Select compositions with compId, compIndex, or compName; layers with layerIndex or layerName; properties with propertyPath. composition/create accepts name, width, height, pixelAspect, duration, and frameRate." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, signal) {
      const allowedActions = operationActions[params.operation];
      if (!allowedActions) throw new Error(`Unsupported After Effects operation '${params.operation}'. Valid operations: ${Object.keys(operationActions).join(", ")}.`);
      if (!allowedActions.includes(params.action)) {
        throw new Error(`Unsupported action '${params.action}' for operation '${params.operation}'. Valid actions: ${allowedActions.join(", ")}.`);
      }
      await fs.mkdir(bridgeDirectory, { recursive: true });
      await assertBridgeAvailable();
      const requestedTimeout = Number((params.parameters as Record<string, unknown> | undefined)?.timeoutMs);
      const defaultTimeout = params.operation === "inspect" ? 60000 :
        params.operation === "layer" && params.action === "replaceSource" && Array.isArray((params.parameters as Record<string, unknown> | undefined)?.replacements) ? 120000 : 30000;
      const timeoutMs = Math.min(600000, Math.max(1000, Number.isFinite(requestedTimeout) ? requestedTimeout : defaultTimeout));
      const releaseBridge = await acquireBridgeLock(timeoutMs + 5000, signal);
      try {
        // The active ScriptUI/CEP bridge may change while waiting for another
        // command. Re-read ownership after the lock to avoid targeting a stale
        // instance across a project lifecycle transition.
        const bridgeStatus = await assertBridgeAvailable();
        const commandId = `pi-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await writeJsonAtomic(resultPath, { status: "waiting", _commandId: commandId, message: "Waiting for After Effects" });
        const chatOwnerPid = getChatOwnerPid();
        await writeJsonAtomic(commandPath, {
          command: "aeCommand",
          id: commandId,
          args: { operation: params.operation, action: params.action, ...(params.parameters || {}) },
          ...(chatOwnerPid === undefined ? {} : { chatOwnerPid }),
          bridgeInstanceId: bridgeStatus.instanceId || null,
          timeoutMs,
          timestamp: new Date().toISOString(),
          status: "pending",
        });
        const result = await waitForResult(commandId, timeoutMs, signal);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } finally {
        await releaseBridge();
      }
    },
  });
}
