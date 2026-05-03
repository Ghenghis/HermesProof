import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CLIENT_IDS, clientPaths, detectClients, resolveHome } from "./wizard-detectors.mjs";

export const SUPPORTED_CLIENTS = CLIENT_IDS;

export async function writeClients({
  clients,
  workspaceRoot,
  repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  serverName = "hermes3d-locks",
  dryRun = false,
  env = process.env,
  homeDir = resolveHome(env),
  force = false
}) {
  const serverEntry = path.join(repoRoot, "src", "server.mjs");
  const paths = clientPaths({ workspaceRoot, env, homeDir });
  const detections = await detectClients({ workspaceRoot, env, homeDir });
  const selected = clients.length ? clients : Object.values(detections).filter((item) => item.detected).map((item) => item.id);
  const results = {};
  for (const client of selected) {
    const writer = WRITERS[client];
    if (!writer) {
      results[client] = { ok: false, status: "unsupported_client" };
      continue;
    }
    try {
      results[client] = await writer.write({ workspaceRoot, repoRoot, serverEntry, serverName, paths, dryRun, env, force });
    } catch (err) {
      results[client] = { ok: false, status: "error", error: err.message };
    }
  }
  return { selected, results, detections };
}

export const WRITERS = {
  "claude-desktop": {
    detect: detectOne("claude-desktop"),
    backup,
    write: async (opts) => await upsertJsonMcp(opts.paths.claudeDesktop, opts)
  },
  codex: {
    detect: detectOne("codex"),
    backup,
    write: async (opts) => await upsertCodexToml(opts.paths.codex, opts)
  },
  windsurf: {
    detect: detectOne("windsurf"),
    backup,
    write: async (opts) => await upsertJsonMcp(opts.paths.windsurf, opts)
  },
  cursor: {
    detect: detectOne("cursor"),
    backup,
    write: async (opts) => await writeCursor(opts)
  },
  "vscode-copilot": {
    detect: detectOne("vscode-copilot"),
    backup,
    write: async (opts) => await writeVscode(opts)
  },
  "claude-code": {
    detect: detectOne("claude-code"),
    backup,
    write: async (opts) => await writeClaudeCode(opts)
  },
  "claude-code-hooks": {
    detect: async () => ({ detected: true }),
    backup,
    write: async (opts) => await writeClaudeCodeHooks(opts)
  },
  "anthropic-sdk": {
    detect: detectOne("anthropic-sdk"),
    backup,
    write: async (opts) => await writeAnthropicSdkExample(opts)
  }
};

function detectOne(id) {
  return async (opts = {}) => {
    const all = await detectClients(opts);
    return all[id] || { id, detected: false };
  };
}

async function upsertJsonMcp(file, { workspaceRoot, serverEntry, serverName, dryRun }) {
  if (dryRun) return planned(file);
  await ensureParent(file);
  const { json, existed } = await readJsonConfig(file, { mcpServers: {} });
  json.mcpServers ||= {};
  const current = json.mcpServers[serverName];
  const next = {
    command: "node",
    args: [serverEntry],
    env: { MCP_LOCK_WORKSPACE: workspaceRoot }
  };
  if (JSON.stringify(current) === JSON.stringify(next)) return skipped(file);
  const bak = existed ? await backup(file) : null;
  json.mcpServers[serverName] = next;
  await fs.writeFile(file, JSON.stringify(json, null, 2) + "\n", "utf8");
  return written(file, bak);
}

async function upsertCodexToml(file, { workspaceRoot, serverEntry, serverName, dryRun }) {
  if (dryRun) return planned(file);
  await ensureParent(file);
  let raw = "";
  let existed = true;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") existed = false;
    else throw err;
  }
  const header = `[mcp_servers.${serverName}]`;
  if (raw.includes(header)) return skipped(file);
  const bak = existed ? await backup(file) : null;
  const block = [
    "",
    header,
    `command = "node"`,
    `args = ["${toml(serverEntry)}"]`,
    `env = { MCP_LOCK_WORKSPACE = "${toml(workspaceRoot)}" }`,
    `enabled = true`,
    `startup_timeout_sec = 10`,
    `tool_timeout_sec = 60`,
    `# Keep serialized for locking; do not set supports_parallel_tool_calls = true.`,
    ""
  ].join("\n");
  await fs.writeFile(file, `${raw}${raw && !raw.endsWith("\n") ? "\n" : ""}${block}`, "utf8");
  return written(file, bak);
}

async function writeCursor({ workspaceRoot, serverEntry, serverName, paths, repoRoot, dryRun }) {
  const files = [
    { path: paths.cursorMcp, kind: "json" },
    { src: path.join(repoRoot, "examples", "cursor", ".cursor", "rules", "hermesproof.mdc"), path: path.join(paths.cursorRulesDir, "hermesproof.mdc"), kind: "copy" },
    { src: path.join(repoRoot, "examples", "cursor", ".cursor", "rules", "hermesproof-queue-discipline.mdc"), path: path.join(paths.cursorRulesDir, "hermesproof-queue-discipline.mdc"), kind: "copy" }
  ];
  if (dryRun) return { ok: true, status: "planned", files: files.map((f) => f.path) };
  const backups = [];
  await upsertJsonMcp(files[0].path, { workspaceRoot, serverEntry, serverName, dryRun: false });
  for (const item of files.slice(1)) {
    await ensureParent(item.path);
    const bak = await backup(item.path);
    if (bak) backups.push(bak);
    await fs.copyFile(item.src, item.path);
  }
  return { ok: true, status: "written", files: files.map((f) => f.path), backups };
}

