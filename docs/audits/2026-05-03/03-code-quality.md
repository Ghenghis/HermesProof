# HermesProof v0.7 — Code Quality Audit

**Auditor lane:** Code quality only (error handling, validation, annotations, dead code, magic numbers, naming, docstrings, logging, resource cleanup, regression test coverage).
**Out of scope:** security exploits, architecture, full doc/spec accuracy, comprehensive test coverage. Other audit lanes own those.
**Repo state:** `main` @ `41258ef`. Files reviewed are the v0.7 additions only.

## Summary

| # | Title | Severity | Type | Location |
|---|---|---|---|---|
| 1 | `_resolvedProviders` ignores registry-merged providers | High | dead-code | src/core/hermes-agent-bridge.mjs:184 |
| 2 | `recordOutcome` has unguarded read-modify-write race | High | error-handling | src/core/reputation.mjs:67-91 |
| 3 | `recordTask` has unguarded read-modify-write race | High | error-handling | src/core/skill-rotation.mjs:49-74 |
| 4 | `AnonymousOrchestrator` mutators are not serialized | High | error-handling | src/core/anonymous-orchestrator.mjs:98-260 |
| 5 | `hermes_record_outcome` pollutes skill histogram with synthetic types | Medium | naming | src/server.mjs:664-670 |
| 6 | A2A read methods bypass the serialize chain (read-stale risk) | Medium | error-handling | src/core/a2a-stub.mjs:119-174 |
| 7 | `tickExpirations` returns boolean `pruned` while peer methods return counts | Medium | naming | src/core/anonymous-orchestrator.mjs:259 |
| 8 | `tickExpirations` "changed" flag spuriously trips on empty role arrays | Low | dead-code | src/core/anonymous-orchestrator.mjs:248 |
| 9 | `recommendNextType` silently returns `"gate"` for unknown actors | Medium | docstring-drift | src/core/skill-rotation.mjs:108-119 |
| 10 | A2A terminal transitions not marked destructive in MCP annotations | Medium | annotation | src/server.mjs:847 |
| 11 | `hermes_record_outcome` not marked destructive despite negative deltas | Low | annotation | src/server.mjs:662 |
| 12 | `healthCheck` probes providers serially with 5s timeout each | Medium | other | src/core/hermes-agent-bridge.mjs:202-213 |
| 13 | `requestUserSession` does not validate `requested_scope` is an array | Low | validation | src/core/hermes-agent-bridge.mjs:240-263 |
| 14 | `console.error` in src/server.mjs from registry load — stdout safe but unconditional | Low | logging | src/server.mjs:58 |
| 15 | Magic number `24 * 60 * 60 * 1000` inlined in skill-rotation prune | Low | magic-number | src/core/skill-rotation.mjs:66 |
| 16 | `let maxLoad = 1` doubles as floor-divisor with no name | Low | magic-number | src/core/capability-dispatch.mjs:71-80 |
| 17 | Test gap: `_mutateQueue` chain-poisoning recovery | Medium | test-gap | src/core/a2a-stub.test.mjs |
| 18 | Test gap: reputation rolling-window boundary at 31+ events | Medium | test-gap | src/core/reputation.test.mjs |
| 19 | Test gap: capability-dispatch with all-zero skill data | Low | test-gap | src/core/capability-dispatch.test.mjs |
| 20 | `health_check` 400-status reachability heuristic conflates auth failures with reachability | Low | other | src/core/hermes-agent-bridge.mjs:233 |
| 21 | Inline `_appendEvidence` calls are not serialized; multi-writer interleave possible | Low | resource-leak | src/core/anonymous-orchestrator.mjs:81-89 |
| 22 | `score: 0` returned with `actor_id: null` is structurally noisy | Nit | naming | src/core/capability-dispatch.mjs:95 |

---

## src/core/hermes-agent-bridge.mjs

### 1. `_resolvedProviders` ignores registry-merged providers

**Severity:** High
**Type:** dead-code
**Location:** src/core/hermes-agent-bridge.mjs:184
**Confidence:** High

