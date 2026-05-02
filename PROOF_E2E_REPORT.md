# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-05-02T21-02-44-031Z`
- **Timestamp (UTC)**: 2026-05-02T21:02:44.031Z
- **Duration**: 0.67s
- **Hermes3D workspace**: `/home/runner/work/HermesProof/HermesProof`
- **Node**: v20.20.2 on linux
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **5 / 0 / 0 / 4**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 5 ms | 13 files hashed |
| `deps.parity` | required | ✅ pass | 1 ms | all 2 deps installed |
| `tests.unit` | required | ✅ pass | 180 ms | pass=12, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 205 ms | 15 tools |
| `doctor.hermes3d` | skipped | ✅ pass | 0 ms | skipped |
| `e2e.multi_agent_flow` | required | ✅ pass | 276 ms | 14/14 checks; 3 ledger, 11 events |
| `workspace.integrity` | skipped | ✅ pass | 0 ms | skipped |
| `clients.config_presence` | skipped | ✅ pass | 0 ms | skipped |
| `clients.claude_code_live` | skipped | ✅ pass | 0 ms | skipped |

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
