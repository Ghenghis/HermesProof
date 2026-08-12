#!/usr/bin/env node
/**
 * Non-interactive client installer.
 *
 * This remains the scriptable path; scripts/wizard.mjs is the interactive
 * operator wrapper. Both share scripts/wizard-writers.mjs so config-writing
 * behavior stays identical.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeClients, SUPPORTED_CLIENTS } from "./wizard-writers.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace" || a === "-w") out.workspace = argv[++i];
    else if (a.startsWith("--workspace=")) out.workspace = a.slice("--workspace=".length);
    else if (a === "--server-name") out.serverName = argv[++i];
    else if (a.startsWith("--server-name=")) out.serverName = a.slice("--server-name=".length);
    else if (a === "--targets" || a === "--target") out.targets = argv[++i];
    else if (a.startsWith("--targets=")) out.targets = a.slice("--targets=".length);
    else if (a.startsWith("--target=")) out.targets = a.slice("--target=".length);
    else if (a === "--launcher") out.launcherPath = argv[++i];
    else if (a.startsWith("--launcher=")) out.launcherPath = a.slice("--launcher=".length);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

export async function installClients(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(helpText());
    return { ok: true };
  }
  const workspaceRoot = path.resolve(
    args.workspace ||
      env.MCP_LOCK_WORKSPACE ||
      env.HERMES3D_WORKSPACE ||
      process.cwd()
  );
  const clients = (args.targets || "kilocode,vscode,codex,windsurf,lm-studio,ollama,claude-desktop,claude-code,cursor,devin")
    .split(",")
    .map((target) => target.trim())
    .filter(Boolean);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const log = args.json ? () => {} : console.log;
  log(`== Installing HermesProof dual-server stack ==`);
  log(`workspace    : ${workspaceRoot}`);
  log(`targets      : ${clients.join(", ")}`);
  log("");
  const result = await writeClients({
    clients,
    workspaceRoot,
    repoRoot,
    serverName: args.serverName || env.MCP_LOCK_SERVER_NAME || "hermes3d-locks",
    launcherPath: args.launcherPath ? path.resolve(args.launcherPath) : undefined,
    dryRun: Boolean(args.dryRun),
    env
  });
  for (const [client, value] of Object.entries(result.results)) {
    if (value.error) log(`${client.padEnd(18)} ERROR  ${value.error}`);
    else log(`${client.padEnd(18)} ${value.status.toUpperCase()}`);
  }
  log("");
  log("Restart or refresh each installed MCP host. Kilo Code, LM Studio, Codex, Windsurf, VS Code, and Claude should list both hermes3d-locks and hp-mha-serena.");
  const output = { ok: Object.values(result.results).every((item) => item.ok !== false), ...result };
  if (args.json) process.stdout.write(JSON.stringify(output) + "\n");
  return output;
}

function helpText() {
  return `Install both HermesProof MCP servers plus LM Link/Ollama routing into supported client configs.\n\n` +
    `Usage:\n` +
    `  node scripts/install-clients.mjs --workspace <path> [--server-name <id>] [--targets <list>] [--launcher <path>]\n\n` +
    `Available targets:\n` +
    `  ${SUPPORTED_CLIENTS.join(", ")}, vscode\n` +
    `  claude-code-hooks\n\n` +
    `--targets defaults to: kilocode,vscode,codex,windsurf,lm-studio,ollama,claude-desktop,claude-code,cursor,devin`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await installClients();
  process.exit(result.ok ? 0 : 1);
}
