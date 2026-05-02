#!/usr/bin/env node
/**
 * Wire `hermes3d-locks` into every supported MCP client config.
 *
 * - Claude Desktop : %APPDATA%\Claude\claude_desktop_config.json (Windows)
 *                    ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
 *                    ~/.config/Claude/claude_desktop_config.json (Linux)
 * - Claude Code    : ~/.claude.json    (managed by `claude mcp add`)
 * - Codex          : ~/.codex/config.toml
 * - Windsurf       : ~/.codeium/windsurf/mcp_config.json
 *
 * Idempotent. Backs up each file with a timestamped suffix before editing.
 * Never modifies existing entries; only appends/upserts the orchestrator.
 *
 * Usage:
 *   node scripts/install-clients.mjs --workspace "G:\\Github\\Hermes3D" \
 *        [--server-name hermes3d-locks] \
 *        [--targets claude-desktop,claude-code,codex,windsurf]
 *
 * --targets defaults to "claude-desktop,codex,windsurf"; Claude Code is
 * intentionally separate because the canonical install path is the CLI command.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace" || a === "-w") out.workspace = argv[++i];
    else if (a === "--server-name") out.serverName = argv[++i];
    else if (a === "--targets") out.targets = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Install hermes3d-locks into MCP client configs.

Usage:
  node scripts/install-clients.mjs --workspace <path> [--server-name <id>] [--targets <list>]

--targets defaults to: claude-desktop,codex,windsurf,claude-code`);
  process.exit(0);
}

const workspace = path.resolve(
  args.workspace ||
    process.env.MCP_LOCK_WORKSPACE ||
    process.env.HERMES3D_WORKSPACE ||
    process.cwd()
);
const serverName = args.serverName || process.env.MCP_LOCK_SERVER_NAME || "hermes3d-locks";
const targets = (args.targets || "claude-desktop,codex,windsurf,claude-code")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const serverEntry = path.join(repoRoot, "src", "server.mjs");

const home = os.homedir();
const platform = process.platform;
const claudeDesktopPath =
  platform === "win32"
    ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json")
    : platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : path.join(home, ".config", "Claude", "claude_desktop_config.json");
const windsurfPath = path.join(home, ".codeium", "windsurf", "mcp_config.json");
const codexPath = path.join(home, ".codex", "config.toml");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const envBlock = { MCP_LOCK_WORKSPACE: workspace };

function describe(action, file, detail = "") {
  console.log(`[${action}] ${file}${detail ? ` :: ${detail}` : ""}`);
}

async function backup(file) {
  try {
    await fs.access(file);
  } catch {
    return null;
  }
  const bak = `${file}.bak.${stamp}`;
  await fs.copyFile(file, bak);
  return bak;
}

async function ensureDir(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
}

async function upsertJsonClient(file, label) {
  await ensureDir(file);
  let json;
  let existed = true;
  try {
    const raw = await fs.readFile(file, "utf8");
    json = raw.trim() ? JSON.parse(raw) : { mcpServers: {} };
  } catch (err) {
    if (err.code === "ENOENT") {
      existed = false;
      json = { mcpServers: {} };
    } else {
      throw new Error(`${label} config at ${file} is not valid JSON: ${err.message}`);
    }
  }
  if (!json.mcpServers || typeof json.mcpServers !== "object") {
    json.mcpServers = {};
  }
  if (json.mcpServers[serverName]) {
    describe("skip", file, `${serverName} already present`);
    return { changed: false, existed, backup: null };
  }
  const bak = existed ? await backup(file) : null;
  json.mcpServers[serverName] = {
    command: "node",
    args: [serverEntry],
    env: envBlock
  };
  await fs.writeFile(file, JSON.stringify(json, null, 2) + "\n", "utf8");
  describe("write", file, bak ? `backup: ${path.basename(bak)}` : "(created new)");
  return { changed: true, existed, backup: bak };
}

async function upsertCodexToml() {
  const file = codexPath;
  await ensureDir(file);
  let raw = "";
  let existed = true;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      existed = false;
    } else {
      throw err;
    }
  }
  const stanzaHeader = `[mcp_servers.${serverName}]`;
  if (raw.includes(stanzaHeader)) {
    describe("skip", file, `${stanzaHeader} already present`);
    return { changed: false, existed, backup: null };
  }
  const bak = existed ? await backup(file) : null;
  const escaped = serverEntry.replace(/\\/g, "\\\\");
  const wsEscaped = workspace.replace(/\\/g, "\\\\");
  const block = [
    "",
    stanzaHeader,
    `command = "node"`,
    `args = ["${escaped}"]`,
    `env = { MCP_LOCK_WORKSPACE = "${wsEscaped}" }`,
    `enabled = true`,
    `startup_timeout_sec = 10`,
    `tool_timeout_sec = 60`,
    `# Keep serialized for locking; do not set supports_parallel_tool_calls = true.`,
    `# HERMES3D_WORKSPACE remains supported as a backwards-compatible alias.`,
    ""
  ].join("\n");
  const next = (raw.endsWith("\n") || raw === "" ? raw : raw + "\n") + block;
  await fs.writeFile(file, next, "utf8");
  describe("write", file, bak ? `backup: ${path.basename(bak)}` : "(created new)");
  return { changed: true, existed, backup: bak };
}

function runClaudeMcpAdd() {
  // Look up the claude binary on PATH (Windows uses .exe).
  const claudeCmd = process.platform === "win32" ? "claude.exe" : "claude";
  const cmdArgs = [
    "mcp", "add",
    "--transport", "stdio",
    serverName,
    "--scope", "user",
    "--env", `MCP_LOCK_WORKSPACE=${workspace}`,
    "--",
    "node", serverEntry
  ];
  console.log(`[run]   ${claudeCmd} ${cmdArgs.join(" ")}`);
  const result = spawnSync(claudeCmd, cmdArgs, { encoding: "utf8" });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      console.log(`[skip]  claude CLI not on PATH; skipping Claude Code wiring. Install Claude Code or paste the printed command manually.`);
      return { changed: false };
    }
    throw result.error;
  }
  if (result.stdout) console.log(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  if (result.status !== 0) {
    // `claude mcp add` errors if the name already exists. Treat as idempotent.
    if (/already exists/i.test(result.stderr || "")) {
      console.log(`[skip]  Claude Code already has ${serverName}`);
      return { changed: false };
    }
    throw new Error(`claude mcp add exited with code ${result.status}`);
  }
  return { changed: true };
}

console.log(`== Installing ${serverName} ==`);
console.log(`workspace    : ${workspace}`);
console.log(`server entry : ${serverEntry}`);
console.log(`targets      : ${targets.join(", ")}`);
console.log("");

const results = {};

if (targets.includes("claude-desktop")) {
  console.log("--- Claude Desktop ---");
  results["claude-desktop"] = await upsertJsonClient(claudeDesktopPath, "claude-desktop");
  console.log("");
}

if (targets.includes("windsurf")) {
  console.log("--- Windsurf ---");
  results["windsurf"] = await upsertJsonClient(windsurfPath, "windsurf");
  console.log("");
}

if (targets.includes("codex")) {
  console.log("--- Codex ---");
  results["codex"] = await upsertCodexToml();
  console.log("");
}

if (targets.includes("claude-code")) {
  console.log("--- Claude Code ---");
  try {
    results["claude-code"] = runClaudeMcpAdd();
  } catch (err) {
    console.error(`claude-code wiring failed: ${err.message}`);
    results["claude-code"] = { changed: false, error: err.message };
  }
  console.log("");
}

console.log("== Summary ==");
for (const [k, v] of Object.entries(results)) {
  if (v.error) console.log(`${k.padEnd(16)} ERROR  ${v.error}`);
  else if (v.changed) console.log(`${k.padEnd(16)} ADDED${v.backup ? `  (backup: ${path.basename(v.backup)})` : ""}`);
  else console.log(`${k.padEnd(16)} SKIPPED`);
}
console.log("");
console.log("Restart Claude Desktop / Codex; refresh MCP servers in Cascade. Run `claude mcp list` to verify Claude Code.");
