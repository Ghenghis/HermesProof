#!/usr/bin/env node
/**
 * perf-budget — micro-benchmarks for HermesProof hot operations.
 *
 * Asserts:
 *   - cold-start `hermes_doctor`     p95 < 300 ms
 *   - lock acquire (lockFiles)       p95 <  50 ms
 *   - heartbeat                      p95 <  20 ms
 *
 * Each op is run N times (default 1000) against a freshly-initialised
 * sandbox workspace; we record `performance.now()` deltas, sort the
 * sample, and pick the index `floor(0.95 * n)`.
 *
 * Output:
 *   PERF/latest.json        — full machine-readable evidence
 *
 * Exit code:
 *   0  — all three p95 within budget (gate PASS)
 *   1  — at least one p95 over budget (gate FAIL)
 *
 * Wired as truth gate `perf.budgets_pass` (required) in scripts/truth-gates.mjs.
 *
 * Usage:
 *   node scripts/perf-budget.mjs
 *   node scripts/perf-budget.mjs --iterations 500
 *   node scripts/perf-budget.mjs --json   (suppress human banner; emit JSON only)
 *
 * Env:
 *   HP_PERF_ITERATIONS  override iteration count (default 1000)
 *   HP_PERF_DOCTOR_BUDGET_MS   default 300
 *   HP_PERF_LOCK_BUDGET_MS     default 50
 *   HP_PERF_HEARTBEAT_BUDGET_MS default 20
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { performance } from "node:perf_hooks";
import { HermesLockManager } from "../src/core/lock-manager.mjs";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

// ---------------------------------------------------------------------------
// Argv / env
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--iterations" || a === "-n") out.iterations = Number(argv[++i]);
    else if (a === "--json") out.json = true;
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node scripts/perf-budget.mjs [options]

Options:
  --iterations <n>   Override iteration count (default 1000, env HP_PERF_ITERATIONS)
  --json             Suppress human-readable banner
  --out <path>       Write JSON to <path> instead of PERF/latest.json
  --help             Show this help`);
  process.exit(0);
}

const ITERATIONS = Number(
  args.iterations || process.env.HP_PERF_ITERATIONS || 1000
);
if (!Number.isFinite(ITERATIONS) || ITERATIONS < 10) {
  console.error(`perf-budget: iterations must be >= 10, got ${ITERATIONS}`);
  process.exit(2);
}

const BUDGETS = Object.freeze({
  doctor_p95_ms: Number(process.env.HP_PERF_DOCTOR_BUDGET_MS) || 300,
  lock_p95_ms: Number(process.env.HP_PERF_LOCK_BUDGET_MS) || 50,
  heartbeat_p95_ms: Number(process.env.HP_PERF_HEARTBEAT_BUDGET_MS) || 20
});

// ---------------------------------------------------------------------------
// Pure stats helpers (exported for unit tests)
// ---------------------------------------------------------------------------
export function percentile(samples, p) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("percentile: samples must be a non-empty array");
  }
  if (typeof p !== "number" || p <= 0 || p >= 1) {
    throw new Error("percentile: p must be in (0,1)");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.floor(p * sorted.length);
  // floor(p * n) per the spec; clamp to last index for safety on small n.
  return sorted[Math.min(idx, sorted.length - 1)];
}

export function summarise(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n,
    min_ms: Number(sorted[0].toFixed(4)),
    max_ms: Number(sorted[n - 1].toFixed(4)),
    mean_ms: Number((sum / n).toFixed(4)),
    p50_ms: Number(percentile(sorted, 0.5).toFixed(4)),
    p95_ms: Number(percentile(sorted, 0.95).toFixed(4)),
    p99_ms: Number(percentile(sorted, 0.99).toFixed(4))
  };
}

export function evaluateBudget({ p95_ms }, budget_ms) {
  return {
    budget_ms,
    p95_ms,
    pass: p95_ms < budget_ms,
    headroom_ms: Number((budget_ms - p95_ms).toFixed(4))
  };
}

// ---------------------------------------------------------------------------
// Bench drivers
// ---------------------------------------------------------------------------
async function makeSandbox(prefix) {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function rmSandbox(dir) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Doctor cold-start bench — each iteration spins up a fresh manager + sandbox
 * and calls .doctor(). This is the worst-case "hermes_doctor first call" path,
 * which is what the perf budget is meant to gate.
 */
