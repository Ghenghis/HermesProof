# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-05-02T22-59-10-617Z`
- **Timestamp (UTC)**: 2026-05-02T22:59:10.617Z
- **Duration**: 1.37s
- **Hermes3D workspace**: `G:\Github\Hermes3D`
- **Node**: v25.8.2 on win32
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **8 / 0 / 0 / 4**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 8 ms | 13 files hashed |
| `deps.parity` | required | ✅ pass | 2 ms | all 2 deps installed |
| `tests.unit` | required | ✅ pass | 295 ms | pass=12, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 296 ms | 16 tools |
| `doctor.hermes3d` | skipped | ✅ pass | 0 ms | skipped |
| `e2e.multi_agent_flow` | required | ✅ pass | 761 ms | 14/14 checks; 3 ledger, 11 events |
| `workspace.integrity` | skipped | ✅ pass | 0 ms | skipped |
| `clients.config_presence` | skipped | ✅ pass | 0 ms | skipped |
| `clients.claude_code_live` | skipped | ✅ pass | 0 ms | skipped |
| `server.tool_description_hygiene` | required | ✅ pass | 1 ms | 0 suspicious patterns |
| `evidence.hash_chain_valid` | required | ✅ pass | 6 ms | positive=true, negative_detected_at_idx_1=true |
| `docs.master_prompt_deliverables_present` | required | ✅ pass | 2 ms | 10/10 deliverables present |

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
