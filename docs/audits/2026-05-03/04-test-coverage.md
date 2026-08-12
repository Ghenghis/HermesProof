# Test Coverage Audit — v0.7 anonymous-orchestration

**Date:** 2026-05-03
**Repo state:** branch `feat/hp-v0.7-anonymous-orchestration-full`, baseline cited at commit `41258ef` (main)
**Suite:** `node --test` over 12 test files, 191 tests / 190 pass / 1 platform-skipped (supervisor SIGTERM is Unix-only)
**Scope:** test coverage gaps and test-quality issues in v0.7 code paths only. Production code quality, security, architecture, and docs are explicitly out of scope.

## Summary

| Module | File | Untested code paths (sample) | Order-dep risk | E2E (stdio) | Concurrency / boundary tests |
|---|---|---|---|---|---|
| `a2a-stub.mjs` | `src/core/a2a-stub.test.mjs` | `init()` happy-path on existing state file, `working→input_required→working` cycle, `input_required→canceled`, `submitted→canceled`, invalid status string, `_serialize` rejection-isolation contract, agent_id/task_type validation throw paths, `listTasks` `task_type` filter alone, multi-filter combos, sort stability under equal `created_ts`, age-exactly-equal-TTL boundary | LOW (each test creates its own task) | MISSING | concurrency YES (50-parallel createTask); TTL boundary YES; status-string validation NO |
| `capability-dispatch.mjs` | `src/core/capability-dispatch.test.mjs` | single-actor candidate list (load=0/0 div check), reputation + recency interaction, `RECENCY_WINDOW_MS` boundary at exactly 10 min, missing actor (no skill / no rep) gets defaults, identical composite ties (sort stability), `recommend()` reasoning string format | LOW (`beforeEach` resets) | MISSING | empty list YES; single-actor NO; recency boundary NO |
| `reputation.mjs` | `src/core/reputation.test.mjs` | `WINDOW_SIZE=30` event truncation behavior, score recompute after window slide, `total_outcomes` increments past window, `leaderboard()` empty-state, `rankedActors({ min_score })` filtering at threshold and below, missing `actor_id` throw, concurrent `recordOutcome` races | MEDIUM — `before/after` (single setup) + tests share `rep` and `tmpDir`; some tests use `stateDirName` overrides to isolate but several still write to the shared dir; serialized writes share state. Codex fix landed for one such case but more remain. | MISSING | concurrency NO; window-size boundary NO; clamp-at-zero implicit only |
| `skill-rotation.mjs` | `src/core/skill-rotation.test.mjs` | `TRIM_AFTER=1000` prune branch (stale-actor purge under load), `recommendNextType` for unknown actor, `last_active_ts` update on every record, custom (non-`KNOWN_TASK_TYPES`) `task_type` strings, missing args throw | MEDIUM — `before/after` shares `sr` + `tmpDir`; "leastLoadedForType returns sorted list" reads counts that are mutated by neighboring tests | MISSING | concurrency NO; TRIM_AFTER boundary NO |
| `anonymous-orchestrator.mjs` | `scripts/anonymous-orchestrator-smoke-test.mjs` | `claimRole` renew-existing path (`existingIdx !== -1`), `releaseRole` evidence emission for non-existent role, `grantUserSession` re-grant after revoke succeeds, `tickExpirations` user-session expiry path (only role expiry tested), `_appendEvidence` failure handling, history-array bound at 200, scope as non-array (object/string), unknown role string, history `slice(-200)` boundary | LOW (each test calls `makeWorkspace()` for isolation) | MISSING | concurrency NO (`claimRole` races / parallel role claims for same role); TTL boundaries NO |
| `hermes-agent-bridge.mjs` | `scripts/anonymous-orchestrator-smoke-test.mjs` | `requestUserSession` happy + decline + defer paths (mocked or otherwise), `resolveBlocked` (any path), `revokeOwnSession` (any path), `_askAgent` provider failover cascade, `_callProvider` markdown-fence salvage, `_callProvider` missing verdict/rationale, `_callProvider` HTTP non-OK, `_callProvider` per-provider AbortController timeout, `DECISION_OVERALL_TIMEOUT_MS` exhaustion, `modelOverrides`, `registryProviders` merge/extend semantics, `_systemPrompt` content stability, `requestUserSession` with no `projectGoals` configured | LOW | MISSING | provider-cascade race NO; timeout boundary NO |
| `mcp-supervisor.mjs` | `scripts/mcp-supervisor-smoke-test.mjs` | log rotation at 1MB (`stat.size > 1MB → rename .old`), `forwardSignal` when `activeChild === null` mid-backoff (process.exit immediately), `HERMESPROOF_SUPERVISOR_DISABLED=1` early-exit path, missing `SERVER_PATH` exit-1 path, multiple SIGTERM coalescing (only first sets `shutdownSignal`), `backoffMs()` formula at boundaries (crash 1 = 1s, crash 5 = 16s, crash >=6 = 30s cap), `purgeOldCrashes` window edge-cases, `crashesInWindow >= MAX_CRASHES` exactly at threshold, log file `appendFile` failure non-fatality, signal-during-backoff (delay() interrupted by signal), respawn `child.on('error', …)` path | LOW (per-test sandbox) | n/a (subprocess test by design) | concurrency NO; backoff boundaries NO; circuit-breaker tested only at one point (3 crashes / 60s) — not at exactly MAX_CRASHES with default settings |
| Server `src/server.mjs` (v0.7 tools) | — none — | All 17 v0.7 MCP tools (hermes_a2a_*, hermes_anonymous_*, hermes_dispatch_recommend, hermes_list_agents, hermes_record_outcome, hermes_record_task, hermes_user_*, hermes_agent_*) lack stdio round-trip coverage. Schema validation (zod), tool registration (`registerTool` annotation surface), and the JSON-RPC-over-stdio shape are exercised only at boot, not per-tool. | n/a | MISSING — see Finding "Zero round-trip coverage for v0.7 tools" | n/a |