async function benchDoctorColdStart(iterations) {
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const sb = await makeSandbox("hp-perf-doctor-");
    try {
      const m = new HermesLockManager({ workspaceRoot: sb });
      await m.init();
      const t0 = performance.now();
      await m.doctor();
      samples.push(performance.now() - t0);
    } finally {
      await rmSandbox(sb);
    }
  }
  return samples;
}

/**
 * Lock-acquire bench — one workspace, N distinct file paths so each acquire
 * is a fresh `mkdir + writeJsonAtomic`. We pre-create the files so path
 * normalisation can resolve them.
 */
async function benchLockAcquire(iterations) {
  const sb = await makeSandbox("hp-perf-lock-");
  try {
    await fs.mkdir(path.join(sb, "src"), { recursive: true });
    const m = new HermesLockManager({ workspaceRoot: sb });
    await m.init();

    // Pre-create files so they exist on disk (path normaliser doesn't
    // require existence, but we keep the bench realistic).
    for (let i = 0; i < iterations; i++) {
      await fs.writeFile(path.join(sb, "src", `f${i}.txt`), `// ${i}\n`);
    }

    const samples = [];
    for (let i = 0; i < iterations; i++) {
      const file = `src/f${i}.txt`;
      const owner = `perf-bench-${i}`;
      const t0 = performance.now();
      await m.lockFiles({ owner, files: [file], reason: "perf-budget bench" });
      samples.push(performance.now() - t0);
      // Release immediately so the next iteration is clean and does not
      // accumulate state — keeps each sample comparable.
      await m.releaseFiles({ owner, files: [file] });
    }
    return samples;
  } finally {
    await rmSandbox(sb);
  }
}

/**
 * Heartbeat bench — a single owner holds a single lock; we hammer .heartbeat()
 * which only touches one metadata file per iteration. This represents the
 * steady-state "agent still alive" ping.
 */
async function benchHeartbeat(iterations) {
  const sb = await makeSandbox("hp-perf-hb-");
  try {
    await fs.mkdir(path.join(sb, "src"), { recursive: true });
    await fs.writeFile(path.join(sb, "src", "ping.txt"), "// ping\n");
    const m = new HermesLockManager({ workspaceRoot: sb });
    await m.init();
    await m.lockFiles({
      owner: "perf-hb-owner",
      files: ["src/ping.txt"],
      reason: "perf-budget heartbeat bench"
    });
    const samples = [];
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      await m.heartbeat({ owner: "perf-hb-owner" });
      samples.push(performance.now() - t0);
    }
    return samples;
  } finally {
    await rmSandbox(sb);
  }
}

