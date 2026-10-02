import { spawn } from "node:child_process";
import { spawnCli, type CliProviderId } from "./cli-providers.js";

export type ModelChoice = { model: string | null; provider: string | null; effort: string | null };
export type ModelOption = { id: string; label: string; provider?: string; efforts?: string[]; defaultEffort?: string };
export type ModelCatalog = {
  status: "loading" | "ready" | "unavailable";
  models: ModelOption[];
  modelSupported: boolean;
  efforts: string[];
  message?: string;
  defaultModel?: string;
  defaultEffort?: string;
};
export const DEFAULT_MODEL_CHOICE: ModelChoice = { model: null, provider: null, effort: null };

export function normalizeModelChoice(value: any): ModelChoice {
  const clean = (input: unknown) => {
    if (input == null || input === "") return null;
    if (typeof input !== "string" || input.length > 200 || /[\s\x00-\x1f"'`&|<>;%!^]/.test(input) || input.startsWith("-")) {
      throw new Error("Enter a model, provider, or reasoning ID without spaces or command characters.");
    }
    return input;
  };
  const choice = { model: clean(value?.model), provider: clean(value?.provider), effort: clean(value?.effort) };
  if (!choice.model) choice.provider = null;
  return choice;
}

// These are read-only catalog/help requests. Run asynchronously so discovering
// models can never block Send, Stop, or the companion heartbeat.
function readCli(executable: string, args: string[], cwd: string, includeHelpStderr = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnCli(executable, args, { cwd, env: { ...process.env, NO_COLOR: "1", PI_OFFLINE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let helpStderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(`${stdout}\n${helpStderr}`.replace(/\x1b\[[0-9;]*m/g, ""));
    };
    const timer = setTimeout(() => {
      child.kill();
      if (process.platform === "win32" && child.pid) spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      finish(new Error("Model discovery timed out. Use CLI default or a custom model ID, or refresh again."));
    }, 15000);
    child.stdout?.on("data", chunk => { stdout += String(chunk); });
    // Go-based CLIs print flag help on stderr. Consume stderr for every request
    // to avoid a full pipe, but retain it ONLY for flag detection, never labels
    // or panel errors (configuration errors may contain credentials).
    child.stderr?.on("data", chunk => { if (includeHelpStderr) helpStderr += String(chunk); });
    child.once("error", () => finish(new Error("The CLI could not be started to list models.")));
    child.once("close", code => finish(code === 0 ? undefined : new Error("The CLI could not list models. Check its sign-in/configuration and refresh.")));
  });
}

export function parseModelCatalog(provider: CliProviderId, output: string): ModelOption[] {
  const models: ModelOption[] = [];
  if (provider === "pi") {
    for (const line of output.split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 6 || columns[0] === "provider" || !/^(yes|no)$/.test(columns[4])) continue;
      models.push({ id: columns[1], provider: columns[0], label: `${columns[0]} / ${columns[1]}`, efforts: columns[4] === "yes" ? ["off", "minimal", "low", "medium", "high", "xhigh"] : [] });
    }
  } else if (provider === "kimi") {
    const config = JSON.parse(output);
    const entries = Array.isArray(config.models)
      ? config.models.map((model: any) => [model.alias || model.id || model.name, model])
      : Object.entries(config.models || {});
    for (const [alias] of entries) {
      if (typeof alias === "string") models.push({ id: alias, label: alias });
    }
  } else if (provider === "opencode") {
    const lines = output.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const key = lines[index].trim();
      if (!/^[\w.-]+\/[^\s]+$/.test(key)) continue;
      const option: ModelOption = { id: key.slice(key.indexOf("/") + 1), provider: key.slice(0, key.indexOf("/")), label: key, efforts: [] };
      if (lines[index + 1]?.trim() === "{") {
        // Nested objects also close with '}'. Use the next model header as the
        // boundary and let JSON.parse validate the complete metadata block.
        let end = index + 1;
        while (end < lines.length && (end === index + 1 || !/^[\w.-]+\/[^\s]+$/.test(lines[end].trim()))) end++;
        try {
          const data = JSON.parse(lines.slice(index + 1, end).join("\n"));
          option.label = `${option.provider} / ${data.name || option.id}`;
          option.efforts = Object.keys(data.variants || {}).filter(key => data.variants[key]?.disabled !== true);
        } catch {}
        index = end - 1;
      }
      models.push(option);
    }
  } else if (provider === "agy") {
    for (const line of output.split(/\r?\n/)) {
      // Recent versions return ID<TAB>display name; older versions return IDs.
      const [id, ...label] = line.trim().split(/\t+/);
      if (/^[\w][\w./:-]*$/.test(id)) models.push({ id, label: label.join(" ") || id });
    }
  } else {
    for (const line of output.split(/\r?\n/)) {
      const id = line.trim();
      if (/^[\w][\w./:-]*$/.test(id)) models.push({ id, label: id });
    }
  }
  return [...new Map(models.map(model => [`${model.provider || ""}/${model.id}`, model])).values()];
}

