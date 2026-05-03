import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ReputationTracker } from "./reputation.mjs";

let tmpDir;
let rep;

describe("ReputationTracker", () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-rep-test-"));
    rep = new ReputationTracker({ workspaceRoot: tmpDir });
    await rep.init();
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("records merge outcome, score increases from 1.0", async () => {
    const r = await rep.recordOutcome("builder-a", "merge", "PR #1");
    assert.equal(r.ok, true);
    assert.equal(r.outcome, "merge");
    assert.equal(r.delta, 1.0);
    assert.equal(r.new_score, 2.0);
  });

  it("records reject outcome, score decreases", async () => {
    const isolated = new ReputationTracker({ workspaceRoot: tmpDir, stateDirName: ".hermes-rep-reject" });
    await isolated.init();
    await isolated.recordOutcome("builder-a", "merge", "seed-success");
    const r = await isolated.recordOutcome("builder-a", "reject", "gate-fail");
    assert.equal(r.delta, -1.0);
    assert.equal(r.new_score, 1.0); // 1.0 + 1.0 - 1.0
  });

  it("score never goes below 0", async () => {
    const r2 = new ReputationTracker({ workspaceRoot: tmpDir, stateDirName: ".hermes-rep2" });
    await r2.init();
    await r2.recordOutcome("weak-agent", "reject");
    await r2.recordOutcome("weak-agent", "reject");
    await r2.recordOutcome("weak-agent", "reject");
    const score = await r2.getScore("weak-agent");
    assert.ok(score.score >= 0, "score should never be negative");
  });

  it("lgtm adds 0.5", async () => {
    const r3 = new ReputationTracker({ workspaceRoot: tmpDir, stateDirName: ".hermes-rep3" });
    await r3.init();
    await r3.recordOutcome("lgtm-agent", "lgtm");
    const score = await r3.getScore("lgtm-agent");
    assert.equal(score.score, 1.5);
  });

  it("timeout subtracts 0.25", async () => {
    const r4 = new ReputationTracker({ workspaceRoot: tmpDir, stateDirName: ".hermes-rep4" });
    await r4.init();
    await r4.recordOutcome("slow-agent", "timeout");
    const score = await r4.getScore("slow-agent");
    assert.equal(score.score, 0.75);
  });

  it("getScore returns null for unknown actor", async () => {
    const s = await rep.getScore("nobody-ever");
    assert.equal(s, null);
  });

  it("leaderboard is sorted descending", async () => {
    const r5 = new ReputationTracker({ workspaceRoot: tmpDir, stateDirName: ".hermes-rep5" });
    await r5.init();
    await r5.recordOutcome("agent-x", "merge");
    await r5.recordOutcome("agent-y", "reject");
    const board = await r5.leaderboard();
    const x = board.find((a) => a.actor_id === "agent-x");
    const y = board.find((a) => a.actor_id === "agent-y");
    assert.ok(x && y);
    assert.ok(x.score > y.score);
  });

  it("rejects unknown outcome", async () => {
    await assert.rejects(
      () => rep.recordOutcome("agent", "excellent"),
      /unknown outcome/
    );
  });
});
