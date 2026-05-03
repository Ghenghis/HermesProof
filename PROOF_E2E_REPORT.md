# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-05-03T04-27-10-843Z`
- **Timestamp (UTC)**: 2026-05-03T04:27:10.843Z
- **Duration**: 19.85s
- **Hermes3D workspace**: `G:\Github\hermesproof-wizard-gates`
- **Node**: v25.8.2 on win32
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **17 / 0 / 0 / 0**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 9 ms | 25 files hashed |
| `deps.parity` | required | ✅ pass | 1 ms | all 2 deps installed |
| `tests.unit` | required | ✅ pass | 4922 ms | pass=47, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 268 ms | 24 tools |
| `doctor.hermes3d` | required | ✅ pass | 5 ms | ok=true, 1 finding(s) |
| `events.directory_present` | required | ✅ pass | 24 ms | outbox/handled/failed present |
| `tasks.directory_present` | required | ✅ pass | 19 ms | pending/claimed/blocked/done present |
| `trigger.doctor_passes` | required | ✅ pass | 428 ms | trigger doctor ok |
| `queue.doctor_passes` | required | ✅ pass | 1319 ms | queue doctor ok |
| `wizard.dry_run_passes` | required | ✅ pass | 382 ms | wizard dry-run ok |
| `e2e.multi_agent_flow` | required | ✅ pass | 1191 ms | 14/14 checks; 15 ledger, 11 events |
| `workspace.integrity` | required | ✅ pass | 38 ms | probes=0, install_mods=0, unexpected_mods=0, unexpected_untracked=0 |
| `clients.config_presence` | required | ✅ pass | 2 ms | all 4 present |
| `clients.claude_code_live` | required | ✅ pass | 11221 ms | Connected |
| `server.tool_description_hygiene` | required | ✅ pass | 1 ms | 0 suspicious patterns |
| `evidence.hash_chain_valid` | required | ✅ pass | 8 ms | positive=true, negative_detected_at_idx_1=true |
| `docs.master_prompt_deliverables_present` | required | ✅ pass | 3 ms | 10/10 deliverables present |

## Machine-readable report

Full evidence including evidence ledgers, tool call shapes, manifest hashes, and config snapshots is in:

`PROOF/latest.json`

## Reproduce

```powershell
cd G:\\Github\\hermes3d-mcp-lock-orchestrator
npm install
node scripts/truth-gates.mjs --workspace "G:\Github\hermesproof-wizard-gates"
```

Exit code 0 means every required gate passed; non-zero means at least one required gate failed.
