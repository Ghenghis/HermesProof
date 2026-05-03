# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-05-03T19-22-49-887Z`
- **Timestamp (UTC)**: 2026-05-03T19:22:49.887Z
- **Duration**: 10.14s
- **Hermes3D workspace**: `/home/runner/work/HermesProof/HermesProof`
- **Node**: v20.20.2 on linux
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **28 / 0 / 2 / 5**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 15 ms | 72 files hashed |
| `deps.parity` | required | ✅ pass | 1 ms | all 3 deps installed |
| `tests.unit` | required | ✅ pass | 2354 ms | pass=141, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 221 ms | 42 tools |
| `doctor.hermes3d` | skipped | ✅ pass | 0 ms | skipped |
| `events.directory_present` | required | ✅ pass | 11 ms | outbox/handled/failed present |
| `tasks.directory_present` | required | ✅ pass | 5 ms | pending/claimed/blocked/done present |
| `trigger.doctor_passes` | required | ✅ pass | 75 ms | trigger doctor ok |
| `queue.doctor_passes` | required | ✅ pass | 162 ms | queue doctor ok |
| `wizard.dry_run_passes` | required | ✅ pass | 66 ms | wizard dry-run ok |
| `e2e.multi_agent_flow` | required | ✅ pass | 350 ms | 14/14 checks; 15 ledger, 11 events |
| `workspace.integrity` | skipped | ✅ pass | 0 ms | skipped |
| `clients.config_presence` | skipped | ✅ pass | 0 ms | skipped |
| `clients.claude_code_live` | skipped | ✅ pass | 0 ms | skipped |
| `server.tool_description_hygiene` | required | ✅ pass | 2 ms | 0 suspicious patterns |
| `security.mcp_scan_pass` | required | ✅ pass | 9 ms | 0 suspicious patterns across 16 signatures |
| `evidence.hash_chain_valid` | required | ✅ pass | 3 ms | positive=true, negative_detected_at_idx_1=true |
| `docs.master_prompt_deliverables_present` | required | ✅ pass | 2 ms | 10/10 deliverables present |
| `provider.registry.validate` | required | ✅ pass | 4 ms | 62 entries, 62 unique provider_names |
| `local.models.catalog.validate` | required | ✅ pass | 1 ms | schema ok; 91 valid rows |
| `continue.llm_classes.validate` | required | ✅ pass | 0 ms | all 62 expected provider names present (62 total) |
| `kilocode.provider.mapping.validate` | warn | ✅ pass | 0 ms | kilocode_mapping.csv not in pack — gate stub running as not_applicable |
| `lmstudio.health` | warn | ⚠️ warn | 11 ms | LM Studio offline: ECONNREFUSED |
| `ollama.health` | warn | ⚠️ warn | 2 ms | Ollama offline: ECONNREFUSED |
| `secret.scan` | required | ✅ pass | 47 ms | fallback: 0 finding(s) |
| `secrets.rotation_evidence_present` | warn | ✅ pass | 0 ms | env file not present at …/hermes/env (source=default.posix); rotation gate not_applicable |
| `sbom.cyclonedx_generated` | required | ✅ pass | 45 ms | 131 components @ /home/runner/work/HermesProof/HermesProof/PROOF/sbom.json |
| `licenses.scan` | required | ✅ pass | 936 ms | 93 packages scanned; unknown=0, review=1 |
| `dependency.fresh` | warn | ✅ pass | 317 ms | 3/3 direct deps within 12mo |
| `security.workflow_actions_sha_pinned` | required | ✅ pass | 7 ms | 4 workflow(s), 17 uses-ref(s), all SHA-pinned |
| `accessibility.wcag_aa_pass` | required | ✅ pass | 1541 ms | 0 critical/serious violations across 22 passing rule(s) (1 non-blocking warning(s)) |
| `perf.budgets_pass` | required | ✅ pass | 3933 ms | hermes_doctor_cold_start=0.5ms<300ms? Y; lock_acquire=7.6ms<50ms? Y; heartbeat=2.3ms<20ms? Y |
| `docs.reflects_changes` | warn | ✅ pass | 10 ms | no version bump or ADR change in range; gate is inert |
| `release.checksums_present` | warn | ✅ pass | 1 ms | no release artifacts in dist,release; gate dormant |
| `quality.coderabbit_reviewed` | skipped | ✅ pass | 4 ms | no PR context (owner/repo/pr); gate inert |

## Machine-readable report

Full evidence including evidence ledgers, tool call shapes, manifest hashes, and config snapshots is in:

`PROOF/latest.json`

## Reproduce

```powershell
cd /home/runner/work/HermesProof/HermesProof
npm install
node scripts/truth-gates.mjs --workspace "/home/runner/work/HermesProof/HermesProof"
```

Exit code 0 means every required gate passed; non-zero means at least one required gate failed.
