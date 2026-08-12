# Architecture Coherence Audit — HermesProof v0.7

**Repo:** `G:\Github\hermes3d-mcp-lock-orchestrator`
**Branch:** `main` @ `41258ef`
**Scope:** Architecture coherence only (module boundaries, layering, coupling, state ownership, failure-mode interaction). NOT code quality, security, tests, or docs.
**Date:** 2026-05-03

## Summary

| # | Title | Severity | Type |
|---|-------|----------|------|
| 1 | Two parallel evidence ledgers (chained vs unchained) | High | boundary-violation |
| 2 | `server.mjs` has no SIGTERM/SIGINT/stdin-EOF handling | High | shutdown-gap |
| 3 | `CapabilityDispatch` instantiates new `ReputationTracker` + `SkillRotation`, parallel to `server.mjs` instances | High | hidden-coupling |
| 4 | A2A "stub" stores durable state and registers tools as if it were core | Medium | boundary-violation |
| 5 | Single-process mutex assumption is implicit, not enforced; only `a2a-stub` has a mutex | High | state-race |
| 6 | Schema versions are siloed — no central registry, no migration story | Medium | schema-drift |
| 7 | TTL constants are scattered and uncalibrated as a set | Medium | ttl-incoherence |
| 8 | `init()` order is implicit; nothing enforces it | Low | hidden-coupling |
| 9 | `HermesAgentBridge.activeSessionId` lives in process memory only | Medium | state-race |
| 10 | Lock manager has structured event taxonomy; v0.7 modules emit ad-hoc evidence kinds | Low | boundary-violation |
| 11 | Owner regex enforced at server.mjs schema layer, but bypassed by direct manager calls | Low | hidden-coupling |
| 12 | Reputation rolling window recomputation IS correct at boundary case | Info | other |

---

## 1. Two parallel evidence ledgers (chained vs unchained)
**Severity:** High
**Type:** boundary-violation
**Location:** `src/core/anonymous-orchestrator.mjs:50,81-89`, `src/core/fs-utils.mjs:245`, `src/core/lock-manager.mjs:480`
**Confidence:** High

**Finding:** The pre-v0.7 evidence ledger lives at `.hermes3d_orchestrator/evidence/ledger.ndjson` and is hash-chained via `appendChainedJsonLine` / verified via `verifyChainedLog`. The v0.7 `AnonymousOrchestrator` writes a separate evidence file at `.hermes3d_orchestrator/evidence.ndjson` (sibling of the `evidence/` directory, not inside it) using a plain `fs.appendFile` — no `prev_hash`, no `entry_hash`, no participation in the chain. `hermes_verify_evidence` will not detect tampering of role-claim or user-session-grant entries.

**Evidence:**
- `fs-utils.mjs:245` — `evidenceFile: path.join(stateDir, "evidence", "ledger.ndjson")`
- `anonymous-orchestrator.mjs:50` — `this.evidenceFile = path.join(this.stateDir, "evidence.ndjson")`
- `anonymous-orchestrator.mjs:81-89` — uses `fs.appendFile(this.evidenceFile, line, "utf8")` directly with no chaining
- `lock-manager.mjs:480` — `appendChainedJsonLine(this.paths.evidenceFile, entry)`

**Architectural impact:** This is the most significant single architectural drift in v0.7. The "evidence ledger" is the core integrity artifact of the system — splitting it in two means: (a) the v0.7 audit trail has no tamper-evidence, undermining the role/USER-grant story; (b) any future "verify everything" tool must walk two log formats; (c) v0.8+ work that adds another module will face a binary choice (which evidence file?) with no architectural answer; (d) the directory structure suggests `evidence/` is a holder for evidence files, but `evidence.ndjson` sits *next to* that directory — a confusing layout that will compound.

**Suggested remediation:** Route all v0.7 evidence through the existing chained ledger. Either:
- Inject the lock manager (or a thin "EvidenceLedger" facade) into `AnonymousOrchestrator`, `A2AStub`, etc., and have them call `appendChainedJsonLine(paths.evidenceFile, ...)`.
- Or extract `EvidenceLedger` as its own core module: `src/core/evidence-ledger.mjs` exposing `append({kind, ...})` and `verify()`, owned by exactly one module, consumed by all.

The second approach is preferable — it gives v0.8+ a single seam to extend.

---

## 2. `server.mjs` has no SIGTERM/SIGINT/stdin-EOF handling
**Severity:** High
**Type:** shutdown-gap
**Location:** `src/server.mjs:939-940`
**Confidence:** High

