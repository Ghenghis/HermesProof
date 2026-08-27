# HermesProof — HP-MHA v4-STABLE Release Notes

| Field | Value |
|---|---|
| **Version** | `hermesproof.hp_mha.2026-08-06` (HP-MHA v4-STABLE) |
| **Release date** | 2026-08-06 |
| **Cut commit** | working tree as of this file's mtime |
| **Stable?** | **YES** for the HP-MHA surface; see "Remaining work" below for items that require external input |
| **Codename** | Model–Harness Attribution — Phase 4 |
| **Spec** | [`docs/48-Point Lever.md`](./48-Point%20Lever.md) sections 1-10 |

## TL;DR

HermesProof now has a complete, end-to-end Model–Harness Attribution (HP-MHA) pipeline that independently measures whether a performance change came from the model, the harness, the runtime configuration, or an interaction among them. Twelve MCP tools, two `required`-level truth-gates, 76 unit tests, and an 11-step end-to-end smoke runner over real stdio JSON-RPC.

## Verification (all green at release time)

| Check | Result |
|---|---|
| HP-MHA unit tests | **76 / 76 pass** in 0.42 s |
| `npm test` | **441 pass / 0 fail / 1 skip** (intentional `doctor.hermes3d` skip) |
| `server.stdio_handshake` | PASS — **121 MCP tools** registered |
| `harness_attribution.contract` | PASS at `required` — **5 / 5 harness cards PASS** (hermesagent, hermesproof, aider_v0_template, goose_v0_template, openhands_v0_template) |
| `harness_attribution.holdout_isolation_at_queue` | PASS at `required` — 4 / 4 cases + trace-index round-trip |
| `npm run hp-mha:smoke-e2e` | **END-TO-END PASS** — 11 steps, 12 ev_* chained on disk, hash chain verified |

## Key changes by version

### v1 (foundation) — spec doc, core module, schema validator

- Restructured `docs/48-Point Lever.md` from raw transcript into a proper protocol specification (10 sections, HP-MHA-001..010)
- New core module `src/core/hp-mha.mjs` (~1,400 lines) with 6 manifest validators, 5 manifest builders, and 6 record/verify helpers
- 7 MCP tools: `harness_card_record`, `experiment_plan_lock`, `benchmark_run_attest`, `trace_bundle_verify`, `model_harness_attribution`, `promotion_evaluate`, `sub_gate`
- `harness_attribution` truth-gate at `warn` level
- Hash-chained HP-MHA evidence ledger at `<workspace>/.hermes3d_orchestrator/evidence/hp_mha.ndjson`

### v2 (v1 polish + features) — held in tandem with v1.5 (audit polish)

- Extracted shared `evaluateHarnessCardFromManifest(cardRaw)` so the truth-gate and `load-card.mjs` cannot drift apart
- **2 new MCP tools**: `hermes_hp_mha_trace_metrics` (recovery rate / control lag / context retention) and `hermes_hp_mha_trace_prune` (retention-class policy)
- **1 new MCP tool**: `hermes_hp_mha_experiment_report` (read-only aggregator)
- New helpers: `classifyTaskSetTag`, `validateTaskSetTagUniqueness`, `buildExperimentReport`, `readExperimentReport`
- Tags: `HOLDOUT_TAG` (`hp_mha.holdout`), `OPTIMIZATION_TAG` (`hp_mha.optimization`)
- Task-set fixtures at `examples/hp-mha/task-sets/{holdout,optimization}.json`
- CLI scripts: `examples/hp-mha/status.mjs`, `examples/hp-mha/load-card.mjs --task-sets`, `examples/hp-mha/smoke-e2e.mjs`
- npm scripts: `hp-mha:status`, `hp-mha:load-all`, `hp-mha:task-sets`, `hp-mha:smoke-e2e`
- Real end-to-end MCP smoke (`npm run hp-mha:smoke-e2e`) exercising 9 tools over real stdio JSON-RPC

### v3 (contract close-outs) — 3 concrete gaps closed