---

## Findings

### Zero round-trip coverage for v0.7 MCP tools

**Severity:** Critical
**Type:** round-trip-gap
**Location:** No `*.test.mjs` or smoke-test invokes the v0.7 tools through the MCP stdio transport. Production: `src/server.mjs:571-937`.
**Confidence:** High

**Finding:** All seventeen v0.7 MCP tools (`hermes_a2a_create_task`, `hermes_a2a_get_task`, `hermes_a2a_update_task`, `hermes_a2a_list_tasks`, `hermes_anonymous_claim`, `hermes_anonymous_release`, `hermes_anonymous_state`, `hermes_dispatch_recommend`, `hermes_list_agents`, `hermes_record_outcome`, `hermes_record_task`, `hermes_user_grant_session`, `hermes_user_revoke_session`, `hermes_user_check_authorization`, `hermes_agent_health`, `hermes_agent_request_user_session`, `hermes_agent_resolve_blocked`, `hermes_agent_revoke_session`) are exercised only via direct module calls. The zod input schemas, the `registerTool` annotation surface, the `toolResult` / `toolError` envelope, and the stdio JSON-RPC framing are never exercised end-to-end. A schema typo (e.g. wrong `Owner` regex on a v0.7 tool) or a registration ordering bug would not fail any test.

**Evidence:** `Grep "hermes_a2a_create_task|hermes_anonymous_claim|hermes_dispatch_recommend|hermes_list_agents|hermes_record_outcome|hermes_record_task|hermes_user_grant_session|hermes_agent_health" --glob "*test*.mjs"` returns no matches in any test or smoke-test file. The only stdio probe in the suite is the `watch-events` webhook test in `coordination-smoke-test.mjs:338`, which does not use the MCP server at all.

**Suggested test:** New file `scripts/v07-stdio-roundtrip-smoke-test.mjs`. Spawn `node src/server.mjs` with `MCP_LOCK_WORKSPACE=<tmp>`, connect a `StdioClientTransport` from `@modelcontextprotocol/sdk/client/stdio.js`, then call each v0.7 tool with valid + invalid inputs and assert the response envelope. Cover at minimum: claim role with invalid role enum (zod must reject), `hermes_a2a_create_task` with valid input, `hermes_a2a_update_task` with invalid transition (must surface as `ok:false`), `hermes_user_grant_session` with `session_id` of length 7 (zod min-length), `hermes_record_outcome` with unknown outcome.

