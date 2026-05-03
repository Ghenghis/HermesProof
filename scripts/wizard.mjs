#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { HermesLockManager } from "../src/core/lock-manager.mjs";
import { CLIENT_IDS, detectClients, platformLabel, resolveHome } from "./wizard-detectors.mjs";
import { confirm, createPromptSession, pathWithCompletion, pickFromList } from "./wizard-prompts.mjs";
import { writeClients } from "./wizard-writers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KNOWN_SECRET_ENV = [
  "ANTHROPIC_API_KEY",
  "CODERABBIT_API_KEY",
  "GITHUB_TOKEN",
  "MINIMAX_API_KEY",
  "DEEPSEEK_API_KEY",
  "HF_TOKEN",
  "AZURE_SPEECH_KEY",
  "SILICONFLOW_API_KEY"
];

export async function runWizard(argv = process.argv.slice(2), { env = process.env, output = console } = {}) {
  const args = parseArgs(argv);
  const secrets = secretValues(env);
  const lines = [];
  const emit = (line = "") => {
    const clean = redact(line, secrets);
    lines.push(clean);
    if (!args.json) output.log(clean);
  };

  try {
    if (args.help) {
      emit(helpText());
      return { ok: true, exitCode: 0, lines };
    }

    emit("HermesProof Setup Wizard");
    emit("────────────────────────");
    emit(`Detected: ${platformLabel()} · Node ${process.version} · git ${gitVersion() || "not found"}`);

    const workspaceRoot = await resolveWorkspace(args, env, emit);
    const github = await handleGithub(args, workspaceRoot, env, emit);
    const detections = await detectClients({ workspaceRoot, env, homeDir: resolveHome(env) });
    printDetections(detections, emit);

    const selectedClients = await selectClients(args, detections, emit);
    emit(`Wire all detected? ${selectedClients.length ? selectedClients.join(",") : "none"}`);

    emit("");
    emit("Writing configs");
    const writeResult = await writeClients({
      clients: selectedClients,
      workspaceRoot,
      repoRoot,
      dryRun: args.dryRun,
      env,
      homeDir: resolveHome(env),
      force: args.force
    });
    for (const [client, result] of Object.entries(writeResult.results)) {
      emit(`  ${result.ok ? "✓" : "✗"} ${client.padEnd(18)} ${result.status}${result.file ? ` ${result.file}` : ""}`);
      if (result.error) emit(`    ${result.error}`);
    }

    const bootstrap = await bootstrapWorkspace({ workspaceRoot, dryRun: args.dryRun });
    emit("");
    emit("Bootstrap workspace");
    emit(`  ${bootstrap.ok ? "✓" : "✗"} ${bootstrap.status}`);

    const doctor = await runDoctor({ workspaceRoot, dryRun: args.dryRun });
    emit("");
    emit("Verify");
    emit(`  ${doctor.ok ? "✓" : "✗"} doctor: ${doctor.status}`);

    const truthGates = await runTruthGates({ workspaceRoot, args, env });
    emit(`  ${truthGates.ok ? "✓" : "✗"} truth-gates: ${truthGates.status}`);
    if (truthGates.details) emit(`    ${truthGates.details}`);

    emit("");
    emit("Done");
    emit("");
    emit("First message to send any agent:");
    emit(`Use hermes_doctor and hermes_read_policy. Confirm workspace_root=${workspaceRoot}.`);
    emit("Then claim_task + lock_files before editing anything. My owner string: codex-impl-01.");

    const summary = {
      ok: doctor.ok && truthGates.ok && Object.values(writeResult.results).every((r) => r.ok !== false),
      workspace_root: workspaceRoot,
      dry_run: args.dryRun,
      github,
      selected_clients: selectedClients,
      results: writeResult.results,
      bootstrap,
      doctor,
      truth_gates: truthGates
    };
    if (args.json) output.log(redact(JSON.stringify(summary, null, 2), secrets));
    return { ...summary, exitCode: summary.ok ? 0 : 1, lines };
  } catch (err) {
    const summary = { ok: false, error: redact(err.message, secrets), lines };
    if (args.json) output.log(JSON.stringify(summary, null, 2));
    else output.error(`ERROR: ${summary.error}`);
    return { ...summary, exitCode: 1 };
  }
}

