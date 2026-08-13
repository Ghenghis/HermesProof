# Changelog

All notable changes to HermesProof are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

No unreleased changes.

## [0.9.2] — 2026-08-12

### Fixed
- Runtime enable, cycle, revoke, scheduler enable, and caller-visible status now reauthorize the lease against the exact owner and workspace; a leaked lease identifier cannot be reused across principals and foreign lease IDs are masked.
- Automation desired state is serialized, persisted atomically, and restored on restart. Every scheduled execution now revalidates its exact owner, task, and active lease; the kill switch continues across individual failures and stops known active jobs. Native scheduler inventory reconciliation and lost-state orphan discovery are not claimed.
- Capability-pack npm installation and probes now use the shared shell-free Windows process runner, eliminating the `spawn EINVAL` path without introducing command-shell parsing.
- The required HP-MHA attribution gate now loads `examples/hp-mha/measured-matrix.json`, enforces the exact model/harness cell assignment, verifies task/harness/scorer identities, retains and re-scores raw responses, and digest-verifies the result. Cards receive separate validation instead of an unrelated matrix; the two local Hermes cards additionally verify their ancestor commit and current product hashes, while external cards remain retained declarations.
- Public HP-MHA holdout locking is denied for server-derived reserved paths—including the real `task-sets/holdout.json` filename—or holdout tags regardless of a caller-supplied role or omitted manifest.
- Runtime enable and cycle require the presented lease to be the runtime's exact active lease, preventing a second owner from seizing an enabled runtime. Task claim state is rechecked on every control action.
- Release documentation and animated diagrams now state the audited v0.9.2 boundaries precisely: 121 core tools, 34 governed composite tools, 52 upstream Serena catalog entries, two local capability packs, npm-only installation, three fixed automation recipes, and no claim of OS sandboxing or publisher-signed packs.
- The Windows installer now rejects absent, empty, or non-canonical SemVer release facts before comparing the archive manifest and release tag; malformed bundles such as an empty version paired with `v` fail closed.
- Windows process-runner coverage now executes both `npm.cmd` and `npx.cmd`, the stable release-facts test binds version and tag together, and Pages tests require every user-facing release marker to match the canonical tag.
- The Windows installer regression is explicitly Windows-only, and the release plan now requires Hermes task claims, exact file locks, allowlisted gates, evidence, and orderly lock/task release for every modification group.

## [0.9.1] — 2026-08-12

### Fixed
- The managed Windows OTA updater now runs npm and npx candidate gates through the active Node runtime instead of asking Node to spawn `.cmd` shims with `shell: false`. This removes the `spawn EINVAL` quarantine failure while preserving exact argv handling, command-shell isolation, fail-closed gates, rollback, and signed candidate verification.
- Added a real Windows regression test that executes `npm.cmd --version` through the production updater process runner and fails if the shell-free translation is removed.
- The Windows installer now validates the archive manifest version against bundled canonical release facts instead of hardcoding v0.9.0, so signed patch releases install while internal version/tag mismatches still fail closed.

## [0.9.0] — 2026-08-12

