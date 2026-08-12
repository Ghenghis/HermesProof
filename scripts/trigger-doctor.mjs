#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { HermesLockManager } from "../src/core/lock-manager.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--workspace") out.workspace = argv[++i];
    else if (arg === "--keep") out.keep = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

export async function runTriggerDoctor({ workspace, keep = false } = {}) {
  const created = !workspace;
  const root = path.resolve(workspace || await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-trigger-")));
  await fs.mkdir(root, { recursive: true });
  if (!await exists(path.join(root, ".git"))) {
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
    await fs.writeFile(path.join(root, "README.md"), "# Trigger sandbox\n", "utf8");
    spawnSync("git", ["add", "-A"], { cwd: root });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: root });
  }
  const manager = new HermesLockManager({ workspaceRoot: root });
  await manager.init();
  const doctor = await manager.doctor();
  const events = await manager.listEvents({ status: "all", limit: 10 });
  const result = {
    trigger_doctor_schema_version: 1,
    ok: doctor.ok === true,
    workspace: root,
    doctor,
    event_dirs: {
      outbox: await exists(path.join(root, ".hermes3d_orchestrator", "events", "outbox")),
      handled: await exists(path.join(root, ".hermes3d_orchestrator", "events", "handled")),
      failed: await exists(path.join(root, ".hermes3d_orchestrator", "events", "failed"))
    },
    event_count: events.events.length
  };
  result.checks = [
    { id: "doctor.ok", ok: doctor.ok === true },
    { id: "events.directory_present", ok: Object.values(result.event_dirs).every(Boolean) }
  ];
  result.ok = result.ok && Object.values(result.event_dirs).every(Boolean);
  if (created && !keep) await fs.rm(root, { recursive: true, force: true });
  return result;
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/trigger-doctor.mjs [--workspace <path>] [--keep]");
    process.exit(0);
  }
  try {
    const result = await runTriggerDoctor(args);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  }
}