---

### HermesAgentBridge non-health code paths entirely untested

**Severity:** Critical
**Type:** missing-test
**Location:** `src/core/hermes-agent-bridge.mjs:240-329` (`requestUserSession`, `resolveBlocked`, `revokeOwnSession`, `_askAgent`, `_callProvider`); test surface in `scripts/anonymous-orchestrator-smoke-test.mjs:136-183`.
**Confidence:** High

**Finding:** Only `healthCheck()` is tested (disabled-state + no-providers-state). `requestUserSession`, `resolveBlocked`, `revokeOwnSession`, the failover cascade in `_askAgent`, the per-provider timeout in `_callProvider`, and the markdown-fence JSON-salvage path (`/```(?:json)?\s*([\s\S]*?)\s*```/`) are never exercised. The only verification of `DEFAULT_FAILOVER` is its identity as an array — neither the `registryProviders` extension, `modelOverrides`, nor the "all providers fail → defer to human" terminal branch is checked.

**Evidence:** `Grep "resolveBlocked|requestUserSession|revokeOwnSession|_askAgent|_callProvider|projectGoals" scripts/anonymous-orchestrator-smoke-test.mjs` → 0 matches.

**Suggested test:** Extend `scripts/anonymous-orchestrator-smoke-test.mjs` (or a new `hermes-agent-bridge-smoke-test.mjs`). Stub `globalThis.fetch` to return controlled responses per provider name, then assert: (a) cascade falls through to fallback when first provider returns 500, (b) markdown-fenced JSON is salvaged and parsed, (c) `revokeOwnSession()` returns `{ok:false}` with no active session, (d) `requestUserSession` without `projectGoals` returns `{ok:false, reason: /project goals/}`, (e) all-providers-fail returns `{ok:false, reason: /all providers failed/}`.

---

### Supervisor log rotation untested

**Severity:** High
**Type:** missing-test
**Location:** `scripts/mcp-supervisor.mjs:65-78` (1MB rotation); no test in `scripts/mcp-supervisor-smoke-test.mjs`.
**Confidence:** High

**Finding:** The log rotation block (`if (stat.size > 1024 * 1024) await fs.rename(logPath, logPath + ".old")`) is never exercised. A regression that broke rotation (e.g. wrong size constant, non-atomic rename, exception propagation) would not be caught.

**Evidence:** `Grep "stat\.size|logPath.*old|HERMESPROOF_SUPERVISOR_LOG" scripts/mcp-supervisor-smoke-test.mjs` → 0 matches.

**Suggested test:** Add to `mcp-supervisor-smoke-test.mjs`. Pre-write a log file >1MB at the path pointed to by `HERMESPROOF_SUPERVISOR_LOG`, run a supervisor cycle, assert that `<log>.old` exists after the next supervisor write and the new `<log>` is small.

---

### Supervisor `forwardSignal` no-active-child branch untested

**Severity:** High
**Type:** missing-test
**Location:** `scripts/mcp-supervisor.mjs:164-175` — when SIGTERM/SIGINT arrives during `delay(wait)` between respawns, `forwardSignal` calls `process.exit(0)` directly because `activeChild === null`.
**Confidence:** High

**Finding:** The "signal during backoff" path is the second of two distinct exit paths but has no dedicated test. The existing SIGTERM test (Unix-only, line 156) sends the signal while the child is alive, so it always hits the `activeChild.kill(sig)` branch.

**Evidence:** No test triggers a SIGTERM during the supervisor's `await delay(wait)` window between crash + respawn.

**Suggested test:** Add to `mcp-supervisor-smoke-test.mjs` (skipped on Windows). Mock server crashes immediately (exit 2), supervisor enters backoff, send SIGTERM during backoff (≤1 s after first crash log), assert process exits 0 and stderr contains `supervisor exiting` without `server crashed` repeating after the signal.

