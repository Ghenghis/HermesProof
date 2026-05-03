# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-05-03T03-27-38-338Z`
- **Timestamp (UTC)**: 2026-05-03T03:27:38.338Z
- **Duration**: 15.73s
- **Hermes3D workspace**: `G:\Github\hermesproof-trigger-sandbox`
- **Node**: v25.8.2 on win32
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **14 / 0 / 0 / 0**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 10 ms | 18 files hashed |
| `deps.parity` | required | ✅ pass | 1 ms | all 2 deps installed |
| `tests.unit` | required | ✅ pass | 1896 ms | pass=29, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 257 ms | 20 tools |
| `doctor.hermes3d` | required | ✅ pass | 4 ms | ok=true, 1 finding(s) |
| `events.directory_present` | required | ✅ pass | 13 ms | outbox/handled/failed present |
| `trigger.doctor_passes` | required | ✅ pass | 347 ms | trigger doctor ok |
| `e2e.multi_agent_flow` | required | ✅ pass | 1175 ms | 14/14 checks; 15 ledger, 11 events |
| `workspace.integrity` | required | ✅ pass | 43 ms | probes=0, install_mods=0, unexpected_mods=0, unexpected_untracked=0 |
| `clients.config_presence` | required | ✅ pass | 2 ms | all 4 present |
| `clients.claude_code_live` | required | ✅ pass | 11955 ms | Connected |
| `server.tool_description_hygiene` | required | ✅ pass | 5 ms | 0 suspicious patterns |
| `evidence.hash_chain_valid` | required | ✅ pass | 11 ms | positive=true, negative_detected_at_idx_1=true |
| `docs.master_prompt_deliverables_present` | required | ✅ pass | 4 ms | 10/10 deliverables present |

## Machine-readable report

Full evidence including evidence ledgers, tool call shapes, manifest hashes, and config snapshots is in:

`PROOF/latest.json`

## Reproduce

```powershell
cd G:\\Github\\hermes3d-mcp-lock-orchestrator
npm install
node scripts/truth-gates.mjs --workspace "G:\Github\hermesproof-trigger-sandbox"
```

Exit code 0 means every required gate passed; non-zero means at least one required gate failed.