**Finding:** The constructor merges registry-loaded providers into `this._mergedProviders` (lines 173–179) and extends `this.failoverOrder` so they participate in failover. But `_resolvedProviders()` reads providers from the module-level `PROVIDERS` constant, not `this._mergedProviders`. Result: registry providers appear in `failoverOrder` but `const p = PROVIDERS[name]` returns `undefined`, the loop `continue`s, and the registry providers are silently skipped. The merge is dead code, and the documented "62 Continue LLM provider classes" capability is non-functional via this path.

**Evidence:**
```js
182	  _resolvedProviders() {
183	    const list = [];
184	    for (const name of this.failoverOrder) {
185	      const p = PROVIDERS[name];        // <-- should be this._mergedProviders[name]
186	      if (!p) continue;
```

**Suggested remediation:** Replace `PROVIDERS[name]` with `this._mergedProviders[name]` on line 185. Add a smoke test that injects a fake registry provider, sets a matching API key in env, and asserts the provider is returned by `_resolvedProviders()`.

---

### 12. `healthCheck` probes providers serially with 5 s timeout each

**Severity:** Medium
**Type:** other (latency/UX)
**Location:** src/core/hermes-agent-bridge.mjs:202-213
**Confidence:** High

**Finding:** `healthCheck()` iterates providers and `await`s each `_probeProvider` call. With the documented six-provider failover (or 60+ via registry), worst case is `n × HEALTH_TIMEOUT_MS` = `6 × 5s = 30s` to declare "all providers unhealthy". The MCP tool `hermes_agent_health` is described as a probe; callers may experience long hangs. The serial path is also redundant when the goal is "first healthy"; `Promise.race` over a small concurrency window would surface health far faster.

**Evidence:**
```js
208	    for (const p of providers) {
209	      const status = await this._probeProvider(p);
210	      if (status.ok) return { ok: true, healthy_provider: p.name, model: p.model };
211	    }
212	    return { ok: false, reason: "all providers unhealthy" };
```

