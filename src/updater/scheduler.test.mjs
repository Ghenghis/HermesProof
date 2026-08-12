import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  autoUpdateDecision,
  deterministicJitterMinutes
} from "./scheduler.mjs";
import {
  WINDOWS_TASK_NAME,
  createWindowsTaskScheduler
} from "./windows-task-scheduler.mjs";
import fs from "node:fs/promises";
import os from "node:os";
import { createSystemdUserTimer } from "./systemd-user-timer.mjs";

test("automatic update cadence uses stable per-machine jitter and exponential failure backoff", () => {
  const first = deterministicJitterMinutes("machine-a", 45);
  assert.equal(first, deterministicJitterMinutes("machine-a", 45));
  assert.ok(first >= 0 && first <= 45);
  assert.notEqual(first, deterministicJitterMinutes("machine-b", 45));

  const base = {
    now: new Date("2026-08-09T18:30:00.000Z"),
    lastAttemptUtc: "2026-08-09T12:00:00.000Z",
    cadenceHours: 6,
    jitterMinutes: 0,
    machineId: "machine-a"
  };
  assert.equal(autoUpdateDecision({ ...base, consecutiveFailures: 0 }).due, true);
  const backedOff = autoUpdateDecision({ ...base, consecutiveFailures: 3 });
  assert.equal(backedOff.due, false);
  assert.equal(backedOff.backoffHours, 8);
});

test("automatic update can catch a missed run but honors maintenance windows and preview opt-in", () => {
  const due = autoUpdateDecision({
    now: new Date("2026-08-09T20:00:00.000Z"),
    lastAttemptUtc: "2026-08-09T08:00:00.000Z",
    cadenceHours: 6,
    jitterMinutes: 0,
    machineId: "machine-a",
    maintenanceWindowUtc: { startHour: 18, endHour: 23 },
    channel: "stable"
  });
  assert.equal(due.due, true);
  assert.equal(due.missedRun, true);
  assert.throws(
    () => autoUpdateDecision({ ...due, now: new Date(), channel: "preview", previewAcknowledged: false }),
    /preview channel requires explicit acknowledgement/
  );
  const outside = autoUpdateDecision({
    now: new Date("2026-08-09T12:00:00.000Z"),
    lastAttemptUtc: "2026-08-09T00:00:00.000Z",
    cadenceHours: 6,
    jitterMinutes: 0,
    machineId: "machine-a",
    maintenanceWindowUtc: { startHour: 18, endHour: 23 }
  });
  assert.equal(outside.due, false);
  assert.equal(outside.reason, "outside_maintenance_window");
});

test("Windows auto-update task is per-user, idempotent, limited, and removable", async () => {
  const calls = [];
  const runner = async (options) => {
    calls.push(options);
    return { exitCode: 0, stdout: "SUCCESS", stderr: "" };
  };
  const scheduler = createWindowsTaskScheduler({
    nodePath: "C:\\Program Files\\nodejs\\node.exe",
    updaterScript: "C:\\HermesProof Managed\\bin\\hermesproof-update.mjs",
    runner
  });
  await scheduler.install();
  await scheduler.inspect();
  await scheduler.remove();

  assert.equal(calls[0].command.toLowerCase(), "schtasks.exe");
  assert.deepEqual(calls[0].args.slice(0, 4), ["/Create", "/TN", WINDOWS_TASK_NAME, "/SC"]);
  assert.ok(calls[0].args.includes("/RL"));
  assert.ok(calls[0].args.includes("LIMITED"));
  assert.equal(calls[0].args.some((value) => /SYSTEM/i.test(value)), false);
  assert.match(calls[0].args[calls[0].args.indexOf("/TR") + 1], /hermesproof-update\.mjs.*auto/);
  assert.deepEqual(calls[1].args, ["/Query", "/TN", WINDOWS_TASK_NAME, "/FO", "LIST", "/V"]);
  assert.deepEqual(calls[2].args, ["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"]);
  for (const call of calls) assert.equal(call.shell, undefined);
});

test("Linux automatic refresh uses a persistent systemd user timer, never a root unit", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hp-systemd-user-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const adapter = createSystemdUserTimer({
    nodePath: "/usr/bin/node",
    updaterScript: "/home/user/.hermesproof-managed/control/scripts/hermesproof-update.mjs",
    unitDirectory: root,
    runner: async (options) => {
      calls.push(options);
      return { exitCode: 0, stdout: "ok", stderr: "" };
    }
  });
  await adapter.install();
  const service = await fs.readFile(path.join(root, "hermesproof-update.service"), "utf8");
  const timer = await fs.readFile(path.join(root, "hermesproof-update.timer"), "utf8");
  assert.match(service, /^ExecStart=\/usr\/bin\/node .*hermesproof-update\.mjs auto --json$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^OnUnitActiveSec=1h$/m);
  assert.deepEqual(calls[0].args, ["--user", "daemon-reload"]);
  assert.deepEqual(calls[1].args, ["--user", "enable", "--now", "hermesproof-update.timer"]);
  await adapter.inspect();
  await adapter.remove();
  assert.equal(calls.every((call) => call.args[0] === "--user"), true);
  assert.equal(await fs.stat(path.join(root, "hermesproof-update.timer")).then(() => true).catch(() => false), false);
});
