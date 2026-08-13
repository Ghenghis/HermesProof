import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AutomationManager,
  verifyAutomationExecutionAuthorization
} from "./automation-manager.mjs";

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
    leaseVerifier: async ({ runtimeId, leaseId, owner }) =>
      runtimeId === "hermesproof" && leaseId === "lease-ok" && owner === "owner-a"
        ? { owner: "owner-a", task_id: "task-a" }
        : false
  });
  manager.register(job);

  await assert.rejects(
    manager.enable({ jobId: "deep-doctor", platform: "windows", leaseId: "bad", owner: "owner-a" }),
    /active runtime lease/i
  );
  await manager.enable({ jobId: "deep-doctor", platform: "windows", leaseId: "lease-ok", owner: "owner-a" });
  await assert.rejects(
    manager.cycle({ jobId: "deep-doctor", platform: "windows", leaseId: "bad", owner: "owner-a" }),
    /active runtime lease/i
  );
  assert.equal(manager.status().jobs[0].enabled, true);
  assert.deepEqual(calls.map((entry) => entry[0]), ["enable"]);
  await manager.cycle({ jobId: "deep-doctor", platform: "windows", leaseId: "lease-ok", owner: "owner-a" });
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

test("enabled automation survives restart and kill switch disables the native job", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hp-automation-durable-"));
  const calls = [];
  const schedulerAdapter = {
    async enable(plan) { calls.push(["enable", plan.job_id]); },
    async disable(plan) { calls.push(["disable", plan.job_id]); }
  };
  const leaseVerifier = async () => ({ owner: "owner-a", task_id: "task-a" });
  try {
    const first = new AutomationManager({ workspaceRoot, schedulerAdapter, leaseVerifier });
    await first.init();
    first.register(job);
    await first.enable({ jobId: job.id, platform: "windows", leaseId: "lease-a", owner: "owner-a" });

    const restarted = new AutomationManager({ workspaceRoot, schedulerAdapter, leaseVerifier });
    await restarted.init();
    const restored = restarted.register(job);
    assert.equal(restored.job.enabled, true);
    assert.equal(restored.job.platform, "windows");
    const stopped = await restarted.killSwitch({ reason: "restart-safe stop" });
    assert.equal(stopped.disabled, 1);
    assert.deepEqual(calls.map((entry) => entry[0]), ["enable", "disable"]);

    const third = new AutomationManager({ workspaceRoot, schedulerAdapter, leaseVerifier });
    await third.init();
    const disabled = third.register(job).job;
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.disabled_reason, "restart-safe stop");
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("scheduled execution rechecks persisted lease owner, expiry, and claimed task", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hp-automation-auth-"));
  const stateDirectory = path.join(workspaceRoot, ".hermes3d_orchestrator");
  const now = 5_000;
  try {
    await fs.mkdir(path.join(stateDirectory, "tasks"), { recursive: true });
    await fs.writeFile(path.join(stateDirectory, "automation-state.json"), JSON.stringify({
      schema: "hermesproof.automation-state.v1",
      jobs: [{ ...job, enabled: true, platform: "windows", lease_id: "lease-a", owner: "owner-a", task_id: "task-a" }]
    }));
    await fs.writeFile(path.join(stateDirectory, "runtime-lifecycle.json"), JSON.stringify({
      schema: "hermesproof.runtime-lifecycle.v1",
      runtimes: [],
      leases: [{ id: "lease-a", runtime_id: "hermesproof", workspace: workspaceRoot, owner: "owner-a", task_id: "task-a", status: "active", expires_at_ms: now + 1_000 }]
    }));
    await fs.writeFile(path.join(stateDirectory, "tasks", "task-a.json"), JSON.stringify({ id: "task-a", owner: "owner-a", status: "claimed" }));

    const authorization = await verifyAutomationExecutionAuthorization({ workspaceRoot, stateDirectory, jobId: job.id, now: () => now });
    assert.equal(authorization.lease_id, "lease-a");
    await assert.rejects(
      verifyAutomationExecutionAuthorization({ workspaceRoot, stateDirectory, jobId: job.id, now: () => now + 1_001 }),
      /active runtime lease/i
    );
    await fs.writeFile(path.join(stateDirectory, "tasks", "task-a.json"), JSON.stringify({ id: "task-a", owner: "owner-a", status: "released" }));
    await assert.rejects(
      verifyAutomationExecutionAuthorization({ workspaceRoot, stateDirectory, jobId: job.id, now: () => now }),
      /claimed task/i
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("kill switch continues after one native scheduler failure", async () => {
  const disabled = [];
  const manager = new AutomationManager({
    schedulerAdapter: {
      async enable() {},
      async disable(plan) {
        disabled.push(plan.job_id);
        if (plan.job_id === "deep-doctor") throw new Error("native task missing");
      }
    },
    leaseVerifier: async () => ({ owner: "owner-a", task_id: "task-a" })
  });
  manager.register(job);
  manager.register({ ...job, id: "completion-pulse" });
  await manager.enable({ jobId: "deep-doctor", platform: "windows", leaseId: "lease-a", owner: "owner-a" });
  await manager.enable({ jobId: "completion-pulse", platform: "windows", leaseId: "lease-a", owner: "owner-a" });
  const result = await manager.killSwitch({ reason: "operator stop" });
  assert.equal(result.ok, false);
  assert.equal(result.disabled, 1);
  assert.equal(result.failures.length, 1);
  assert.deepEqual(disabled, ["deep-doctor", "completion-pulse"]);
});
