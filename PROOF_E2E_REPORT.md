# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-08-09T19-03-27-409Z`
- **Timestamp (UTC)**: 2026-08-09T19:03:27.409Z
- **Duration**: 46.31s
- **Hermes3D workspace**: `C:\Users\Admin\Documents\Codex\2026-08-08\g-github-hermes3d-mcp-lock-orchestrator-2\work\hermesproof-release`
- **Node**: v22.16.0 on win32
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **38 / 0 / 0 / 1**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 49 ms | 184 files hashed |
| `deps.parity` | required | ✅ pass | 3 ms | all 7 deps installed |
| `tests.unit` | required | ✅ pass | 31517 ms | pass=495, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 356 ms | 121 tools |
| `doctor.hermes3d` | required | ✅ pass | 4 ms | ok=true, 0 finding(s) |
| `events.directory_present` | required | ✅ pass | 21 ms | outbox/handled/failed present |
| `tasks.directory_present` | required | ✅ pass | 17 ms | pending/claimed/blocked/done present |
| `trigger.doctor_passes` | required | ✅ pass | 250 ms | trigger doctor ok |
| `queue.doctor_passes` | required | ✅ pass | 412 ms | queue doctor ok |
| `wizard.dry_run_passes` | required | ✅ pass | 549 ms | wizard dry-run ok |
| `e2e.multi_agent_flow` | required | ✅ pass | 800 ms | 14/14 checks; 15 ledger, 11 events |
| `workspace.integrity` | required | ✅ pass | 210 ms | probes=0, install_mods=0, expected_mods=0, unexpected_mods=0, unexpected_untracked=0 |
| `clients.config_presence` | required | ✅ pass | 2 ms | all 4 present |
| `clients.claude_code_live` | required | ✅ pass | 5365 ms | Connected |
| `server.tool_description_hygiene` | required | ✅ pass | 7 ms | 0 suspicious patterns |
| `security.mcp_scan_pass` | required | ✅ pass | 133 ms | 0 suspicious patterns across 16 signatures |
| `evidence.hash_chain_valid` | required | ✅ pass | 36 ms | positive=true, negative_detected_at_idx_1=true |
| `docs.master_prompt_deliverables_present` | required | ✅ pass | 4 ms | 10/10 deliverables present |
| `provider.registry.validate` | required | ✅ pass | 3 ms | 62 entries, 62 unique provider_names |
| `local.models.catalog.validate` | required | ✅ pass | 1 ms | schema ok; 91 valid rows |
| `continue.llm_classes.validate` | required | ✅ pass | 1 ms | all 62 expected provider names present (62 total) |
| `kilocode.provider.mapping.validate` | warn | ✅ pass | 0 ms | kilocode_mapping.csv not in pack — gate stub running as not_applicable |
| `lmstudio.health` | warn | ✅ pass | 1033 ms | LM Studio reachable via local fallback (200) |
| `ollama.health` | warn | ✅ pass | 2 ms | Ollama reachable (200) |
| `backend.api_config_presence` | warn | ✅ pass | 244 ms | backend API inventory: envs=8, gh=true, glab=false |
| `gitlab.auth_probe` | warn | ✅ pass | 687 ms | GitLab authenticated via gitlab_env_file:GITLAB_TOKEN |
| `secret.scan` | required | ✅ pass | 181 ms | fallback: 0 finding(s) |
| `secrets.rotation_evidence_present` | warn | ✅ pass | 0 ms | env mtime 2026-08-08T19:54:02.512Z (age 1.0d <= max 90d) |
| `sbom.cyclonedx_generated` | required | ✅ pass | 53 ms | 96 components @ C:/Users/Admin/Documents/Codex/2026-08-08/g-github-hermes3d-mcp-lock-orchestrator-2/work/hermesproof-release/PROOF/sbom.json |
| `licenses.scan` | required | ✅ pass | 1625 ms | 99 packages scanned; unknown=0, review=1 |
| `dependency.fresh` | warn | ✅ pass | 1361 ms | 7/7 direct deps within 12mo |
| `security.workflow_actions_sha_pinned` | required | ✅ pass | 1 ms | 0 workflow(s), 0 uses-ref(s), all SHA-pinned |
| `accessibility.wcag_aa_pass` | required | ✅ pass | 1202 ms | 0 critical/serious violations across 21 passing rule(s) (1 non-blocking warning(s)) |
| `perf.budgets_pass` | required | ✅ pass | 1 ms | hermes_doctor_cold_start=1.5ms<300ms? Y; lock_acquire=6.5ms<50ms? Y; heartbeat=6.9ms<20ms? Y |
| `docs.reflects_changes` | warn | ✅ pass | 104 ms | no version bump or ADR change in range; gate is inert |
| `release.checksums_present` | warn | ✅ pass | 15 ms | 1 artifact(s) have verified sha256+Ed25519 signatures |
| `quality.coderabbit_reviewed` | skipped | ✅ pass | 34 ms | no PR context (owner/repo/pr); gate inert |
| `harness_attribution.contract` | required | ✅ pass | 8 ms | cards=8 (aider_0_86_2_windows_installed=PASS, goose_1_27_2_windows_installed=PASS, hermesagent_bridge_2026-08-05=PASS, hermesproof_v0.7.0_hp_mha_real=PASS, openhands_cli_1_16_0_windows_installed=PASS, aider_0_86_2_windows_installed_reference=PASS, goose_1_27_2_windows_installed_reference=PASS, openhands_cli_1_16_0_windows_installed_reference=PASS) \| adversarial=FAIL(HP-MHA-missing-input) |
| `harness_attribution.holdout_isolation_at_queue` | required | ✅ pass | 15 ms | cases=ok\|4/4 (optimizer_on_holdout=FAIL, agent_on_holdout=PASS, optimizer_on_optimization=PASS, optimizer_on_mixed=FAIL) \| index rows=2 range-match=1 |

## Machine-readable report

Full evidence including evidence ledgers, tool call shapes, manifest hashes, and config snapshots is in:

`PROOF/latest.json`

## Reproduce

```powershell
cd C:\\Users\\Admin\\Documents\\Codex\\2026-08-08\\g-github-hermes3d-mcp-lock-orchestrator-2\\work\\hermesproof-release
npm install
node scripts/truth-gates.mjs --workspace "C:\Users\Admin\Documents\Codex\2026-08-08\g-github-hermes3d-mcp-lock-orchestrator-2\work\hermesproof-release"
```

Exit code 0 means every required gate passed; non-zero means at least one required gate failed.