---

### Supervisor backoff math untested at boundaries

**Severity:** Medium
**Type:** boundary
**Location:** `scripts/mcp-supervisor.mjs:88-91` — `backoffMs(n) = min(1000 * 2^(n-1), 30000)`. Defaults: 1s/2s/4s/8s/16s/30s cap.
**Confidence:** High

**Finding:** No test asserts the formula at any specific crash count. The circuit-breaker test (`scripts/mcp-supervisor-smoke-test.mjs:192`) only asserts the breaker trips after 3 crashes — it does not introspect the wait between crashes. A regression that changed the doubling base or cap would pass the suite.

**Evidence:** `Grep "backoffMs" scripts/mcp-supervisor-smoke-test.mjs` → 0 matches.

**Suggested test:** Refactor `backoffMs` into a `module.exports` testable function (or `export` from a small util); add unit tests asserting `backoffMs(1)===1000`, `backoffMs(4)===8000`, `backoffMs(5)===16000`, `backoffMs(6)===30000`, `backoffMs(99)===30000`.

---

### Reputation tests share file state across cases (latent order dep)

**Severity:** Medium
**Type:** order-dep
**Location:** `src/core/reputation.test.mjs:11-20` — single `before/after` creates `rep` against `tmpDir`.
**Confidence:** Medium

**Finding:** Of eight cases in the file, four use `stateDirName` overrides to isolate (`.hermes-rep-reject`, `.hermes-rep2`, etc.), but two (`records merge outcome…` and `getScore returns null for unknown actor`, `leaderboard is sorted descending`) write to or read from the default-named state file shared by `rep`. If a future test added between them mutated `builder-a` or any default-named actor before the assertions ran, the test would silently change behavior. Codex's recent fix isolated one such drift; the same shape persists for the remaining cases.

**Evidence:** `src/core/reputation.test.mjs:23` writes `builder-a` against the shared `rep`; `src/core/reputation.test.mjs:65` reads via the shared `rep`. No `beforeEach` resets between them.

**Suggested test:** Convert the shared `before/after` into `beforeEach/afterEach` (mirroring `capability-dispatch.test.mjs:12`) so every case gets a fresh `tmpDir` + `rep`. Or, scope each case with its own `stateDirName` exactly the way the four already do.

---

### Skill-rotation tests share file state across cases (latent order dep)

**Severity:** Medium
**Type:** order-dep
**Location:** `src/core/skill-rotation.test.mjs:11-20`.
**Confidence:** Medium

**Finding:** Identical structural issue to reputation: single `before/after`, shared `sr`, several tests recordTask against the default state file. "leastLoadedForType returns sorted list" relies on counts produced by the prior two `recordTask` calls in the same case — fine — but the surrounding cases also recordTask against `claude-01` / `agent-a` / `agent-b` against the same file, so swapping order would produce different `total_tasks` assertions in earlier cases that use `>=`.

**Evidence:** `src/core/skill-rotation.test.mjs:22-37` records to `claude-01` then asserts `>=`. The use of `>=` is a tell that the author already noticed cross-test bleed.

**Suggested test:** Same fix as reputation — switch to `beforeEach`/per-case `stateDirName`. Then change `>=` assertions to exact `===`.

---

### A2A: status-string validation rejection path untested

**Severity:** Medium
**Type:** error-branch
**Location:** Production: `src/core/a2a-stub.mjs:135` — `if (!VALID_STATUSES.includes(new_status)) throw …`. Test surface: `src/core/a2a-stub.test.mjs`.
**Confidence:** High

**Finding:** All transition-rejection tests pass valid status names but illegal transitions (e.g. `submitted→completed`). No test passes an unknown status string (e.g. `"DONE"`, `"in_progress"`) to verify the early validation throw at line 135. Refactoring `VALID_STATUSES` would not fail the suite.

**Evidence:** `Grep "invalid status" src/core/a2a-stub.test.mjs` → 0 matches; only `invalid transition` is asserted.

