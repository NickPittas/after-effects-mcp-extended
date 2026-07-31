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

const operationActions: Record<string, readonly string[]> = {
  inspect: ["get"],
  property: ["get", "set", "expression"],
  keyframe: ["get", "set", "update", "remove", "clear"],
  effect: ["get", "add", "update", "remove", "move"],
  mask: ["get", "add", "set", "update", "remove"],
  shape: ["get", "add", "set", "update", "remove", "move", "duplicate"],
  text: ["get", "add", "set", "update"],
  layer: ["get", "add", "update", "duplicate", "remove", "move", "precompose", "setTrackMatte", "removeTrackMatte", "timeRemap"],
  composition: ["get", "create", "update", "duplicate", "remove"],
  project: ["get", "media", "getItem", "updateItem", "import", "relink", "reload", "interpret", "proxy", "dependencies", "manifest", "cleanup", "createFolder", "save", "queueRender"],
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
  throw new Error("Timed out waiting for the After Effects bridge. Open Window > mcp-bridge-auto.jsx and enable Auto-run commands.");
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

async function assertBridgeAvailable(): Promise<void> {
  try {
    const status = JSON.parse(await fs.readFile(heartbeatPath, "utf8"));
    const updatedAt = typeof status.updatedAt === "number" ? status.updatedAt : Date.parse(String(status.updatedAt || ""));
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > 4000) throw new Error("heartbeat is stale");
    if (status.autoRun === false || status.state === "paused") throw new Error("Auto-run is disabled");
    if (!["starting", "checking", "ready"].includes(String(status.state || ""))) throw new Error(`state is '${status.state || "unknown"}'`);
  } catch (error) {
    throw new Error(`After Effects bridge is unavailable (${error instanceof Error ? error.message : String(error)}). Keep the MCP Bridge panel open with Auto-run enabled.`);
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "after_effects",
    label: "After Effects",
    description: `Inspect or control the open Adobe After Effects project through the local bridge. Valid operation/action pairs: ${actionContract}. Composition creation is composition/create, never composition/add.`,
    promptSnippet: "Inspect, create, animate, mask, apply effects, manage project media, render, or capture frames in After Effects.",
    promptGuidelines: [
      "Use after_effects for After Effects work instead of guessing project state or manipulating AE files directly.",
      "Prefer an inspect operation before edits when layer, composition, or property selectors are uncertain.",
      "Use operation=composition and action=create to create a composition; action=add is invalid for compositions.",
      "For composition/create, pass name, width, height, pixelAspect, duration, and frameRate in parameters. Omitted values default to Composition, 1920, 1080, 1, 10 seconds, and 25 fps.",
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
      const requestedTimeout = Number((params.parameters as Record<string, unknown> | undefined)?.timeoutMs || 30000);
      const timeoutMs = Math.min(600000, Math.max(1000, Number.isFinite(requestedTimeout) ? requestedTimeout : 30000));
      const releaseBridge = await acquireBridgeLock(timeoutMs + 5000, signal);
      try {
        const commandId = `pi-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await fs.writeFile(resultPath, JSON.stringify({ status: "waiting", _commandId: commandId, message: "Waiting for After Effects" }, null, 2), "utf8");
        await fs.writeFile(commandPath, JSON.stringify({
          command: "aeCommand",
          id: commandId,
          args: { operation: params.operation, action: params.action, ...(params.parameters || {}) },
          timestamp: new Date().toISOString(),
          status: "pending",
        }, null, 2), "utf8");
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
