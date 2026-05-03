# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-05-03T16-49-16-063Z`
- **Timestamp (UTC)**: 2026-05-03T16:49:16.063Z
- **Duration**: 5.71s
- **Hermes3D workspace**: `/home/runner/work/HermesProof/HermesProof`
- **Node**: v20.20.2 on linux
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **23 / 0 / 2 / 4**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 14 ms | 47 files hashed |
| `deps.parity` | required | ✅ pass | 2 ms | all 3 deps installed |
| `tests.unit` | required | ✅ pass | 1795 ms | pass=124, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 225 ms | 34 tools |
| `doctor.hermes3d` | skipped | ✅ pass | 0 ms | skipped |
| `events.directory_present` | required | ✅ pass | 12 ms | outbox/handled/failed present |
| `tasks.directory_present` | required | ✅ pass | 7 ms | pending/claimed/blocked/done present |
| `trigger.doctor_passes` | required | ✅ pass | 71 ms | trigger doctor ok |
| `queue.doctor_passes` | required | ✅ pass | 160 ms | queue doctor ok |
| `wizard.dry_run_passes` | required | ✅ pass | 59 ms | wizard dry-run ok |
| `e2e.multi_agent_flow` | required | ✅ pass | 351 ms | 14/14 checks; 15 ledger, 11 events |
| `workspace.integrity` | skipped | ✅ pass | 0 ms | skipped |
| `clients.config_presence` | skipped | ✅ pass | 0 ms | skipped |
| `clients.claude_code_live` | skipped | ✅ pass | 0 ms | skipped |
| `server.tool_description_hygiene` | required | ✅ pass | 2 ms | 0 suspicious patterns |
| `security.mcp_scan_pass` | required | ✅ pass | 5 ms | 0 suspicious patterns across 16 signatures |
| `evidence.hash_chain_valid` | required | ✅ pass | 4 ms | positive=true, negative_detected_at_idx_1=true |
| `docs.master_prompt_deliverables_present` | required | ✅ pass | 3 ms | 10/10 deliverables present |
| `provider.registry.validate` | required | ✅ pass | 3 ms | 62 entries, 62 unique provider_names |
| `local.models.catalog.validate` | required | ✅ pass | 0 ms | schema ok; 87 valid rows |
| `continue.llm_classes.validate` | required | ✅ pass | 1 ms | all 62 expected provider names present (62 total) |
| `kilocode.provider.mapping.validate` | warn | ✅ pass | 1 ms | kilocode_mapping.csv not in pack — gate stub running as not_applicable |
| `lmstudio.health` | warn | ⚠️ warn | 11 ms | LM Studio offline: ECONNREFUSED |
| `ollama.health` | warn | ⚠️ warn | 1 ms | Ollama offline: ECONNREFUSED |
| `secret.scan` | required | ✅ pass | 37 ms | fallback: 0 finding(s) |
| `secrets.rotation_evidence_present` | warn | ✅ pass | 1 ms | env file not present at …/hermes/env (source=default.posix); rotation gate not_applicable |
| `sbom.cyclonedx_generated` | required | ✅ pass | 33 ms | 92 components @ /home/runner/work/HermesProof/HermesProof/PROOF/sbom.json |
| `licenses.scan` | required | ✅ pass | 2618 ms | 93 packages scanned; unknown=0, review=1 |
| `dependency.fresh` | warn | ✅ pass | 289 ms | 3/3 direct deps within 12mo |

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
