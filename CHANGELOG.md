# Changelog

All notable changes to HermesProof are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.5.1] — 2026-05-03

Performance companion to v0.5.0. Ships the four deferred items from the
PR #15 review (Gemini audit). No public API breaks; same MCP tool surface.

### Added
- `hermes_doctor` now accepts `force_refresh` to bypass the in-memory cache.
- `recoverStaleTasks()` returns `failures: [{ task_id, error, code }]` with
  partial-success semantics — one bad task no longer aborts the batch.
- `QueueManager._claimedIndex` (`Map<task_id, { file, owner }>`) keeps the
  set of claimed tasks hot in memory; reconciled with disk on `init()` and
  on every `recoverStaleTasks()` call.
- `mapWithConcurrency(items, concurrency, mapper)` helper exported from
  `src/core/queue-manager.mjs` (zero-dep `p-limit`-style worker pool).
- `READ_TASKS_CONCURRENCY = 16` exported alongside it for visibility.
- `npm run smoke:perf` — runs `scripts/perf-v0.5.1-smoke-test.mjs` (17 tests,
  including 3 micro-benchmarks).

### Changed
- `HermesLockManager.doctor()` results are cached for 30s per instance.
  First call within the TTL re-uses the prior probe; subsequent calls return
  `cached: true` and `cache_age_ms`. Concurrent uncached callers share the
  in-flight probe instead of duplicating syscalls.
- `QueueManager.heartbeat({ taskId })` is now O(1): hits the in-memory
  index, falls back to a single direct file read, and never scans the
  `tasks/claimed/` directory. The batch path (no `taskId`) remains O(n) by
  design — the caller asked for "every task I own".
- `QueueManager.readTasks(state)` reads the directory in parallel with
  bounded concurrency (16). Hand-rolled worker pool, no new runtime deps.
- `QueueManager.init()` is now idempotent (`_initialized` guard) and
  reconciles the claimed index on first call.
- `recoverStaleTasks()` wraps each task in its own `try`/`catch`; failures
  are collected and reported alongside successful recoveries. The status
  flips to `partial` if any task failed.

### Performance (informational, measured by `scripts/perf-v0.5.1-smoke-test.mjs`)
- `hermes_doctor` cached call: ~6,900x faster than a cold probe.
- `heartbeat({ taskId })` on 200 claimed tasks: ~150x faster than the
  full-scan path.
- `readTasks()` on 200 pending tasks: ~2.8x faster than the prior serial
  loop on local SSD.

### Tests
- 17 new tests in `scripts/perf-v0.5.1-smoke-test.mjs` (unit + integration
  + 3 benchmarks). Existing 49-test smoke + hardening suites unchanged and
  still green.

### Compatibility
- Node 20+ (unchanged).
- MCP tool input schema for `hermes_doctor` adds an optional
  `force_refresh: boolean`. Callers that don't pass it get the cached
  behavior (which is faster, not slower, than v0.5.0).

## [0.5.0] — 2026-05-03

Initial public-ish drop: 17 truth gates, lock manager, queue manager,
universal setup wizard, sandbox attestation. See git history.