**Finding:** The server's shutdown story is:
```js
const transport = new StdioServerTransport();
await server.connect(transport);
```
There are no `process.on("SIGTERM", ...)`, `process.on("SIGINT", ...)`, or `process.stdin.on("end", ...)` handlers. The user just landed two fixes in the supervisor for stdin-EOF propagation and SIGTERM clean exit; the supervisor now correctly forwards these signals — but the server itself relies on Node defaults to translate them into a process exit, with no opportunity to:
- Drain in-flight `writeJsonAtomic` operations (atomic-rename is *almost* atomic but the .tmp write + rename is two syscalls — interruption between them leaves an orphan `.tmp` file)
- Drain in-flight `appendChainedJsonLine` (read tail → compute hash → append — interruption can leave a partially written final line, breaking the chain on next read)
- Drain the `_mutateQueue` Promise chain in `A2AStub` (queued mutations are silently dropped)
- Flush the lock manager's atomic writes
- Call `tickExpirations()` to record final state
- Emit a `server.shutdown` evidence entry

**Evidence:**
- `src/server.mjs` end-of-file: no signal handlers
- `scripts/mcp-supervisor.mjs:176-177` — supervisor handles signals, expects child to also handle them
- `src/core/fs-utils.mjs:54-59` — `writeJsonAtomic` is two syscalls (writeFile then rename), no fsync
- `src/core/a2a-stub.mjs:50,75-86` — `_mutateQueue` is in-process state with no shutdown drain

**Architectural impact:** Today this manifests as occasional `.tmp` orphans and *possibly* torn evidence chain entries on harsh shutdowns. As v0.8+ adds more state-mutating modules (each with its own JSON state file) the surface area grows linearly. The supervisor circuit-breaker (10 crashes in 5min → exit 1) would compound if each crash leaves torn state — the next spawn might fail to read malformed state.

**Suggested remediation:** Add a shutdown coordinator at the bottom of `src/server.mjs`:
```js
const shutdown = async (sig) => {
  try { await a2a._mutateQueue; } catch {}
  try { await anon.tickExpirations(); } catch {}
  // emit final evidence entry
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.stdin.on("end", () => shutdown("stdin-EOF"));
```
Better long-term: have every core module expose a `shutdown()` method, and have `server.mjs` await `Promise.all([...modules.map(m => m.shutdown())])`.

---

## 3. `CapabilityDispatch` instantiates new `ReputationTracker` + `SkillRotation`, parallel to `server.mjs` instances
**Severity:** High
**Type:** hidden-coupling
**Location:** `src/server.mjs:49-50`, `src/core/capability-dispatch.mjs:38-47`
**Confidence:** High

**Finding:** `server.mjs` creates `reputation = new ReputationTracker(...)` and `skills = new SkillRotation(...)` on lines 49-50. Then on line 50 it creates `dispatch = new CapabilityDispatch(...)`. Inside the `CapabilityDispatch` constructor:
```js
this.reputation = new ReputationTracker({ workspaceRoot, stateDirName });
this.skills = new SkillRotation({ workspaceRoot, stateDirName });
```
There are now **two** `ReputationTracker` instances and **two** `SkillRotation` instances pointing at the same state files. The state is file-backed and there's no in-memory cache, so this is *currently* not corrupting data — but:
- Each call path makes its own redundant `readJson` round-trip
- If anyone later adds caching to either module (very tempting for `leaderboard()` performance), the two instances will diverge silently
- `init()` is called twice on each backing file — once via `server.mjs:73-74`, once via `dispatch.init()` on line 73

**Evidence:**
- `server.mjs:49-50` — direct instantiation of reputation + skills
- `server.mjs:73` — `await dispatch.init()` calls `reputation.init() + skills.init()` again on lines 45-47 of `capability-dispatch.mjs`
- `capability-dispatch.mjs:40-41` — `new ReputationTracker(...) ; new SkillRotation(...)`

**Architectural impact:** The dependency graph is *almost* a DAG, but `CapabilityDispatch` doesn't compose its dependencies — it duplicates them. v0.8+ work that adds caching, in-memory listeners, or anything stateful to ReputationTracker will hit a "which instance?" bug. This pattern, if copied to future composers, will make the in-memory state space combinatorial.

