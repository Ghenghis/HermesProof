import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CLIENT_IDS, clientPaths, detectClients, resolveHome } from "./wizard-detectors.mjs";
import {
  createClientConfigSnapshot,
  finalizeClientConfigSnapshot,
  restoreClientConfigSnapshot
} from "../src/core/client-config-snapshot.mjs";

export const SUPPORTED_CLIENTS = CLIENT_IDS;

export async function writeClients({
  clients,
  workspaceRoot,
  repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  serverName = "hermes3d-locks",
  dryRun = false,
  env = process.env,
  homeDir = resolveHome(env),
  force = false,
  launcherPath,
  commandRunner = spawnSync
}) {
  const managedRoot = path.resolve(env.HERMESPROOF_MANAGED_ROOT || path.join(homeDir, ".hermesproof-managed"));
  const servers = hermesServerSpecs({ repoRoot, workspaceRoot, coreName: serverName, launcherPath, managedRoot });
  const serverEntry = servers[0].entry;
  const paths = clientPaths({ workspaceRoot, env, homeDir });
  const detections = await detectClients({ workspaceRoot, env, homeDir });
  const selected = clients.length ? clients : Object.values(detections).filter((item) => item.detected).map((item) => item.id);
  const configFiles = selectedConfigFiles(selected, paths);
  const backupRoot = path.join(
    managedRoot,
    "backups",
    "clients"
  );
  const snapshot = dryRun || configFiles.length === 0
    ? null
    : await createClientConfigSnapshot({ files: configFiles, backupRoot });
  const results = {};
  for (const client of selected) {
    const writer = WRITERS[client];
    if (!writer) {
      results[client] = { ok: false, status: "unsupported_client" };
      continue;
    }
    try {
      results[client] = await writer.write({
        workspaceRoot,
        repoRoot,
        serverEntry,
        serverName,
        servers,
        paths,
        dryRun,
        env,
        force,
        commandRunner
      });
    } catch (err) {
      results[client] = { ok: false, status: "error", error: err.message };
    }
  }
  let snapshotResult = null;
  let rollback = null;
  if (snapshot) {
    snapshotResult = await finalizeClientConfigSnapshot({ manifestFile: snapshot.manifestFile });
    if (Object.values(results).some((item) => item.ok === false)) {
      rollback = await restoreClientConfigSnapshot({
        manifestFile: snapshot.manifestFile,
        manifestSha256: snapshotResult.manifestSha256,
        allowedFiles: configFiles
      });
    }
  }
  return {
    selected,
    results,
    detections,
    snapshot: snapshot ? {
      ...snapshot,
      finalized: Boolean(snapshotResult),
      manifestSha256: snapshotResult?.manifestSha256 || null,
      allowedFiles: configFiles
    } : null,
    rollback
  };
}

