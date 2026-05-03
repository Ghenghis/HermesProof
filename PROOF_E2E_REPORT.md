# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-05-03T15-10-21-275Z`
- **Timestamp (UTC)**: 2026-05-03T15:10:21.275Z
- **Duration**: 5.46s
- **Hermes3D workspace**: `/home/runner/work/HermesProof/HermesProof`
- **Node**: v20.20.2 on linux
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **18 / 0 / 0 / 4**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 13 ms | 40 files hashed |
| `deps.parity` | required | ✅ pass | 3 ms | all 3 deps installed |
| `tests.unit` | required | ✅ pass | 1745 ms | pass=99, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 218 ms | 24 tools |
| `doctor.hermes3d` | skipped | ✅ pass | 0 ms | skipped |
| `events.directory_present` | required | ✅ pass | 12 ms | outbox/handled/failed present |
| `tasks.directory_present` | required | ✅ pass | 5 ms | pending/claimed/blocked/done present |
| `trigger.doctor_passes` | required | ✅ pass | 71 ms | trigger doctor ok |
| `queue.doctor_passes` | required | ✅ pass | 172 ms | queue doctor ok |
| `wizard.dry_run_passes` | required | ✅ pass | 60 ms | wizard dry-run ok |
| `e2e.multi_agent_flow` | required | ✅ pass | 345 ms | 14/14 checks; 15 ledger, 11 events |
| `workspace.integrity` | skipped | ✅ pass | 0 ms | skipped |
| `clients.config_presence` | skipped | ✅ pass | 0 ms | skipped |
| `clients.claude_code_live` | skipped | ✅ pass | 0 ms | skipped |
| `server.tool_description_hygiene` | required | ✅ pass | 1 ms | 0 suspicious patterns |
| `security.mcp_scan_pass` | required | ✅ pass | 5 ms | 0 suspicious patterns across 16 signatures |
| `evidence.hash_chain_valid` | required | ✅ pass | 3 ms | positive=true, negative_detected_at_idx_1=true |
| `docs.master_prompt_deliverables_present` | required | ✅ pass | 2 ms | 10/10 deliverables present |
| `secrets.rotation_evidence_present` | warn | ✅ pass | 1 ms | env file not present at …/hermes/env (source=default.posix); rotation gate not_applicable |
| `sbom.cyclonedx_generated` | required | ✅ pass | 33 ms | 92 components @ /home/runner/work/HermesProof/HermesProof/PROOF/sbom.json |
| `licenses.scan` | required | ✅ pass | 2512 ms | 93 packages scanned; unknown=0, review=1 |
| `dependency.fresh` | warn | ✅ pass | 253 ms | 3/3 direct deps within 12mo |

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
