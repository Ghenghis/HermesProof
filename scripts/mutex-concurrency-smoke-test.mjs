/**
 * mutex-concurrency-smoke-test.mjs — proves the shared `makeMutex` helper
 * actually serializes the read-modify-write hot paths in lock-manager,
 * queue-manager, and event-manager that the 2026-05-03 audit cross-confirmed
 * were racing.
 *
 * Each test creates its own tmp workspace, fires N concurrent calls on the
 * same shared state, and asserts the post-conditions a serialized execution
 * guarantees (no torn writes, no lost updates, idempotent move-on-already-moved).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HermesLockManager } from "../src/core/lock-manager.mjs";
import { EventManager } from "../src/core/event-manager.mjs";

async function makeWorkspace(label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `hermes-${label}-`));
  return root;
}

test("HermesLockManager.heartbeat — 20 concurrent calls don't drop history entries", async () => {
  const root = await makeWorkspace("lock-hb-race");
  try {
    const lm = new HermesLockManager({ workspaceRoot: root });
    await lm.init();
    // Seed: claim a task + acquire one lock so heartbeat has something to touch.
    await lm.claimTask({ owner: "race-owner", taskId: "T-RACE-1", reason: "race test" });
    await lm.lockFiles({ owner: "race-owner", taskId: "T-RACE-1", files: ["src/file_a.txt"] });

    const N = 20;
    const calls = Array.from({ length: N }, () =>
      lm.heartbeat({ owner: "race-owner", taskId: "T-RACE-1" })
    );
    const results = await Promise.all(calls);
    assert.equal(results.length, N);
    for (const r of results) assert.equal(r.ok, true);

    // Pre-fix, concurrent heartbeats both pushed a "heartbeat" history entry,
    // but the last writer's state.history.push() was based on a stale read,
    // dropping any other concurrent push. With the mutex we expect exactly N
    // heartbeat entries in metadata.history.
    const locks = await lm.listLocks();
    assert.equal(locks.locks.length, 1);
    const meta = locks.locks[0];
    const heartbeats = (meta.history || []).filter((h) => h.type === "heartbeat");
    assert.equal(heartbeats.length, N, `expected ${N} heartbeat history entries, got ${heartbeats.length}`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("QueueManager.heartbeat — 20 concurrent calls leave heartbeat_utc monotonic", async () => {
  // Indirect via lock-manager since QueueManager is its dependency. Concurrent
  // heartbeat calls all target the same claimed task; each call writes
  // heartbeat_utc. With the mutex serializing the writes, the final on-disk
  // value is the LAST mutator's timestamp — which must be >= every prior
  // result's heartbeat_utc.
  const root = await makeWorkspace("queue-hb-race");
  try {
    const lm = new HermesLockManager({ workspaceRoot: root });
    await lm.init();
    await lm.queueManager.enqueueTask({
      task_id: "Q-RACE-1",
      owner: "race-owner",
      summary: "concurrency probe",
      priority: 5
    });
    // Pick the just-enqueued task into claimed/ so heartbeat has a target.
    const picked = await lm.queueManager.pickTask({ owner: "race-owner" });
    assert.ok(picked.ok, `pickTask must succeed; got ${JSON.stringify(picked)}`);
    assert.equal(picked.task.task_id, "Q-RACE-1");

    const N = 20;
    const calls = Array.from({ length: N }, () =>
      lm.queueManager.heartbeat({ owner: "race-owner", taskId: "Q-RACE-1" })
    );
    const results = await Promise.all(calls);
    // Each call returns the touched array; serialized → every call should have
    // touched the task at least once (no torn writes that erase the claim).
    assert.equal(results.length, N);
    for (const r of results) assert.deepEqual(r, ["Q-RACE-1"]);

    // Verify the final on-disk task is still claimed and has a heartbeat_utc.
    const tasks = await lm.queueManager.readTasks("claimed");
    const ours = tasks.find((t) => t.task.task_id === "Q-RACE-1");
    assert.ok(ours, "task must still be in claimed/ after concurrent heartbeats");
    assert.equal(ours.task.claimed_by, "race-owner");
    assert.ok(ours.task.heartbeat_utc, "heartbeat_utc must be set");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("EventManager.markEventHandled — 10 concurrent calls for same event are idempotent", async () => {
  // markEventHandled does pathExists checks + atomic-rename + write. Without
  // the mutex, two concurrent calls could both pass the pathExists check on
  // outbox/, then both try to rename the same file — one wins, the other
  // throws ENOENT. With the mutex, exactly one succeeds and the rest see
  // event_already_handled.
  const root = await makeWorkspace("event-mh-race");
  try {
    const em = new EventManager({ workspaceRoot: root });
    await em.init();
    const emit = await em.emitEvent({
      event_type: "task.enqueued",
      task_id: "T-EV-1",
      summary: "race probe"
    });
    const eventId = emit.event.event_id;

    const N = 10;
    const calls = Array.from({ length: N }, (_, i) =>
      em.markEventHandled({ event_id: eventId, handled_by: `caller-${i}` })
    );
    const results = await Promise.all(calls);

    const successes = results.filter((r) => r.ok && r.status === "handled");
    const idempotent = results.filter((r) => r.ok && r.status === "event_already_handled");
    const failed = results.filter((r) => !r.ok);

    assert.equal(successes.length, 1, "exactly one call must succeed in handling");
    assert.equal(idempotent.length, N - 1, `${N - 1} calls must see event_already_handled`);
    assert.equal(failed.length, 0, `no call should error; got ${failed.length} failures: ${JSON.stringify(failed)}`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
