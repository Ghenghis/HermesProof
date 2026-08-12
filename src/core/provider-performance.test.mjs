import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ProviderPerformanceTracker } from "./provider-performance.mjs";

let tmpDir;
let providers;

describe("ProviderPerformanceTracker", () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-provider-perf-"));
    providers = new ProviderPerformanceTracker({ workspaceRoot: tmpDir });
    await providers.init();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("records provider outcomes and computes success/failure rates", async () => {
    await providers.recordOutcome({
      provider_id: "MiniMax",
      model_name: "MiniMax-M3",
      task_type: "aice_live_controller",
      outcome: "verified",
      latency_ms: 1200,
      evidence: "ce_ping 30/30",
    });
    await providers.recordOutcome({
      provider_id: "MiniMax",
      task_type: "aice_live_controller",
      outcome: "failed",
      context: "tool call schema miss",
    });

    const stats = await providers.stats({ provider_id: "minimax", task_type: "aice_live_controller" });

    assert.equal(stats.count, 1);
    assert.equal(stats.providers[0].provider_id, "minimax");
    assert.equal(stats.providers[0].count, 2);
    assert.equal(stats.providers[0].verified, 1);
    assert.equal(stats.providers[0].failed, 1);
    assert.equal(stats.providers[0].success_rate, 0.5);
    assert.equal(stats.providers[0].failure_rate, 0.5);
  });

  it("ranks providers by task-specific proof history without penalizing new candidates", async () => {
    await providers.recordOutcome({
      provider_id: "minimax",
      task_type: "pacman_timer_scan",
      outcome: "verified",
    });
    await providers.recordOutcome({
      provider_id: "deepseek",
      task_type: "pacman_timer_scan",
      outcome: "failed",
    });

    const ranked = await providers.rankProviders({
      task_type: "pacman_timer_scan",
      candidates: ["deepseek", "siliconflow", "minimax"],
    });

    assert.deepEqual(
      ranked.providers.map((entry) => entry.provider_id),
      ["minimax", "siliconflow", "deepseek"]
    );
    assert.equal(ranked.providers[1].recommendation, "baseline");
  });

  it("keeps task lanes isolated", async () => {
    await providers.recordOutcome({
      provider_id: "siliconflow",
      task_type: "embedding_recall",
      outcome: "verified",
    });
    await providers.recordOutcome({
      provider_id: "siliconflow",
      task_type: "live_ce_control",
      outcome: "failed",
    });

    const embedding = await providers.stats({ provider_id: "siliconflow", task_type: "embedding_recall" });
    const live = await providers.stats({ provider_id: "siliconflow", task_type: "live_ce_control" });

    assert.ok(embedding.providers[0].score > live.providers[0].score);
    assert.equal(embedding.providers[0].failed, 0);
    assert.equal(live.providers[0].failed, 1);
  });

  it("rejects unknown outcomes", async () => {
    await assert.rejects(
      () => providers.recordOutcome({ provider_id: "minimax", outcome: "magic" }),
      /unknown provider outcome/
    );
  });
});
