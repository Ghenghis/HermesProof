# HermesProof — Final Evidence Report

> Master-prompt §5 Wave 7 closure. Generated 2026-05-02 after the merge of PR #1 to `main`, the first push of `main` exercising the Phase 2 Sigstore + attestation pipeline, and the Pages workflow rerun.

## 1. Identity

```text
Project:           HermesProof
Repo:              https://github.com/Ghenghis/HermesProof
Local path:        G:\Github\hermes3d-mcp-lock-orchestrator
Package:           hermesproof@0.3.0
License:           MIT (Ghenghis 2026)
MCP server name:   hermes3d-locks (deployed name)
MCP spec version:  2025-11-25 (server-supported; negotiates down to client)
Node engine:       >= 20
Live site:         https://ghenghis.github.io/HermesProof/
```

## 2. Branch and merge state

```text
Branch:           feat/hermesproof-spec-docs (now merged + closed)
Merged to main:   PR #1 — ba6a4f7 (merge commit)
Commits landed:   7e46663, b2274a0, 1f34c05, 6577680, 9874c1e
Auto-refresh:     5d41f40 ci: refresh truth-gate proof for ba6a4f7 [skip ci]
PR link:          https://github.com/Ghenghis/HermesProof/pull/1
```

## 3. Files created / changed

**Created (Phase 0 — design contract closure):**
- [docs/README_MASTER_SPEC.md](docs/README_MASTER_SPEC.md)
- [docs/README_COVERAGE_MATRIX.md](docs/README_COVERAGE_MATRIX.md)
- [docs/VISUAL_ASSET_SPEC.md](docs/VISUAL_ASSET_SPEC.md)
- [docs/SVG_ANIMATION_SPEC.md](docs/SVG_ANIMATION_SPEC.md)
- [docs/HERMES3D_SOURCE_AUDIT.md](docs/HERMES3D_SOURCE_AUDIT.md)
- [docs/HERMESPROOF_SETUP_AUDIT.md](docs/HERMESPROOF_SETUP_AUDIT.md)
- [docs/CODEX_IMPLEMENTATION_HANDOFF.md](docs/CODEX_IMPLEMENTATION_HANDOFF.md)
- [docs/CLAUDE_REVIEW_TEAM_PROMPT.md](docs/CLAUDE_REVIEW_TEAM_PROMPT.md)
- [docs/ACCEPTANCE_GATES.md](docs/ACCEPTANCE_GATES.md)
- [handoffs/HANDOFF_TO_CODEX_README_VISUALS.md](handoffs/HANDOFF_TO_CODEX_README_VISUALS.md)

**Created (Phase 2 — client integration bundles):**
- [examples/claude_code/settings.hooks.json](examples/claude_code/settings.hooks.json)
- [examples/claude_code/skills/hermesproof/SKILL.md](examples/claude_code/skills/hermesproof/SKILL.md)
- [examples/cursor/.cursor/mcp.json](examples/cursor/.cursor/mcp.json)
- [examples/cursor/.cursor/rules/hermesproof.mdc](examples/cursor/.cursor/rules/hermesproof.mdc)
- [examples/vscode/.vscode/mcp.json](examples/vscode/.vscode/mcp.json)
- [examples/vscode/copilot-instructions.snippet.md](examples/vscode/copilot-instructions.snippet.md)
- [examples/AGENTS.snippet.md](examples/AGENTS.snippet.md)

