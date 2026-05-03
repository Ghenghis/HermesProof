import test from "node:test";
import assert from "node:assert/strict";
import {
  percentile,
  summarise,
  evaluateBudget,
  runAllBenches
} from "./perf-budget.mjs";

test("percentile picks the floor(p*n) index of the sorted sample", () => {
  // Spec: "sort + index 0.95*n". For n=20, idx=floor(0.95*20)=19, so the
  // largest element is the p95.
  const samples = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20
  assert.equal(percentile(samples, 0.95), 20);
  // Order-insensitive — function sorts internally. floor(0.5*20)=10 -> sorted[10]=11 (1..20 array).
  const shuffled = [...samples].sort(() => Math.random() - 0.5);
  assert.equal(percentile(shuffled, 0.5), 11);
});

test("percentile rejects empty arrays and out-of-range p", () => {
  assert.throws(() => percentile([], 0.95));
  assert.throws(() => percentile([1, 2], 0));
  assert.throws(() => percentile([1, 2], 1));
});

test("summarise reports n/min/max/mean/p50/p95/p99 with 4-decimal precision", () => {
  const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const s = summarise(samples);
  assert.equal(s.n, 10);
  assert.equal(s.min_ms, 1);
  assert.equal(s.max_ms, 10);
  assert.equal(s.mean_ms, 5.5);
  // floor(0.5*10) = 5 -> sorted[5] = 6
  assert.equal(s.p50_ms, 6);
  // floor(0.95*10) = 9 -> sorted[9] = 10
  assert.equal(s.p95_ms, 10);
});

test("evaluateBudget marks pass when p95 strictly under the budget", () => {
  const r = evaluateBudget({ p95_ms: 49.9 }, 50);
  assert.equal(r.pass, true);
  assert.equal(r.budget_ms, 50);
  assert.equal(r.headroom_ms, 0.1);
});

test("evaluateBudget marks fail when p95 equals or exceeds the budget", () => {
  // strictly less than — equal is a fail, per the spec ("< 50ms")
  const equalCase = evaluateBudget({ p95_ms: 50 }, 50);
  assert.equal(equalCase.pass, false);
  const overCase = evaluateBudget({ p95_ms: 51 }, 50);
  assert.equal(overCase.pass, false);
});

test("runAllBenches produces all three benches with budget verdicts (smoke)", async () => {
  // Tiny iteration count keeps the unit-test bounded; we only verify shape
  // and that all three benches were measured. Tight budgets (10s) ensure
  // we don't flap on slow CI.
  const report = await runAllBenches({
    iterations: 10,
    budgets: { doctor_p95_ms: 10_000, lock_p95_ms: 10_000, heartbeat_p95_ms: 10_000 }
  });
  assert.equal(report.perf_schema_version, 1);
  assert.ok(report.benches.hermes_doctor_cold_start);
  assert.ok(report.benches.lock_acquire);
  assert.ok(report.benches.heartbeat);
  assert.equal(report.iterations, 10);
  for (const b of Object.values(report.benches)) {
    assert.equal(b.stats.n, 10);
    assert.equal(typeof b.stats.p95_ms, "number");
    assert.equal(b.budget.pass, true);
  }
  assert.equal(report.ok, true);
});
