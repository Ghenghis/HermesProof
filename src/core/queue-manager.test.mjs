import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { QueueManager } from "./queue-manager.mjs";

const HOLDOUT = { task_set_id: "ts_holdout_release", tags: ["hp_mha.holdout"] };
const OPTIMIZATION = { task_set_id: "ts_optimization_release", tags: ["hp_mha.optimization"] };

async function withQueue(fn) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hp-queue-holdout-"));
  const queue = new QueueManager({ workspaceRoot });
  await queue.init();
  try {
    await fn(queue);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function enqueue(queue, task_id, task_set_manifest, priority = 0) {
  return await queue.enqueueTask({
    task_id,
    priority,
    enqueued_by: "hp-mha-scheduler-test",
    data: { task_set_manifest }
  });
}

test("scheduler rejects optimizer holdout claim before moving the task", async () => {
  await withQueue(async (queue) => {
    await enqueue(queue, "HOLDOUT-OPTIMIZER-DENY", HOLDOUT, 10);
    const result = await queue.pickTask({
      owner: "candidate-optimizer",
      role: "optimizer",
      prefer_task_id: "HOLDOUT-OPTIMIZER-DENY"
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, "holdout_isolation_denied");
    assert.deepEqual(result.reason_codes, ["HP-MHA-006"]);
    assert.equal((await queue.readTasks("pending")).length, 1);
    assert.equal((await queue.readTasks("claimed")).length, 0);
  });
});

test("scheduler fails closed on a holdout claim when role is omitted", async () => {
  await withQueue(async (queue) => {
    await enqueue(queue, "HOLDOUT-NO-ROLE", HOLDOUT);
    const result = await queue.pickTask({ owner: "unknown-candidate", prefer_task_id: "HOLDOUT-NO-ROLE" });
    assert.equal(result.ok, false);
    assert.equal(result.status, "holdout_isolation_denied");
    assert.match(result.reason, /role/i);
    assert.equal((await queue.readTasks("claimed")).length, 0);
  });
});

test("scheduler permits an explicit auditor role to claim holdout work", async () => {
  await withQueue(async (queue) => {
    await enqueue(queue, "HOLDOUT-AUDITOR-ALLOW", HOLDOUT);
    const result = await queue.pickTask({
      owner: "independent-auditor",
      role: "auditor",
      prefer_task_id: "HOLDOUT-AUDITOR-ALLOW"
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, "claimed");
    assert.equal(result.task.claimed_by, "independent-auditor");
    assert.equal(result.task.claimed_role, "auditor");
  });
});

test("optimizer scheduler skips forbidden holdout work and claims eligible optimization work", async () => {
  await withQueue(async (queue) => {
    await enqueue(queue, "HOLDOUT-HIGH", HOLDOUT, 100);
    await enqueue(queue, "OPTIMIZATION-LOW", OPTIMIZATION, 1);
    const result = await queue.pickTask({ owner: "candidate-optimizer", role: "optimizer" });
    assert.equal(result.ok, true);
    assert.equal(result.task.task_id, "OPTIMIZATION-LOW");
    assert.equal((await queue.readTasks("pending")).some(({ task }) => task.task_id === "HOLDOUT-HIGH"), true);
  });
});

test("scheduler rejects ambiguous mixed holdout and optimization tags", async () => {
  await withQueue(async (queue) => {
    await enqueue(queue, "MIXED-TAGS", {
      task_set_id: "ts_mixed",
      tags: ["hp_mha.holdout", "hp_mha.optimization"]
    });
    const result = await queue.pickTask({
      owner: "independent-auditor",
      role: "auditor",
      prefer_task_id: "MIXED-TAGS"
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, "holdout_isolation_denied");
    assert.ok(result.reason_codes.includes("HP-MHA-006-mixed-tags"));
    assert.equal((await queue.readTasks("claimed")).length, 0);
  });
});
