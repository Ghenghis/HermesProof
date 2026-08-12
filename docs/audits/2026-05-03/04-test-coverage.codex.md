# Test Coverage Gaps - Codex Audit

## Executive Summary

The v0.7 test suite has meaningful coverage for direct module happy paths, recent A2A race/TTL fixes, registry validation, and supervisor crash behavior. The signed proof harness, however, overstates what it exercises. `package.json` runs twelve test files, including the v0.7 core suites, anonymous orchestrator smoke tests, supervisor tests, and perf tests; the truth-gate `tests.unit` gate runs only five older smoke/security files. The real stdio coverage is also legacy-heavy: `tools/list` checks only the old 24-tool subset and the end-to-end flow calls lock, handoff, gate, and evidence tools, but not the anonymous, reputation, dispatch, USER-session, A2A, or Hermes Agent tools added in v0.7. Direct tests miss important failure and boundary paths. `SkillRotation` and A2A tests share mutable suite state and use `>=` assertions, making order dependence possible. A temp concurrency probe showed the untested read-modify-write paths in reputation, skill rotation, and anonymous orchestration can throw or lose updates under simultaneous calls. Hermes Agent has the largest gap: provider failover, JSON salvage, approve/decline, registry providers, timeouts, and session-grant evidence are mostly untested. Counts and tool lists are duplicated manually, which allowed drift to reappear.

## Summary

| ID | Severity | Type | Location | Confidence | Finding |
| --- | --- | --- | --- | --- | --- |
| TC-01 | High | Smoke overclaim | `scripts/truth-gates.mjs:230`, `package.json:38` | 0.96 | Truth-gate `tests.unit` does not run the package-level test suite. |
| TC-02 | High | MCP stdio gap | `scripts/truth-gates.mjs:271`, `scripts/truth-gates.mjs:496`, `src/server.mjs:571` | 0.98 | v0.7 tools lack real `tools/call` round-trip coverage. |
| TC-03 | High | Concurrency gap | `src/core/fs-utils.mjs:54`, `src/core/reputation.mjs:67`, `src/core/skill-rotation.mjs:49` | 0.96 | Non-A2A v0.7 writers lack concurrent-call tests and fail under probe. |
| TC-04 | Medium | Test isolation | `src/core/skill-rotation.test.mjs:11`, `src/core/a2a-stub.test.mjs:11` | 0.90 | Some suites share mutable state and use loose assertions. |
| TC-05 | Medium | Boundary matrix | `src/core/a2a-stub.mjs:31`, `src/core/a2a-stub.test.mjs:29` | 0.88 | A2A transition/error matrix is only partially covered. |
| TC-06 | High | Hermes Agent gap | `src/core/hermes-agent-bridge.mjs:172`, `scripts/anonymous-orchestrator-smoke-test.mjs:136` | 0.95 | Provider failover and authorization success/decline paths are untested. |
| TC-07 | Medium | Formula/boundary gap | `src/core/capability-dispatch.mjs:61`, `src/core/reputation.mjs:27`, `src/core/skill-rotation.mjs:63` | 0.82 | Routing/scoring thresholds and rollover/pruning boundaries are thin. |
| TC-08 | Medium | Drift-prone counts | `scripts/truth-gates.mjs:271`, `docs/TOOL_REFERENCE.md:3` | 0.90 | Tool/gate/provider counts are manually duplicated instead of generated. |

## Findings

### TC-01 - Truth-Gate Unit Test Gate Omits Most v0.7 Tests

Severity: High

Type: Smoke-test overclaim

Location: `scripts/truth-gates.mjs:230`, `scripts/truth-gates.mjs:245`, `package.json:38`

Confidence: 0.96

Finding: The truth-gate comment says "full unit suite", but it spawns only five files. `npm test` runs twelve files, including v0.7 core tests, anonymous orchestrator smoke tests, supervisor smoke tests, secret rotation tests, and perf tests.

Evidence: `truth-gates.mjs:245-249` lists five test files. `package.json` includes `skill-rotation.test.mjs`, `reputation.test.mjs`, `a2a-stub.test.mjs`, `capability-dispatch.test.mjs`, `anonymous-orchestrator-smoke-test.mjs`, and `mcp-supervisor-smoke-test.mjs`.

Suggested remediation: Drive truth-gate tests from the `npm test` manifest or a shared explicit test manifest, and fail CI if the truth-gate subset omits package-level tests.

### TC-02 - v0.7 MCP Tools Lack Stdio Round-Trip Coverage

Severity: High

Type: MCP stdio gap

Location: `scripts/truth-gates.mjs:271`, `scripts/truth-gates.mjs:496`, `src/server.mjs:571`

Confidence: 0.98

Finding: `server.mjs` registers 42 tools, but the truth-gate `expectedTools` array contains only the older 24-tool subset. The multi-agent stdio flow exercises coordination, lock, gate, handoff, and evidence paths, but none of the anonymous role, reputation, dispatch, USER-session, A2A, or Hermes Agent tools.

Evidence: Live `tools/list` returned 42. `expectedTools` lines 271-296 list 24 names and only checks for missing names, so removal of v0.7 tools would not fail the gate.

Suggested remediation: Add `tools/call` probes for each v0.7 tool, including error paths. Assert exact live tool membership or compare against a generated manifest.

