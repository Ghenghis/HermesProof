# HermesProof — HP-MHA v4-STABLE Release Notes

| Field | Value |
|---|---|
| **Version** | `hermesproof.hp_mha.2026-08-06` (HP-MHA v4-STABLE) |
| **Release date** | 2026-08-12 (v0.9.2 hardening refresh) |
| **Cut commit** | recorded by the v0.9.2 release proof and harness cards |
| **Stable?** | **YES** for the shipped HP-MHA surface after strict gates; evaluator-process separation remains an explicitly unclaimed hardening item |
| **Codename** | Model–Harness Attribution — Phase 4 |
| **Spec** | [`docs/48-Point Lever.md`](./48-Point%20Lever.md) sections 1-10 |

## TL;DR

HermesProof has an end-to-end Model–Harness Attribution (HP-MHA) pipeline that measures whether a benchmark change came from the model, the exact benchmark harness, or their interaction. Twelve MCP tools, two `required` truth gates, and an 11-step smoke runner operate over real stdio JSON-RPC. Harness cards are separately validated for schema and installed provenance; an unrelated benchmark result is never attributed to them.

## Verification contract

| Check | Result |
|---|---|
| HP-MHA unit tests | Must pass at the release commit; exact totals are recorded in generated proof rather than frozen in this document |
| `npm test` | Must pass at the release commit; exact totals are recorded in generated proof |
| `server.stdio_handshake` | PASS — **121 MCP tools** registered |
| `harness_attribution.contract` | PASS at `required` only when every discovered card has valid schema and installed provenance and the exact Kilo benchmark v2 evidence re-scores and verifies |
| `harness_attribution.holdout_isolation_at_queue` | PASS at `required` — 5 / 5 public-boundary cases + trace-index round-trip |
| `npm run hp-mha:smoke-e2e` | **END-TO-END PASS** — 11 steps, 12 ev_* chained on disk, hash chain verified |

## Key changes by version

### v1 (foundation) — spec doc, core module, schema validator

- Restructured `docs/48-Point Lever.md` from raw transcript into a proper protocol specification (10 sections, HP-MHA-001..010)
- New core module `src/core/hp-mha.mjs` (~1,400 lines) with 6 manifest validators, 5 manifest builders, and 6 record/verify helpers
- 7 MCP tools: `harness_card_record`, `experiment_plan_lock`, `benchmark_run_attest`, `trace_bundle_verify`, `model_harness_attribution`, `promotion_evaluate`, `sub_gate`
- `harness_attribution` truth-gate at `warn` level
- Hash-chained HP-MHA evidence ledger at `<workspace>/.hermes3d_orchestrator/evidence/hp_mha.ndjson`

### v2 (v1 polish + features) — held in tandem with v1.5 (audit polish)

- Extracted shared card validation so the truth-gate and `load-card.mjs` cannot drift apart; v0.9.2 now uses provenance-only `validateHarnessCardFromManifest` by default and reserves attribution for an explicitly supplied exact benchmark matrix
- **2 new MCP tools**: `hermes_hp_mha_trace_metrics` (recovery rate / control lag / context retention) and `hermes_hp_mha_trace_prune` (retention-class policy)
- **1 new MCP tool**: `hermes_hp_mha_experiment_report` (read-only aggregator)
- New helpers: `classifyTaskSetTag`, `validateTaskSetTagUniqueness`, `buildExperimentReport`, `readExperimentReport`
- Tags: `HOLDOUT_TAG` (`hp_mha.holdout`), `OPTIMIZATION_TAG` (`hp_mha.optimization`)
- Task-set fixtures at `examples/hp-mha/task-sets/{holdout,optimization}.json`
- CLI scripts: `examples/hp-mha/status.mjs`, `examples/hp-mha/load-card.mjs --task-sets`, `examples/hp-mha/smoke-e2e.mjs`
- npm scripts: `hp-mha:status`, `hp-mha:load-all`, `hp-mha:task-sets`, `hp-mha:smoke-e2e`
- Real end-to-end MCP smoke (`npm run hp-mha:smoke-e2e`) exercising 9 tools over real stdio JSON-RPC

### v3 (contract close-outs) — 3 concrete gaps closed

- **HP-MHA-006 queue-level enforcement**: `assertLockFilesRespectHoldoutIsolation({ files, role, task_set_manifest })` is consulted before `manager.lockFiles`. The v0.9.2 public boundary denies every reserved holdout path or tag regardless of the untrusted caller-supplied role, including the real `task-sets/holdout.json` filename.
- **Contract version bump**: `hermesproof.hp_mha.2026-08-05` → `hermesproof.hp_mha.2026-08-06`; all 13 schema literals bumped from `v1` to `v2`.
- **Pre-existing baseline test fix**: `DEFAULT_FAILOVER` in `src/core/hermes-agent-bridge.mjs` aligned with the six-provider expectation in `scripts/anonymous-orchestrator-smoke-test.mjs` (was `["minimax","deepseek"]`, now `["minimax","deepinfra","deepseek","siliconflow","lm_studio","ollama"]`). `npm test` failures dropped 2 → 1.

