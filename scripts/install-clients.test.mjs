import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { writeClients } from "./wizard-writers.mjs";
import { installClients } from "./install-clients.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Windows-first install writes both HermesProof servers to the supported client matrix", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-clients-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, "home");
  const workspaceRoot = path.join(root, "workspace");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: path.join(homeDir, "AppData", "Roaming"),
    HERMESPROOF_TEST_HOME: homeDir
  };

  const targets = ["kilocode", "lm-studio", "ollama", "codex", "windsurf", "vscode", "cursor", "devin"];
  const result = await writeClients({
    clients: targets,
    workspaceRoot,
    repoRoot,
    env,
    homeDir
  });
  assert.deepEqual(result.selected, targets);
  assert.equal(result.snapshot.finalized, true);
  assert.match(result.snapshot.manifestFile, /backups[\\/]clients/);
  for (const target of targets) assert.equal(result.results[target].ok, true, target);
  assert.equal(result.rollback, null);

  const kilo = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".kilo", "kilo.json"), "utf8"));
  assert.deepEqual(Object.keys(kilo.mcp).sort(), ["hermes3d-locks", "hp-mha-serena"]);
  assert.deepEqual(kilo.mcp["hermes3d-locks"].command.slice(0, 1), ["node"]);
  assert.equal(kilo.mcp["hermes3d-locks"].enabled, true);
  assert.equal(kilo.mcp["hp-mha-serena"].enabled, true);

  const lmStudio = JSON.parse(await fs.readFile(path.join(homeDir, ".lmstudio", "mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(lmStudio.mcpServers).sort(), ["hermes3d-locks", "hp-mha-serena"]);
  const localModels = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".hermesproof", "local-models.json"), "utf8"));
  assert.equal(localModels.routing.preferred, "lm-studio-lm-link");
  assert.equal(localModels.routing.fallback, "ollama");
  assert.deepEqual(localModels.providers["lm-studio-lm-link"].linkStatusCommand, ["lms", "link", "status", "--json"]);

  const windsurf = JSON.parse(await fs.readFile(path.join(homeDir, ".codeium", "windsurf", "mcp_config.json"), "utf8"));
  assert.deepEqual(Object.keys(windsurf.mcpServers).sort(), ["hermes3d-locks", "hp-mha-serena"]);

  const vscode = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".vscode", "mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(vscode.servers).sort(), ["hermes3d-locks", "hp-mha-serena"]);

  const cursor = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".cursor", "mcp.json"), "utf8"));
  assert.deepEqual(Object.keys(cursor.mcpServers).sort(), ["hermes3d-locks", "hp-mha-serena"]);

  const codex = await fs.readFile(path.join(homeDir, ".codex", "config.toml"), "utf8");
  assert.match(codex, /\[mcp_servers\.hermes3d-locks\]/);
  assert.match(codex, /\[mcp_servers\.hp-mha-serena\]/);

  const devin = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".hermesproof", "devin", "mcp-install.json"), "utf8"));
  assert.equal(devin.schema, "hermesproof.devin-mcp-install.v1");
  assert.deepEqual(devin.servers.map((server) => server.name), ["hermes3d-locks", "hp-mha-serena"]);
  assert.ok(devin.instructions.some((line) => line.includes("Test listing tools")));
});

test("installer preserves unrelated client configuration and is idempotent", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-clients-preserve-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, "home");
  const workspaceRoot = path.join(root, "workspace");
  const appData = path.join(homeDir, "AppData", "Roaming");
  const windsurfFile = path.join(homeDir, ".codeium", "windsurf", "mcp_config.json");
  await fs.mkdir(path.dirname(windsurfFile), { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(windsurfFile, JSON.stringify({ mcpServers: { existing: { command: "safe-existing" } }, theme: "dark" }), "utf8");
  const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir, APPDATA: appData, HERMESPROOF_TEST_HOME: homeDir };

  await writeClients({ clients: ["windsurf"], workspaceRoot, repoRoot, env, homeDir });
  await writeClients({ clients: ["windsurf"], workspaceRoot, repoRoot, env, homeDir });
  const parsed = JSON.parse(await fs.readFile(windsurfFile, "utf8"));
  assert.equal(parsed.theme, "dark");
  assert.equal(parsed.mcpServers.existing.command, "safe-existing");
  assert.equal(Object.keys(parsed.mcpServers).length, 3);
});