export async function discoverCliModels(provider: CliProviderId, executable: string, cwd: string): Promise<ModelCatalog> {
  const help = await readCli(executable, provider === "opencode" ? ["run", "--help"] : ["--help"], cwd, true);
  const catalog: ModelCatalog = { status: "ready", models: [], modelSupported: /--model\b/.test(help), efforts: [] };
  if (!catalog.modelSupported) return { ...catalog, status: "unavailable", message: "This CLI version does not advertise model selection. Update it to enable this control." };
  if (provider === "claude") {
    // Stable CLI aliases, not a hard-coded catalog of dated model versions.
    catalog.models = ["sonnet", "opus", "haiku"].map(id => ({ id, label: `${id.charAt(0).toUpperCase() + id.slice(1)} (CLI alias)` }));
    catalog.message = "Claude CLI aliases; use Custom model for a specific model ID.";
  } else {
    const args = provider === "pi" ? ["--offline", "--no-extensions", "--list-models"]
      : provider === "opencode" ? ["models", "--verbose"]
      : provider === "kimi" ? ["provider", "list", "--json"] : ["models"];
    try { catalog.models = parseModelCatalog(provider, await readCli(executable, args, cwd)); }
    catch { catalog.message = "Model list unavailable. CLI default and Custom model are still available. Check CLI sign-in/configuration, then refresh."; }
  }
  if (provider === "agy" && /--effort\b/.test(help)) {
    const advertised = help.match(/--effort[^\r\n]*\(([^)]+)\)/)?.[1];
    catalog.efforts = (advertised || "low|medium|high").split(/[|,\s]+/).filter(level => /^(low|medium|high|max)$/.test(level));
  }
  if (provider === "pi") {
    const levels = help.match(/--thinking[^\r\n]+(?:off|low)[^\r\n]*/)?.[0];
    if (levels) {
      const efforts = (levels.split(/:\s*/).at(-1) || "").split(/[,|\s]+/).filter(value => /^(off|minimal|low|medium|high|xhigh|max|ultra)$/.test(value));
      catalog.models.forEach(model => { if (model.efforts?.length) model.efforts = efforts.length ? efforts : model.efforts; });
    }
  }
  if (!catalog.models.length && !catalog.message) catalog.message = "No configured models were returned. Use CLI default, configure the CLI, or enter a custom model ID.";
  return catalog;
}

export function modelEfforts(catalog: ModelCatalog | undefined, choice: ModelChoice): string[] {
  const model = catalog?.models.find(model => model.id === (choice.model || catalog.defaultModel) && (model.provider || null) === choice.provider);
  return model?.efforts || catalog?.efforts || [];
}

export function validateModelChoice(catalog: ModelCatalog | undefined, choice: ModelChoice): void {
  if (choice.model && catalog?.modelSupported === false) throw new Error("This installed CLI does not support model selection.");
  if (choice.effort && !modelEfforts(catalog, choice).includes(choice.effort)) throw new Error("This reasoning level is not supported for the selected model. Choose an advertised level or CLI default.");
}
