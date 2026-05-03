# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-05-03T14-31-28-389Z`
- **Timestamp (UTC)**: 2026-05-03T14:31:28.389Z
- **Duration**: 5.44s
- **Hermes3D workspace**: `/home/runner/work/HermesProof/HermesProof`
- **Node**: v20.20.2 on linux
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **17 / 0 / 0 / 4**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 11 ms | 36 files hashed |
| `deps.parity` | required | ✅ pass | 2 ms | all 3 deps installed |
| `tests.unit` | required | ✅ pass | 1699 ms | pass=86, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 212 ms | 24 tools |
| `doctor.hermes3d` | skipped | ✅ pass | 0 ms | skipped |
| `events.directory_present` | required | ✅ pass | 12 ms | outbox/handled/failed present |
| `tasks.directory_present` | required | ✅ pass | 6 ms | pending/claimed/blocked/done present |
| `trigger.doctor_passes` | required | ✅ pass | 70 ms | trigger doctor ok |
| `queue.doctor_passes` | required | ✅ pass | 155 ms | queue doctor ok |
| `wizard.dry_run_passes` | required | ✅ pass | 59 ms | wizard dry-run ok |
| `e2e.multi_agent_flow` | required | ✅ pass | 338 ms | 14/14 checks; 15 ledger, 11 events |
| `workspace.integrity` | skipped | ✅ pass | 0 ms | skipped |
| `clients.config_presence` | skipped | ✅ pass | 0 ms | skipped |
| `clients.claude_code_live` | skipped | ✅ pass | 0 ms | skipped |
| `server.tool_description_hygiene` | required | ✅ pass | 1 ms | 0 suspicious patterns |
| `security.mcp_scan_pass` | required | ✅ pass | 4 ms | 0 suspicious patterns across 16 signatures |
| `evidence.hash_chain_valid` | required | ✅ pass | 4 ms | positive=true, negative_detected_at_idx_1=true |
| `docs.master_prompt_deliverables_present` | required | ✅ pass | 2 ms | 10/10 deliverables present |
| `sbom.cyclonedx_generated` | required | ✅ pass | 38 ms | 92 components @ /home/runner/work/HermesProof/HermesProof/PROOF/sbom.json |
| `licenses.scan` | required | ✅ pass | 2589 ms | 93 packages scanned; unknown=0, review=1 |
| `dependency.fresh` | warn | ✅ pass | 231 ms | 3/3 direct deps within 12mo |

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
