# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-07-03T02-42-43-779Z`
- **Timestamp (UTC)**: 2026-07-03T02:42:43.779Z
- **Duration**: 52.98s
- **Hermes3D workspace**: `G:\Github\Hermes3D`
- **Node**: v26.2.0 on win32
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **32 / 0 / 0 / 5**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 34 ms | 79 files hashed |
| `deps.parity` | required | ✅ pass | 2 ms | all 3 deps installed |
| `tests.unit` | required | ✅ pass | 36777 ms | pass=320, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 521 ms | 92 tools |
| `doctor.hermes3d` | skipped | ✅ pass | 0 ms | skipped |
| `events.directory_present` | required | ✅ pass | 70 ms | outbox/handled/failed present |
| `tasks.directory_present` | required | ✅ pass | 23 ms | pending/claimed/blocked/done present |
| `trigger.doctor_passes` | required | ✅ pass | 378 ms | trigger doctor ok |
| `queue.doctor_passes` | required | ✅ pass | 860 ms | queue doctor ok |
| `wizard.dry_run_passes` | required | ✅ pass | 810 ms | wizard dry-run ok |
| `e2e.multi_agent_flow` | required | ✅ pass | 1136 ms | 14/14 checks; 15 ledger, 11 events |
| `workspace.integrity` | skipped | ✅ pass | 0 ms | skipped |
| `clients.config_presence` | skipped | ✅ pass | 0 ms | skipped |
| `clients.claude_code_live` | skipped | ✅ pass | 0 ms | skipped |
| `server.tool_description_hygiene` | required | ✅ pass | 8 ms | 0 suspicious patterns |
| `security.mcp_scan_pass` | required | ✅ pass | 126 ms | 0 suspicious patterns across 16 signatures |
| `evidence.hash_chain_valid` | required | ✅ pass | 8 ms | positive=true, negative_detected_at_idx_1=true |
| `docs.master_prompt_deliverables_present` | required | ✅ pass | 4 ms | 10/10 deliverables present |
| `provider.registry.validate` | required | ✅ pass | 3 ms | 62 entries, 62 unique provider_names |
| `local.models.catalog.validate` | required | ✅ pass | 1 ms | schema ok; 91 valid rows |
| `continue.llm_classes.validate` | required | ✅ pass | 1 ms | all 62 expected provider names present (62 total) |
| `kilocode.provider.mapping.validate` | warn | ✅ pass | 1 ms | kilocode_mapping.csv not in pack — gate stub running as not_applicable |
| `lmstudio.health` | warn | ✅ pass | 9 ms | LM Studio reachable (200) |
| `ollama.health` | warn | ✅ pass | 1 ms | Ollama reachable (200) |
| `backend.api_config_presence` | warn | ✅ pass | 369 ms | backend API inventory: envs=10, gh=true, glab=false |
| `gitlab.auth_probe` | warn | ✅ pass | 321 ms | GitLab authenticated via gitlab_env_file:GITLAB_TOKEN |
| `secret.scan` | required | ✅ pass | 130 ms | fallback: 0 finding(s) |
| `secrets.rotation_evidence_present` | warn | ✅ pass | 0 ms | env mtime 2026-06-20T17:43:43.876Z (age 12.4d <= max 90d) |
| `sbom.cyclonedx_generated` | required | ✅ pass | 57 ms | 131 components @ G:/Github/hermes3d-mcp-lock-orchestrator/PROOF/sbom.json |
| `licenses.scan` | required | ✅ pass | 7785 ms | 93 packages scanned; unknown=0, review=1 |
| `dependency.fresh` | warn | ✅ pass | 615 ms | 3/3 direct deps within 12mo |
| `security.workflow_actions_sha_pinned` | required | ✅ pass | 6 ms | 4 workflow(s), 17 uses-ref(s), all SHA-pinned |
| `accessibility.wcag_aa_pass` | required | ✅ pass | 2741 ms | 0 critical/serious violations across 22 passing rule(s) (1 non-blocking warning(s)) |
| `perf.budgets_pass` | required | ✅ pass | 1 ms | hermes_doctor_cold_start=1.5ms<300ms? Y; lock_acquire=6.5ms<50ms? Y; heartbeat=6.9ms<20ms? Y |
| `docs.reflects_changes` | warn | ✅ pass | 136 ms | no version bump or ADR change in range; gate is inert |
| `release.checksums_present` | warn | ✅ pass | 0 ms | no release artifacts in dist,release; gate dormant |
| `quality.coderabbit_reviewed` | skipped | ✅ pass | 42 ms | no PR context (owner/repo/pr); gate inert |

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
