import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const marketplacePath = join(root, ".agents", "plugins", "marketplace.json");
const pluginRoot = join(root, "plugins", "runtime-evolution-workbench");
const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
const requiredFiles = [
  marketplacePath,
  manifestPath,
  join(pluginRoot, ".mcp.json"),
  join(pluginRoot, "hooks", "hooks.json"),
  join(pluginRoot, "scripts", "capture-hook.mjs"),
  join(pluginRoot, "scripts", "mcp-server.mjs"),
  join(pluginRoot, "skills", "run-evolution", "SKILL.md")
];

for (const path of requiredFiles) {
  if (!existsSync(path)) throw new Error(`Required plugin file is missing: ${path}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.name !== "runtime-evolution-workbench" || manifest.version !== "0.1.0") {
  throw new Error("Plugin name/version does not match the release contract.");
}
if (manifest.mcpServers !== "./.mcp.json" || manifest.skills !== "./skills/") {
  throw new Error("Plugin capability paths are invalid.");
}

const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
if (marketplace.name !== "runtime-evolution-workbench") {
  throw new Error("Marketplace name must be runtime-evolution-workbench.");
}
const entry = marketplace.plugins?.find((candidate) => candidate.name === manifest.name);
if (!entry || entry.source?.source !== "local" || entry.source?.path !== "./plugins/runtime-evolution-workbench") {
  throw new Error("Marketplace plugin source is invalid.");
}

const hooks = JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8"));
if (!hooks.hooks || Object.keys(hooks.hooks).length < 5) throw new Error("Lifecycle hook coverage is unexpectedly small.");
for (const registrations of Object.values(hooks.hooks)) {
  for (const registration of registrations) {
    for (const hook of registration.hooks ?? []) {
      if (typeof hook.command !== "string" || !hook.command.includes("$PLUGIN_ROOT")) {
        throw new Error("Every shell hook command must resolve from PLUGIN_ROOT.");
      }
      if (typeof hook.commandWindows !== "string" || !hook.commandWindows.includes("%PLUGIN_ROOT%")) {
        throw new Error("Every Windows hook command must resolve from PLUGIN_ROOT.");
      }
    }
  }
}

process.stdout.write("Plugin structure and marketplace metadata passed.\n");
