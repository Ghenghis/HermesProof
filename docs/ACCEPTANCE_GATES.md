# Acceptance Gates

Mapping of master-prompt §10 acceptance criteria → truth-gate IDs → pass/fail thresholds. This is the single document a reviewer reads to decide "did Codex finish."

## 1. Acceptance criteria (master prompt §10)

The README must answer, visually and verifiably:

| ID | Criterion | Met by README section(s) |
|---|---|---|
| AC-01 | What is HermesProof? | Hero, Architecture |
| AC-02 | Why does Hermes3D need it? | Multi-agent coordination, Composition |
| AC-03 | How do Claude and Codex avoid collisions? | Pipeline, Multi-agent coordination |
| AC-04 | What happens when one agent needs another agent's file? | Multi-agent coordination (handoff lifecycle) |
| AC-05 | How is every change proven? | Pipeline, Truth gates |
| AC-06 | What gates run? | Truth gates (table) |
| AC-07 | How do I install it? | Quickstart, Client config |
| AC-08 | How does it connect to Claude Desktop, Code, Codex, Windsurf? | Quickstart, Client config |
| AC-09 | Where is the proof? | Truth gates (PROOF/* links) |
| AC-10 | How is it inspired by Hermes Agent? | Inspiration & credits |

All 10 are met by the shipped README (commit `c330814`).

## 2. Gate-to-criterion mapping

Each AC must be backed by at least one passing gate (preferred) or one verifiable doc (acceptable).

| AC | Primary gate | Secondary gate / doc |
|---|---|---|
| AC-01 | `server.stdio_handshake` (proves the server actually exists and responds) | [docs/ARCHITECTURE.md](ARCHITECTURE.md) |
| AC-02 | `e2e.multi_agent_flow` (the whole flow runs against a real workspace) | [docs/INTEROP_WITH_OTHER_MCP.md](INTEROP_WITH_OTHER_MCP.md) |
| AC-03 | `e2e.multi_agent_flow` step `lock.blocked_by_codex` | [docs/LOCK_PROTOCOL.md](LOCK_PROTOCOL.md) |
| AC-04 | `e2e.multi_agent_flow` steps `handoff.requested` + `handoff.approved` + `handoff.codex_cannot_silently_recapture` | [docs/LOCK_PROTOCOL.md](LOCK_PROTOCOL.md) |
| AC-05 | `source.integrity_manifest` + `e2e.multi_agent_flow` step `evidence.appended` | [PROOF/latest.json](../PROOF/latest.json) |
| AC-06 | `tests.unit` (12 tests pass), `truth-gates.mjs` itself runs all gates | [PROOF_E2E_REPORT.md](../PROOF_E2E_REPORT.md) |
| AC-07 | `clients.config_presence` (4/4 wired locally), `clients.claude_code_live` | [docs/SETUP_*.md](SETUP_GENERIC_PROJECT.md) |
| AC-08 | `clients.config_presence` + `clients.claude_code_live` | [examples/](../examples/) |
| AC-09 | `truth-gates.mjs` writes `PROOF/latest.json` and `PROOF_E2E_REPORT.md` on every run | refreshed per push to `main` |
| AC-10 | (no gate; documentary attribution) | [docs/HERMES3D_SOURCE_AUDIT.md](HERMES3D_SOURCE_AUDIT.md) §1 |

## 3. Pass/fail thresholds

| Gate | Pass threshold | Failure mode |
|---|---|---|
| `source.integrity_manifest` | All files in `src/` + `scripts/` hashable, `manifest_sha256` computed | I/O error or unreadable file |
| `deps.parity` | Every declared dep present under `node_modules/` | One or more deps missing |
| `tests.unit` | exit_code = 0, pass_count > 0, fail_count = 0 | Any test failure |
| `server.stdio_handshake` | All 15 expected tools present after `tools/list` | Missing tool, server crash, parse error |
| `doctor.hermes3d` (local) | `findings.filter(f => f.level === 'error').length === 0` | Workspace unwritable, state dir missing |
| `e2e.multi_agent_flow` | All 14 sub-checks pass; ≥ 1 ledger entry; ≥ 1 event entry | Any step failure |
| `workspace.integrity` (local) | Zero probe files left, zero unexpected modifications, zero unexpected untracked | Probe leak, tracked-file drift |
| `clients.config_presence` (local) | All 4 client configs reference `hermes3d-locks` | Any missing |
| `clients.claude_code_live` (local) | `claude mcp list` shows `✓ Connected` for `hermes3d-locks` | Not connected, CLI not found (warn) |
| `docs.master_prompt_deliverables_present` (Phase 0) | All 10 deliverables exist, non-empty, frontmatter parseable | Any missing or empty |

`required` gates failing → exit code 1 → CI red. `warn` gates failing → exit code 0 → CI green with warning. `skipped` gates → not counted.

## 4. CI subset (`--ci`)

CI runs in a clean ubuntu-latest container with no client configs and no Hermes3D workspace. The `--ci` flag skips:

- `doctor.hermes3d` (no workspace)
- `workspace.integrity` (no workspace)
- `clients.config_presence` (no configs)
- `clients.claude_code_live` (no `claude` CLI)

CI must pass: `source.integrity_manifest`, `deps.parity`, `tests.unit`, `server.stdio_handshake`, `e2e.multi_agent_flow`, and (Phase 0) `docs.master_prompt_deliverables_present`. After Phase 1, also `mcp-scan` (gate 11). After Phase 2, also `cosign.signed_proof` and `attestation.published`.

## 5. Gate roadmap

| Phase | Gate ID | Adds |
|---|---|---|
| 0 (this branch) | `docs.master_prompt_deliverables_present` | Verifies the 10 spec/handoff files exist |
| 1 | `mcp-scan` | Static analysis of MCP server for tool poisoning |
| 1 | `evidence.hash_chain_valid` | Walks NDJSON, verifies prev_hash chain |
| 1 (optional) | `assets.svg_a11y` | All SVGs have `<desc>` + reduced-motion |
| 2 | `proof.cosign_signed` | `PROOF/latest.json` has matching cosign bundle |
| 2 | `attestation.build_provenance` | `gh attestation verify` succeeds |

## 6. Reviewer checklist

When approving a PR that touches the README, docs, source, or workflows:

- [ ] All `required` gates pass locally on the branch HEAD: `npm run truth-gates`
- [ ] CI passes on the same SHA: `gh run watch -R Ghenghis/HermesProof --exit-status`
- [ ] No gate added that depends on a network resource without explicit allowlist
- [ ] [README_COVERAGE_MATRIX.md](README_COVERAGE_MATRIX.md) updated if any claim moved or changed
- [ ] No new claim asserted without backing source + gate
- [ ] Branch is `feat/*` or `fix/*`, not direct push to `main`
- [ ] Commit messages follow the `<type>(<scope>): <subject>` convention used in repo history
- [ ] No file modified that is locked by another agent (check `hermes_list_locks`)