**Suggested test:** Add to `src/core/a2a-stub.test.mjs`. `await assert.rejects(() => a2a.updateTask(task_id, "DONE"), /invalid status/);`

---

### A2A: agent_id / task_type required-field rejections untested

**Severity:** Medium
**Type:** error-branch
**Location:** `src/core/a2a-stub.mjs:98` — `if (!agent_id || !task_type) throw …`.
**Confidence:** High

**Finding:** No test calls `createTask` with missing `agent_id` or missing `task_type`. The throw branch is dead from the suite's perspective; only the schema layer in `server.mjs` partially covers this, and that layer itself is untested (see Critical above).

**Evidence:** Inspection of `src/core/a2a-stub.test.mjs` — every `createTask` invocation supplies both fields.

**Suggested test:** `await assert.rejects(() => a2a.createTask({ task_type: "x" }), /required/);` and the symmetric case missing `task_type`.

---

### A2A: missing transition coverage (`working↔input_required`, `submitted→canceled`)

**Severity:** Medium
**Type:** missing-test
**Location:** Production `VALID_TRANSITIONS` table at `src/core/a2a-stub.mjs:31-38`.
**Confidence:** High

**Finding:** Of the 8 valid transitions defined in the table, only 4 are covered by tests (`submitted→working`, `working→completed`, `working→failed`, plus the negative tests). Untested valid transitions: `submitted→canceled`, `working→input_required`, `working→canceled`, `input_required→working`, `input_required→canceled`. A typo in the table (e.g. removing `input_required` from `working`'s allow-list) would pass the suite.

**Evidence:** `Grep "input_required|canceled" src/core/a2a-stub.test.mjs` → only used in the VALID_STATUSES import, never as a transition target in a test body.

**Suggested test:** Add a test sweeping all 8 valid transitions and asserting each succeeds, plus rejection cases for the 28 invalid transitions (or a representative subset).

---

### A2A: TTL boundary at exactly TASK_TTL_MS untested

**Severity:** Low
**Type:** boundary
**Location:** `src/core/a2a-stub.mjs:170, 185` — `now - t.updated_ts > TASK_TTL_MS` (strict greater-than).
**Confidence:** Medium

**Finding:** The TTL test creates a task at `now - 25h` (4 h past TTL). The strict-greater-than vs greater-or-equal boundary at exactly `TASK_TTL_MS` is not asserted. Off-by-one regressions in the comparator would pass.

**Suggested test:** Two cases: task at `updated_ts = now - TASK_TTL_MS` (exactly at TTL → must remain visible per `>`) and `now - TASK_TTL_MS - 1` (just past → must be hidden).

---

### Capability-dispatch: single-actor candidate list untested

**Severity:** Medium
**Type:** boundary
**Location:** `src/core/capability-dispatch.mjs:71-74` — `maxLoad` initialized to 1; with a single actor whose load is 0, the load term is `0/1 = 0`; with load 5, `5/5 = 1`.
**Confidence:** High

**Finding:** No test exercises the singleton-list shape, which was the exact failure mode the regression "rankActors load normalization" was introduced to fix. The fix is asserted only in the multi-actor case — a regression that re-collapsed singleton normalization (e.g. via a new `Math.max(maxLoad, 0)` instead of `1`) would pass.

**Suggested test:** `const r = await dispatch.rankActors("gate", ["solo"]); assert.equal(r.length, 1); assert.ok(r[0].dispatch_score > 0);` plus a second assertion that the score equals `1.0 * 0.5 + 0.5 * 0.3 - 0 * 0.2 = 0.65` (i.e. the formula at boundary).

---

### Capability-dispatch: RECENCY_WINDOW_MS boundary untested

**Severity:** Low
**Type:** boundary
**Location:** `src/core/capability-dispatch.mjs:30, 79` — recency cliff at exactly 10 min.
**Confidence:** Medium

**Finding:** No test pins `last_active_ts` near the 10-minute cliff. A regression replacing `<` with `<=` would shift the cliff position by 1 ms but not fail any test.

**Suggested test:** Construct skill state with `last_active_ts = now - RECENCY_WINDOW_MS + 1` (recency=1.0) vs `now - RECENCY_WINDOW_MS` (recency=0.5) and assert the composite score difference equals `0.5 * 0.3 = 0.15`.

---

### Reputation: WINDOW_SIZE event-truncation behavior untested

**Severity:** Medium
**Type:** boundary
**Location:** `src/core/reputation.mjs:82` — `if (rec.events.length > WINDOW_SIZE) rec.events = rec.events.slice(-WINDOW_SIZE)`.
**Confidence:** High

**Finding:** No test records >30 outcomes for a single actor and asserts that the score reflects only the last 30 events (and that the ledger keeps `total_outcomes` advancing). The clamp-at-zero test covers ≤3 events. The window-slide is the most behaviorally interesting branch in the file; it is untested.

**Suggested test:** Record 35 alternating merge/reject; final score must reflect only the last 30; `total_outcomes` must equal 35; `rec.events.length` must equal 30.

---

### Reputation: rankedActors min_score threshold untested

**Severity:** Low
**Type:** missing-test
**Location:** `src/core/reputation.mjs:117-120`.
**Confidence:** High

**Finding:** `rankedActors()` is called by no test, even though it's part of the public API surface. Default `min_score=0.25` and the explicit override path are dead from the suite's perspective.

**Suggested test:** Mix of high- and low-score actors; `rankedActors()` filters to >=0.25; `rankedActors({min_score:1.5})` filters more aggressively.

---

### Skill-rotation: TRIM_AFTER prune branch untested

**Severity:** Low
**Type:** missing-test
**Location:** `src/core/skill-rotation.mjs:64-70`.
**Confidence:** High

**Finding:** The `>1000 actors → prune idle` branch is dead from the suite's perspective. Production won't routinely hit it, but a regression that broke the cutoff math (e.g. ms vs sec) would silently degrade the file in long-running deployments.

**Suggested test:** Seed state file with 1001 synthetic actors, half with `last_active_ts` >24h ago; `recordTask` for a fresh actor; assert stale ones are deleted.

---

### Anonymous-orchestrator: claimRole renew-existing path untested

**Severity:** Medium
**Type:** missing-test
**Location:** `src/core/anonymous-orchestrator.mjs:113-117` — when same `actor_id` already holds the role, only `expires_at` is bumped (no duplicate entry).
**Confidence:** High

**Finding:** No test claims the same role twice with the same `actor_id`. A regression that started pushing duplicates would pass the suite.

**Suggested test:** `await orch.claimRole({role:BUILDER, actor_id:"a"})`, then again with the same args; assert `state.active_roles.BUILDER.length === 1` and the `expires_at` advanced.

---

### Anonymous-orchestrator: tickExpirations user-session path untested

**Severity:** Medium
**Type:** missing-test
**Location:** `src/core/anonymous-orchestrator.mjs:250-257`.
**Confidence:** High

**Finding:** `tickExpirations` clears expired user sessions and emits an evidence entry. The test only covers the role-claim arm. A regression in the user-session arm (e.g. clearing the session while it's still valid) would pass.

**Suggested test:** Grant a session with `ttl_ms:1`, sleep 5ms, call `tickExpirations()`, assert `state.active_user_session === null` AND an evidence entry of kind `user_session_expired_tick` was appended.

---

### Anonymous-orchestrator: history bound at 200 untested

**Severity:** Low
**Type:** boundary
**Location:** `src/core/anonymous-orchestrator.mjs:126, 139, 178, 192` — `state.history = state.history.slice(-200)` repeated four times.
**Confidence:** High

**Finding:** No test verifies that `history` doesn't grow without bound. A regression that dropped the slice on one of the four call sites would silently leak memory.

**Suggested test:** Loop `claimRole` 250 times (varying actor_id), call `getState()`, assert `state.history.length === 200`.

---

### Anonymous-orchestrator: parallel claim concurrency untested

**Severity:** High
**Type:** concurrency-gap
**Location:** `src/core/anonymous-orchestrator.mjs:108-127` — `_readState()` then `_writeState()`, no serialize-mutex (unlike `A2AStub._serialize`).
**Confidence:** High

**Finding:** `claimRole` does an unguarded read-modify-write. Two concurrent calls for different roles or actors can lose updates — exactly the bug `A2AStub._mutateQueue` was added to prevent. There is no concurrency test for any orchestrator method (claim, release, grant, revoke, tick).

**Evidence:** `Grep "Promise\.all.*claimRole|Promise\.all.*grantUserSession" scripts/anonymous-orchestrator-smoke-test.mjs` → 0 matches.

**Suggested test:** Mirror the a2a-stub 50-parallel test. Fire 50 concurrent `claimRole` calls for different actors/roles and assert all 50 land in `state.active_roles` (no lost updates). If this currently fails, the bug is real and this finding upgrades to "missing safety test for known-broken code path" — the audit author should re-classify after running.

---

### Smoke-test docstrings vs. reality

**Severity:** Medium
**Type:** claim-vs-reality
**Location:** Each `*-smoke-test.mjs` top comment.
**Confidence:** Medium

**Finding:** Comparing each smoke test's stated coverage to its test bodies:

- `scripts/coordination-smoke-test.mjs` — no top-of-file docstring; coverage is whatever the tests run. No drift.
- `scripts/hardening-smoke-test.mjs` — no top-of-file docstring.
- `scripts/perf-v0.5.1-smoke-test.mjs` — claims 5 areas; all 5 appear to have at least one test. No drift detected.
- `scripts/registry-validate-smoke-test.mjs` — no docstring.
- `scripts/anonymous-orchestrator-smoke-test.mjs:2-7` claims to test `AnonymousOrchestrator + HermesAgentBridge`; in fact tests the orchestrator end-to-end but exercises only `HermesAgentBridge.healthCheck` (1 of 6 public methods + ~5 internal helpers). The phrase "Bridge is exercised in DISABLED mode (no network calls) plus a synthetic mock of the agent decision call" is misleading — there is no synthetic mock of the agent decision call anywhere in the file.
- `scripts/mcp-supervisor-smoke-test.mjs:3-13` claims coverage of "supervisor spawns the configured server, on a synthetic crash supervisor respawns, circuit breaker trips after MAX_CRASHES in window, clean exit (code 0) terminates supervisor cleanly, SIGTERM forwarded to child". The respawn-after-crash behavior is verified only indirectly via the circuit-breaker test (which observes 3 crashes in stderr). There is no standalone "respawn once on crash" test that verifies the child re-spawns and reaches "ready" again — i.e. the post-respawn happy path is unverified.
- `scripts/secret-rotation-smoke-test.mjs` — docstring lists 7 cases; the file delivers 7 cases. No drift.

**Suggested test:** Update the `anonymous-orchestrator-smoke-test.mjs` docstring to honestly state "exercises bridge healthCheck only" — or add a synthetic-fetch mock that asserts requestUserSession's full flow as the docstring already claims. Add a `mcp-supervisor-smoke-test.mjs` "respawn happy-path" test that verifies a single respawn reaches a fresh "ready" line on stdout.

---

### Cross-platform: implicit Date.now() / timing assumptions

**Severity:** Low
**Type:** platform-gap
**Location:** `src/core/a2a-stub.test.mjs:90-101, 125-161` (TTL tests use `Date.now() - 25h`); `scripts/anonymous-orchestrator-smoke-test.mjs:103-114` (1ms TTL with 5ms sleep); `mcp-supervisor-smoke-test.mjs:155` correctly skips on Windows.
**Confidence:** Medium

**Finding:** The 1ms-TTL + 5ms-sleep pattern in `anonymous-orchestrator-smoke-test.mjs` is fragile under loaded CI runners: if the event loop pauses ≥1ms before `grantUserSession` resolves, the session may already be expired before the test code reaches `setTimeout`. The race is benign on fast hardware but could flake on Windows containers under contention. Same shape would apply to a similar pattern in any future a2a TTL test.

**Suggested test:** Treat TTL via injectable clock — pass an `unsafe_now` constructor option to `AnonymousOrchestrator` (production already exists in pattern) or use a small wrapper. As an audit-only finding, no fix is requested; flagged for stability watch.

---

### Drift: hard-coded counts that mask regressions

**Severity:** Low
**Type:** drift
**Location:** No test asserts the v0.7 tool count exposed by `server.mjs` (32 per the README). If `registerTool` calls were silently dropped during a merge conflict, no test would fire.
**Confidence:** High

**Finding:** The README reports "32 MCP tools" (from the recent commit `e36c2b2`). The test suite contains no assertion on the tool list length or membership. Add one — even just `assert.equal(tools.length, 32)` — and tightly couple drift to a CI failure.

**Evidence:** `Grep "tools\.length\s*===|tools\.length\s*==" --glob "*.mjs"` returns 0 matches in any test file.

**Suggested test:** Combine with the proposed v0.7 stdio round-trip test. After connecting the client, call `client.listTools()` and assert `result.tools.length === 32` AND that each of the v0.7 tool names is present in the returned set.

---

## Coverage notes

What was scanned and how:

- All v0.7 production modules read in full: `src/core/a2a-stub.mjs` (195 LOC), `src/core/capability-dispatch.mjs` (121), `src/core/reputation.mjs` (123), `src/core/skill-rotation.mjs` (122), `src/core/anonymous-orchestrator.mjs` (263), `src/core/hermes-agent-bridge.mjs` (399), `scripts/mcp-supervisor.mjs` (234), and `src/server.mjs` (940) for the v0.7 tool block (lines 568-937).
- All v0.7 test files read in full: `src/core/a2a-stub.test.mjs` (162), `src/core/capability-dispatch.test.mjs` (77), `src/core/reputation.test.mjs` (88), `src/core/skill-rotation.test.mjs` (66), `scripts/anonymous-orchestrator-smoke-test.mjs` (183), `scripts/mcp-supervisor-smoke-test.mjs` (221).
- Test runner script in `package.json` enumerated.

Greps performed:

- `Grep "_mutateQueue|_serialize"` across `*.test.mjs` — 0 matches (concurrency mutex untested except via the 50-parallel test that exercises it indirectly).
- `Grep "tickExpirations|recommendNextType|leastLoadedForType|getActor|rankedActors|getScore|pruneCompleted"` across `*.test.mjs` and `*-smoke-test.mjs` — `pruneCompleted` covered (a2a), `getScore` covered, `getActor` covered, `leastLoadedForType` covered, `recommendNextType` covered, `tickExpirations` covered (role arm only), `rankedActors` 0 matches.
- `Grep "resolveBlocked|requestUserSession|revokeOwnSession|_askAgent|_callProvider"` across all test files — 0 matches.
- `Grep "hermes_a2a_create_task|hermes_anonymous_claim|hermes_dispatch_recommend|hermes_list_agents|hermes_record_outcome|hermes_record_task|hermes_user_grant_session|hermes_agent_health|hermes_agent_request_user_session"` — 0 matches in any test file.
- `Grep "forwardSignal|backoffMs|purgeOldCrashes|HERMESPROOF_SUPERVISOR_LOG|HERMESPROOF_SUPERVISOR_DISABLED|stat\.size"` in `mcp-supervisor-smoke-test.mjs` — 0 matches.
- `Grep "A2AStub|AnonymousOrchestrator|ReputationTracker|SkillRotation|CapabilityDispatch|HermesAgentBridge"` across `scripts/` — only `anonymous-orchestrator-smoke-test.mjs` imports any of these.
- `Grep "Promise\.all.*claimRole|Promise\.all.*grantUserSession"` in test files — 0 matches.
- `Grep "tools\.length\s*===|tools\.length\s*=="` in test files — 0 matches.

What was not scanned:

- `src/core/registry-providers.mjs` (out of scope per task brief).
- Production-code semantics, security, or architecture (out of scope).
- Truth-gates and CI workflows beyond what `package.json test` invokes.
