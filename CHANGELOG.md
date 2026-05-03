# Changelog

All notable changes to HermesProof are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.6.0] — 2026-05-03

### Added
- **Anonymous role rotation** — new `AnonymousOrchestrator` (`src/core/anonymous-orchestrator.mjs`) implements 6 anonymous coordination roles (BUILDER, CRITIC, SCRIBE, GATE-SMITH, DOC-KEEPER, WATCHDOG) plus a reserved USER role. Roles are claimed at message-write time, not session start, and rotate freely between Claude / Codex / KiloCode / Cursor / Windsurf / VSCode+Copilot.
- **Hermes-Agent-as-USER bridge** — new `HermesAgentBridge` (`src/core/hermes-agent-bridge.mjs`) connects HermesProof to a configured Hermes Agent reasoning loop. When enabled (`HERMES_AGENT_ENABLED=1`), the agent reasons about USER-scope decisions and grants AS_USER sessions on the user's behalf within bounded scope.
- **Provider failover** for the Hermes Agent: DeepSeek → MiniMax → SiliconFlow (cloud, preferred order) → LM Studio → Ollama → Hipfire (local fallbacks). All API keys read from env (`G:\private\.env` per the user's secret-store convention); never hardcoded, never logged.
- **10 new MCP tools**:
  - `hermes_anonymous_claim` / `hermes_anonymous_release` / `hermes_anonymous_state`
  - `hermes_user_grant_session` / `hermes_user_revoke_session` / `hermes_user_check_authorization`
  - `hermes_agent_health` / `hermes_agent_request_user_session` / `hermes_agent_resolve_blocked` / `hermes_agent_revoke_session`
- **STREAM/ handoff protocol** (`handoffs/STREAM/PROTOCOL.md` + mirror in Hermes3D) — markdown-based pub/sub for real-time anonymous coordination between AI clients. Includes WATCHDOG.md (heartbeat + auto-reassign), CLIENT_ADAPTERS.md (Claude/Codex/KiloCode/Cursor/Windsurf/VSCode+Copilot drop-ins).
- **STREAM scripts** in `scripts/`: `stream-validate.mjs`, `stream-watchdog.mjs`, `stream-backup.mjs`, `stream-archive.mjs`. Zero deps, foolproof (idempotent, schema-validated, auto-archive after 6h, snapshots every 30min with 7d retention).
- **`.env.example`** — names-only template documenting every env var. Hardened `.gitleaks.toml` patterns added: `ghp_*`, `ghs_*`, `cr-*`, `cp-*`, Azure Speech keys.
- **ADR-016** — design rationale for Hermes-Agent-as-Anonymous-USER, including provider failover, capability scoping, and security model.

### Changed
- `package.json` version bump 0.5.1 → 0.6.0.
- `package.json` test target now includes `anonymous-orchestrator-smoke-test.mjs` (15 tests, all green).
- `.gitignore` adds `handoffs/STREAM/backups/` and a paranoid blocklist for accidental Notepad-saved-as variants.

### Security
- Hermes Agent bridge is **disabled by default**; explicit opt-in via env.
- USER sessions are bounded by capability scope + TTL (default 8h, max 48h).
- Session hash redacted from public state reads.
- `granted_by` validated against enum (`human` / `hermes-agent` / `ci`); rejects spoofed values.
- All grant/revoke events written to evidence ledger with hash + provider + model used.
- Provider responses parsed strictly as JSON; markdown fences salvaged but malformed responses fail closed.
- Per-provider timeout (25s) + overall decision timeout (60s); all 6 failures → defer to human.

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
