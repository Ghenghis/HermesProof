# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-05-03T12-10-06-383Z`
- **Timestamp (UTC)**: 2026-05-03T12:10:06.383Z
- **Duration**: 15.78s
- **Hermes3D workspace**: `G:\Github\Hermes3D`
- **Node**: v25.8.2 on win32
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **14 / 0 / 0 / 4**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 15 ms | 28 files hashed |
| `deps.parity` | required | ✅ pass | 2 ms | all 3 deps installed |
| `tests.unit` | required | ✅ pass | 7526 ms | pass=61, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 459 ms | 24 tools |
| `doctor.hermes3d` | skipped | ✅ pass | 0 ms | skipped |
| `events.directory_present` | required | ✅ pass | 33 ms | outbox/handled/failed present |
| `tasks.directory_present` | required | ✅ pass | 25 ms | pending/claimed/blocked/done present |
| `trigger.doctor_passes` | required | ✅ pass | 406 ms | trigger doctor ok |
| `queue.doctor_passes` | required | ✅ pass | 2207 ms | queue doctor ok |
| `wizard.dry_run_passes` | required | ✅ pass | 668 ms | wizard dry-run ok |
| `e2e.multi_agent_flow` | required | ✅ pass | 2657 ms | 14/14 checks; 15 ledger, 11 events |
| `workspace.integrity` | skipped | ✅ pass | 0 ms | skipped |
| `clients.config_presence` | skipped | ✅ pass | 0 ms | skipped |
| `clients.claude_code_live` | skipped | ✅ pass | 0 ms | skipped |
| `server.tool_description_hygiene` | required | ✅ pass | 1 ms | 0 suspicious patterns |
| `evidence.hash_chain_valid` | required | ✅ pass | 7 ms | positive=true, negative_detected_at_idx_1=true |
| `docs.master_prompt_deliverables_present` | required | ✅ pass | 2 ms | 10/10 deliverables present |
| `accessibility.wcag_aa_pass` | required | ✅ pass | 1763 ms | 0 critical/serious violations across 22 passing rule(s) (1 non-blocking warning(s)) |

## Machine-readable report

Full evidence including evidence ledgers, tool call shapes, manifest hashes, and config snapshots is in:

`PROOF/latest.json`

## Reproduce

```powershell
cd G:\\_codex_worktrees\\HermesProof-gate-a11y
npm install
node scripts/truth-gates.mjs --workspace "G:\Github\Hermes3D"
```

Exit code 0 means every required gate passed; non-zero means at least one required gate failed.
