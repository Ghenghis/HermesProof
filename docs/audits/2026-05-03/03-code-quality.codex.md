# Code Quality of v0.7 Code - Codex Audit

## Executive Summary

The v0.7 code is readable and follows the repository's small-module style, with clear docstrings, simple file-backed stores, and explicit MCP annotations on all newly registered tools. The supervisor's logging discipline is good: it writes logs to stderr and keeps stdout reserved for JSON-RPC child traffic. The highest quality issues are not style problems but contract drift and missing shared primitives. A2A implements a mutation queue, but reputation, skill rotation, and anonymous orchestration duplicate the same read-modify-write pattern without serialization. `writeJsonAtomic` itself is fragile under same-millisecond concurrent writes because its temp filename is not unique enough. The Hermes Agent bridge has dead wiring: registry providers are merged into `_mergedProviders` but `_resolvedProviders` still reads the static `PROVIDERS` object. Several tool annotations are present but semantically misleading because tools marked read-only or idempotent mutate state, append evidence, or renew TTLs. The code also promises decision evidence for Hermes Agent grants but does not write it to the main ledger. Core API validation is weaker than MCP-edge schemas, so direct module calls can bypass regex, TTL, and scope constraints. Overall, the code is close to coherent, but v0.7 needs shared validation, shared mutation serialization, and stricter tool-contract tests.

## Summary

| ID | Severity | Type | Location | Confidence | Finding |
| --- | --- | --- | --- | --- | --- |
| CQ-01 | High | Functional dead code | `src/core/hermes-agent-bridge.mjs:173`, `src/core/hermes-agent-bridge.mjs:185` | 0.98 | Registry providers are merged but never resolved. |
| CQ-02 | High | Concurrency | `src/core/fs-utils.mjs:54`, `src/core/reputation.mjs:74`, `src/core/skill-rotation.mjs:53` | 0.96 | Non-A2A state writers can fail or lose updates under parallel calls. |
| CQ-03 | Medium | Tool contract | `src/server.mjs:642`, `src/server.mjs:825` | 0.90 | Several v0.7 MCP annotations are syntactically present but semantically wrong. |
| CQ-04 | Medium | Behavior drift | `src/server.mjs:575`, `src/server.mjs:586` | 0.93 | `hermes_list_agents` omits anonymous role state despite its description. |
| CQ-05 | Medium | Evidence drift | `src/core/hermes-agent-bridge.mjs:19`, `src/server.mjs:897` | 0.92 | Hermes Agent decisions are promised as evidenced but not written. |
| CQ-06 | Medium | Input validation | `src/core/anonymous-orchestrator.mjs:156`, `src/core/a2a-stub.mjs:97` | 0.84 | Core APIs are looser than MCP schemas. |
| CQ-07 | Low | Stale docs / cleanup | `src/server.mjs:13`, `src/server.mjs:874` | 0.86 | Unused import and stale A2A TTL wording remain. |

## Findings

### CQ-01 - Registry Providers Are Dead Wiring

Severity: High

Type: Functional dead code

Location: `src/core/hermes-agent-bridge.mjs:173`, `src/core/hermes-agent-bridge.mjs:185`, `src/server.mjs:57`

Confidence: 0.98

Finding: The bridge constructor merges registry providers into `this._mergedProviders` and extends the failover order, but `_resolvedProviders()` looks up each name in the static `PROVIDERS` constant. Any non-built-in provider loaded from `policies/provider-registry/registry.yaml` is skipped.

Evidence: `this._mergedProviders[rp.name] = rp` is set in the constructor. `_resolvedProviders` uses `const p = PROVIDERS[name]`, not `this._mergedProviders[name]`.

Suggested remediation: Use `this._mergedProviders[name]` in `_resolvedProviders`, and add a synthetic registry-provider unit test with an env key to prove it resolves.

### CQ-02 - Shared Atomic Write Helper Is Unsafe Under v0.7 Concurrency

Severity: High

Type: Concurrency

Location: `src/core/fs-utils.mjs:54`, `src/core/reputation.mjs:74`, `src/core/skill-rotation.mjs:53`, `src/core/anonymous-orchestrator.mjs:127`

Confidence: 0.96

Finding: `writeJsonAtomic` uses `${file}.${process.pid}.${Date.now()}.tmp` for temp files. Multiple writes to the same file in one millisecond can collide. A2A masks this with `_mutateQueue`; the other v0.7 modules do not.

Evidence: A temp probe with concurrent `recordOutcome`, `recordTask`, and `claimRole` calls threw `ENOENT` during `rename` and/or persisted only one of many expected updates.