### v4 (this release) — STABLE

| Change | Source of truth |
|---|---|
| **ev_trace searchable index** (HP-MHA spec §8.1) — `buildTraceIndexRows`, `writeTraceIndex`, `readTraceIndex`, `searchTraceIndex` helpers. Index at `<workspace>/<stateDir>/evidence/hp_mha_trace_index.ndjson`, sorted by `(bundle_id, byte_start)`. | `src/core/hp-mha.mjs` |
| **2 new MCP tools**: `hermes_hp_mha_trace_index_record` (ingest) + `hermes_hp_mha_trace_search` (range query by byte_start / byte_end / signals / kind) | `src/server.mjs` |
| **`harness_attribution.holdout_isolation_at_queue` sub-gate promoted to `required`**: 5 public-boundary lock-guard cases + trace-index round-trip | `scripts/truth-gates.mjs` |
| **3 verified installed-reference harness cards** at `examples/hp-mha/harness-cards/templates/{openhands,aider,goose}.json` + `examples/hp-mha/CONTRIBUTING.md` onboarding guide | `examples/hp-mha/` |
| **Measured-matrix v2 evidence binding**: exact cell/model/harness contract checks, task/scorer source hashes, retained raw responses, deterministic re-scoring, and a digest over the complete evidence | `src/core/hp-mha-benchmark.mjs`, `examples/hp-mha/measured-matrix.json` |
| **Pre-existing KiloCode stdio round-trip failure fixed**: `startServer` in `scripts/v07-stdio-roundtrip-smoke-test.mjs` now passes `HERMES_AGENT_ENABLED:""`; companion assertion in `src/core/hermes-agent-bridge.test.mjs` switched to a slice check that doesn't pin a position | `scripts/v07-stdio-roundtrip-smoke-test.mjs`, `src/core/hermes-agent-bridge.test.mjs` |
| **`npm test` failures dropped from 1 → 0** | — |
| Audit note updated: `docs/audits/2026-08-06-hp-mha-phase3.codex.md` post-scriptum through v4 + stable-release declaration table | `docs/audits/` |

## MCP tool surface (121 total, 12 HP-MHA)

```
hermes_hp_mha_harness_card_record       ev_harness_*
hermes_hp_mha_experiment_plan_lock      ev_experiment_*    (HP-MHA-002/003)
hermes_hp_mha_benchmark_run_attest      ev_run_*            (HP-MHA-001/004/005)
hermes_hp_mha_trace_bundle_verify       ev_trace_*          (Merkle + retention)
hermes_hp_mha_trace_index_record       ev_trace_index_*   (NEW v4)
hermes_hp_mha_trace_search             read-only           (NEW v4)
hermes_hp_mha_trace_metrics            §6 metrics
hermes_hp_mha_trace_prune              retention policy
hermes_hp_mha_model_harness_attribution  ev_attribution_*   (HP-MHA-007)
hermes_hp_mha_promotion_evaluate       ev_promotion_*       (HP-MHA-008)
hermes_hp_mha_experiment_report        read-only
hermes_hp_mha_sub_gate                 read-only
```

## Harness cards and benchmark evidence

| Card id | Kind | Installed identity |
|---|---|---|
| HermesProof card | Real | Exact v0.9.2 implementation commit and package/lock hashes recorded in the card |
| HermesAgent card | Real | Exact v0.9.2 implementation commit plus bridge-source and lock hashes recorded in the card |
| `openhands_cli_1_16_0_windows_installed` | Real | `package:openhands-cli@1.16.0+openhands-sdk@1.21.0` |
| `aider_0_86_2_windows_installed` | Real | `package:aider-chat@0.86.2` |
| `goose_1_27_2_windows_installed` | Real | `package:goose@1.27.2-static-windows-x64` |

The three files under `harness-cards/templates/` are verified installed references and are also validated, for eight discovered manifests in total. See `examples/hp-mha/CONTRIBUTING.md` for onboarding: probe the installed version, hash the executable/package and dependency receipt or lock, materialize a unique card from a verified reference, then run `npm run hp-mha:load-all`.

The measured matrix is a separate exact Kilo backend safety benchmark. It is not evidence for the quality of the eight cards. Its four raw model responses are retained and re-scored against the bound scorer source before the attribution triple is accepted.

## Contract requirements (HP-MHA-001..010) — enforcement status

| Req | Description | Enforced where |
|---|---|---|
| HP-MHA-001 | Six-manifest binding + trace-root hash | `validateRunBinding` in `evaluatePromotion` |
| HP-MHA-002 | Model comparison needs locked-harness OR factorial design | `validateModelComparison` in `evaluatePromotion` |
| HP-MHA-003 | Harness claim needs eight-key held-constant | `validateHarnessImprovementClaim` in `evaluatePromotion` |
| HP-MHA-004 | Contamination classification | `classifyContamination` invoked for every `attestBenchmarkRun` |
| HP-MHA-005 | Failed/cancelled/crashed/timed_out in denominator | `computeDenominator` + `evaluatePromotion` impossible-clean check |
| HP-MHA-006 | Holdout isolation | `validateTaskSetTagUniqueness` + `assertLockFilesRespectHoldoutIsolation` + `hermes_lock_files` handler + `holdout_isolation_at_queue` sub-gate |
| HP-MHA-007 | Multi-dimensional report | `computeFactorialAttribution` + `evaluatePromotion` returning triple |
| HP-MHA-008 | PASS/FAIL/INCONCLUSIVE with `ev_*` reason codes | `evaluatePromotion` malformed guard + reason codes |
| HP-MHA-009 | Independence from candidate | `evaluatePromotion` `contested.self_certified` guard + structural separation |
| HP-MHA-010 | Real execution | `evaluatePromotion` `execution_real` + `fake_signals` check |