export function parseArgs(argv) {
  const out = { clients: [], truthGates: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--workspace") out.workspace = argv[++i];
    else if (arg === "--github") out.github = argv[++i];
    else if (arg === "--clients") out.clients = csv(argv[++i]);
    else if (arg === "--no-truth-gates") out.truthGates = false;
    else if (arg === "--json") out.json = true;
    else if (arg === "--yes" || arg === "-y") out.yes = true;
    else if (arg === "--force") out.force = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

async function resolveWorkspace(args, env, emit) {
  let input = args.workspace;
  let rl;
  if (!input && !args.yes) {
    rl = createPromptSession();
    input = await pathWithCompletion(rl, "Where is the project HermesProof should govern?", process.cwd());
    rl.close();
  }
  input ||= process.cwd();
  const expanded = expandPath(input, env);
  validateWorkspacePath(expanded);
  const workspaceRoot = path.resolve(expanded);
  const exists = await pathExists(workspaceRoot);
  if (!exists) {
    if (args.dryRun) {
      emit(`Workspace path: ${workspaceRoot} (would create)`);
    } else if (args.yes) {
      await fs.mkdir(workspaceRoot, { recursive: true });
      emit(`Workspace path: ${workspaceRoot} (created)`);
    } else {
      const rl = createPromptSession();
      const ok = await confirm(rl, `Create ${workspaceRoot}?`, false);
      rl.close();
      if (!ok) throw new Error("workspace_missing");
      await fs.mkdir(workspaceRoot, { recursive: true });
    }
  } else {
    emit(`Workspace path: ${workspaceRoot}`);
  }
  return workspaceRoot;
}

async function handleGithub(args, workspaceRoot, env, emit) {
  if (!args.github) {
    emit("GitHub repo: skipped");
    return { status: "skipped" };
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(args.github)) {
    throw new Error("github repo must be owner/name");
  }
  const gitDir = path.join(workspaceRoot, ".git");
  if (await pathExists(gitDir)) {
    emit(`GitHub repo: workspace already has .git; left unchanged (${args.github})`);
    return { status: "existing_git", repo: args.github };
  }
  if (args.dryRun) {
    emit(`GitHub repo: would clone ${args.github}`);
    return { status: "planned_clone", repo: args.github };
  }
  const useGh = commandOk("gh", ["auth", "status"], env);
  const command = useGh ? "gh" : "git";
  const cmdArgs = useGh
    ? ["repo", "clone", args.github, workspaceRoot]
    : ["clone", `https://github.com/${args.github}.git`, workspaceRoot];
  const result = spawnSync(command, cmdArgs, { encoding: "utf8", env, shell: false });
  if (result.status !== 0) {
    throw new Error(`github_clone_failed: ${(result.stderr || result.stdout || "").slice(-400).trim()}`);
  }
  emit(`GitHub repo: cloned ${args.github}`);
  return { status: "cloned", repo: args.github };
}

async function selectClients(args, detections, emit) {
  if (args.clients.length) {
    for (const client of args.clients) {
      if (!CLIENT_IDS.includes(client) && client !== "claude-code-hooks") throw new Error(`unsupported client: ${client}`);
    }
    return args.clients;
  }
  const detected = Object.values(detections).filter((item) => item.detected).map((item) => item.id);
  if (args.yes || args.dryRun) {
    return detected.length ? detected : ["claude-desktop", "claude-code", "codex", "windsurf", "cursor", "vscode-copilot"];
  }
  const rl = createPromptSession();
  const picked = await pickFromList(rl, "Clients to wire", Object.values(detections), Object.values(detections).filter((item) => item.detected));
  rl.close();
  return picked.map((item) => item.id);
}

function printDetections(detections, emit) {
  emit("");
  emit("Detected clients:");
  for (const item of Object.values(detections)) {
    emit(`  ${item.detected ? "✓" : "✗"} ${item.label}${item.version ? ` (${item.version})` : ""}`);
  }
}

async function bootstrapWorkspace({ workspaceRoot, dryRun }) {
  if (dryRun) return { ok: true, status: "planned" };
  const manager = new HermesLockManager({ workspaceRoot });
  await manager.init();
  return { ok: true, status: ".hermes3d_orchestrator initialized" };
}

async function runDoctor({ workspaceRoot, dryRun }) {
  if (dryRun) return { ok: true, status: "planned" };
  const manager = new HermesLockManager({ workspaceRoot });
  const doctor = await manager.doctor();
  return { ok: doctor.ok, status: `ok=${doctor.ok}`, checks: doctor.checks };
}

async function runTruthGates({ workspaceRoot, args, env }) {
  if (!args.truthGates) return { ok: true, status: "skipped (--no-truth-gates)" };
  if (args.dryRun) return { ok: true, status: "planned truth-gates --ci" };
  const result = spawnSync(
    process.platform === "win32" ? "node.exe" : "node",
    [path.join(repoRoot, "scripts", "truth-gates.mjs"), "--ci", "--workspace", workspaceRoot],
    { cwd: repoRoot, encoding: "utf8", env, shell: false }
  );
  const text = `${result.stdout || ""}${result.stderr || ""}`;
  const pass = text.match(/Pass:\s+(\d+)/)?.[1];
  const fail = text.match(/Fail:\s+(\d+)/)?.[1];
  const skip = text.match(/Skip:\s+(\d+)/)?.[1];
  return {
    ok: result.status === 0,
    status: result.status === 0 ? "passed" : `failed exit=${result.status}`,
    details: pass ? `${pass} pass / ${fail} fail / ${skip} skip` : text.slice(-300)
  };
}

export function validateWorkspacePath(value) {
  if (typeof value !== "string" || !value.trim()) throw new Error("workspace path is required");
  if (/[\u0000-\u001f]/.test(value)) throw new Error("workspace path contains control characters");
  if (!path.isAbsolute(value)) throw new Error("workspace path must be absolute");
  if (path.basename(path.resolve(value)).toLowerCase() === ".git") throw new Error("workspace path must be the project root, not .git");
}

function expandPath(value, env) {
  let out = value.trim();
  if (out === "~" || out.startsWith("~/") || out.startsWith("~\\")) {
    out = path.join(env.HOME || env.USERPROFILE || os.homedir(), out.slice(2));
  }
  out = out.replace(/^%USERPROFILE%/i, env.USERPROFILE || os.homedir());
  return path.resolve(out);
}

function gitVersion() {
  const result = spawnSync("git", ["--version"], { encoding: "utf8", shell: false });
  return result.status === 0 ? result.stdout.trim() : "";
}

function commandOk(command, args, env) {
  const result = spawnSync(command, args, { encoding: "utf8", env, shell: false });
  return !result.error && result.status === 0;
}

function csv(value = "") {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function pathExists(value) {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}

function secretValues(env) {
  return KNOWN_SECRET_ENV.map((key) => env[key]).filter((value) => typeof value === "string" && value.length >= 4);
}

function redact(text, secrets) {
  let out = String(text);
  for (const secret of secrets) out = out.split(secret).join("[REDACTED]");
  return out;
}

function helpText() {
  return `Usage: node scripts/wizard.mjs [options]\n\n` +
    `  --dry-run                 show the plan without writing\n` +
    `  --workspace <path>        workspace HermesProof should govern\n` +
    `  --github <owner/repo>     optional GitHub repo to clone/link\n` +
    `  --clients <csv>           claude-desktop,claude-code,codex,windsurf,cursor,vscode-copilot,anthropic-sdk\n` +
    `  --no-truth-gates          skip post-install truth-gates --ci\n` +
    `  --json                    machine-readable output\n` +
    `  --yes                     accept defaults for non-interactive runs`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runWizard();
  process.exit(result.exitCode);
}