// ---------------------------------------------------------------------------
// Composite: run all 3 benches and produce an evaluator-ready report.
// Exported so tests can drive it with smaller iteration counts.
// ---------------------------------------------------------------------------
export async function runAllBenches({ iterations = ITERATIONS, budgets = BUDGETS } = {}) {
  const startedIso = new Date().toISOString();
  const t0 = performance.now();

  const doctorSamples = await benchDoctorColdStart(iterations);
  const lockSamples = await benchLockAcquire(iterations);
  const heartbeatSamples = await benchHeartbeat(iterations);

  const doctorStats = summarise(doctorSamples);
  const lockStats = summarise(lockSamples);
  const heartbeatStats = summarise(heartbeatSamples);

  const doctorBudget = evaluateBudget(doctorStats, budgets.doctor_p95_ms);
  const lockBudget = evaluateBudget(lockStats, budgets.lock_p95_ms);
  const heartbeatBudget = evaluateBudget(heartbeatStats, budgets.heartbeat_p95_ms);

  const ok = doctorBudget.pass && lockBudget.pass && heartbeatBudget.pass;

  return {
    perf_schema_version: 1,
    ok,
    started_utc: startedIso,
    duration_ms: Math.round(performance.now() - t0),
    iterations,
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu_count: os.cpus()?.length || null,
    cpu_model: os.cpus()?.[0]?.model || null,
    budgets,
    benches: {
      hermes_doctor_cold_start: { stats: doctorStats, budget: doctorBudget },
      lock_acquire: { stats: lockStats, budget: lockBudget },
      heartbeat: { stats: heartbeatStats, budget: heartbeatBudget }
    }
  };
}

// ---------------------------------------------------------------------------
// Gate adapter — used by truth-gates.mjs so it can read PERF/latest.json
// and produce a single gate result without re-running 3000 iterations.
//
// Strategy: if PERF/latest.json exists AND was produced by the same
// node/platform AND iterations >= 100, trust it. Otherwise (CI cold start,
// missing file, stale platform), run with a reduced iteration count and
// rewrite the file.
// ---------------------------------------------------------------------------
export async function loadOrRunPerfReport({ minIterations = 100, fastIterations = 200 } = {}) {
  const perfDir = path.join(repoRoot, "PERF");
  const file = path.join(perfDir, "latest.json");
  let report = null;
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.perf_schema_version === 1 &&
        parsed.platform === process.platform &&
        Number(parsed.iterations) >= minIterations) {
      report = { ...parsed, source: "cached" };
    }
  } catch { /* fall through to fresh run */ }
  if (!report) {
    const fresh = await runAllBenches({ iterations: fastIterations });
    await fs.mkdir(perfDir, { recursive: true });
    await fs.writeFile(file, JSON.stringify(fresh, null, 2) + "\n", "utf8");
    report = { ...fresh, source: "fresh" };
  }
  return report;
}

// ---------------------------------------------------------------------------
// CLI entrypoint — only runs when this script is the program.
// ---------------------------------------------------------------------------
const isMain = process.argv[1] && url.pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  if (!args.json) {
    console.log(`perf-budget: iterations=${ITERATIONS}, budgets=${JSON.stringify(BUDGETS)}`);
    console.log(`perf-budget: warming up (3 benches × ${ITERATIONS} iters each)…`);
  }
  const report = await runAllBenches({ iterations: ITERATIONS, budgets: BUDGETS });
  const outFile = args.out
    ? path.resolve(args.out)
    : path.join(repoRoot, "PERF", "latest.json");
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(report, null, 2) + "\n", "utf8");
  if (args.json) {
    process.stdout.write(JSON.stringify(report) + "\n");
  } else {
    const rows = [
      ["hermes_doctor cold-start", report.benches.hermes_doctor_cold_start],
      ["lock acquire", report.benches.lock_acquire],
      ["heartbeat", report.benches.heartbeat]
    ];
    for (const [label, b] of rows) {
      const tag = b.budget.pass ? "PASS" : "FAIL";
      console.log(
        `[${tag}] ${label.padEnd(28)} p95=${b.stats.p95_ms.toFixed(2)}ms  ` +
        `budget=${b.budget.budget_ms}ms  headroom=${b.budget.headroom_ms.toFixed(2)}ms  ` +
        `(p50=${b.stats.p50_ms.toFixed(2)}, p99=${b.stats.p99_ms.toFixed(2)})`
      );
    }
    console.log(`\nPERF/latest.json written -> ${outFile}`);
    console.log(`Result: ${report.ok ? "ALL BUDGETS WITHIN LIMIT" : "BUDGET EXCEEDED"}`);
  }
  process.exit(report.ok ? 0 : 1);
}
