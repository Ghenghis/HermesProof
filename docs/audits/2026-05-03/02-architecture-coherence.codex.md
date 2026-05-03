# Architecture Coherence - Codex Audit

## Executive Summary

HermesProof v0.7 fits the additive spirit of the v0.5/v0.6 system, but its new anonymous-orchestration components are not yet fully integrated into the older lock, queue, event, evidence, and state-path architecture. The mature spine uses shared `statePaths`, explicit event envelopes, task schemas, atomic directory moves, and targeted serialization. The new modules mostly create sibling whole-file JSON stores: `skill_rotation.json`, `reputation.json`, `a2a_tasks.json`, and `anonymous_orchestrator.json`. Only A2A has a Promise-chain mutation queue. Reputation, skill rotation, and anonymous role/session state can lose updates under concurrent MCP calls, and they also bypass shared state-dir normalization. The routing architecture is similarly split: `CapabilityDispatch` claims to route from anonymous active roles, but `hermes_list_agents` builds actors from skill and reputation ledgers only, so a newly claimed role with no recorded task is invisible. Evidence ownership is split between `evidence/ledger.ndjson` and the anonymous module's root `evidence.ndjson`, weakening the single-ledger mental model. Shutdown is process-level: the supervisor forwards signals, but `server.mjs` does not drain in-flight mutators or provider fetches. v0.7 needs a shared persistence/mutation/evidence layer, not more sibling mini-stores.

## Summary

| ID | Severity | Type | Location | Confidence | Finding |
| --- | --- | --- | --- | --- | --- |
| ARCH-01 | High | State concurrency | `src/core/reputation.mjs:67`, `src/core/skill-rotation.mjs:49`, `src/core/anonymous-orchestrator.mjs:98` | 0.98 | Most v0.7 whole-file stores lack A2A-style mutation serialization. |
| ARCH-02 | High | State path ownership | `src/server.mjs:45`, `src/core/fs-utils.mjs:9`, `src/core/skill-rotation.mjs:22` | 0.94 | New modules bypass shared `statePaths` / state-dir normalization. |
| ARCH-03 | Medium | Routing DAG | `src/server.mjs:586`, `src/core/capability-dispatch.mjs:40` | 0.93 | Dispatch and agent listing are not wired to anonymous role ownership. |
| ARCH-04 | Medium | Evidence ownership | `src/core/fs-utils.mjs:245`, `src/core/anonymous-orchestrator.mjs:50`, `src/core/gate-runner.mjs:128` | 0.90 | Evidence is split across chained and unchained or alternate ledgers. |
| ARCH-05 | Medium | Provider integration | `src/server.mjs:57`, `src/core/hermes-agent-bridge.mjs:172`, `src/core/hermes-agent-bridge.mjs:185` | 0.96 | Registry providers are loaded and merged but never used. |
| ARCH-06 | Medium | TTL and schema coherence | `src/server.mjs:874`, `src/core/a2a-stub.mjs:165`, `src/core/reputation.mjs:51` | 0.86 | TTL descriptions and schema-version handling are inconsistent. |
| ARCH-07 | Medium | Shutdown semantics | `scripts/mcp-supervisor.mjs:164`, `src/server.mjs:939` | 0.82 | Supervisor handles process signals, but server has no application-level drain. |

## Findings

### ARCH-01 - v0.7 State Stores Do Not Share a Mutation Model

Severity: High

Type: State concurrency

Location: `src/core/reputation.mjs:67`, `src/core/skill-rotation.mjs:49`, `src/core/anonymous-orchestrator.mjs:98`, contrast `src/core/a2a-stub.mjs:75`

Confidence: 0.98

Finding: A2A serializes mutations through `_mutateQueue`, but reputation, skill rotation, and anonymous orchestration perform plain read-modify-write against whole JSON files. In an MCP server, clients can issue concurrent tool calls, so these modules do not inherit safety from Node's single-threaded event loop.

Evidence: A temp probe with 50 concurrent writes hit `writeJsonAtomic` temp-name collisions and lost updates. A2A's queue preserved concurrent task creation because `_serialize` wraps read/write.

Suggested remediation: Extract a shared serialized JSON-store helper and use it for every single-file v0.7 store. Add concurrency tests mirroring `a2a-stub.test.mjs`.

### ARCH-02 - New Modules Bypass Shared State Directory Normalization

Severity: High

Type: State path ownership

Location: `src/server.mjs:45`, `src/core/fs-utils.mjs:9`, `src/core/skill-rotation.mjs:22`, `src/core/reputation.mjs:37`, `src/core/a2a-stub.mjs:43`, `src/core/anonymous-orchestrator.mjs:45`

Confidence: 0.94

Finding: `HermesLockManager` resolves and validates the state directory through `statePaths` / `resolveStateDirName`; v0.7 modules receive raw `stateDirName` and call `path.join` directly. That creates a two-tier architecture where older modules reject slashes, `..`, and nulls, while newer stores rely on caller discipline.

Evidence: `fs-utils.mjs:9-16` rejects dangerous state-dir names. The v0.7 constructors use `path.join(workspaceRoot, stateDirName)` without calling that helper.

Suggested remediation: Pass the resolved `statePaths` object into v0.7 modules or provide a single `StateStore` factory that owns workspace/state-dir validation.