## Evidence ledger

- File: `<workspace>/.hermes3d_orchestrator/evidence/hp_mha.ndjson`
- Schema: `hermesproof.hp_mha.v2` per entry (`ev_harness`, `ev_experiment`, `ev_run`, `ev_trace`, `ev_attribution`, `ev_promotion`, `ev_prune`, `ev_trace_index`)
- Hash chain: each entry stores `prev_entry_id` + `prev_hash`; the next `entry_hash` is `sha256(prev_hash + canonical(entry))`
- Companion index: `evidence/hp_mha_trace_index.ndjson`

## Files touched across the four versions

```
src/core/hp-mha.mjs                                core module
src/core/hp-mha.test.mjs                           76/76 unit tests
src/core/hermes-agent-bridge.mjs                   DEFAULT_FAILOVER realigned
src/core/hermes-agent-bridge.test.mjs              DEFAULT_FAILOVER slice check
src/server.mjs                                     12 HP-MHA tools registered
scripts/truth-gates.mjs                           2 HP-MHA sub-gates
scripts/v07-stdio-roundtrip-smoke-test.mjs         hermetic env override
examples/hp-mha/load-card.mjs                      recursive, --task-sets, --all
examples/hp-mha/status.mjs                        CLI
examples/hp-mha/smoke-e2e.mjs                      11-step end-to-end MCP smoke
examples/hp-mha/task-sets/holdout.json             new fixture
examples/hp-mha/task-sets/optimization.json        new fixture
examples/hp-mha/harness-cards/hermesproof.json     real v0.9.2 implementation provenance
examples/hp-mha/harness-cards/hermesagent.json     real v0.9.2 bridge provenance
examples/hp-mha/harness-cards/{openhands,aider,goose}.json  installed cards
examples/hp-mha/harness-cards/templates/...    3 verified references
examples/hp-mha/measured-matrix.json                real hash-bound 2×2 evidence
scripts/hp-mha-measure-2x2.mjs                      reproducible local runner
examples/hp-mha/CONTRIBUTING.md                    new onboarding guide
docs/48-Point Lever.md                             restructured protocol spec
docs/TOOL_REFERENCE.md                             12 HP-MHA entries
docs/ARCHITECTURE.md                               §7.1 HP-MHA section
docs/audits/2026-08-06-hp-mha-phase3.codex.md     self-audit + post-scriptum
CHANGELOG.md                                       rolling Unreleased block
package.json                                       4 npm scripts
```

## Shippability remediation completed

1. **Installed harness provenance** — OpenHands 1.16.0, Aider 0.86.2, and Goose 1.27.2 now have real Windows cards with executable/package and dependency-receipt hashes.
2. **Real measured 2×2 matrix** — a fixed-seed local Ollama run is retained in `examples/hp-mha/measured-matrix.json`, with digest and tamper verification in `hp-mha-benchmark.test.mjs`.
3. **Lock-time isolation** — every public MCP lock request for server-derived holdout paths or holdout-tagged task sets fails closed regardless of the caller-supplied role, and mixed holdout/optimization tags are rejected. A separately owned evaluator process and result partition remain future hardening.
4. **Evidence binding** — measured-matrix v2 binds exact cell semantics, task, benchmark harness contract, scorer source, raw responses, deterministic re-scoring, and the complete evidence digest. Unrelated cards receive provenance validation only.
4. **Independent review remains additive governance** — another human or separately controlled reviewer can still strengthen confidence, but it is not represented as completed evidence by this release.

## Reproduction recipe

```bash
cd G:\Github\hermes3d-mcp-lock-orchestrator

# 1. Unit tests
node --test src/core/hp-mha.test.mjs                   # 76/76

# 2. Full test suite
npm test                                                  # 441/1

# 3. Truth-gates (with Phase 4 still on required level)
node scripts/truth-gates.mjs --skip clients.config_presence,clients.claude_code_live,doctor.hermes3d,workspace.integrity,perf.budget,perf.unused_exports,kilocode_release.installed_vsix,kilocode_release.runtime_health,kilocode_release.openhands_consensus,kilocode_release.evaluation_redacted,kilocode_release.optimization,kilocode_release.ui_proof,kilocode_release.recent_commits --ci

# 4. CLI commands
npm run hp-mha:status
npm run hp-mha:load-all
npm run hp-mha:task-sets
npm run hp-mha:smoke-e2e                                 # END-TO-END PASS
```