**Suggested remediation:** Either keep serial but document the worst-case latency in the tool description (so callers don't time-out before the probe finishes), or run probes in parallel and return the first ok provider, cancelling the rest via AbortController.

---

### 13. `requestUserSession` does not validate `requested_scope` is an array

**Severity:** Low
**Type:** validation
**Location:** src/core/hermes-agent-bridge.mjs:240-263
**Confidence:** High

**Finding:** `requestUserSession({ requested_scope, ttl_hours })` calls `requested_scope.filter(...)` (line 262) without checking `Array.isArray(requested_scope)`. If a caller passes a non-array (e.g. a string, or undefined when MCP schema is bypassed at the JS-level), the call throws a TypeError that leaks through to the user. The MCP-level Zod schema enforces array-of-strings, but bridge methods are also imported and reused from non-MCP paths (smoke tests, future CLI), where the contract isn't enforced.

**Evidence:**
```js
261	    const finalScope = this.scope
262	      ? requested_scope.filter((cap) => this.scope.includes(cap))
263	      : requested_scope;
```

**Suggested remediation:** Add a runtime guard: `if (!Array.isArray(requested_scope) || requested_scope.length === 0) return { ok: false, reason: "requested_scope must be a non-empty array" }` at the top of `requestUserSession`.

---

### 20. `healthCheck` 400-status reachability heuristic conflates auth failures with reachability

**Severity:** Low
**Type:** other
**Location:** src/core/hermes-agent-bridge.mjs:233
**Confidence:** Medium

**Finding:** `_probeProvider` returns `{ ok: r.ok || r.status === 400 }`. The intent (per the inline comment) is "schema-only error still proves reachability." But 401/403 also prove reachability, and 400 may itself be raised before auth (so this check is partially complete) — yet 401 is treated as `!ok` (network failure) rather than "reachable but auth bad". Result: the user gets "all providers unhealthy" when really the auth failed; the actual root cause (bad API key) is invisible.

**Evidence:**
```js
232	      // Many providers return 200 even with minimal prompt; some validate auth at request time.
233	      return { ok: r.ok || r.status === 400 /* schema-only error still proves reachability */ };
```

**Suggested remediation:** Treat `r.status >= 200 && r.status < 500` as "reachable" and return `{ ok: false, reason: "${name} auth failed" }` for 401/403 specifically, so users can distinguish missing-key vs unreachable-endpoint.

---

## src/core/reputation.mjs

### 2. `recordOutcome` has unguarded read-modify-write race

**Severity:** High
**Type:** error-handling
**Location:** src/core/reputation.mjs:67-91
**Confidence:** High

**Finding:** `recordOutcome()` reads state, mutates `rec.events`, writes back. Concurrent calls (e.g. CI logging two outcomes for the same actor in parallel; the merge-master loop firing for two PRs at once) execute their reads before either write completes, then both writes back partial state — losing one of the two events. `A2AStub` solved this exact pattern with `_serialize`/`_mutateQueue`; reputation has no equivalent.

**Evidence:**
```js
74	    const state = await this._read();
75	    if (!state.actors[actor_id]) {
76	      state.actors[actor_id] = { score: 1.0, events: [], total_outcomes: 0 };
77	    }
78	    const rec = state.actors[actor_id];
...
89	    await this._write(state);
90	    return { ok: true, actor_id, outcome, delta, new_score: rec.score };
```

**Suggested remediation:** Add the same `_mutateQueue` chain pattern as `A2AStub._serialize`. Wrap the `recordOutcome` body in a single serialize call so concurrent writes line up. Add a regression test: 50 concurrent `recordOutcome` calls for the same actor must produce 50 events in the rolling window (capped to WINDOW_SIZE=30, but `total_outcomes` should equal 50).

---

### 18. Test gap: reputation rolling-window boundary at 31+ events

**Severity:** Medium
**Type:** test-gap
**Location:** src/core/reputation.test.mjs
**Confidence:** High

**Finding:** `WINDOW_SIZE = 30` is enforced via `slice(-30)` after each push. No existing test pushes 31+ events to confirm the slice keeps the most-recent 30. A regression here would silently change scoring behavior (e.g. an off-by-one slice would either keep 29 or 31 entries, drifting scores). Given the prompt explicitly called out "is there a test for `reputation.score` clamping at the WINDOW_SIZE boundary," this is a flagged high-risk gap.

**Evidence:** No test in `reputation.test.mjs` references `WINDOW_SIZE` or pushes >30 events.

**Suggested remediation:** Add a test that records 35 outcomes for one actor, then asserts `events.length === 30`, the oldest 5 events were dropped, `total_outcomes === 35`, and the score equals `Math.max(0, 1.0 + sum(deltas of last 30))`.

---

## src/core/skill-rotation.mjs

### 3. `recordTask` has unguarded read-modify-write race

**Severity:** High
**Type:** error-handling
**Location:** src/core/skill-rotation.mjs:49-74
**Confidence:** High

**Finding:** Same pattern as reputation: `recordTask` reads, mutates, writes back without serialization. Two concurrent records for the same actor will lose one increment.

**Evidence:**
```js
53	    const state = await this._read();
...
59	    rec.task_counts[task_type] = (rec.task_counts[task_type] ?? 0) + 1;
60	    rec.last_active_ts = now;
61	    rec.total_tasks = (rec.total_tasks ?? 0) + 1;
...
72	    await this._write(state);
```

**Suggested remediation:** Adopt the `_mutateQueue` chain pattern; wrap the body of `recordTask`. The test concurrent-50 pattern from a2a-stub should be ported.

---

### 9. `recommendNextType` silently returns `"gate"` for unknown actors

**Severity:** Medium
**Type:** docstring-drift
**Location:** src/core/skill-rotation.mjs:108-119
**Confidence:** High

**Finding:** The docstring says "Recommended next task type for actor_id — returns the type least represented in their histogram among the known task types." For an unknown actor, the function returns `KNOWN_TASK_TYPES[0]` (= `"gate"`), not "no recommendation" or `null`. Callers can't distinguish "this actor has been balanced and gate is the suggestion" from "this actor doesn't exist." Both produce `"gate"`.

**Evidence:**
```js
108	  async recommendNextType(actor_id) {
109	    const state = await this._read();
110	    const rec = state.actors[actor_id];
111	    if (!rec) return KNOWN_TASK_TYPES[0];   // <- silent fallback to "gate"
```

**Suggested remediation:** Either return `null` (or a `{ recommendation: null, reason: "actor unknown" }` object) for unknown actors and update the docstring, OR document the fallback explicitly: `// Unknown actor → recommend the canonical first task type ("gate") so new agents start there`.

---

### 15. Magic number `24 * 60 * 60 * 1000` inlined in skill-rotation prune

**Severity:** Low
**Type:** magic-number
**Location:** src/core/skill-rotation.mjs:66
**Confidence:** High

**Finding:** Inline `24 * 60 * 60 * 1000` ms cutoff has no name. Compare with `TASK_TTL_MS` and `USER_SESSION_TTL_MS` constants in sibling modules — the convention is module-level naming.

**Evidence:**
```js
65	    if (actorIds.length > TRIM_AFTER) {
66	      const cutoff = now - 24 * 60 * 60 * 1000;
```

**Suggested remediation:** `const STALE_ACTOR_AGE_MS = 24 * 60 * 60 * 1000;` at module top (next to `TRIM_AFTER`).

---

## src/core/capability-dispatch.mjs

### 16. `let maxLoad = 1` doubles as floor-divisor with no name

**Severity:** Low
**Type:** magic-number
**Location:** src/core/capability-dispatch.mjs:71-80
**Confidence:** High

**Finding:** The initial value `1` for `maxLoad` is both a starting comparator and a default divisor when no actor has done the task type. Its purpose isn't obvious from the name; `MIN_LOAD_DIVISOR = 1` plus `let maxLoad = MIN_LOAD_DIVISOR` would clarify intent.

**Evidence:**
```js
70	    // Max task_type count across the FULL candidate set, for load normalization.
71	    let maxLoad = 1;
72	    for (const id of candidate_actors) {
...
80	      const load       = (skillActors[actor_id]?.task_counts?.[task_type] ?? 0) / maxLoad;
```

**Suggested remediation:** Add `const MIN_LOAD_DIVISOR = 1;` next to the WEIGHT_* constants and use it.

---

### 19. Test gap: capability-dispatch with all-zero skill data

**Severity:** Low
**Type:** test-gap
**Location:** src/core/capability-dispatch.test.mjs
**Confidence:** High

**Finding:** Existing tests cover the cases where some actors have skill history. The path where the candidate set is non-empty but NO actor has any history for the queried task_type (so `maxLoad = 1`, all loads = 0) is not directly exercised. This is a likely cold-start scenario in production.

**Suggested remediation:** Add a test: 3 actors with no skill records, `recommend("gate", [a,b,c])` returns one with score = `1.0 * 0.5 + 0.5 * 0.3 + 0 = 0.65` (recency=0.5 because last_active_ts=0 is past the 10-minute window). Verify ranking is consistent across runs.

---

### 22. `score: 0` returned with `actor_id: null` is structurally noisy

**Severity:** Nit
**Type:** naming
**Location:** src/core/capability-dispatch.mjs:95
**Confidence:** High

**Finding:** When called with empty candidates, `recommend` returns `{ actor_id: null, score: 0, reasoning: "no candidates" }`. Returning a score of `0` for a no-data case can be confused with a legitimate score of zero. A field like `available: false` would be clearer.

**Suggested remediation:** Cosmetic. If touched, change to `{ actor_id: null, score: null, reasoning: "no candidates" }`.

---

## src/core/a2a-stub.mjs

### 6. A2A read methods bypass the serialize chain (read-stale risk)

**Severity:** Medium
**Type:** error-handling
**Location:** src/core/a2a-stub.mjs:119-174
**Confidence:** Medium

**Finding:** `getTask` and `listTasks` call `this._read()` directly without going through `_serialize`. If a write is in flight (queued behind the chain), the read may see the pre-write snapshot. This is usually fine for read-after-write callers (the same caller awaits its own write before reading) but breaks for callers that observe other agents' tasks. The race is pre-existing in v0.5/v0.6 readers too, so the fix surface is the v0.7 reader fleet.

**Evidence:**
```js
119	  async getTask(task_id) {
120	    const state = await this._read();    // <-- not serialized
121	    const task = state.tasks[task_id];
...
157	  async listTasks(filter = {}) {
158	    const state = await this._read();    // <-- not serialized
```

**Suggested remediation:** Either route all reads through `_serialize` (small overhead, full consistency), or document the read-stale semantics in the docstrings of both methods so callers know not to use them for cross-agent observation. The first option matches the prior comment claim that the chain "serializes read-modify-write".

---

### 17. Test gap: `_mutateQueue` chain-poisoning recovery

**Severity:** Medium
**Type:** test-gap
**Location:** src/core/a2a-stub.test.mjs
**Confidence:** High

**Finding:** Lines 47-50 of `a2a-stub.mjs` claim "Failures in one mutation do NOT poison the chain." There IS a test for race-free 50-concurrent createTask, but none that injects a deliberate failure (e.g. `updateTask` with an invalid transition mid-stream) and then verifies the next mutation still succeeds. Because `_serialize` swallows rejections via `.catch(() => {})` on the chain pointer, this is the load-bearing claim of the v0.7 race fix; a regression here would silently break under load.

**Suggested remediation:** Add a test:
```js
const t = await a2a.createTask({...});
await a2a.updateTask(t.task_id, "working");
await a2a.updateTask(t.task_id, "completed");
// Now try an invalid transition (terminal → working) — must reject:
await assert.rejects(() => a2a.updateTask(t.task_id, "working"));
// Chain must still be alive — next mutation must succeed:
const t2 = await a2a.createTask({...});
assert.ok(t2.ok);
```

---

## src/core/anonymous-orchestrator.mjs

### 4. `AnonymousOrchestrator` mutators are not serialized

**Severity:** High
**Type:** error-handling
**Location:** src/core/anonymous-orchestrator.mjs:98-260
**Confidence:** High

**Finding:** Every mutator (`claimRole`, `releaseRole`, `grantUserSession`, `revokeUserSession`, `tickExpirations`, lazy clear in `checkUserAuthorization`) does `_readState → mutate → _writeState` without a serialize chain. This is the same race the v0.7 work explicitly fixed in A2AStub. Two concurrent `claimRole` calls for different roles will read the same state, each add their role, write back; one role survives. Two `grantUserSession` racing with each other after revocation can both pass the "no active session" check before either writes.

**Evidence:**
```js
108	    const state = await this._readState();
...
127	    await this._writeState(state);
128	    await this._appendEvidence({ kind: "role_claim", role, actor_id, purpose });
```

**Suggested remediation:** Port the `_serialize`/`_mutateQueue` pattern from `A2AStub` into a `BaseStateStore` mixin (or duplicate it inline) and wrap every mutator. Add a 50-concurrent-claim regression test mirroring the a2a-stub race test.

---

### 7. `tickExpirations` returns boolean `pruned` while peer methods return counts

**Severity:** Medium
**Type:** naming
**Location:** src/core/anonymous-orchestrator.mjs:259
**Confidence:** High

**Finding:** `A2AStub.pruneCompleted()` returns `{ ok: true, pruned: <number> }`. `AnonymousOrchestrator.tickExpirations()` returns `{ ok: true, pruned: <boolean> }`. Same key name, different value type. A caller writing `if (r.pruned > 0)` on `tickExpirations` will get truthy/falsy on `true`/`false`, not a count, and won't distinguish "1 thing pruned" from "47 things pruned". The smoke test currently asserts `r.pruned === true` so the contract is locked in to the boolean — a deliberate mismatch with the peer.

**Evidence:**
```js
258	    if (changed) await this._writeState(state);
259	    return { ok: true, pruned: changed };
```

**Suggested remediation:** Either rename to `pruned_changed: boolean` here, or change the implementation to count actual prunes (`pruned_roles_count + pruned_session_count`) and return a number for parity with `pruneCompleted`.

---

### 8. `tickExpirations` "changed" flag spuriously trips on empty role arrays

**Severity:** Low
**Type:** dead-code
**Location:** src/core/anonymous-orchestrator.mjs:248
**Confidence:** Medium

**Finding:** Line 247 deletes `state.active_roles[role]` when its filtered length is 0. The very next line then reads `state.active_roles[role]?.length` — which is now `undefined` because the key was deleted. `undefined !== before` evaluates to `true` whenever `before === 0` is false (i.e. always when there were entries). The flag is set correctly in that case, but the optional-chain on a just-deleted key is a code smell — readers will assume `?.length` reflects current state, not that the key was removed in the previous statement.

**Evidence:**
```js
246	      state.active_roles[role] = state.active_roles[role].filter((r) => r.expires_at > now);
247	      if (state.active_roles[role].length === 0) delete state.active_roles[role];
248	      if (state.active_roles[role]?.length !== before) changed = true;
```

**Suggested remediation:** Compute the new length before the delete:
```js
const after = state.active_roles[role].length;
if (after === 0) delete state.active_roles[role];
if (after !== before) changed = true;
```

---

### 21. Inline `_appendEvidence` calls are not serialized; multi-writer interleave possible

**Severity:** Low
**Type:** resource-leak (sort of — append-channel integrity)
**Location:** src/core/anonymous-orchestrator.mjs:81-89
**Confidence:** Medium

**Finding:** `_appendEvidence` calls `fs.appendFile` directly. POSIX appendFile with `O_APPEND` is atomic for small writes on Linux; on Windows it is not strictly guaranteed for >4 KB writes, and concurrent writers on the same NDJSON file (lock-manager and orchestrator both write to `evidence.ndjson`) can produce torn lines. With small JSON entries this is unlikely to bite, but it is the kind of low-frequency corruption that breaks audit-trail verification weeks later.

**Suggested remediation:** Either route both writers through a single shared evidence-append helper that holds an in-process mutex, or use a per-line write with a length-prefix marker so torn writes can be detected on read.

---

## src/server.mjs (v0.7 tool registrations)

### 5. `hermes_record_outcome` pollutes skill histogram with synthetic types

**Severity:** Medium
**Type:** naming
**Location:** src/server.mjs:664-670
**Confidence:** High

**Finding:** The handler for `hermes_record_outcome` records the outcome in `reputation` AND ALSO calls `skills.recordTask(args.actor_id, "outcome_" + args.outcome)`. This injects task types like `"outcome_merge"`, `"outcome_reject"` into the skill histogram, which is documented as tracking the eight `KNOWN_TASK_TYPES` (gate/lock/review/...). Downstream consumers (capability-dispatch load-penalty, `hermes_list_agents.task_counts`) will now see synthetic counters that the docstring never advertised. The two systems are conceptually separate (reputation = quality, skills = breadth), and tying them this way means every reputation event silently increments a fake skill bucket.

**Evidence:**
```js
665	    try {
666	      const result = await reputation.recordOutcome(args.actor_id, args.outcome, args.context);
667	      await skills.recordTask(args.actor_id, "outcome_" + args.outcome);
668	      return toolResult(result);
669	    } catch (err) { return toolError(err); }
```

**Suggested remediation:** Drop the `skills.recordTask` call — outcome recording is reputation's job, not skill rotation's. If the intent was just to bump `last_active_ts`, add a dedicated `skills.touchActor(actor_id)` method that updates `last_active_ts` without inventing a task_type.

---

### 10. A2A terminal transitions not marked destructive in MCP annotations

**Severity:** Medium
**Type:** annotation
**Location:** src/server.mjs:847
**Confidence:** Medium

**Finding:** `hermes_a2a_update_task` carries `destructiveHint: false`, but transitioning to `canceled`/`failed`/`completed` is irreversible (the state machine forbids leaving a terminal state). MCP-2025-11-25's `destructiveHint` is "may perform destructive updates" — making a task irreversibly terminal qualifies. By contrast, `hermes_user_revoke_session` is correctly `destructiveHint: true` for an analogous one-way action. The lack of consistency means clients enforcing destructive-action prompts will gate `revokeSession` but not `updateTask("canceled")`.

**Evidence:**
```js
847	    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
```

**Suggested remediation:** Set `destructiveHint: true` for `hermes_a2a_update_task` (the tool can do destructive transitions even if some calls are non-destructive — the hint is permissive: "may perform destructive updates").

---

### 11. `hermes_record_outcome` not marked destructive despite negative deltas

**Severity:** Low
**Type:** annotation
**Location:** src/server.mjs:662
**Confidence:** Low

**Finding:** `hermes_record_outcome` has `destructiveHint: false`. But `outcome="reject"` permanently lowers an actor's score by 1.0 in the rolling window, which is destructive in a defensible sense. This is borderline — the spec says destructive means "the tool may perform destructive updates to the environment." Reputation drops are recoverable by recording positive outcomes, so calling this destructive is debatable. Flagging for visibility.

**Suggested remediation:** Either leave as-is and document the rationale in a comment, or set `destructiveHint: true` since the tool can produce a one-way negative reputation event.

---

### 14. Unconditional `console.error` for registry-load failure on stdio MCP server

**Severity:** Low
**Type:** logging
**Location:** src/server.mjs:58
**Confidence:** High

**Finding:** `console.error` writes to stderr (good — does not corrupt the stdio JSON-RPC channel), so this is not a correctness bug. But the message uses a plain `console.error` instead of the `[hermesproof]` prefix established elsewhere in the file (lines 26, 32). Inconsistent log-line tagging makes log-grep harder.

**Evidence:**
```js
57	const registryLoad = await loadRegistryProviders({ workspaceRoot }).catch((err) => {
58	  console.error("[hermesproof] registry load failed (non-fatal):", err?.message);
59	  return { ok: false, providers: [] };
60	});
```

This is actually CORRECTLY prefixed. **Updated finding:** No issue. Strike from report.

**Suggested remediation:** None — closer reading shows the prefix is present. Leaving the row in the table for index-stability would be misleading; treat this row as resolved.

---

## scripts/mcp-supervisor.mjs

No new findings beyond what's already addressed in the regression tests. The `forwardSignal` / `shutdownSignal` machinery handles the cases the prior audit flagged. The `process.exit(0)` on no-active-child path is a deliberate fast-path during backoff. The unbounded `crashTimestamps` array is bounded in practice by `purgeOldCrashes()` running on every crash.

---

## Coverage notes

The regression-coverage angle of this audit (item 10 of the rubric) found three notable test gaps:

1. **a2a-stub `_mutateQueue` poisoning recovery** (#17) — load-bearing v0.7 claim that has no direct test. The 50-concurrent test exercises happy-path serialization; it doesn't prove the chain survives a thrown rejection.
2. **reputation rolling-window boundary at 31+ events** (#18) — `WINDOW_SIZE=30` slice has no boundary test.
3. **capability-dispatch with all-zero skill data** (#19) — cold-start path exercising `maxLoad=1` floor.

Less critical but worth tracking:
- No tests for `AnonymousOrchestrator` race conditions (will become important once finding #4 is fixed).
- No tests for `HermesAgentBridge._resolvedProviders` registry-merge path (which would surface finding #1 immediately).

Anonymous orchestrator's mutators run unserialized today (#4), so a concurrent-claim regression test would FAIL today and is the right driver for adding `_serialize` to that class.

---

## Closing notes

Highest-leverage fixes, ranked:
1. Finding #1 — registry providers are dead code. One-character bug (`PROVIDERS` → `this._mergedProviders`) but breaks a documented capability.
2. Findings #2, #3, #4 — same fix pattern (port `_serialize` from a2a-stub to reputation/skill-rotation/anonymous-orchestrator). Three modules, one architectural change.
3. Finding #5 — strange coupling between reputation and skills via synthetic `outcome_*` task types.
4. Finding #17 — add the chain-poisoning regression test before any future work touches `_serialize`.
