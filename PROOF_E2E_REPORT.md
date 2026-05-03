# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-05-03T11-55-09-149Z`
- **Timestamp (UTC)**: 2026-05-03T11:55:09.149Z
- **Duration**: 16.65s
- **Hermes3D workspace**: `G:\Github\Hermes3D`
- **Node**: v25.8.2 on win32
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **14 / 0 / 0 / 4**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 9 ms | 28 files hashed |
| `deps.parity` | required | ✅ pass | 1 ms | all 3 deps installed |
| `tests.unit` | required | ✅ pass | 9706 ms | pass=72, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 306 ms | 24 tools |
| `doctor.hermes3d` | skipped | ✅ pass | 0 ms | skipped |
| `events.directory_present` | required | ✅ pass | 21 ms | outbox/handled/failed present |
| `tasks.directory_present` | required | ✅ pass | 16 ms | pending/claimed/blocked/done present |
| `trigger.doctor_passes` | required | ✅ pass | 563 ms | trigger doctor ok |
| `queue.doctor_passes` | required | ✅ pass | 1893 ms | queue doctor ok |
| `wizard.dry_run_passes` | required | ✅ pass | 758 ms | wizard dry-run ok |
| `e2e.multi_agent_flow` | required | ✅ pass | 3360 ms | 14/14 checks; 15 ledger, 11 events |
| `workspace.integrity` | skipped | ✅ pass | 0 ms | skipped |
| `clients.config_presence` | skipped | ✅ pass | 0 ms | skipped |
| `clients.claude_code_live` | skipped | ✅ pass | 0 ms | skipped |
| `server.tool_description_hygiene` | required | ✅ pass | 1 ms | 0 suspicious patterns |
| `security.mcp_scan_pass` | required | ✅ pass | 3 ms | 0 suspicious patterns across 16 signatures |
| `evidence.hash_chain_valid` | required | ✅ pass | 9 ms | positive=true, negative_detected_at_idx_1=true |
| `docs.master_prompt_deliverables_present` | required | ✅ pass | 3 ms | 10/10 deliverables present |

## Machine-readable report

Full evidence including evidence ledgers, tool call shapes, manifest hashes, and config snapshots is in:

`PROOF/latest.json`

## Reproduce

```powershell
cd G:\\_codex_worktrees\\HermesProof-gate-mcpscan
npm install
node scripts/truth-gates.mjs --workspace "G:\Github\Hermes3D"
```

Exit code 0 means every required gate passed; non-zero means at least one required gate failed.