### TC-03 - Concurrency Failures Are Untested Outside A2A

Severity: High

Type: Concurrency gap

Location: `src/core/fs-utils.mjs:54`, `src/core/reputation.mjs:67`, `src/core/skill-rotation.mjs:49`, `src/core/anonymous-orchestrator.mjs:98`

Confidence: 0.96

Finding: A2A has a race regression test and `_mutateQueue`; reputation, skill rotation, and anonymous orchestration do not. A temp-only probe with concurrent writes threw `ENOENT` during `rename`, caused by `writeJsonAtomic` temp name collisions.

Evidence: The failing path was `...reputation.json.<pid>.<Date.now>.tmp -> reputation.json`. `writeJsonAtomic` uses PID plus timestamp without random entropy.

Suggested remediation: Add concurrent writer tests for reputation, skill rotation, anonymous roles, USER sessions, and evidence appends. Fix with unique temp names and serialized mutations.

### TC-04 - Some Tests Share Mutable Suite State

Severity: Medium

Type: Hidden inter-test dependency

Location: `src/core/skill-rotation.test.mjs:11`, `src/core/skill-rotation.test.mjs:30`, `src/core/a2a-stub.test.mjs:11`

Confidence: 0.90

Finding: `SkillRotation` uses one `before` fixture for the whole suite. The second test expects `gate >= 3`, relying on the first test having already written one gate task. Several A2A list/prune assertions also use shared state and `>=` style checks.

Evidence: `skill-rotation.test.mjs:12-15` initializes once; lines 30-36 then depend on accumulated state.

Suggested remediation: Use `beforeEach` temp workspaces or reset state per test. Prefer exact assertions and run suites in isolation as a CI mode.

### TC-05 - A2A Transition and Error Matrix Is Partial

Severity: Medium

Type: Boundary matrix

Location: `src/core/a2a-stub.mjs:31`, `src/core/a2a-stub.test.mjs:29`

Confidence: 0.88

Finding: Tests cover submitted-to-working, working-to-completed/failed, terminal rejection, and direct submitted-to-completed rejection. They do not cover submitted-to-canceled, working-to-input_required, input_required-to-working/canceled, invalid status, update of missing task, post-error mutex recovery, or concurrent updates to the same task.

Evidence: `VALID_TRANSITIONS` has six status states and more legal/illegal edges than the current tests enumerate.

Suggested remediation: Table-test every legal transition and invalid complement; add tests for same-task concurrent updates and mutation-queue recovery after a thrown mutator.

### TC-06 - Hermes Agent Provider and Authorization Paths Are Barely Tested

Severity: High

Type: Hermes Agent error/failover gap

Location: `src/core/hermes-agent-bridge.mjs:172`, `scripts/anonymous-orchestrator-smoke-test.mjs:136`

Confidence: 0.95

Finding: Tests cover disabled health, no-provider health, and built-in provider exports. They do not cover `_askAgent`, `_callProvider`, JSON-fence salvage, failover after HTTP errors, provider timeouts, approve/decline/defer results, scope intersection, session grant side effects, registry providers, or blocked-resolution authorization.

Evidence: `anonymous-orchestrator-smoke-test.mjs:136-182` contains only health/export checks for the bridge. The dead registry-provider bug is not covered.

Suggested remediation: Inject `fetch`, clock, and providers; add deterministic tests for success/failure/failover, registry provider activation, JSON parse salvage, scope filtering, and evidence emission.

### TC-07 - Routing and Scoring Boundary Tests Are Thin

Severity: Medium

Type: Formula and boundary gap

Location: `src/core/capability-dispatch.mjs:61`, `src/core/reputation.mjs:27`, `src/core/skill-rotation.mjs:63`

Confidence: 0.82

Finding: Dispatch tests assert broad ordering, but they do not freeze time for fresh/stale recency, exact composite scores, ties, unknown candidates, reputation/load tradeoffs, reputation `WINDOW_SIZE` rollover, or skill-rotation stale actor trimming after `TRIM_AFTER`.

Evidence: Constants `RECENCY_WINDOW_MS`, `WINDOW_SIZE`, and `TRIM_AFTER` shape behavior but have little boundary coverage.

Suggested remediation: Inject a clock, add exact formula tests, verify deterministic ties, and cover rollover/prune thresholds.

### TC-08 - Tool, Gate, and Provider Counts Are Duplicated by Hand

Severity: Medium

Type: Drift-prone hardcoded counts

Location: `scripts/truth-gates.mjs:271`, `docs/TOOL_REFERENCE.md:3`, `README.md:53`

Confidence: 0.90

Finding: Tool membership, truth-gate rows, provider counts, and built-in provider lists are asserted or documented in separate places. The truth-gate expected tool list already lags the 42-tool server registration, and docs still drift on gate count.

Evidence: `expectedTools` has 24 names; live `tools/list` has 42. README lists 26 gates, while `PROOF/latest.json` has 29 gate rows.

Suggested remediation: Generate docs tables and gate/tool manifests from source or live `tools/list`; add a single drift check comparing docs, proof, and runtime values.

## Coverage notes

I did not read Claude's audit docs or any non-Codex audit reports. I inspected package test wiring, v0.7 tests, truth-gate harness coverage, and live proof artifacts. I ran temp-directory concurrency probes only; I did not run coverage tooling or modify tests.