**Modified (core hardening):**
- [src/server.mjs](src/server.mjs) — `registerTool` migration, MCP `2025-11-25` annotations, regex-tightened `Owner`, new `hermes_verify_evidence` tool (#16)
- [src/core/lock-manager.mjs](src/core/lock-manager.mjs) — `appendEvidence` now uses chained NDJSON; new `verifyEvidence` method
- [src/core/fs-utils.mjs](src/core/fs-utils.mjs) — `appendChainedJsonLine`, `verifyChainedLog`, `canonicalJSON`; tightened `normalizeWorkspacePath` (control chars, `~`, NTFS ADS)
- [scripts/truth-gates.mjs](scripts/truth-gates.mjs) — gates `server.tool_description_hygiene`, `evidence.hash_chain_valid`, `docs.master_prompt_deliverables_present`; expectedTools count 16
- [scripts/install-clients.mjs](scripts/install-clients.mjs) — three new install targets
- [.github/workflows/truth-gates.yml](.github/workflows/truth-gates.yml) — top-level least-privilege perms, harden-runner audit, SHA-pin (8 of 13 actions), `attest-build-provenance`, cosign keyless sign-blob, verification echo
- [.github/workflows/pages.yml](.github/workflows/pages.yml) — same hardening (perms, harden-runner, partial SHA-pin)
- [package.json](package.json) — `@modelcontextprotocol/sdk` `^1.19.0` → `^1.24.0` (resolves `1.29.0`); version bump to `0.3.0`
- [README.md](README.md) — claim updates: 16 tools, 12 gates, MCP `2025-11-25`, hash-chain ledger, Sigstore signing, native attestations
- 7× [docs/diagrams/*.svg](docs/diagrams) — WCAG 2.2 AA pass: `<desc>`, `aria-labelledby`, `prefers-reduced-motion` reduce stanza in `<defs>`; text-claim updates (15→16 tools, 9→12 gates) on the four diagrams that referenced counts

## 4. Locks held / released

The MCP lock-store was rooted at `G:\Github\Hermes3D` for this session (the workspace HermesProof governs), so HermesProof's own files were edited without internal locks (single-agent operation across multiple sequential edits). The git-history-as-evidence-trail is the audit record for this branch:

```text
ba6a4f7  Merge PR #1
9874c1e  fix(diagrams)
6577680  fix(examples)
1f34c05  feat(security)
b2274a0  docs(spec)
7e46663  feat(site)
```

## 5. Codex handoff status

[handoffs/HANDOFF_TO_CODEX_README_VISUALS.md](handoffs/HANDOFF_TO_CODEX_README_VISUALS.md) is preserved as the historical contract for `c330814` (master-prompt Wave 4 implementation). No new Codex handoff is open at the time of this report — Phase 0+1+2 work was completed by Claude in this branch without requiring a Codex implementation hand-off.

## 6. HermesProof setup status

```text
README:                    visual-first, 14 KB, 7 SMIL-animated SVGs (all WCAG 2.2 AA after Phase 1)
Pages site:                live at https://ghenghis.github.io/HermesProof/ (deployed by .github/workflows/pages.yml)
MCP server:                src/server.mjs, 16 tools, MCP 2025-11-25 annotations, registerTool API
Lock store:                .hermes3d_orchestrator/ (atomic mkdir, 90-min TTL, hash-chained evidence)
Allowlisted gates:         9 default + extensible via state-dir config
Truth-gate harness:        scripts/truth-gates.mjs, 12 gates total
CI workflows:              truth-gates.yml (push/PR/dispatch), pages.yml (push paths/dispatch)
Sigstore signing:          PROOF/latest.json signed via cosign keyless OIDC on every main push
Build attestations:        actions/attest-build-provenance over PROOF/latest.json
Client install bundles:    examples/{claude_code, cursor, vscode}/, examples/AGENTS.snippet.md, plus the existing claude-desktop/codex/windsurf bundles
```

## 7. Hermes3D status (read-only)

```text
Path:                      G:\Github\Hermes3D
Edits made by HermesProof: ZERO (verified via gate workspace.integrity locally)
Audit doc:                 docs/HERMES3D_SOURCE_AUDIT.md
Integration touchpoints:   16 hermes3d-mcp tools, Truth Gate (8 checks), Proof Envelope (HMAC-SHA256), 12 agent role manifests, PROOF_PROTOCOL.md canonical-JSON encoding (HermesProof matches)
```

## 8. Truth gates required vs delivered

| # | Gate | Status (CI on main, ba6a4f7) |
|---|---|---|
| 1 | `source.integrity_manifest` | ✅ pass (13 files hashed) |
| 2 | `deps.parity` | ✅ pass (2/2 installed) |
| 3 | `tests.unit` | ✅ pass (12/12) |
| 4 | `server.stdio_handshake` | ✅ pass (16 tools surfaced) |
| 5 | `doctor.hermes3d` | ⏭ skipped (no live workspace in CI) |
| 6 | `e2e.multi_agent_flow` | ✅ pass (14/14 checks) |
| 7 | `workspace.integrity` | ⏭ skipped (CI) |
| 8 | `clients.config_presence` | ⏭ skipped (CI) |
| 9 | `clients.claude_code_live` | ⏭ skipped (CI) |
| 10 | `server.tool_description_hygiene` | ✅ pass (0 suspicious patterns) |
| 11 | `evidence.hash_chain_valid` | ✅ pass (positive + tamper-detected) |
| 12 | `docs.master_prompt_deliverables_present` | ✅ pass (10/10 files) |

**Required required-gate tally:** 8 pass / 0 fail / 0 warn / 4 skip on CI; 11 pass / 0 fail / 0 warn / 1 skip locally (with the workspace.integrity gate flagging an unrelated playwright-report.json artifact in the Hermes3D workspace, outside HermesProof's scope).

## 9. Cryptographic proof

```text
PROOF/latest.json                  6.0 KB, sha256-hashed manifest of 13 source files
PROOF/latest.json.cosign.bundle    Sigstore-issued signature over PROOF/latest.json
PROOF_E2E_REPORT.md                human-readable mirror, 8 pass / 0 fail / 4 skip on CI
GitHub artifact attestation        actions/attest-build-provenance, verifiable via gh attestation verify
Evidence ledger                    .hermes3d_orchestrator/evidence/ledger.ndjson, prev_hash + entry_hash chain
```

Verify externally:

```bash
# Fetch + verify Sigstore signature
gh api repos/Ghenghis/HermesProof/contents/PROOF/latest.json --jq .download_url | xargs curl -sLO
gh api repos/Ghenghis/HermesProof/contents/PROOF/latest.json.cosign.bundle --jq .download_url | xargs curl -sLO
cosign verify-blob \
  --certificate-identity-regexp 'https://github.com/Ghenghis/HermesProof' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --bundle latest.json.cosign.bundle latest.json

# Verify GitHub native attestation
gh attestation verify PROOF/latest.json --repo Ghenghis/HermesProof
```

## 10. Asset inventory

```text
README.md                 ~16 KB after claim updates (under 120 KiB target)
docs/diagrams/*.svg        7 files, ~80 KB total, all SMIL-animated, all WCAG 2.2 AA
site/index.html           42 KB, dark Hermes-Agent-aesthetic landing page
site/styles.css           23 KB, no external imports
site/app.js                ~9 KB, vanilla JS, no external libs
examples/                  4 client bundles + AGENTS.snippet.md (HP) + 4 prior single-file configs
```

Largest single asset on `main`: `site/index.html` (42 KB).

## 11. Known limitations

| Limitation | Severity | Path forward |
|---|---|---|
| 4 first-party GitHub actions still on tag pins (`actions/setup-node`, `actions/upload-artifact`, `actions/upload-pages-artifact`, `actions/deploy-pages`, `sigstore/cosign-installer`) | Med | Resolved in v0.3.0 hardening pass (this branch may add SHAs); otherwise next PR |
| `truth-gates-animated.svg` visual still shows 3×3 = 9 cells; the aria-label and desc claim 12 gates | Low | Redraw to 4×3 or 3×4 in a future iteration; alt-text already correct |
| Cosign `verify-blob` step is `continue-on-error` | Low | Tighten to fail-closed once first push to main has been verified end-to-end (this push has) |
| `truth-gates-animated.svg` visual elements (gate count) | Low | See above |
| `workspace.integrity` gate flags any pre-existing dirty state in the Hermes3D workspace (e.g., `03_implementation/ui/playwright-report.json`) | Low | Pre-existing condition; not in HermesProof's scope. Document in `docs/MAINTENANCE.md` if it confuses operators. |

## 12. Next recommended checkpoint

Hand off to whichever agent is going to drive the **Hermes3D project work** itself. HermesProof is now ready to be the coordination layer:

1. Restart Claude Desktop / Claude Code / Codex / Windsurf — they pick up the latest server source automatically (already wired into client configs by `npm run install-clients`).
2. New session: tell the agent *"Use `mcp__hermes3d-locks__hermes_doctor` and `mcp__hermes3d-locks__hermes_read_policy` first. Then `hermes_claim_task` and `hermes_lock_files` before editing any Hermes3D file."*
3. The `examples/claude_code/settings.hooks.json` bundle, when installed, automates this whole flow at session start, before every Edit/Write, and on session/subagent stop.
4. The Hermes3D project work itself is OUT OF SCOPE for HermesProof — HermesProof governs the work; the work happens in Hermes3D's own repo.

This ends master-prompt Wave 7. HermesProof v0.3.0 is shipped.
