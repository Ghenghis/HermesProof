# End-to-End Truth-Gate Report

- **Run id**: `truth_2026-08-12T20-04-29-668Z`
- **Timestamp (UTC)**: 2026-08-12T20:04:29.668Z
- **Duration**: 50.31s
- **Hermes3D workspace**: `C:\Users\Admin\Documents\Codex\2026-08-08\g-github-hermes3d-mcp-lock-orchestrator-2\work\hermesproof-release`
- **Node**: v22.16.0 on win32
- **Result**: ✅ ALL REQUIRED GATES PASS

Pass / Fail / Warn / Skip: **37 / 0 / 1 / 1**

## Gate results

| Gate | Level | Result | Duration | Detail |
| --- | --- | --- | --- | --- |
| `source.integrity_manifest` | required | ✅ pass | 54 ms | 190 files hashed |
| `deps.parity` | required | ✅ pass | 3 ms | all 7 deps installed |
| `tests.unit` | required | ✅ pass | 31421 ms | pass=497, fail=0, exit=0 |
| `server.stdio_handshake` | required | ✅ pass | 423 ms | 121 tools |
| `doctor.hermes3d` | required | ✅ pass | 4 ms | ok=true, 0 finding(s) |
| `events.directory_present` | required | ✅ pass | 21 ms | outbox/handled/failed present |
| `tasks.directory_present` | required | ✅ pass | 17 ms | pending/claimed/blocked/done present |
| `trigger.doctor_passes` | required | ✅ pass | 260 ms | trigger doctor ok |
| `queue.doctor_passes` | required | ✅ pass | 398 ms | queue doctor ok |
| `wizard.dry_run_passes` | required | ✅ pass | 382 ms | wizard dry-run ok |
| `e2e.multi_agent_flow` | required | ✅ pass | 820 ms | 14/14 checks; 15 ledger, 11 events |
| `workspace.integrity` | required | ✅ pass | 221 ms | probes=0, install_mods=0, expected_mods=0, unexpected_mods=0, unexpected_untracked=0 |
| `clients.config_presence` | required | ✅ pass | 2 ms | all 4 present |
| `clients.claude_code_live` | required | ✅ pass | 5686 ms | 2/2 connected |
| `server.tool_description_hygiene` | required | ✅ pass | 6 ms | 0 suspicious patterns |
| `security.mcp_scan_pass` | required | ✅ pass | 129 ms | 0 suspicious patterns across 16 signatures |
| `evidence.hash_chain_valid` | required | ✅ pass | 35 ms | positive=true, negative_detected_at_idx_1=true |
| `docs.master_prompt_deliverables_present` | required | ✅ pass | 9 ms | 10/10 deliverables present |
| `provider.registry.validate` | required | ✅ pass | 5 ms | 62 entries, 62 unique provider_names |
| `local.models.catalog.validate` | required | ✅ pass | 3 ms | schema ok; 91 valid rows |
| `continue.llm_classes.validate` | required | ✅ pass | 1 ms | all 62 expected provider names present (62 total) |
| `kilocode.provider.mapping.validate` | warn | ✅ pass | 1 ms | kilocode_mapping.csv not in pack — gate stub running as not_applicable |
| `lmstudio.health` | warn | ⚠️ warn | 5018 ms | LM Studio offline: ECONNREFUSED |
| `ollama.health` | warn | ✅ pass | 3 ms | Ollama reachable (200) |
| `backend.api_config_presence` | warn | ✅ pass | 110 ms | backend API inventory: envs=8, gh=false, glab=false |
| `gitlab.auth_probe` | warn | ✅ pass | 563 ms | GitLab authenticated via gitlab_env_file:GITLAB_TOKEN |
| `secret.scan` | required | ✅ pass | 156 ms | fallback: 0 finding(s) |
| `secrets.rotation_evidence_present` | warn | ✅ pass | 1 ms | env mtime 2026-08-08T19:54:02.512Z (age 4.0d <= max 90d) |
| `sbom.cyclonedx_generated` | required | ✅ pass | 55 ms | 96 components @ C:/Users/Admin/Documents/Codex/2026-08-08/g-github-hermes3d-mcp-lock-orchestrator-2/work/hermesproof-release/PROOF/sbom.json |
| `licenses.scan` | required | ✅ pass | 1508 ms | 99 packages scanned; unknown=0, review=1 |
| `dependency.fresh` | warn | ✅ pass | 1325 ms | 7/7 direct deps within 12mo |
| `security.workflow_actions_sha_pinned` | required | ✅ pass | 0 ms | 0 workflow(s), 0 uses-ref(s), all SHA-pinned |
| `accessibility.wcag_aa_pass` | required | ✅ pass | 1428 ms | 0 critical/serious violations across 21 passing rule(s) (1 non-blocking warning(s)) |
| `perf.budgets_pass` | required | ✅ pass | 1 ms | hermes_doctor_cold_start=1.5ms<300ms? Y; lock_acquire=6.5ms<50ms? Y; heartbeat=6.9ms<20ms? Y |
| `docs.reflects_changes` | warn | ✅ pass | 161 ms | no version bump or ADR change in range; gate is inert |
| `release.checksums_present` | warn | ✅ pass | 17 ms | 1 artifact(s) have verified sha256+Ed25519 signatures |
| `quality.coderabbit_reviewed` | skipped | ✅ pass | 37 ms | no PR context (owner/repo/pr); gate inert |
| `harness_attribution.contract` | required | ✅ pass | 10 ms | cards=8 (aider_0_86_2_windows_installed=PASS, goose_1_27_2_windows_installed=PASS, hermesagent_bridge_2026-08-05=PASS, hermesproof_v0.7.0_hp_mha_real=PASS, openhands_cli_1_16_0_windows_installed=PASS, aider_0_86_2_windows_installed_reference=PASS, goose_1_27_2_windows_installed_reference=PASS, openhands_cli_1_16_0_windows_installed_reference=PASS) \| adversarial=FAIL(HP-MHA-missing-input) |
| `harness_attribution.holdout_isolation_at_queue` | required | ✅ pass | 8 ms | cases=ok\|4/4 (optimizer_on_holdout=FAIL, agent_on_holdout=PASS, optimizer_on_optimization=PASS, optimizer_on_mixed=FAIL) \| index rows=2 range-match=1 |

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