Suggested remediation: Add random/crypto suffixes to temp files and serialize every read-modify-write store. Consider a shared `JsonStateStore.mutate()` helper.

### CQ-03 - MCP Annotations Do Not Always Match Side Effects

Severity: Medium

Type: Tool contract

Location: `src/server.mjs:642`, `src/server.mjs:679`, `src/server.mjs:825`

Confidence: 0.90

Finding: Every v0.7 tool has annotations, but some hints are misleading. `hermes_anonymous_claim` is marked idempotent while it renews TTL and appends evidence/history. `hermes_anonymous_release` appends history/evidence even on repeated no-op releases. `hermes_user_check_authorization` is marked read-only/idempotent while it lazy-clears expired sessions.

Evidence: `anonymous-orchestrator.mjs:125-128` appends claim history/evidence; `anonymous-orchestrator.mjs:138-141` appends release history/evidence; `anonymous-orchestrator.mjs:210-214` writes state/evidence during an authorization check.

Suggested remediation: Either remove hidden writes from read-only/idempotent handlers or adjust annotations so clients render approval prompts that match the real side effects.

### CQ-04 - Agent Listing Does Not Include Anonymous Role State

Severity: Medium

Type: Behavior drift

Location: `src/server.mjs:575`, `src/server.mjs:586`, `src/server.mjs:610`

Confidence: 0.93

Finding: `hermes_list_agents` says it lists active agents with role, skill histogram, reputation score, and dispatch ranking. The implementation never reads `anon.getState()` and returns no role field. It lists only actors present in skill/reputation ledgers.

Evidence: Lines 586-589 read `skills.listActors()` and `reputation.leaderboard()`. Actor IDs are the union of those two stores. Active anonymous role claims are not consulted.

Suggested remediation: Merge active anonymous role claims into the agent view, return roles and expiry times, and prune expired role claims before listing.

### CQ-05 - Hermes Agent Decision Evidence Is Not Implemented

Severity: Medium

Type: Evidence and documentation drift

Location: `src/core/hermes-agent-bridge.mjs:19`, `src/core/hermes-agent-bridge.mjs:240`, `src/server.mjs:897`

Confidence: 0.92

Finding: The bridge docstring and tool description say decisions are evidenced with rationale/provider/model. `requestUserSession()` returns that data to the caller and grants a session, but it does not append a decision record to the hash-chained ledger. `resolveBlocked()` similarly returns `_askAgent()` output without evidence.

Evidence: `requestUserSession` ends by returning `rationale`, `provider_used`, and `model_used`; no evidence manager is injected into `HermesAgentBridge`.

Suggested remediation: Inject an evidence writer or emit a server-level evidence record for every approve/decline/defer decision, including provider/model/correlation and a redacted rationale.

### CQ-06 - Core APIs Are Looser Than MCP Schemas

Severity: Medium

Type: Input validation

Location: `src/core/anonymous-orchestrator.mjs:156`, `src/core/a2a-stub.mjs:97`, `src/core/skill-rotation.mjs:49`

Confidence: 0.84

Finding: MCP schemas enforce regexes and TTL bounds, but core APIs generally validate only truthiness or basic type. Direct module callers can pass malformed actor IDs, non-array `scope`, or unbounded `ttl_ms`. A non-array truthy scope bypasses the `Array.isArray` scoped-deny check.

Evidence: `grantUserSession` stores `scope: scope ?? null`; `checkUserAuthorization` only denies when `session.scope && Array.isArray(session.scope) && !includes(...)`. A2A and skill rotation check only required presence in core.

Suggested remediation: Move validators into core modules and have MCP schemas reuse them. Reject non-array scopes and enforce TTL ranges at the core boundary too.

### CQ-07 - Minor Cleanup: Unused Import and Stale Tool Description

Severity: Low

Type: Stale docs / cleanup

Location: `src/server.mjs:13`, `src/server.mjs:874`

Confidence: 0.86

Finding: `ANON_ROLES` is imported but unused. The `hermes_a2a_list_tasks` description says tasks older than 24h are excluded, but implementation now only hides terminal stale tasks.

Evidence: `server.mjs:13` imports `ANON_ROLES`; no references use it. `a2a-stub.mjs:165-170` keeps non-terminal tasks visible regardless of age.

Suggested remediation: Remove the unused import and update the tool description to "terminal tasks older than 24h are excluded until pruned."

## Coverage notes

I did not read Claude's audit docs or any non-Codex audit reports. I reviewed the v0.7 scoped modules, v0.7 tool registrations, supervisor, and v0.7 tests. I also ran targeted source greps and temp concurrency probes. I did not modify production code.