### ARCH-03 - Agent Listing and Dispatch Do Not Use Anonymous Role State

Severity: Medium

Type: Routing DAG

Location: `src/server.mjs:575`, `src/server.mjs:586`, `src/server.mjs:610`, `src/core/capability-dispatch.mjs:40`

Confidence: 0.93

Finding: The v0.7 architecture says active anonymous roles feed routing, but implementation builds agent lists from skill and reputation only. A role holder with no recorded tasks/outcomes is absent, role and expiry metadata are not returned, and dispatch can rank inactive historical actors if they remain in skill/reputation state.

Evidence: `hermes_list_agents` reads `skills.listActors()` and `reputation.leaderboard()`, then unions those IDs. `CapabilityDispatch` constructs only `ReputationTracker` and `SkillRotation`.

Suggested remediation: Make `AnonymousOrchestrator` the source of active actors. Merge role claims with skill/reputation views, prune expired roles on read, and filter dispatch candidates by active role.

### ARCH-04 - Evidence Ownership Is Split Across Multiple Surfaces

Severity: Medium

Type: Evidence and audit ledger

Location: `src/core/fs-utils.mjs:245`, `src/core/lock-manager.mjs:468`, `src/core/anonymous-orchestrator.mjs:50`, `src/core/anonymous-orchestrator.mjs:81`, `src/core/gate-runner.mjs:128`

Confidence: 0.90

Finding: The main evidence path is `evidence/ledger.ndjson`, managed through `appendChainedJsonLine`. The anonymous orchestrator writes a separate root `evidence.ndjson`, and gate results append directly to the main evidence file without hash-chain fields. This breaks the architectural idea that evidence is one append-only verifiable ledger.

Evidence: `statePaths(...).evidenceFile` points to `evidence/ledger.ndjson`; `AnonymousOrchestrator` sets `this.evidenceFile = path.join(this.stateDir, "evidence.ndjson")`; `GateRunner` calls `appendJsonLine`, not `appendChainedJsonLine`.

Suggested remediation: Route every evidence-producing module through one evidence service. Preserve hash-chain fields on gate and anonymous records, or explicitly define separate ledgers with separate verifiers.

### ARCH-05 - Provider Registry Is in the DAG but Not in Execution

Severity: Medium

Type: Dependency DAG / provider registry

Location: `src/server.mjs:57`, `src/server.mjs:68`, `src/core/hermes-agent-bridge.mjs:172`, `src/core/hermes-agent-bridge.mjs:185`

Confidence: 0.96

Finding: `server.mjs` loads registry providers and passes them into `HermesAgentBridge`; the constructor merges them into `this._mergedProviders`; `_resolvedProviders` then reads from the original `PROVIDERS` constant, so registry providers are skipped.

Evidence: `hermes-agent-bridge.mjs:173-179` populates `_mergedProviders`; line 185 uses `const p = PROVIDERS[name]`.

Suggested remediation: Resolve from `this._mergedProviders[name]` and add a synthetic registry provider test proving it appears in health/failover resolution.

### ARCH-06 - TTL and Schema Semantics Are Not Uniform

Severity: Medium

Type: TTL and schema coherence

Location: `src/server.mjs:874`, `src/core/a2a-stub.mjs:165`, `src/core/skill-rotation.mjs:36`, `src/core/reputation.mjs:51`, `src/core/anonymous-orchestrator.mjs:66`

Confidence: 0.86

Finding: A2A's tool description says tasks older than 24h are excluded, but code only filters terminal stale tasks. v0.7 state files write `schema_version: 1`, but readers accept whatever JSON exists and mutate it. Older queue/event paths have stronger schema checks.

Evidence: `a2a-stub.mjs:165-170` explicitly keeps non-terminal stale tasks visible; v0.7 `_read` helpers return parsed JSON without schema-version validation.

Suggested remediation: Align tool descriptions with actual TTL semantics. Add schema-version assertions and migration/quarantine behavior for every v0.7 state file.

### ARCH-07 - Shutdown Does Not Drain In-Flight Work

Severity: Medium

Type: Shutdown semantics

Location: `scripts/mcp-supervisor.mjs:164`, `scripts/mcp-supervisor.mjs:198`, `src/server.mjs:939`, `src/core/hermes-agent-bridge.mjs:331`

Confidence: 0.82

Finding: The supervisor forwards SIGTERM/SIGINT and avoids respawn loops, but the child server has no graceful shutdown handler. In-flight JSON-store writes, evidence appends, and provider fetches can be interrupted by process termination without a drain/abort policy at the application layer.

Evidence: `mcp-supervisor.mjs` tracks `shutdownSignal`; `server.mjs` connects the stdio transport and installs no signal handling; Hermes Agent fetches have local timers but no process-wide abort.

Suggested remediation: Add server-level shutdown: stop accepting new calls, abort provider requests, await mutation queues/evidence appends, then close transport. Let the supervisor escalate only after a grace period.

## Coverage notes

I did not read Claude's audit docs or any non-Codex audit reports. I reviewed v0.7 production modules, the server composition root, supervisor, shared fs/state helpers, and representative tests. I used targeted temp-directory probes for concurrency and live MCP probes for tool counts. I did not edit production code.
