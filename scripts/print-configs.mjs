#!/usr/bin/env node
/**
 * Prints ready-to-paste MCP client configurations for Claude Desktop, Claude Code,
 * Codex CLI/IDE, and Windsurf Cascade. Also prints OS-specific config file
 * locations so you know where to paste each block.
 *
 * Inputs (env vars, all optional):
 *   MCP_LOCK_WORKSPACE      Project workspace root (preferred, project-agnostic)
 *   HERMES3D_WORKSPACE      Legacy alias; used as fallback for backwards-compat
 *   MCP_LOCK_SERVER         Absolute path to src/server.mjs
 *   MCP_LOCK_SERVER_NAME    MCP server identifier (default: hermes3d-locks)
 *   MCP_LOCK_STATE_DIR      Override hidden state dir name
 */
import os from "node:os";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const workspace =
  process.env.MCP_LOCK_WORKSPACE ||
  process.env.HERMES3D_WORKSPACE ||
  "G:\\Github\\Hermes3D";

const server =
  process.env.MCP_LOCK_SERVER ||
  process.env.HERMES3D_MCP_SERVER ||
  path.join(workspace, "tools", "hermes3d-mcp-lock-orchestrator", "src", "server.mjs");

const serverName = process.env.MCP_LOCK_SERVER_NAME || "hermes3d-locks";
const stateDirName = process.env.MCP_LOCK_STATE_DIR || "";

const envBlock = {
  MCP_LOCK_WORKSPACE: workspace,
  ...(stateDirName ? { MCP_LOCK_STATE_DIR: stateDirName } : {})
};

const jsonConfig = {
  mcpServers: {
    [serverName]: {
      command: "node",
      args: [server],
      env: envBlock
    }
  }
};

const platform = process.platform;
const home = os.homedir();

const claudeDesktopConfigPath = (() => {
  if (platform === "win32") return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  return path.join(home, ".config", "Claude", "claude_desktop_config.json");
})();

const windsurfConfigPath = (() => {
  if (platform === "win32") return path.join(home, ".codeium", "windsurf", "mcp_config.json");
  return path.join(home, ".codeium", "windsurf", "mcp_config.json");
})();

const codexConfigPath = path.join(home, ".codex", "config.toml");

console.log(`# Detected paths`);
console.log(`Repo root        : ${repoRoot}`);
console.log(`Workspace        : ${workspace}`);
console.log(`Server entry     : ${server}`);
console.log(`Server name      : ${serverName}`);
console.log(`Platform         : ${platform}`);
console.log("");

console.log(`# Claude Desktop config file`);
console.log(claudeDesktopConfigPath);
console.log("");
console.log("# Claude Desktop / Windsurf JSON (paste into mcpServers)");
console.log(JSON.stringify(jsonConfig, null, 2));
console.log("");

console.log(`# Windsurf Cascade config file`);
console.log(windsurfConfigPath);
console.log("");

console.log("# Claude Code CLI");
const envFlags = Object.entries(envBlock)
  .map(([k, v]) => `--env ${k}="${v}"`)
  .join(" ");
console.log(
  `claude mcp add --transport stdio ${serverName} --scope local ${envFlags} -- node "${server}"`
);
console.log("");

console.log(`# Codex config file`);
console.log(codexConfigPath);
console.log("");
console.log("# Codex ~/.codex/config.toml entry");
const tomlEnvEntries = Object.entries(envBlock)
  .map(([k, v]) => `${k} = "${v.replace(/\\/g, "\\\\")}"`)
  .join(", ");
console.log(
  `[mcp_servers.${serverName}]
command = "node"
args = ["${server.replace(/\\/g, "\\\\")}"]
env = { ${tomlEnvEntries} }
enabled = true
startup_timeout_sec = 10
tool_timeout_sec = 60
# Keep serialized for locking; do not set supports_parallel_tool_calls = true for this server.`
);