async function writeVscode({ workspaceRoot, serverEntry, serverName, paths, dryRun }) {
  if (dryRun) return planned(paths.vscodeMcp);
  await ensureParent(paths.vscodeMcp);
  const { json, existed } = await readJsonConfig(paths.vscodeMcp, { servers: {} });
  json.servers ||= {};
  json.servers[serverName] = {
    type: "stdio",
    command: "node",
    args: [serverEntry],
    env: { MCP_LOCK_WORKSPACE: workspaceRoot }
  };
  const bak = existed ? await backup(paths.vscodeMcp) : null;
  await fs.writeFile(paths.vscodeMcp, JSON.stringify(json, null, 2) + "\n", "utf8");
  return written(paths.vscodeMcp, bak);
}

async function writeClaudeCode({ workspaceRoot, serverEntry, serverName, dryRun }) {
  const command = process.platform === "win32" ? "claude.exe" : "claude";
  const args = [
    "mcp", "add", "--transport", "stdio", serverName, "--scope", "user",
    "--env", `MCP_LOCK_WORKSPACE=${workspaceRoot}`,
    "--", "node", serverEntry
  ];
  if (dryRun) return { ok: true, status: "planned", command, args };
  const result = spawnSync(command, args, { encoding: "utf8", shell: false });
  if (result.error?.code === "ENOENT") {
    return { ok: true, status: "skipped", reason: "claude CLI not found", command, args };
  }
  if (result.status !== 0 && !/already exists/i.test(result.stderr || "")) {
    return { ok: false, status: "error", error: `claude mcp add exited ${result.status}` };
  }
  return { ok: true, status: result.status === 0 ? "written" : "skipped", command };
}

async function writeClaudeCodeHooks({ paths, repoRoot, workspaceRoot, dryRun }) {
  const skillSrc = path.join(repoRoot, "examples", "claude_code", "skills", "hermesproof", "SKILL.md");
  const hooksSrc = path.join(repoRoot, "examples", "claude_code", "settings.hooks.json");
  const skillDest = path.join(workspaceRoot, ".claude", "skills", "hermesproof", "SKILL.md");
  if (dryRun) return { ok: true, status: "planned", files: [paths.claudeHooksSidecar, skillDest] };
  await ensureParent(paths.claudeHooksSidecar);
  const hooksBak = await backup(paths.claudeHooksSidecar);
  await fs.copyFile(hooksSrc, paths.claudeHooksSidecar);
  await ensureParent(skillDest);
  const skillBak = await backup(skillDest);
  await fs.copyFile(skillSrc, skillDest);
  return { ok: true, status: "written", files: [paths.claudeHooksSidecar, skillDest], backups: [hooksBak, skillBak].filter(Boolean) };
}

async function writeAnthropicSdkExample({ workspaceRoot, serverEntry, paths, dryRun }) {
  const file = path.join(paths.anthropicDir, "anthropic-sdk-example.mjs");
  if (dryRun) return planned(file);
  await ensureParent(file);
  const bak = await backup(file);
  const body = `// HermesProof MCP example for the Claude Code SDK.\n` +
    `// Current Anthropic docs show: import { query } from "@anthropic-ai/claude-code".\n` +
    `// Set ANTHROPIC_API_KEY in your shell before running; do not store it here.\n` +
    `import { query } from "@anthropic-ai/claude-code";\n\n` +
    `if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required at runtime");\n\n` +
    `for await (const message of query({\n` +
    `  prompt: "Run hermes_doctor and summarize the workspace status.",\n` +
    `  options: {\n` +
    `    mcpServers: {\n` +
    `      "hermes3d-locks": {\n` +
    `        type: "stdio",\n` +
    `        command: "node",\n` +
    `        args: [${JSON.stringify(serverEntry)}],\n` +
    `        env: { MCP_LOCK_WORKSPACE: ${JSON.stringify(workspaceRoot)} }\n` +
    `      }\n` +
    `    },\n` +
    `    allowedTools: ["mcp__hermes3d-locks__hermes_doctor"]\n` +
    `  }\n` +
    `})) {\n` +
    `  if (message.type === "result") console.log(message.result);\n` +
    `}\n`;
  await fs.writeFile(file, body, "utf8");
  return written(file, bak);
}

async function readJsonConfig(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return { json: raw.trim() ? JSON.parse(raw) : fallback, existed: true };
  } catch (err) {
    if (err.code === "ENOENT") return { json: fallback, existed: false };
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
}

export async function backup(file) {
  try {
    await fs.access(file);
  } catch {
    return null;
  }
  const bak = `${file}.bak.${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await fs.copyFile(file, bak);
  return bak;
}

async function ensureParent(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
}

function planned(file) {
  return { ok: true, status: "planned", file };
}

function skipped(file) {
  return { ok: true, status: "skipped", file };
}

function written(file, bak) {
  return { ok: true, status: "written", file, backup: bak };
}

function toml(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