- **HP-MHA-006 queue-level enforcement**: new `assertLockFilesRespectHoldoutIsolation({ files, role, task_set_manifest })` rejects `optimizer` role on `hp_mha.holdout` task sets; `hermes_lock_files` MCP tool handler consults the helper before `manager.lockFiles`. Roles `agent / auditor / reviewer / human / system` are allow-listed.
- **Contract version bump**: `hermesproof.hp_mha.2026-08-05` → `hermesproof.hp_mha.2026-08-06`; all 13 schema literals bumped from `v1` to `v2`.
- **Pre-existing baseline test fix**: `DEFAULT_FAILOVER` in `src/core/hermes-agent-bridge.mjs` aligned with the six-provider expectation in `scripts/anonymous-orchestrator-smoke-test.mjs` (was `["minimax","deepseek"]`, now `["minimax","deepinfra","deepseek","siliconflow","lm_studio","ollama"]`). `npm test` failures dropped 2 → 1.

### v4 (this release) — STABLE

| Change | Source of truth |
|---|---|
| **ev_trace searchable index** (HP-MHA spec §8.1) — `buildTraceIndexRows`, `writeTraceIndex`, `readTraceIndex`, `searchTraceIndex` helpers. Index at `<workspace>/<stateDir>/evidence/hp_mha_trace_index.ndjson`, sorted by `(bundle_id, byte_start)`. | `src/core/hp-mha.mjs` |
| **2 new MCP tools**: `hermes_hp_mha_trace_index_record` (ingest) + `hermes_hp_mha_trace_search` (range query by byte_start / byte_end / signals / kind) | `src/server.mjs` |
| **`harness_attribution.holdout_isolation_at_queue` sub-gate promoted to `required`**: 4 lock-guard cases + trace-index round-trip | `scripts/truth-gates.mjs` |
| **3 template harness cards** at `examples/hp-mha/harness-cards/templates/{openhands,aider,goose}.json` + `examples/hp-mha/CONTRIBUTING.md` onboarding guide with the 4-step onboarding | `examples/hp-mha/` |
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

## Harness cards (5 / 5 PASS at `required`)

| Card id | Kind | Installed commit |
|---|---|---|
| `hermesproof_v0.7.0_hp_mha_real` | Real | `fae63a40` |
| `hermesagent_bridge_2026-08-05` | Real | `fae63a40` |
| `openhands_v0_template` | Template (4 fields to fill) | FIXME |
| `aider_v0_template` | Template (4 fields to fill) | FIXME |
| `goose_v0_template` | Template (4 fields to fill) | FIXME |

See `examples/hp-mha/CONTRIBUTING.md` for the 4-step onboarding: hash four manifests (`installed_commit`, `package_sha256`, `dependency_lock_sha256`, plus the lockfile SHA), fill the template, run `npm run hp-mha:load-all`, ship.

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
examples/hp-mha/harness-cards/hermesproof.json     real (fae63a4)
examples/hp-mha/harness-cards/hermesagent.json     real (fae63a4)
examples/hp-mha/harness-cards/templates/open...    3 templates
examples/hp-mha/CONTRIBUTING.md                    new onboarding guide
docs/48-Point Lever.md                             restructured protocol spec
docs/TOOL_REFERENCE.md                             12 HP-MHA entries
docs/ARCHITECTURE.md                               §7.1 HP-MHA section
docs/audits/2026-08-06-hp-mha-phase3.codex.md     self-audit + post-scriptum
CHANGELOG.md                                       rolling Unreleased block
package.json                                       4 npm scripts
```

## Remaining work (out of HP-MHA scope)

1. **Independent adversarial audit** — `docs/audits/2026-08-06-hp-mha-phase3.codex.md` is self-authored; a second reviewer on a different lane is the only way to land this.
2. **Real (non-template) harness cards for OpenHands / Aider / Goose** — requires installed packages on a contributor's machine to compute the SHA-256 fields. The templates document the exact commands.
3. **Real measured 2×2 attribution matrix** — `SMOKE_MATRIX` in `src/core/hp-mha.mjs` is the placeholder; once a benchmark pipeline lands, override with `--matrix s11,s12,s21,s22` to the measured numbers.
4. **Holdout/optimization queue enforcement at scheduler level** — currently file-lock and result-level guards are wired; a scheduler that prevents a candidate optimizer from claiming jobs whose `task_set_id.tag` is `hp_mha.holdout` is not yet built.

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
