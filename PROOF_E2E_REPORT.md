# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-05-03T13-38-14-870Z`
- **Timestamp (UTC)**: 2026-05-03T13:38:14.870Z
- **Duration**: 4.92s
- **Hermes3D workspace**: `/home/runner/work/HermesProof/HermesProof`
- **Node**: v20.20.2 on linux
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **14 / 0 / 0 / 4**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 11 ms | 33 files hashed |
| `deps.parity` | required | ✅ pass | 2 ms | all 3 deps installed |
| `tests.unit` | required | ✅ pass | 1730 ms | pass=52, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 223 ms | 24 tools |
| `doctor.hermes3d` | skipped | ✅ pass | 0 ms | skipped |
| `events.directory_present` | required | ✅ pass | 12 ms | outbox/handled/failed present |
| `tasks.directory_present` | required | ✅ pass | 6 ms | pending/claimed/blocked/done present |
| `trigger.doctor_passes` | required | ✅ pass | 72 ms | trigger doctor ok |
| `queue.doctor_passes` | required | ✅ pass | 164 ms | queue doctor ok |
| `wizard.dry_run_passes` | required | ✅ pass | 62 ms | wizard dry-run ok |
| `e2e.multi_agent_flow` | required | ✅ pass | 353 ms | 14/14 checks; 15 ledger, 11 events |
| `workspace.integrity` | skipped | ✅ pass | 0 ms | skipped |
| `clients.config_presence` | skipped | ✅ pass | 0 ms | skipped |
| `clients.claude_code_live` | skipped | ✅ pass | 0 ms | skipped |
| `server.tool_description_hygiene` | required | ✅ pass | 1 ms | 0 suspicious patterns |
| `evidence.hash_chain_valid` | required | ✅ pass | 4 ms | positive=true, negative_detected_at_idx_1=true |
| `docs.master_prompt_deliverables_present` | required | ✅ pass | 2 ms | 10/10 deliverables present |
| `licenses.scan` | required | ✅ pass | 2275 ms | 93 packages scanned; unknown=0, review=1 |

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