**Suggested remediation:** Inject dependencies rather than instantiating them. `CapabilityDispatch` constructor should accept `{ reputation, skills }`:
```js
const dispatch = new CapabilityDispatch({ reputation, skills });
```
Same fix applies to `HermesAgentBridge` (which already correctly receives `orchestrator` via constructor — proves the pattern is known, just not applied uniformly).

---

## 4. A2A "stub" stores durable state and registers tools as if it were core
**Severity:** Medium
**Type:** boundary-violation
**Location:** `src/core/a2a-stub.mjs`, `src/server.mjs:763-891`
**Confidence:** High

**Finding:** `A2AStub` is named "stub" and the file header says "This is a STUB — it persists task state and enforces valid transitions but does not orchestrate execution." But:
- It owns durable state (`a2a_tasks.json`)
- It registers four MCP tools: `hermes_a2a_create_task`, `hermes_a2a_get_task`, `hermes_a2a_update_task`, `hermes_a2a_list_tasks`
- It implements a state machine with valid transitions
- It implements TTL-based pruning
- It implements a Promise-chain mutex (the only module to do so)

That's not a stub — that's a fully-fledged A2A task lifecycle module. Calling it a "stub" creates a future maintenance trap: someone will assume "stub = throwaway" and either remove it or replace it without realizing 4 production tools depend on it.

**Evidence:**
- `a2a-stub.mjs:1-22` — header self-describes as "STUB"
- `a2a-stub.mjs:50` — `_mutateQueue = Promise.resolve()` — a real mutex, not a stub
- `server.mjs:763-891` — 4 user-facing tools registered against `a2a`

**Architectural impact:** "stub" naming aside, the deeper question is: **is there a missing line between `src/core/` (production orchestration primitives) and "experimental protocol scaffolds"?** Today everything goes in `core/`. If A2A doesn't ship as v1.0 stable, where does it go? `src/experimental/`? `scripts/`? Without that boundary, every protocol experiment (MCP-Bus, FIPA, etc.) will land in `core/` and accrete.

**Suggested remediation:** Either:
- Rename to `src/core/a2a-task-manager.mjs` and remove the "stub" framing — admit it's production
- Or move to `src/experimental/a2a/` and gate the tool registrations behind `HERMES_A2A_ENABLED=1`, similar to how `HermesAgentBridge` gates on `HERMES_AGENT_ENABLED=1`

The first is the lower-risk change.

---

## 5. Single-process mutex assumption is implicit; only `a2a-stub` has a mutex
**Severity:** High
**Type:** state-race
**Location:** All v0.7 modules; `fs-utils.mjs:84` (comment); `a2a-stub.mjs:50`
**Confidence:** High

**Finding:** Every state-mutating module follows the read-modify-write pattern over `writeJsonAtomic`. Only `A2AStub` serializes its mutations through a `_mutateQueue` Promise chain. `AnonymousOrchestrator`, `ReputationTracker`, `SkillRotation`, `HermesAgentBridge` do not. The comment at `fs-utils.mjs:84` says "this assumes a single-process appender (which the MCP server is)" — but within a single Node process, two concurrent MCP tool handlers can absolutely race a read-modify-write cycle.

Concrete failure case: Two MCP clients (Claude + Codex) both call `hermes_anonymous_claim` for role `BUILDER` at the same time. Both `_readState()` calls return the same state. Both modify `state.active_roles[BUILDER]`. Both `_writeState()` — the second wins, the first claim is silently lost. Resolution is **non-deterministic**.

Same race exists in:
- `reputation.recordOutcome` — concurrent outcome records can lose events
- `skill-rotation.recordTask` — concurrent records can lose increments
- `anonymous-orchestrator.grantUserSession` / `revokeUserSession` — race window between the "active session exists?" check and the write

**Evidence:**
- `a2a-stub.mjs:50,75-86` — only place that serializes mutations
- `anonymous-orchestrator.mjs:108-129` — read, modify, write with no lock
- `reputation.mjs:67-91` — read, modify, write with no lock
- `skill-rotation.mjs:49-74` — read, modify, write with no lock

**Architectural impact:** The lock manager itself uses filesystem `mkdir` for atomic directory creation as the lock primitive, sidestepping this problem. The v0.7 modules don't get that for free because they don't manipulate per-key directories. As concurrent client count grows (this server is *designed* for multi-client coordination), the race rate grows quadratically. Reputation drift between agents will silently miscount outcomes.