test("managed install pins every client entry to the stable launcher and returns a restorable allowlist", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-managed-clients-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, "home");
  const workspaceRoot = path.join(root, "workspace");
  const launcherPath = path.join(root, "managed", "bin", "hermesproof-launch.mjs");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: path.join(homeDir, "AppData", "Roaming"),
    HERMESPROOF_TEST_HOME: homeDir
  };

  const result = await writeClients({
    clients: ["kilocode", "lm-studio", "codex"],
    workspaceRoot,
    repoRoot,
    launcherPath,
    env,
    homeDir
  });
  assert.equal(result.snapshot.finalized, true);
  assert.deepEqual(result.snapshot.allowedFiles.sort(), result.snapshot.entries.map((entry) => entry.file).sort());
  const kilo = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".kilo", "kilo.json"), "utf8"));
  for (const [serverName, entry] of Object.entries(kilo.mcp)) {
    assert.deepEqual(entry.command, ["node", launcherPath, "--server", serverName]);
    assert.equal(entry.environment.HERMESPROOF_MANAGED_ROOT, path.join(homeDir, ".hermesproof-managed"));
  }
  const codex = await fs.readFile(path.join(homeDir, ".codex", "config.toml"), "utf8");
  assert.equal(codex.includes(launcherPath.replace(/\\/g, "\\\\")), true);
});

test("non-interactive installer accepts a stable launcher path", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-client-cli-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, "home");
  const workspaceRoot = path.join(root, "workspace");
  const launcherPath = path.join(root, "managed", "bin", "hermesproof-launch.mjs");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: path.join(homeDir, "AppData", "Roaming"),
    HERMESPROOF_TEST_HOME: homeDir,
  };
  const result = await installClients([
    "--workspace", workspaceRoot, "--targets", "kilocode", "--launcher", launcherPath,
  ], env);
  assert.equal(result.ok, true);
  const kilo = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".kilo", "kilo.json"), "utf8"));
  assert.deepEqual(kilo.mcp["hermes3d-locks"].command, ["node", launcherPath, "--server", "hermes3d-locks"]);
  assert.deepEqual(kilo.mcp["hp-mha-serena"].command, ["node", launcherPath, "--server", "hp-mha-serena"]);
});

test("Claude Code receives both servers and LM Studio alone receives the LM Link/Ollama route", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-client-gaps-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, "home");
  const workspaceRoot = path.join(root, "workspace");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: path.join(homeDir, "AppData", "Roaming"),
    HERMESPROOF_TEST_HOME: homeDir
  };
  const calls = [];
  const result = await writeClients({
    clients: ["claude-code", "lm-studio"],
    workspaceRoot,
    repoRoot,
    env,
    homeDir,
    commandRunner: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: "added", stderr: "" };
    }
  });
  assert.equal(result.results["claude-code"].ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.args[4]).sort(), ["hermes3d-locks", "hp-mha-serena"]);
  const localModels = JSON.parse(await fs.readFile(path.join(workspaceRoot, ".hermesproof", "local-models.json"), "utf8"));
  assert.equal(localModels.routing.preferred, "lm-studio-lm-link");
  assert.equal(localModels.routing.fallback, "ollama");
});

test("Anthropic SDK example includes both governed MCP servers", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-anthropic-sdk-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, "home");
  const workspaceRoot = path.join(root, "workspace");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir, APPDATA: path.join(homeDir, "AppData", "Roaming"), HERMESPROOF_TEST_HOME: homeDir };
  const result = await writeClients({ clients: ["anthropic-sdk"], workspaceRoot, repoRoot, env, homeDir });
  assert.equal(result.results["anthropic-sdk"].ok, true);
  const example = await fs.readFile(path.join(workspaceRoot, ".hermesproof", "anthropic-sdk-example.mjs"), "utf8");
  assert.match(example, /"hermes3d-locks"/);
  assert.match(example, /"hp-mha-serena"/);
});
