import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SkillRotation, KNOWN_TASK_TYPES } from "./skill-rotation.mjs";

let tmpDir;
let sr;

describe("SkillRotation", () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-sr-test-"));
    sr = new SkillRotation({ workspaceRoot: tmpDir });
    await sr.init();
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("records a task and returns correct totals", async () => {
    const r = await sr.recordTask("claude-01", "gate");
    assert.equal(r.ok, true);
    assert.equal(r.actor_id, "claude-01");
    assert.equal(r.task_type, "gate");
    assert.equal(r.total_tasks, 1);
  });

  it("accumulates multiple tasks for the same actor", async () => {
    await sr.recordTask("claude-01", "gate");
    await sr.recordTask("claude-01", "gate");
    await sr.recordTask("claude-01", "review");
    const rec = await sr.getActor("claude-01");
    assert.ok(rec.task_counts.gate >= 3);
    assert.ok(rec.task_counts.review >= 1);
  });

  it("returns null for unknown actor", async () => {
    const rec = await sr.getActor("unknown-agent-xyz");
    assert.equal(rec, null);
  });

  it("leastLoadedForType returns sorted list", async () => {
    await sr.recordTask("agent-a", "build");
    await sr.recordTask("agent-a", "build");
    await sr.recordTask("agent-b", "build");
    const sorted = await sr.leastLoadedForType("build");
    const agentA = sorted.find((x) => x.actor_id === "agent-a");
    const agentB = sorted.find((x) => x.actor_id === "agent-b");
    assert.ok(agentA && agentB);
    assert.ok(agentB.count <= agentA.count);
  });

  it("recommendNextType returns the least-practiced type", async () => {
    const sr2 = new SkillRotation({ workspaceRoot: tmpDir, stateDirName: ".hermes-sr2" });
    await sr2.init();
    // Do lots of gate tasks, very few docs tasks
    for (let i = 0; i < 5; i++) await sr2.recordTask("new-agent", "gate");
    await sr2.recordTask("new-agent", "review");
    const rec = await sr2.recommendNextType("new-agent");
    // Should recommend something other than gate
    assert.notEqual(rec, "gate");
    assert.ok(KNOWN_TASK_TYPES.includes(rec));
  });

  it("serializes concurrent recordTask — exact total_tasks count under 50-parallel load", async () => {
    // Pre-fix, two concurrent recordTask calls could read+mutate+write the
    // same actor entry, dropping count increments. With the mutex every
    // call serializes; total_tasks must equal the exact number of calls.
    const raceDir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-sr-race-"));
    const race = new SkillRotation({ workspaceRoot: raceDir });
    await race.init();
    try {
      const N = 50;
      const calls = [];
      for (let i = 0; i < N; i++) {
        // Mix of task types to also exercise the per-type histogram increments.
        const type = ["gate", "lock", "review", "build", "docs"][i % 5];
        calls.push(race.recordTask("race-actor", type));
      }
      await Promise.all(calls);
      const actor = await race.getActor("race-actor");
      assert.equal(actor.total_tasks, N, `expected ${N} total_tasks, got ${actor.total_tasks}`);
      const histSum = Object.values(actor.task_counts).reduce((a, b) => a + b, 0);
      assert.equal(histSum, N, `task_counts histogram should sum to ${N}, got ${histSum}`);
    } finally {
      await fs.rm(raceDir, { recursive: true, force: true });
    }
  });
});
