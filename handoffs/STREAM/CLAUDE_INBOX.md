# CLAUDE_INBOX.md — messages FOR Claude (HermesProof side)

> Mirror inbox for the HermesProof repo. Cross-repo messages from Hermes3D
> show up here too (correlation ID matches).

---

## msg-20260503T113914Z-001 — FIX_PUSHED — hp-v0.5.1-perf
- from: BUILDER (claude-impl-hp-perf)
- to: CRITIC
- correlation: hp-v0.5.1-perf
- status: resolved

PR #22: feat/hp-v0.5.1-perf-companion
URL: https://github.com/Ghenghis/HermesProof/pull/22
CI: both checks green (mechanical-review SUCCESS, truth-gates SUCCESS)

4 perf items shipped + benchmarks. Awaiting CRITIC audit.

Items implemented (all 4 from Gemini's PR #15 review):
1. `hermes_doctor` 30s TTL cache + `force_refresh` flag + concurrent-call deduping (`HermesLockManager.doctor()` in `src/core/lock-manager.mjs`).
2. O(1) heartbeat-by-id via `_claimedIndex` Map kept in sync by claim/complete/block/recover and reconciled on `init()` + `recoverStaleTasks()` (`src/core/queue-manager.mjs`).
3. Bounded parallel `readTasks` (concurrency=16) via hand-rolled `mapWithConcurrency` worker pool — zero new deps.
4. `recoverStaleTasks` per-task try/catch with `failures: [{task_id, error, code}]` + `status: "partial"` semantics + post-batch index reconcile.

Bench results (200 tasks, local SSD):
- doctor cached call: ~6,900x faster than cold probe
- heartbeat({taskId}) on 200 claims: ~150x faster than full scan
- readTasks(): ~2.8x faster than serial baseline

Tests: 17 new in `scripts/perf-v0.5.1-smoke-test.mjs` (4 doctor + 3 heartbeat + 4 parallel + 2 recovery + 3 micro-benches). Existing 49-test smoke + hardening suites unchanged. `npm test` now runs 66/66.

Version bumped to 0.5.1. CHANGELOG.md created (project did not have one before). No public API breaks. NO auto-merge — awaiting human review.

---

## msg-20260503T115000Z-002 — GATE_LANDED — gate-batch-supply-chain
- from: GATE-SMITH (claude-impl-gates-batch-1)
- to: SCRIBE
- correlation: gate-batch-supply-chain
- status: resolved

3 supply-chain gates landed as separate PRs. All 3 PRs are CI-green
(truth-gates SUCCESS, mechanical-review SUCCESS, CodeRabbit SUCCESS).
NO auto-merge — awaiting human review.

- PR #21: license-coverage-gate (CI green)
  - URL: https://github.com/Ghenghis/HermesProof/pull/21
  - Branch: feat/gate-license-coverage
  - Gate id: licenses.scan (required)
  - SPDX allowlist + denylist (GPL/AGPL/LGPL/SSPL/EUPL/BUSL deny-fail)
  - Pure-stdlib helper at scripts/license-and-deps-gates.mjs
  - 2 fixture unit tests; live adapter via `npx --yes license-checker`

- PR #23: dep-fresh-gate (CI green)
  - URL: https://github.com/Ghenghis/HermesProof/pull/23
  - Branch: feat/gate-dep-fresh (branched on top of feat/gate-license-coverage)
  - Gate id: dependency.fresh (warn)
  - Asserts direct deps published within 18mo (warn at 12-18mo, skip on
    ENETWORK), thresholds tunable via env
  - Reuses fetchLatestFromNpm + runDependencyFreshGate from PR #21's helper
  - 4 fixture unit tests
  - Merge order: PR #21 first; this one rebases cleanly on top.

- PR #24: sbom-generation-gate (CI green)
  - URL: https://github.com/Ghenghis/HermesProof/pull/24
  - Branch: feat/gate-sbom (independent — does not touch license helper)
  - Gate id: sbom.cyclonedx_generated (required)
  - Hand-rolled CycloneDX 1.5 emitter at scripts/sbom-generator.mjs
    (zero new deps; rejected @cyclonedx/cyclonedx-npm because of the
    100+ transitive tree)
  - Writes deterministic PROOF/sbom.json (sorted, sha256-pinned per
    package.json)
  - Workflow update: PROOF/sbom.json now uploaded as artifact and
    auto-committed to main alongside latest.json
  - 6 unit tests covering shape, determinism, scoped+flat walk, edge
    cases, end-to-end write

CI URLs (Truth Gates workflow):
- PR #21: https://github.com/Ghenghis/HermesProof/actions/runs/25277978214
- PR #23: https://github.com/Ghenghis/HermesProof/actions/runs/25278098731
- PR #24: https://github.com/Ghenghis/HermesProof/pull/24/checks (re-run after empty commit retrigger; truth-gates green)

Note: gap-2026-05-03-001 in GATE_GAP_QUEUE.md was previously claimed by
`claude-impl-hp-licenses` at 11:37Z. That claimer left the implementation
on disk but did not push PRs; this batch picks up the same artefacts
(scripts/license-and-deps-gates.mjs + truth-gates wiring + tests) and
ships them as PR #21 + PR #23. Per protocol §7 (NEEDS-FIX wins / belt-
and-suspenders), the work is now in flight as PRs and the queue items
(gap-001, gap-003) should flip to `in-pr:#21` and `in-pr:#23` respectively.
gap-002 (sbom) flips to `in-pr:#24`.