**Suggested remediation:** Promote the `_mutateQueue` pattern from `A2AStub` to `fs-utils.mjs` as a `SerializedJsonStore`:
```js
export class SerializedJsonStore {
  constructor(file, defaultState) { ... }
  async mutate(fn) { /* serialize read-modify-write */ }
}
```
Migrate every v0.7 module to use it. This is a non-breaking refactor — file format unchanged, behavior strictly more correct.

---

## 6. Schema versions are siloed — no central registry, no migration story
**Severity:** Medium
**Type:** schema-drift
**Location:** All modules with `schema_version`
**Confidence:** High

**Finding:** Every state file has `schema_version: 1`, but:
- There is no central list of (file → current_version)
- There is no migration runner — v1 is the only version anyone has ever seen
- Each module's `init()` writes `schema_version: 1` if missing but doesn't validate the version on read
- `event-manager.mjs:156-162` does validate `event_schema_version` against `EVENT_SCHEMA_VERSION = 1` and routes mismatches to `failed/` — a reasonable pattern, but it's not adopted by any other module
- `queue-manager.mjs` does `task_schema_version` checks on read — also good, also not adopted by v0.7
- `anonymous-orchestrator.mjs`, `reputation.mjs`, `skill-rotation.mjs`, `a2a-stub.mjs` write `schema_version: 1` but never check it on read

**Evidence:** see grep result for `schema_version` — eleven sites, three different patterns.

**Architectural impact:** The first time anyone bumps a schema version (v1 → v2), they will:
1. Modify the producer's write path
2. Forget the reader doesn't check version → silently misinterprets old data, OR
3. Add a check, find no migration framework, write an ad-hoc migrator inline → next module inherits the inline pattern

By the time three modules need migration there will be three different migration styles.

**Suggested remediation:** Add `src/core/schema-registry.mjs`:
```js
export const SCHEMAS = {
  "anonymous_orchestrator.json": { version: 1, migrate: { /* 1→2: ... */ } },
  "reputation.json":             { version: 1, migrate: {} },
  // ...
};
export async function readVersionedJson(file, schemaName) { ... }
```
And require every module to read through it. Even if no migrations exist yet, the seam is in place for v0.8.

---

## 7. TTL constants are scattered and uncalibrated as a set
**Severity:** Medium
**Type:** ttl-incoherence
**Location:** Multiple
**Confidence:** High

**Finding:** TTL/window constants in v0.7:

| Constant | Value | Module | What it gates |
|---|---|---|---|
| `DEFAULT_TTL_MINUTES` | 90 min | `lock-manager.mjs:25` | Lock TTL |
| `DEFAULT_TTL_MINUTES` | 120 min | `queue-manager.mjs:17` | Queue task TTL |
| `DOCTOR_CACHE_TTL_MS` | 30 s | `lock-manager.mjs:30` | Doctor cache |
| `USER_SESSION_TTL_MS` | 8 h | `anonymous-orchestrator.mjs:36` | AS_USER session |
| `ROLE_CLAIM_TTL_MS` | 30 min | `anonymous-orchestrator.mjs:37` | Anonymous role |
| `WINDOW_SIZE` | 30 events | `reputation.mjs:27` | Reputation window |
| `RECENCY_WINDOW_MS` | 10 min | `capability-dispatch.mjs:30` | "fresh" actor |
| `TASK_TTL_MS` | 24 h | `a2a-stub.mjs:40` | A2A task auto-archive |
| `TRIM_AFTER` / cutoff | 24 h | `skill-rotation.mjs:19,66` | Stale actor cleanup |
| `MAX_CRASHES`/`WINDOW_MS` | 10 / 5 min | `mcp-supervisor.mjs:44-45` | Crash circuit-breaker |
| `HEALTH_TIMEOUT_MS` | 5 s | `hermes-agent-bridge.mjs:138` | Provider health |
| `PROVIDER_TIMEOUT_MS` | 25 s | `hermes-agent-bridge.mjs:139` | Per-provider call |
| `DECISION_OVERALL_TIMEOUT_MS` | 60 s | `hermes-agent-bridge.mjs:140` | Total decision |

Implied timescales of the system:
- **Sub-second:** none coordinated
- **Seconds:** doctor cache (30s), provider timeouts (5s/25s/60s)
- **Minutes:** recency (10m), role claim (30m), supervisor window (5m), lock (90m), queue (120m)
- **Hours:** USER session (8h), A2A task (24h), skill cleanup (24h)
- **Tens of events:** reputation (30)

