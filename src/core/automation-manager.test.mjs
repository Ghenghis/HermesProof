import test from "node:test";
import assert from "node:assert/strict";

import { AutomationManager } from "./automation-manager.mjs";

const job = {
  id: "deep-doctor",
  description: "Run governed deep doctor",
  runtime_id: "hermesproof",
  action: "doctor.deep",
  interval_minutes: 15,
  timeout_seconds: 300,
  retries: 2
};

test("automation jobs are disabled by default and render Windows plus VPS schedulers", () => {
  const manager = new AutomationManager();
  const registered = manager.register(job);
  assert.equal(registered.job.enabled, false);

  const windows = manager.plan({ jobId: "deep-doctor", platform: "windows" });
  assert.equal(windows.adapter, "windows-task-scheduler");
  assert.ok(windows.arguments.includes("/SC"));
  const taskCommand = windows.arguments[windows.arguments.indexOf("/TR") + 1];
  assert.match(taskCommand, /automation-runner\.mjs/);
  assert.doesNotMatch(taskCommand, /hermesproof automation run/);
  assert.equal(windows.mutates_system, false);

  const linux = manager.plan({ jobId: "deep-doctor", platform: "linux" });
  assert.equal(linux.adapter, "systemd-timer");
  assert.match(linux.timer_unit, /OnUnitActiveSec=15min/);
  assert.match(linux.service_unit, /automation-runner\.mjs/);
  assert.equal(linux.mutates_system, false);
});

test("enabling requires a matching active runtime lease and supports cycle/kill switch", async () => {
  const calls = [];
  const manager = new AutomationManager({
    schedulerAdapter: {
      async enable(plan) { calls.push(["enable", plan.job_id]); },
      async disable(plan) { calls.push(["disable", plan.job_id]); }
    },
    leaseVerifier: async ({ runtimeId, leaseId }) =>
      runtimeId === "hermesproof" && leaseId === "lease-ok"
  });
  manager.register(job);

  await assert.rejects(
    manager.enable({ jobId: "deep-doctor", platform: "windows", leaseId: "bad" }),
    /active runtime lease/i
  );
  await manager.enable({ jobId: "deep-doctor", platform: "windows", leaseId: "lease-ok" });
  await manager.cycle({ jobId: "deep-doctor", platform: "windows", leaseId: "lease-ok" });
  const stopped = await manager.killSwitch({ reason: "operator stop" });
  assert.equal(stopped.disabled, 1);
  assert.deepEqual(calls.map((entry) => entry[0]), ["enable", "disable", "enable", "disable"]);
});

test("unsafe schedules and raw secret-bearing commands fail closed", () => {
  const manager = new AutomationManager();
  assert.throws(
    () => manager.register({ ...job, id: "too-fast", interval_minutes: 0 }),
    /interval/i
  );
  assert.throws(
    () => manager.register({ ...job, id: "secret", action: "deploy --token abc" }),
    /secret|action/i
  );
});
