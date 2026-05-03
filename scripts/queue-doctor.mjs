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

export async function runQueueDoctor({ workspace, keep = false } = {}) {
  const created = !workspace;
  const root = path.resolve(workspace || await fs.mkdtemp(path.join(os.tmpdir(), "hermesproof-queue-")));
  await prepareWorkspace(root);
  const manager = new HermesLockManager({ workspaceRoot: root });
  await manager.init();
  const checks = [];
  const run = Date.now().toString(36);

  const dirs = {
    pending: path.join(root, ".hermes3d_orchestrator", "tasks", "pending"),
    claimed: path.join(root, ".hermes3d_orchestrator", "tasks", "claimed"),
    blocked: path.join(root, ".hermes3d_orchestrator", "tasks", "blocked"),
    done: path.join(root, ".hermes3d_orchestrator", "tasks", "done")
  };
  const dirChecks = {};
  for (const [name, dir] of Object.entries(dirs)) {
    dirChecks[name] = await isWritableDir(dir);
  }
  checks.push({ id: "tasks.directory_present", ok: Object.values(dirChecks).every(Boolean), details: dirChecks });

  const round = await manager.enqueueTask({
    task_id: `QUEUE-ROUNDTRIP-${run}`,
    title: "Round trip",
    summary: "queue doctor round trip",
    enqueued_by: "queue-doctor",
    target_owner_pattern: "^codex-[a-z0-9-]+$"
  });
  const picked = await manager.pickTask({ owner: "codex-doctor", prefer_task_id: `QUEUE-ROUNDTRIP-${run}` });
  const done = await manager.releaseTask({ owner: "codex-doctor", taskId: `QUEUE-ROUNDTRIP-${run}`, note: "doctor done" });
  checks.push({ id: "queue.round_trip", ok: round.ok && picked.ok && done.ok && done.status === "done" });

  await manager.enqueueTask({
    task_id: `QUEUE-MISMATCH-${run}`,
    title: "Mismatch",
    target_owner_pattern: "^claude-.*$",
    enqueued_by: "queue-doctor"
  });
  const mismatch = await manager.pickTask({ owner: "codex-doctor", prefer_task_id: `QUEUE-MISMATCH-${run}` });
  checks.push({ id: "queue.owner_pattern_rejection", ok: mismatch.ok === false && mismatch.status === "task_owner_mismatch" });

  for (const [id, priority] of [[`QUEUE-P1-${run}`, 1], [`QUEUE-P5-${run}`, 5], [`QUEUE-P3-${run}`, 3]]) {
    await manager.enqueueTask({ task_id: id, title: id, priority, enqueued_by: "queue-doctor" });
  }
  const first = await manager.pickTask({ owner: "any-owner" });
  const second = await manager.pickTask({ owner: "any-owner" });
  const third = await manager.pickTask({ owner: "any-owner" });
  checks.push({
    id: "queue.priority_order",
    ok: first.task?.task_id === `QUEUE-P5-${run}` && second.task?.task_id === `QUEUE-P3-${run}` && third.task?.task_id === `QUEUE-P1-${run}`
  });

  await manager.enqueueTask({
    task_id: `QUEUE-STALE-${run}`,
    title: "Stale",
    ttl_minutes: 1,
    enqueued_by: "queue-doctor"
  });
  const stalePick = await manager.pickTask({ owner: "codex-doctor", prefer_task_id: `QUEUE-STALE-${run}` });
  stalePick.task.heartbeat_utc = new Date(Date.now() - 120_000).toISOString();
  stalePick.task.claimed_utc = stalePick.task.heartbeat_utc;
  await fs.writeFile(
    path.join(dirs.claimed, `QUEUE-STALE-${run}.json`),
    JSON.stringify(stalePick.task, null, 2) + "\n",
    "utf8"
  );
  const recovered = await manager.recoverStaleTasks({ owner: "queue-doctor", note: "doctor recovery" });
  const repicked = await manager.pickTask({ owner: "codex-doctor", prefer_task_id: `QUEUE-STALE-${run}` });
  checks.push({
    id: "queue.stale_recovery",
    ok: recovered.recovered.includes(`QUEUE-STALE-${run}`) && repicked.ok === true
  });

  const result = {
    queue_doctor_schema_version: 1,
    ok: checks.every((check) => check.ok),
    workspace: root,
    checks
  };
  if (created && !keep) await fs.rm(root, { recursive: true, force: true });
  return result;
}

async function prepareWorkspace(root) {
  await fs.mkdir(root, { recursive: true });
  if (!await exists(path.join(root, ".git"))) {
    spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
    await fs.writeFile(path.join(root, "README.md"), "# Queue sandbox\n", "utf8");
    spawnSync("git", ["add", "-A"], { cwd: root });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: root });
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function isWritableDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.probe-${Date.now()}`);
    await fs.writeFile(probe, "ok", "utf8");
    await fs.rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/queue-doctor.mjs [--workspace <path>] [--keep]");
    process.exit(0);
  }
  try {
    const result = await runQueueDoctor(args);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  }
}