The lock TTL (90 min) and role claim TTL (30 min) are the only ones the user/agent must mentally track; they're 3× apart with no documented reason. The `RECENCY_WINDOW_MS` (10 min) is **shorter** than the role claim TTL (30 min) — meaning an actor can be "stale" (per dispatch) while still actively holding a role. That's likely a bug or at least a coordination gap.

The supervisor's 5-min crash window is 6× shorter than the lock TTL — so a circuit-breaker trip + restart loses the supervisor but leaves locks held by the dead session intact for up to 90 more minutes.

**Architectural impact:** v0.7 introduced 6 new timescales without aligning them to the existing two (lock + queue). Future work will keep adding TTLs without a calibration story.

**Suggested remediation:** Add `src/core/ttl-config.mjs` with a single exported object documenting all TTLs and their relationships. Specifically:
- `RECENCY_WINDOW_MS` should likely be `>=` `ROLE_CLAIM_TTL_MS` so a role-holder is never "stale"
- `MAX_CRASHES_WINDOW_MS` should align with lock TTL so circuit-breaker recovery doesn't strand locks

---

## 8. `init()` order is implicit; nothing enforces it
**Severity:** Low
**Type:** hidden-coupling
**Location:** `src/server.mjs:70-75`
**Confidence:** Medium

**Finding:**
```js
await manager.init();
await skills.init();
await reputation.init();
await dispatch.init();
await a2a.init();
await anon.init();
```
This sequence works only because `dispatch.init()` re-inits the same skills + reputation files (idempotent because `readJson(... null)` short-circuits when state exists). But the order matters in a subtle way: if `dispatch.init()` ran *before* `skills.init()` / `reputation.init()`, dispatch would be the initial creator. That's fine *today*, but if any module's `init()` ever stops being idempotent (e.g. a migration step that runs once), the implicit ordering becomes a runtime bug.

`registryLoad` happens between the constructors (line 57) and the `await manager.init()` block — also order-sensitive with `hermesAgent` constructor (which uses `registryLoad.providers`).

**Evidence:** server.mjs:46-75 is a flat sequence with no dependency declaration.

**Architectural impact:** Low for now (everything is idempotent), but adding non-idempotent init steps in v0.8+ will reveal the implicit graph one bug at a time.

**Suggested remediation:** Declare dependencies explicitly:
```js
const modules = [
  { name: "manager", init: () => manager.init() },
  { name: "skills", init: () => skills.init() },
  // ...
];
for (const m of modules) await m.init();
```
Better: a small DI container that resolves init order from declared deps.

---

## 9. `HermesAgentBridge.activeSessionId` lives in process memory only
**Severity:** Medium
**Type:** state-race
**Location:** `src/core/hermes-agent-bridge.mjs:171,272,283-286`
**Confidence:** High

**Finding:** `HermesAgentBridge` tracks the session it issued via the in-memory field `this.activeSessionId`. The corresponding `active_user_session` in the orchestrator is durable (file-backed). On supervisor-driven restart:
- The orchestrator reloads `active_user_session` from disk (still valid, still un-expired)
- `HermesAgentBridge` constructs fresh with `activeSessionId = null`
- A subsequent `revokeOwnSession()` returns `{ ok: false, reason: "no active bridge session" }` — even though the session DOES exist in the orchestrator and is attributed to "hermes-agent"

The bridge has effectively orphaned its own session.

**Evidence:**
- `hermes-agent-bridge.mjs:171` — `this.activeSessionId = null` in constructor
- `hermes-agent-bridge.mjs:272` — set on grant
- `hermes-agent-bridge.mjs:283-286` — read on revoke

**Architectural impact:** Combined with the supervisor's auto-restart behavior, this creates a "zombie session" pattern: the orchestrator believes hermes-agent has authority for up to 8 hours after a crash, but no in-process bridge state can revoke it. The only recovery path is calling the orchestrator's `revokeUserSession` with the session_id — which the operator doesn't know.

**Suggested remediation:** On bridge construction (or first call), reconcile from durable state:
```js
const state = await this.orchestrator.getState();
if (state.active_user_session?.granted_by === "hermes-agent") {
  this.activeSessionId = state.active_user_session.session_id;
}
```
Or eliminate the in-memory field entirely and always read from the orchestrator.

---

## 10. Lock manager has structured event taxonomy; v0.7 modules emit ad-hoc evidence kinds
**Severity:** Low
**Type:** boundary-violation
**Location:** `event-manager.mjs:23-39`, `anonymous-orchestrator.mjs:128,141,180,194,214,251`
**Confidence:** High

