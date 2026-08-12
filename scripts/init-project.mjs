#!/usr/bin/env node
/**
 * Project bootstrap for the MCP Lock Orchestrator.
 *
 * Idempotent. Safe to run on existing or brand-new projects. It will:
 *   1. Validate the target workspace exists.
 *   2. Initialize the hidden state dir (.hermes3d_orchestrator by default).
 *   3. Append an .gitignore stanza so state files are not committed.
 *   4. Print MCP client config blocks for Claude Desktop, Claude Code,
 *      Codex, and Windsurf, pre-filled with absolute paths.
 *   5. Run a self-check (hermes_doctor) and report any blocking findings.
 *
 * Usage:
 *   node scripts/init-project.mjs [--workspace <path>] [--state-dir <name>]
 *
 * Or via env vars:
 *   MCP_LOCK_WORKSPACE=/abs/path node scripts/init-project.mjs
 *
 * Non-interactive: never prompts for input; safe for CI and automation.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { HermesLockManager } from "../src/core/lock-manager.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace" || a === "-w") out.workspace = argv[++i];
    else if (a === "--state-dir") out.stateDirName = argv[++i];
    else if (a === "--server-name") out.serverName = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(
    `MCP Lock Orchestrator project initializer

Usage:
  node scripts/init-project.mjs [--workspace <path>] [--state-dir <name>] [--server-name <id>]

Options:
  --workspace <path>     Target project root (default: $MCP_LOCK_WORKSPACE | $HERMES3D_WORKSPACE | cwd)
  --state-dir <name>     Hidden state dir name (default: .hermes3d_orchestrator)
  --server-name <id>     MCP server id used in client configs (default: hermes3d-locks)
  -h, --help             Show this help.`
  );
  process.exit(0);
}

const workspace = path.resolve(
  args.workspace ||
    process.env.MCP_LOCK_WORKSPACE ||
    process.env.HERMES3D_WORKSPACE ||
    process.cwd()
);
const stateDirName =
  args.stateDirName || process.env.MCP_LOCK_STATE_DIR || ".hermes3d_orchestrator";
const serverName =
  args.serverName || process.env.MCP_LOCK_SERVER_NAME || "hermes3d-locks";
const serverEntry = path.join(repoRoot, "src", "server.mjs");

console.log("== MCP Lock Orchestrator project init ==");
console.log(`Workspace     : ${workspace}`);
console.log(`State dir     : ${stateDirName}`);
console.log(`Server name   : ${serverName}`);
console.log(`Server entry  : ${serverEntry}`);
console.log("");

// 1. Workspace must exist.
let wsStat;
try {
  wsStat = await fs.stat(workspace);
} catch {
  console.error(`ERROR: workspace does not exist: ${workspace}`);
  console.error("Create the directory first or pass --workspace <path>.");
  process.exit(2);
}
if (!wsStat.isDirectory()) {
  console.error(`ERROR: workspace is not a directory: ${workspace}`);
  process.exit(2);
}

// 2. Initialize lock manager state dir.
const manager = new HermesLockManager({ workspaceRoot: workspace, stateDirName });
await manager.init();
console.log(`OK: state dir initialized at ${path.join(workspace, stateDirName)}`);

// 3. Ensure .gitignore in the workspace excludes state dir + tools/<pkg>/node_modules.
const gitignorePath = path.join(workspace, ".gitignore");
const ignoreLines = [
  `${stateDirName}/`,
  `tools/hermes3d-mcp-lock-orchestrator/node_modules/`
];
let existingIgnore = "";
try {
  existingIgnore = await fs.readFile(gitignorePath, "utf8");
} catch { /* file may not exist */ }
const missingLines = ignoreLines.filter(
  (line) => !existingIgnore.split(/\r?\n/).some((l) => l.trim() === line)
);
if (missingLines.length) {
  const stamp = `\n# Added by MCP Lock Orchestrator init (${new Date().toISOString()})\n`;
  const append = stamp + missingLines.join("\n") + "\n";
  await fs.appendFile(gitignorePath, append, "utf8");
  console.log(`OK: appended ${missingLines.length} line(s) to ${gitignorePath}`);
} else {
  console.log(`OK: .gitignore already covers state and tools dirs`);
}

// 4. Run doctor for non-destructive validation.
const report = await manager.doctor();
const blocking = report.findings.filter((f) => f.level === "error");
const warnings = report.findings.filter((f) => f.level === "warn");
const info = report.findings.filter((f) => f.level === "info");

console.log("");
console.log(`== Doctor report (ok=${report.ok}) ==`);
for (const f of [...blocking, ...warnings, ...info]) {
  console.log(`[${f.level}] ${f.check}: ${f.message}`);
  if (f.fix) console.log(`        fix: ${f.fix}`);
}

// 5. Print client configs.
const home = os.homedir();
const platform = process.platform;
const claudeDesktopConfigPath =
  platform === "win32"
    ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
    : platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : path.join(home, ".config", "Claude", "claude_desktop_config.json");
const windsurfConfigPath = path.join(home, ".codeium", "windsurf", "mcp_config.json");
const codexConfigPath = path.join(home, ".codex", "config.toml");

const envBlock = {
  MCP_LOCK_WORKSPACE: workspace,
  ...(stateDirName !== ".hermes3d_orchestrator" ? { MCP_LOCK_STATE_DIR: stateDirName } : {})
};

const jsonConfig = {
  mcpServers: {
    [serverName]: {
      command: "node",
      args: [serverEntry],
      env: envBlock
    }
  }
};

console.log("");
console.log(`== Client config files ==`);
console.log(`Claude Desktop : ${claudeDesktopConfigPath}`);
console.log(`Windsurf       : ${windsurfConfigPath}`);
console.log(`Codex          : ${codexConfigPath}`);
console.log("");
console.log("== JSON for Claude Desktop / Windsurf (merge into mcpServers) ==");
console.log(JSON.stringify(jsonConfig, null, 2));
console.log("");
console.log("== Claude Code CLI command ==");
const envFlags = Object.entries(envBlock).map(([k, v]) => `--env ${k}="${v}"`).join(" ");
console.log(`claude mcp add --transport stdio ${serverName} --scope local ${envFlags} -- node "${serverEntry}"`);
console.log("");
console.log("== Codex TOML block ==");
const tomlEnvEntries = Object.entries(envBlock)
  .map(([k, v]) => `${k} = "${v.replace(/\\/g, "\\\\")}"`)
  .join(", ");
console.log(`[mcp_servers.${serverName}]
command = "node"
args = ["${serverEntry.replace(/\\/g, "\\\\")}"]
env = { ${tomlEnvEntries} }
enabled = true
startup_timeout_sec = 10
tool_timeout_sec = 60
# Keep serialized for locking; do not set supports_parallel_tool_calls = true.`);

if (blocking.length) {
  console.log("");
  console.error(`Init finished with ${blocking.length} blocking finding(s). Address them before connecting MCP clients.`);
  process.exit(1);
}
console.log("");
console.log("Init finished successfully. Add the printed blocks to your MCP clients.");
