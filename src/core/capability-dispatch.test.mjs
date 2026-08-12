import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { CapabilityDispatch } from "./capability-dispatch.mjs";

let tmpDir;
let dispatch;

describe("CapabilityDispatch", () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-dispatch-test-"));
    dispatch = new CapabilityDispatch({ workspaceRoot: tmpDir });
    await dispatch.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("recommend returns null actor with empty candidates", async () => {
    const r = await dispatch.recommend("gate", []);
    assert.equal(r.actor_id, null);
    assert.equal(r.score, 0);
  });

  it("rankActors returns empty list with empty input", async () => {
    const r = await dispatch.rankActors("gate", []);
    assert.deepEqual(r, []);
  });

  it("rankActors and recommend agree on best actor (regression: per-actor scoring drift)", async () => {
    // Actor A has done the task type many times; Actor B has done it zero times.
    // recommend(task_type, [A,B]) and rankActors(task_type, [A,B]) must agree.
    // Pre-fix, rankActors called recommend per-actor with [actor_id], so each
    // call's maxLoad normalized to itself (=1.0), collapsing load relativity
    // and producing different orderings between recommend and rankActors.
    for (let i = 0; i < 8; i++) {
      await dispatch.skills.recordTask("actor-A", "build");
    }
    // actor-B has no task history → load = 0
    await dispatch.skills.recordTask("actor-B", "review"); // unrelated type

    const rec = await dispatch.recommend("build", ["actor-A", "actor-B"]);
    const ranked = await dispatch.rankActors("build", ["actor-A", "actor-B"]);
    assert.equal(ranked[0].actor_id, rec.actor_id, "rankActors top must equal recommend pick");
    assert.equal(ranked[0].actor_id, "actor-B", "B (no build load) must outrank A (8 builds)");
  });

  it("rankActors load normalization spreads scores across the full set (not collapsed to 1.0 each)", async () => {
    // With 3 actors of widely different loads, the dispatch_scores must NOT
    // be identical (which is what the pre-fix bug produced via maxLoad=self).
    for (let i = 0; i < 10; i++) await dispatch.skills.recordTask("heavy",   "gate");
    for (let i = 0; i < 5;  i++) await dispatch.skills.recordTask("medium",  "gate");
    // light has zero gate tasks
    await dispatch.skills.recordTask("light", "review");

    const ranked = await dispatch.rankActors("gate", ["heavy", "medium", "light"]);
    assert.equal(ranked.length, 3);
    const scores = ranked.map((r) => r.dispatch_score);
    // Top must be light, bottom must be heavy
    assert.equal(ranked[0].actor_id, "light");
    assert.equal(ranked[2].actor_id, "heavy");
    // Scores must actually differ (full-set normalization)
    assert.notEqual(scores[0], scores[2]);
  });

  it("rankActors returns sorted descending by dispatch_score", async () => {
    await dispatch.skills.recordTask("x", "build");
    await dispatch.skills.recordTask("y", "build");
    const ranked = await dispatch.rankActors("build", ["x", "y", "z"]);
    for (let i = 0; i < ranked.length - 1; i++) {
      assert.ok(ranked[i].dispatch_score >= ranked[i + 1].dispatch_score);
    }
  });

  it("P1-15: accepts injected reputation + skills (DI) instead of constructing parallel instances", async () => {
    // Verify the DI form: when an external module already has a
    // ReputationTracker + SkillRotation against the same workspace,
    // CapabilityDispatch reuses them rather than spinning up parallel
    // instances. Pre-fix, two instances would silently diverge if either
    // grew in-memory state.
    const { ReputationTracker } = await import("./reputation.mjs");
    const { SkillRotation } = await import("./skill-rotation.mjs");
    const di = await import("./capability-dispatch.mjs");

    const sharedRep = new ReputationTracker({ workspaceRoot: tmpDir, stateDirName: ".hermes-di" });
    const sharedSkills = new SkillRotation({ workspaceRoot: tmpDir, stateDirName: ".hermes-di" });
    await sharedRep.init();
    await sharedSkills.init();

    const injected = new di.CapabilityDispatch({
      workspaceRoot: tmpDir,
      stateDirName: ".hermes-di",
      reputation: sharedRep,
      skills: sharedSkills,
    });
    await injected.init();

    // Identity check: dispatch.reputation must be the SAME object as the one
    // we passed in (not a freshly constructed peer).
    assert.equal(injected.reputation, sharedRep, "dispatch.reputation must be the injected instance");
    assert.equal(injected.skills, sharedSkills, "dispatch.skills must be the injected instance");

    // Functional check: write through the SHARED instance, read through
    // the dispatch's reference — must see the same data.
    await sharedRep.recordOutcome("di-actor", "merge");
    const score = await injected.reputation.getScore("di-actor");
    assert.equal(score.score, 2.0, "must observe writes made through the shared instance");
  });
});
