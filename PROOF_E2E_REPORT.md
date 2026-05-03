# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-05-03T16-33-45-752Z`
- **Timestamp (UTC)**: 2026-05-03T16:33:45.752Z
- **Duration**: 14.33s
- **Hermes3D workspace**: `G:\Github\hp-registry`
- **Node**: v25.8.2 on win32
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **25 / 0 / 0 / 4**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 14 ms | 47 files hashed |
| `deps.parity` | required | ✅ pass | 2 ms | all 3 deps installed |
| `tests.unit` | required | ✅ pass | 4231 ms | pass=124, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 270 ms | 34 tools |
| `doctor.hermes3d` | skipped | ✅ pass | 0 ms | skipped |
| `events.directory_present` | required | ✅ pass | 17 ms | outbox/handled/failed present |
| `tasks.directory_present` | required | ✅ pass | 14 ms | pending/claimed/blocked/done present |
| `trigger.doctor_passes` | required | ✅ pass | 207 ms | trigger doctor ok |
| `queue.doctor_passes` | required | ✅ pass | 716 ms | queue doctor ok |
| `wizard.dry_run_passes` | required | ✅ pass | 387 ms | wizard dry-run ok |
| `e2e.multi_agent_flow` | required | ✅ pass | 969 ms | 14/14 checks; 15 ledger, 11 events |
| `workspace.integrity` | skipped | ✅ pass | 0 ms | skipped |
| `clients.config_presence` | skipped | ✅ pass | 0 ms | skipped |
| `clients.claude_code_live` | skipped | ✅ pass | 0 ms | skipped |
| `server.tool_description_hygiene` | required | ✅ pass | 1 ms | 0 suspicious patterns |
| `security.mcp_scan_pass` | required | ✅ pass | 6 ms | 0 suspicious patterns across 16 signatures |
| `evidence.hash_chain_valid` | required | ✅ pass | 6 ms | positive=true, negative_detected_at_idx_1=true |
| `docs.master_prompt_deliverables_present` | required | ✅ pass | 3 ms | 10/10 deliverables present |
| `provider.registry.validate` | required | ✅ pass | 3 ms | 62 entries, 62 unique provider_names |
| `local.models.catalog.validate` | required | ✅ pass | 1 ms | schema ok; 87 valid rows |
| `continue.llm_classes.validate` | required | ✅ pass | 1 ms | all 62 expected provider names present (62 total) |
| `kilocode.provider.mapping.validate` | warn | ✅ pass | 0 ms | kilocode_mapping.csv not in pack — gate stub running as not_applicable |
| `lmstudio.health` | warn | ✅ pass | 26 ms | LM Studio reachable (200) |
| `ollama.health` | warn | ✅ pass | 251 ms | Ollama reachable (200) |
| `secret.scan` | required | ✅ pass | 87 ms | fallback: 0 finding(s) |
| `secrets.rotation_evidence_present` | warn | ✅ pass | 1 ms | env mtime 2026-05-03T11:21:11.447Z (age 0.2d <= max 90d) |
| `sbom.cyclonedx_generated` | required | ✅ pass | 45 ms | 92 components @ G:/Github/hp-registry/PROOF/sbom.json |
| `licenses.scan` | required | ✅ pass | 6404 ms | 93 packages scanned; unknown=0, review=1 |
| `dependency.fresh` | warn | ✅ pass | 670 ms | 3/3 direct deps within 12mo |

## Machine-readable report

Full evidence including evidence ledgers, tool call shapes, manifest hashes, and config snapshots is in:

`PROOF/latest.json`

## Reproduce

```powershell
cd G:\\Github\\hp-registry
npm install
node scripts/truth-gates.mjs --workspace "G:\Github\hp-registry"
```

Exit code 0 means every required gate passed; non-zero means at least one required gate failed.