**Finding:** The pre-v0.7 `EventManager` defines a closed set of `EVENT_TYPES` (15 entries — `task.enqueued`, `lock.acquired`, etc.) with `next_actor` and `recommended_action` fields. The v0.7 evidence entries use free-form `kind` strings: `role_claim`, `role_release`, `user_session_grant`, `user_session_revoke`, `user_session_expired_lazy`, `user_session_expired_tick` — never registered in the event taxonomy, never consumable by the existing `hermes_list_events` tool.

This means a watcher subscribing to `events.ndjson` will not see role/session activity. The two systems are talking past each other.

**Architectural impact:** Two parallel event streams violate the "one event log" assumption that downstream consumers (review packets, dashboards, watchers) rely on.

**Suggested remediation:** Extend `EVENT_TYPES` to include `role.claimed`, `role.released`, `session.granted`, `session.revoked`, `session.expired`. Have `AnonymousOrchestrator` route through `EventManager.emitEvent(...)` in addition to (or instead of) its private evidence file.

---

## 11. Owner regex enforced at server.mjs schema layer, but bypassed by direct manager calls
**Severity:** Low
**Type:** hidden-coupling
**Location:** `server.mjs:84-87`, `anonymous-orchestrator.mjs:105`
**Confidence:** Medium

**Finding:** The `Owner` regex (`^[a-z][a-z0-9-]{1,63}$`) is enforced in two places:
- `server.mjs:84-87` via Zod
- `anonymous-orchestrator.mjs:105` via inline regex

The two regexes are identical but duplicated. The other v0.7 modules accept any string. If any future caller invokes `reputation.recordOutcome()` directly without the Zod gate (e.g. a script in `scripts/`), invalid actor IDs flow through to disk.

**Architectural impact:** Validation is supposed to happen at the boundary; right now there are two boundaries with overlapping regex.

**Suggested remediation:** Centralize the regex in `fs-utils.mjs` (or a new `src/core/validators.mjs`) and import it into both sites.

---

## 12. Reputation rolling window recomputation IS correct at boundary case
**Severity:** Info
**Type:** other
**Location:** `reputation.mjs:81-88`
**Confidence:** High

**Finding:** The audit prompt asked specifically about event #31 vs `WINDOW_SIZE = 30`:
```js
rec.events.push(event);                          // length now 31
if (rec.events.length > WINDOW_SIZE) rec.events = rec.events.slice(-WINDOW_SIZE);  // trims to last 30
rec.score = Math.max(0, 1.0 + rec.events.reduce((sum, e) => sum + e.delta, 0));  // sums the 30 retained
```
Sequence is push → trim → sum-from-trimmed. Correct: the recomputed score reflects the rolling window after the boundary. No bug here.

**Architectural impact:** None. Including this finding so the audit doesn't read as confirmation-bias-only.

---

## Coverage notes

**Modules read in full:** `server.mjs`, `fs-utils.mjs`, `anonymous-orchestrator.mjs`, `a2a-stub.mjs`, `capability-dispatch.mjs`, `reputation.mjs`, `skill-rotation.mjs`, `hermes-agent-bridge.mjs`, `mcp-supervisor.mjs`.

**Modules read partially (header + key functions):** `lock-manager.mjs` (init, claim/release/lock paths), `event-manager.mjs` (taxonomy, emit, append paths), `queue-manager.mjs` (constructor + init only).

**Modules NOT read:** `gate-runner.mjs`, `env-file.mjs`, `registry-providers.mjs`. Out-of-scope for boundary/coupling/lifecycle audit; gate-runner is allowlist-only and shells out, env-file is config resolution, registry-providers is a config loader. None of these own durable state that crosses module boundaries based on the import graph.

**Tests NOT read:** `*.test.mjs` files were intentionally not consulted (other agents own test review).

**Things deliberately not audited (out of scope per prompt):**
- Code quality / readability
- Security (prompt-injection, secret handling, etc.)
- Test coverage / correctness
- Documentation accuracy
- Performance characteristics beyond what touches lifecycle (concurrency was in scope, microbenchmarks were not)

**Confidence calibration:** Findings 1, 2, 3, 5, 9 are direct code reads with quoted line citations — High. Findings 4, 7, 10 are interpretation of code intent vs. code behavior — High but with judgment calls. Finding 6 is structural — High. Findings 8, 11 are speculative-future-impact — Low/Medium. Finding 12 is positive verification — High.
