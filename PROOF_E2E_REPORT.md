# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-05-02T20-57-36-821Z`
- **Timestamp (UTC)**: 2026-05-02T20:57:36.821Z
- **Duration**: 14.18s
- **Hermes3D workspace**: `G:\Github\Hermes3D`
- **Node**: v25.8.2 on win32
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **9 / 0 / 0 / 0**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 6 ms | 13 files hashed |
| `deps.parity` | required | ✅ pass | 1 ms | all 2 deps installed |
| `tests.unit` | required | ✅ pass | 260 ms | pass=12, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 273 ms | 15 tools |
| `doctor.hermes3d` | required | ✅ pass | 4 ms | ok=true, 0 finding(s) |
| `e2e.multi_agent_flow` | required | ✅ pass | 646 ms | 14/14 checks; 3 ledger, 11 events |
| `workspace.integrity` | required | ✅ pass | 88 ms | probes=0, install_mods=1, unexpected_mods=0, unexpected_untracked=0 |
| `clients.config_presence` | required | ✅ pass | 2 ms | all 4 present |
| `clients.claude_code_live` | required | ✅ pass | 12895 ms | Connected |

## Machine-readable report

Full evidence including evidence ledgers, tool call shapes, manifest hashes, and config snapshots is in:

`PROOF/latest.json`

## Reproduce

```powershell
cd G:\\Github\\hermes3d-mcp-lock-orchestrator
npm install
node scripts/truth-gates.mjs --workspace "G:\Github\Hermes3D"
```

Exit code 0 means every required gate passed; non-zero means at least one required gate failed.