function selectedConfigFiles(selected, paths) {
  const byClient = {
    "claude-desktop": [paths.claudeDesktop],
    "claude-code": [paths.claudeUserSettings],
    codex: [paths.codex],
    windsurf: [paths.windsurf],
    kilocode: [paths.kilocodeMcp],
    "lm-studio": [paths.lmStudioMcp, paths.localModelProviders],
    ollama: [paths.localModelProviders],
    devin: [paths.devinExport],
    cursor: [paths.cursorMcp],
    "vscode-copilot": [paths.vscodeMcp],
    vscode: [paths.vscodeMcp],
    "anthropic-sdk": [path.join(paths.anthropicDir, "anthropic-sdk-example.mjs")]
  };
  return [...new Set(selected.flatMap((client) => byClient[client] || []).map((file) => path.resolve(file)))];
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
    write: async (opts) => await writeWindsurf(opts)
  },
  kilocode: {
    detect: detectOne("kilocode"),
    backup,
    write: async (opts) => await writeKiloCode(opts)
  },
  "lm-studio": {
    detect: detectOne("lm-studio"),
    backup,
    write: async (opts) => {
      const mcp = await upsertJsonMcp(opts.paths.lmStudioMcp, opts);
      const models = await writeLocalModelProviders(opts);
      return {
        ok: mcp.ok !== false && models.ok !== false,
        status: mcp.status === "written" || models.status === "written" ? "written" : "skipped",
        files: [opts.paths.lmStudioMcp, opts.paths.localModelProviders],
        backups: [mcp.backup, models.backup].filter(Boolean)
      };
    }
  },
  ollama: {
    detect: detectOne("ollama"),
    backup,
    write: async (opts) => await writeLocalModelProviders(opts)
  },
  devin: {
    detect: detectOne("devin"),
    backup,
    write: async (opts) => await writeDevinExport(opts)
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
  vscode: {
    detect: detectOne("vscode"),
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

export function hermesServerSpecs({
  repoRoot,
  workspaceRoot,
  coreName = "hermes3d-locks",
  launcherPath,
  managedRoot
}) {
  const make = (name, entry) => ({
    name,
    entry,
    command: "node",
    args: launcherPath ? [launcherPath, "--server", name] : [entry],
    env: {
      MCP_LOCK_WORKSPACE: workspaceRoot,
      ...(launcherPath && managedRoot ? { HERMESPROOF_MANAGED_ROOT: path.resolve(managedRoot) } : {})
    }
  });
  return [
    make(coreName, path.join(repoRoot, "src", "server.mjs")),
    make("hp-mha-serena", path.join(repoRoot, "src", "hp-mha-serena", "server.mjs"))
  ];
}

function detectOne(id) {
  return async (opts = {}) => {
    const all = await detectClients(opts);
    return all[id] || { id, detected: false };
  };
}

async function upsertJsonMcp(file, { servers, dryRun }) {
  if (dryRun) return planned(file);
  await ensureParent(file);
  const { json, existed } = await readJsonConfig(file, { mcpServers: {} });
  json.mcpServers ||= {};
  const desired = Object.fromEntries(servers.map((server) => [
    server.name,
    { command: server.command, args: server.args, env: server.env }
  ]));
  const unchanged = Object.entries(desired).every(([name, entry]) =>
    JSON.stringify(json.mcpServers[name]) === JSON.stringify(entry)
  );
  if (unchanged) return skipped(file);
  const bak = existed ? await backup(file) : null;
  Object.assign(json.mcpServers, desired);
  await fs.writeFile(file, JSON.stringify(json, null, 2) + "\n", "utf8");
  return written(file, bak);
}

async function upsertCodexToml(file, { servers, dryRun }) {
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
  let nextRaw = raw;
  for (const server of servers) {
    const block = [
      "[mcp_servers." + server.name + "]",
      "command = \"" + toml(server.command) + "\"",
      "args = [" + server.args.map((arg) => "\"" + toml(arg) + "\"").join(", ") + "]",
      "env = { MCP_LOCK_WORKSPACE = \"" + toml(server.env.MCP_LOCK_WORKSPACE) + "\" }",
      "enabled = true",
      "startup_timeout_sec = 20",
      "tool_timeout_sec = 120",
      "# Keep serialized for locking; do not set supports_parallel_tool_calls = true."
    ].join("\n");
    nextRaw = upsertTomlSection(nextRaw, "mcp_servers." + server.name, block);
  }
  if (nextRaw === raw) return skipped(file);
  const bak = existed ? await backup(file) : null;
  await fs.writeFile(file, nextRaw.endsWith("\n") ? nextRaw : nextRaw + "\n", "utf8");
  return written(file, bak);
}

function upsertTomlSection(raw, section, block) {
  const escaped = section.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("(^|\\n)\\[" + escaped + "\\][\\s\\S]*?(?=\\n\\[[^\\n]+\\]|$)");
  if (pattern.test(raw)) return raw.replace(pattern, (match, prefix) => prefix + block);
  const separator = raw && !raw.endsWith("\n") ? "\n\n" : raw ? "\n" : "";
  return raw + separator + block + "\n";
}

async function writeCursor({ servers, paths, repoRoot, dryRun }) {
  const files = [
    { path: paths.cursorMcp, kind: "json" },
    { src: path.join(repoRoot, "examples", "cursor", ".cursor", "rules", "hermesproof.mdc"), path: path.join(paths.cursorRulesDir, "hermesproof.mdc"), kind: "copy" },
    { src: path.join(repoRoot, "examples", "cursor", ".cursor", "rules", "hermesproof-queue-discipline.mdc"), path: path.join(paths.cursorRulesDir, "hermesproof-queue-discipline.mdc"), kind: "copy" },
    { src: path.join(repoRoot, "examples", "cursor", "streamhooks", ".cursor", "rules", "stream.mdc"), path: path.join(paths.cursorRulesDir, "stream.mdc"), kind: "copy" }
  ];
  if (dryRun) return { ok: true, status: "planned", files: files.map((f) => f.path) };
  const backups = [];
  await upsertJsonMcp(files[0].path, { servers, dryRun: false });
  for (const item of files.slice(1)) {
    await ensureParent(item.path);
    const bak = await backup(item.path);
    if (bak) backups.push(bak);
    await fs.copyFile(item.src, item.path);
  }
  return { ok: true, status: "written", files: files.map((f) => f.path), backups };
}

async function writeKiloCode({ paths, repoRoot, servers, dryRun }) {
  const files = [
    { path: paths.kilocodeMcp, kind: "mcp" },
    { src: path.join(repoRoot, "examples", "kilocode", "streamhooks", "rules.toml"), path: paths.kilocodeRules },
    { src: path.join(repoRoot, "examples", "kilocode", "streamhooks", "system-prompt-snippet.md"), path: path.join(paths.kilocodeDir, "hermesproof", "system-prompt-snippet.md") }
  ];
  if (dryRun) return { ok: true, status: "planned", files: files.map((f) => f.path) };
  const backups = [];
  await ensureParent(paths.kilocodeMcp);
  const { json, existed } = await readJsonConfig(paths.kilocodeMcp, { "$schema": "https://app.kilo.ai/config.json", mcp: {} });
  json.$schema ||= "https://app.kilo.ai/config.json";
  json.mcp ||= {};
  for (const server of servers) {
    json.mcp[server.name] = {
      type: "local",
      command: [server.command, ...server.args],
      environment: server.env,
      enabled: true,
      timeout: 120000
    };
  }
  const mcpBak = existed ? await backup(paths.kilocodeMcp) : null;
  if (mcpBak) backups.push(mcpBak);
  await fs.writeFile(paths.kilocodeMcp, JSON.stringify(json, null, 2) + "\n", "utf8");
  for (const item of files.slice(1)) {
    await ensureParent(item.path);
    const bak = await backup(item.path);
    if (bak) backups.push(bak);
    await fs.copyFile(item.src, item.path);
  }
  return { ok: true, status: "written", files: files.map((f) => f.path), backups };
}

async function writeWindsurf(opts) {
  const mcp = await upsertJsonMcp(opts.paths.windsurf, opts);
  const rulesSrc = path.join(opts.repoRoot, "examples", "windsurf", "streamhooks", ".windsurfrules");
  const rulesDest = path.join(opts.workspaceRoot, ".windsurfrules");
  if (opts.dryRun) return { ok: true, status: "planned", files: [opts.paths.windsurf, rulesDest] };
  await ensureParent(rulesDest);
  const rulesBak = await backup(rulesDest);
  await fs.copyFile(rulesSrc, rulesDest);
  return { ok: true, status: "written", files: [opts.paths.windsurf, rulesDest], backups: [mcp.backup, rulesBak].filter(Boolean) };
}

async function writeVscode({ workspaceRoot, paths, repoRoot, servers, dryRun }) {
  const files = [
    paths.vscodeMcp,
    path.join(workspaceRoot, ".github", "copilot-instructions.md")
  ];
  if (dryRun) return { ok: true, status: "planned", files };
  await ensureParent(paths.vscodeMcp);
  const { json, existed } = await readJsonConfig(paths.vscodeMcp, { servers: {} });
  json.servers ||= {};
  for (const server of servers) {
    json.servers[server.name] = {
      type: "stdio",
      command: server.command,
      args: server.args,
      env: server.env
    };
  }
  const bak = existed ? await backup(paths.vscodeMcp) : null;
  await fs.writeFile(paths.vscodeMcp, JSON.stringify(json, null, 2) + "\n", "utf8");
  const instructionsSrc = path.join(repoRoot, "examples", "vscode", "streamhooks", ".github", "copilot-instructions.md");
  const instructionsDest = files[1];
  await ensureParent(instructionsDest);
  const instructionsBak = await backup(instructionsDest);
  await fs.copyFile(instructionsSrc, instructionsDest);
  return { ok: true, status: "written", files, backups: [bak, instructionsBak].filter(Boolean) };
}

async function writeClaudeCode({ workspaceRoot, servers, dryRun, commandRunner }) {
  const command = process.platform === "win32" ? "claude.exe" : "claude";
  const commands = servers.map((server) => ({
    command,
    args: [
      "mcp", "add", "--transport", "stdio", server.name, "--scope", "user",
      "--env", "MCP_LOCK_WORKSPACE=" + workspaceRoot,
      "--", server.command, ...server.args
    ]
  }));
  if (dryRun) return { ok: true, status: "planned", commands };
  for (const item of commands) {
    let result = commandRunner(item.command, item.args, { encoding: "utf8", shell: false });
    if (result.error?.code === "ENOENT") {
      return { ok: true, status: "skipped", reason: "claude CLI not found", commands };
    }
    if (result.status !== 0 && /already exists/i.test(result.stderr || "")) {
      const configuredServerName = item.args[4];
      const removed = commandRunner(
        item.command,
        ["mcp", "remove", configuredServerName, "--scope", "user"],
        { encoding: "utf8", shell: false }
      );
      if (removed.status !== 0) {
        return { ok: false, status: "error", error: "claude mcp remove exited " + removed.status };
      }
      result = commandRunner(item.command, item.args, { encoding: "utf8", shell: false });
    }
    if (result.status !== 0) {
      return { ok: false, status: "error", error: "claude mcp add exited " + result.status };
    }
  }
  return { ok: true, status: "written", commands };
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

async function writeAnthropicSdkExample({ workspaceRoot, servers, paths, dryRun }) {
  const file = path.join(paths.anthropicDir, "anthropic-sdk-example.mjs");
  if (dryRun) return planned(file);
  await ensureParent(file);
  const bak = await backup(file);
  const sdkServers = Object.fromEntries(servers.map((server) => [server.name, {
    type: "stdio",
    command: server.command,
    args: server.args,
    env: server.env,
  }]));
  const body = `// HermesProof MCP example for the Claude Code SDK.\n` +
    `// Current Anthropic docs show: import { query } from "@anthropic-ai/claude-code".\n` +
    `// Set ANTHROPIC_API_KEY in your shell before running; do not store it here.\n` +
    `import { query } from "@anthropic-ai/claude-code";\n\n` +
    `if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is required at runtime");\n\n` +
    `for await (const message of query({\n` +
    `  prompt: "Run hermes_doctor and summarize the workspace status.",\n` +
    `  options: {\n` +
    `    mcpServers: ${JSON.stringify(sdkServers, null, 6)},\n` +
    `    allowedTools: ["mcp__hermes3d-locks__hermes_doctor"]\n` +
    `  }\n` +
    `})) {\n` +
    `  if (message.type === "result") console.log(message.result);\n` +
    `}\n`;
  await fs.writeFile(file, body, "utf8");
  return written(file, bak);
}

async function writeLocalModelProviders({ paths, dryRun }) {
  const file = paths.localModelProviders;
  if (dryRun) return planned(file);
  await ensureParent(file);
  const { json, existed } = await readJsonConfig(file, { schema: "hermesproof.local-model-providers.v1" });
  const next = {
    ...json,
    schema: "hermesproof.local-model-providers.v1",
    routing: {
      preferred: "lm-studio-lm-link",
      fallback: "ollama",
      requireToolCalling: true,
      failClosedOnToolSchemaMismatch: true
    },
    providers: {
      ...(json.providers || {}),
      "lm-studio-lm-link": {
        kind: "openai-compatible",
        baseUrl: "http://127.0.0.1:1234/v1",
        healthUrl: "http://127.0.0.1:1234/api/v1/models",
        linkStatusCommand: ["lms", "link", "status", "--json"],
        preferred: true
      },
      ollama: {
        kind: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        healthUrl: "http://127.0.0.1:11434/api/tags",
        fallback: true
      }
    }
  };
  if (JSON.stringify(json) === JSON.stringify(next)) return skipped(file);
  const bak = existed ? await backup(file) : null;
  await fs.writeFile(file, JSON.stringify(next, null, 2) + "\n", "utf8");
  return written(file, bak);
}

async function writeDevinExport({ paths, servers, dryRun }) {
  const file = paths.devinExport;
  if (dryRun) return planned(file);
  await ensureParent(file);
  const existed = await fileExists(file);
  const bak = existed ? await backup(file) : null;
  const body = {
    schema: "hermesproof.devin-mcp-install.v1",
    destination: "Devin Settings > MCP Marketplace > Add Your Own",
    instructions: [
      "Create one STDIO entry for each server below in the Devin environment that has this GitLab repository checked out.",
      "Save each entry, then use Test listing tools before enabling it for sessions.",
      "Keep workspace paths inside the checked-out project and do not paste secrets into this export."
    ],
    servers: servers.map((server) => ({
      name: server.name,
      transport: "STDIO",
      command: server.command,
      args: server.args,
      env_variables: server.env
    }))
  };
  await fs.writeFile(file, JSON.stringify(body, null, 2) + "\n", "utf8");
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

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
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