### Added
- Runtime workspace switching for multi-repo use: `hermes_get_workspace` reports the active root and `hermes_set_workspace` switches to another existing absolute workspace directory, records `workspace.switch` evidence, and refuses to strand active locks unless `allowActiveLocks` is explicit.
- Live collaboration tools: `hermes_live_status` returns the active workspace's lock/queue/event/agent snapshot, and `hermes_wait_for_events` long-polls event outbox changes for request/response-friendly realtime agent coordination.
- Unlock-request workflow: `hermes_request_unlock` discovers current lock owners, creates grouped handoff requests, emits `handoff.created` events, and points owners to `hermes_approve_handoff` for proof-backed transfer.
- Agent workflow layer: `hermes_update_presence`, `hermes_list_presence`, `hermes_find_agents`, `hermes_request_assistance`, `hermes_wait_for_assistance`, `hermes_send_message`, `hermes_get_inbox`, `hermes_wait_for_inbox`, `hermes_ack_message`, `hermes_wait_for_unlock`, and `hermes_complete_work` add learned skills-aware routing, durable inboxes, assistance requests, acceptance waiting, unlock waiting, stale-owner recovery routing, and one-call completion/release.
- Redacted backend/GitLab tools: `hermes_backend_status`, `hermes_gitlab_status`, `hermes_gitlab_ensure_project`, `hermes_gitlab_list_merge_requests`, `hermes_gitlab_create_merge_request`, `hermes_gitlab_ultimate_status`, and `hermes_gitlab_bootstrap_ultimate` make GitLab project/MR and last-day Ultimate governance capture first-class without returning token values or private env-file paths.
- External agent connector guidance for Cheat Engine Chat + MiniMax M3, including a reusable profile example and standing prompt that route high-trust host access through HermesProof locks, gates, inboxes, and evidence.
- Runtime agent profile tools: `hermes_register_agent_profile`, `hermes_get_agent_profile`, `hermes_list_agent_profiles`, `hermes_update_agent_capabilities`, and `hermes_join_project` persist structured host/capability profiles under the workspace state database and let late-joining agents hydrate current project state.
- Truth-gate and stdio round-trip coverage for the expanded 77-tool MCP surface, including dynamic workspace switching, composite project connection, workspace testing mode, bug tickets, bug-fix submission, active-lock guard behavior, live event observation, unlock handoff transfer, assistance routing, GitLab status/project/MR paths, profiles, presence, inbox acknowledgement, skills routing, and completion release.
- **HP-MHA Model–Harness Attribution protocol** (`src/core/hp-mha.mjs`) — 9 new MCP tools (`hermes_hp_mha_harness_card_record`, `hermes_hp_mha_experiment_plan_lock`, `hermes_hp_mha_benchmark_run_attest`, `hermes_hp_mha_trace_bundle_verify`, `hermes_hp_mha_trace_metrics`, `hermes_hp_mha_trace_prune`, `hermes_hp_mha_model_harness_attribution`, `hermes_hp_mha_promotion_evaluate`, `hermes_hp_mha_sub_gate`) plus a dedicated hash-chained evidence ledger (`<workspace>/.hermes3d_orchestrator/evidence/hp_mha.ndjson`). Enforces contract requirements HP-MHA-001 (six-manifest binding + trace-root), HP-MHA-002 (locked-harness or 2×2 factorial model comparison), HP-MHA-003 (eight-key held-constant harness claim), HP-MHA-004 (contamination: fallback / substitution / changed reasoning / timeout / tools), HP-MHA-005 (failed/cancelled/crashed/timed_out in denominator; impossible-clean rejected), HP-MHA-006 (holdout isolation from optimizer), HP-MHA-007 (harness effect + model effect + interaction, not just one aggregate percentage), HP-MHA-008 (PASS/FAIL/INCONCLUSIVE with chained `ev_*` reason codes), HP-MHA-009 (HermesProof never certifies a candidate harness it modified), HP-MHA-010 (real installed runtime + real tool chain; no mock / synthetic proof). Spec lives at [`docs/48-Point Lever.md`](./docs/48-Point%20Lever.md); contract version `hermesproof.hp_mha.2026-08-05`.
- HP-MHA audit-and-polish pass — removed unused imports/dead code from `src/core/hp-mha.mjs`, fixed broken malformed-input guard in `evaluatePromotion`, extracted shared `evaluateHarnessCardFromManifest` so `scripts/truth-gates.mjs` and `examples/hp-mha/load-card.mjs` cannot drift, corrected `routine_retention_ms=0` to disable the retention window, replaced card-name-padded evidence_ids with deterministic sha256 stubs, fixed indentation in the `hermes_hp_mha_sub_gate` handler, removed unused `ManifestLayers` zod schema. 54/54 unit tests pass; truth-gate still PASS at `required` level; `server.stdio_handshake` still reports 118 tools.
- HP-MHA v2 — added `hermes_hp_mha_experiment_report` (read-only aggregator that compiles every `ev_*` for an experiment_id into a structured report: match_count, breakdown by kind, denominator, last attribution triple, last promotion verdict). Added `classifyTaskSetTag`, `validateTaskSetTagUniqueness`, `buildExperimentReport`, `readExperimentReport` in `src/core/hp-mha.mjs`. Added `HOLDOUT_TAG` (`hp_mha.holdout`) and `OPTIMIZATION_TAG` (`hp_mha.optimization`) constants + HP-MHA-006 enforcement that a single task set cannot carry both. New `examples/hp-mha/task-sets/{holdout,optimization}.json` fixtures + `examples/hp-mha/load-card.mjs --task-sets` mode. New `examples/hp-mha/status.mjs` CLI prints ledger summary + last verdict. New audit note `docs/audits/2026-08-06-hp-mha-phase3.codex.md` documents v2 findings. **Fix:** `lockExperimentPlan` now injects the freshly-computed manifest sha256s into the plan before HP-MHA-002 / HP-MHA-003 validation so the contract checks act on what was locked, not on what the caller typed. New `examples/hp-mha/smoke-e2e.mjs` spawns `src/server.mjs` over real stdio JSON-RPC and runs the full harness→plan→run→trace→metrics→attribution→promotion→report pipeline; exit 0 with hash chain verified on disk. Four new npm scripts: `hp-mha:status`, `hp-mha:load-all`, `hp-mha:task-sets`, `hp-mha:smoke-e2e`. 62/62 unit tests pass; `server.stdio_handshake` reports 119 tools; `harness_attribution.contract` PASSes for 2 real cards; `npm run hp-mha:smoke-e2e` end-to-end PASS.
- HP-MHA v3 — closes three concrete gaps: (1) **HP-MHA-006 queue-level enforcement** — new `assertLockFilesRespectHoldoutIsolation({ files, role, task_set_manifest })` helper in `src/core/hp-mha.mjs` rejects `optimizer` role on `hp_mha.holdout` task sets; the `hermes_lock_files` MCP tool now consults it before invoking `manager.lockFiles`. (2) **Contract version bump** `hermesproof.hp_mha.2026-08-05` → `hermesproof.hp_mha.2026-08-06`; all 13 schema literals bumped from `v1` to `v2`. (3) **Pre-existing baseline test fix** — `DEFAULT_FAILOVER` in `src/core/hermes-agent-bridge.mjs` aligned with the six-provider expectation in `scripts/anonymous-orchestrator-smoke-test.mjs` (was `["minimax","deepseek"]`, now `["minimax","deepinfra","deepseek","siliconflow","lm_studio","ollama"]`). +9 new tests in `src/core/hp-mha.test.mjs` (71/71 pass total). Real end-to-end smoke (`npm run hp-mha:smoke-e2e`) re-verified after the contract bump. Audit note `docs/audits/2026-08-06-hp-mha-phase3.codex.md` appended with v2 corrections + v3 forward-looking notes.
- **HP-MHA v4-STABLE** — closed the v3 trace-index and stdio gaps, promoted holdout isolation to a required truth gate, and introduced three seven-layer onboarding examples for OpenHands, Aider, and Goose. Those examples were later replaced by retained installed-reference declarations, and v0.9.2 separates card validation from the exact Kilo benchmark attribution. The 121-tool core server and the 11-step real stdio/Merkle smoke remain release-gated.
- New `HP-HARNESS-ATTRIBUTION` release sub-gate in `scripts/truth-gates.mjs` (advisory `warn`, becomes `required` once real harness cards are wired in). Truth-gate expected tool list updated to include the 7 new HP-MHA tools; `server.stdio_handshake` now reports 109 tools.
- 33 new tests in `src/core/hp-mha.test.mjs` cover each contract requirement, factorial math with 12-decimal IEEE-754 rounding, trace-bundle tampering, schema rejection, and adversarial + passing sub-gate fixtures. Added to the `npm test` union.
- `docs/TOOL_REFERENCE.md` and `docs/ARCHITECTURE.md` updated to describe the HP-MHA surface, the trust boundary (optimizer outside HermesProof), and the new threat-model row.
- **Phase 2 first deliverable** — real harness cards under `examples/hp-mha/harness-cards/`. `hermesproof.json` (commit `fae63a4`, package_sha256 `e47dd4b1…`, lock sha256 `22d5c7c5…`) and `hermesagent.json` (commit `fae63a4`, package_sha256 `6f2fe016…`). `examples/hp-mha/load-card.mjs` runs both and prints PASS/FAIL verdicts. Regression test `real HermesProof harness card passes HP-HARNESS-ATTRIBUTION contract` added.
- **Phase 3 first deliverables** — `pruneByRetention()` (`routine_run` older than `routine_retention_ms`, `failure_diagnostic` guarded by `failures_required`, `duplicate_chunk` deduped by `root_sha256`, `release_pinned` never purged); `computeTraceMetrics()` (recovery rate at 1/3/5/10 steps, average control lag, context retention on a configurable `lookback`). Two new MCP tools: `hermes_hp_mha_trace_metrics` (read-only) and `hermes_hp_mha_trace_prune` (appends `ev_prune` summary without breaking the hash chain). 11 new tests in `src/core/hp-mha.test.mjs` (`45/45` now passing).
- **Sub-gate promoted `warn` → `required`** once two real harness cards were committed. `scripts/truth-gates.mjs` now iterates every JSON file under `examples/hp-mha/harness-cards/` and asserts each passes the HP-MHA contract end-to-end; failure of any real card fails the run. Truth-gate reports `cards=N (card_a=PASS, card_b=PASS) | adversarial=FAIL(HP-MHA-missing-input)`.
- Truth-gate expected tool list extended with `hermes_hp_mha_trace_metrics` and `hermes_hp_mha_trace_prune`. `server.stdio_handshake` now reports 118 tools.

### Fixed
- All supported client writers now provide `HERMES_WORKSPACE_ROOT` to `hp-mha-serena` while preserving the core server's narrower environment, so the composite server starts correctly in Claude Code, Codex, Kilo Code, VS Code, Windsurf, Cursor, LM Studio, and Devin exports.
- The live-client truth gate now requires both `hermes3d-locks` and `hp-mha-serena` to report connected; a core-only connection can no longer produce release proof.
- A stale Sigstore bundle from earlier history was removed, and pretests now fail if any retained bundle's embedded digest differs from `PROOF/latest.json`; v0.9.0 uses the offline Ed25519-signed archive as its authoritative cryptographic release boundary.

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
