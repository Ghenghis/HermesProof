# Codex Implementation Handoff

The exact, file-by-file contract Codex receives when Claude has finished a wave of design/audit. Codex never starts from a vague request; this document is the only instruction set it needs.

This file is a **template + standing record** — instances of it are copied into `handoffs/HANDOFF_TO_CODEX_<checkpoint>.md` per phase.

## 1. Mission

Implement the HermesProof artifact specified by Claude's design wave, exactly as laid out below. Use HermesProof's own MCP tools to coordinate. Never push to `main`. Always append evidence.

## 2. Repos and paths

- HermesProof local: `G:\Github\hermes3d-mcp-lock-orchestrator`
- HermesProof remote: https://github.com/Ghenghis/HermesProof
- Hermes3D reference-only: `G:\Github\Hermes3D` / https://github.com/Ghenghis/Hermes3D

## 3. Pre-flight (always)

```text
hermes_doctor
hermes_read_policy
hermes_claim_task   owner=codex-impl-01  taskId=<phase-tag>
hermes_lock_files   owner=codex-impl-01  files=[…see §5]
```

If any file is locked: `hermes_request_handoff` and wait for `hermes_approve_handoff`. **Never overwrite. Never create parallel files.**

## 4. Branch + commit hygiene

- Branch: `feat/<phase>` or `fix/<phase>`. NEVER push to `main`.
- Commits: Conventional `<type>(<scope>): <subject>` matching the repo's history (see `git log --oneline -20`).
- Every commit message body must contain: branch, hash, changed files, gates run, proof artifact path, known limitations.
- Heartbeat: `hermes_heartbeat` every 20 min for any work spanning > 10 min.

## 5. Codex agent roles (sub-agent split)

```
1. Codex Lead Implementer       (drives the file list, owns top-level branch)
2. SVG Asset Agent              (only edits docs/diagrams/*.svg)
3. README Assembly Agent        (only edits README.md)
4. Docs Update Agent            (only edits docs/*.md other than spec docs)
5. CI / Truth Gate Agent        (only edits .github/workflows/*.yml + scripts/truth-gates.mjs)
6. Link Validation Agent        (read-only; runs lychee, reports broken refs)
7. Security / Secrets Scan Agent (read-only; runs gitleaks/detect-secrets)
8. Evidence Reporter            (only writes handoffs/* and appends ledger)
```

Each role MUST claim files for its scope only. Other roles' scopes are off-limits.

## 6. Files Codex MAY edit (per phase)

The exact list lives in the phase-specific handoff file in `handoffs/`. The general allowlist is:

```
README.md
docs/ARCHITECTURE.md
docs/LOCK_PROTOCOL.md
docs/TOOL_REFERENCE.md
docs/SECURITY_POLICY.md
docs/INTEROP_WITH_OTHER_MCP.md
docs/MAINTENANCE.md
docs/SETUP_CLAUDE_CODE.md
docs/SETUP_CLAUDE_DESKTOP.md
docs/SETUP_CODEX.md
docs/SETUP_WINDSURF.md
docs/SETUP_GENERIC_PROJECT.md
docs/diagrams/*.svg
package.json
LICENSE
AGENTS.md
PROOF/latest.json
PROOF_E2E_REPORT.md
.github/workflows/truth-gates.yml
.github/workflows/pages.yml
src/server.mjs                          (Phase 1+ only)
src/core/lock-manager.mjs               (Phase 1+ only)
src/core/gate-runner.mjs                (Phase 1+ only)
src/core/fs-utils.mjs                   (Phase 1+ only)
scripts/truth-gates.mjs
scripts/install-clients.mjs             (Phase 2+ only)
examples/**                             (Phase 2+ only, additive)
site/**                                 (with pages workflow rebuild)
```

## 7. Files Codex MUST NOT edit

```
G:\Github\Hermes3D\**                   (entire Hermes3D repo)
docs/README_MASTER_SPEC.md              (Lead Architect lock)
docs/README_COVERAGE_MATRIX.md          (Truth Gates Architect lock)
docs/VISUAL_ASSET_SPEC.md               (Visual System Designer lock)
docs/SVG_ANIMATION_SPEC.md              (SVG Motion Designer lock)
docs/HERMES3D_SOURCE_AUDIT.md           (Hermes3D Cartographer lock)
docs/HERMESPROOF_SETUP_AUDIT.md         (HermesProof Cartographer lock)
docs/CODEX_IMPLEMENTATION_HANDOFF.md    (Lead Architect lock)
docs/CLAUDE_REVIEW_TEAM_PROMPT.md       (Lead Architect lock)
docs/ACCEPTANCE_GATES.md                (Truth Gates Architect + Lead Architect lock)
.hermes3d_orchestrator/**               (state — don't hand-edit)
PROOF/sbom.cdx.json                     (Phase 2 — auto-generated)
.env / .env.* / **/secrets.* / **/credentials.*
```

## 8. Required visual style (when touching SVGs)

See [VISUAL_ASSET_SPEC.md](VISUAL_ASSET_SPEC.md) for tokens and [SVG_ANIMATION_SPEC.md](SVG_ANIMATION_SPEC.md) for motion rules. Hard rules:

- SMIL only (no CSS animation, no JS)
- Self-contained (no external `href`, no `<script>`, no remote fonts)
- `role="img"` + `<title>` + `<desc>` + `aria-labelledby` mandatory
- `prefers-reduced-motion: reduce` stanza in `<defs>` mandatory
- Each diagram ≤ 100 KiB

## 9. Required README structure

Per [README_MASTER_SPEC.md](README_MASTER_SPEC.md) §2: 12 required sections in order, max 5 hero badges, max 120 KiB total. Don't add new sections without a Lead Architect handoff.

## 10. Required tests / gates per commit

```powershell
npm install
npm test                         # unit + smoke (12 tests)
npm run smoke                    # 14-step e2e
npm run smoke:hardening          # stale-lock + TTL
npm run truth-gates              # 10 gates after Phase 0; 11 after Phase 1
git status --short               # tree clean except intended files
git diff --check                 # no whitespace errors
```

All required gates must pass. CI must remain green: `gh run watch -R Ghenghis/HermesProof --exit-status`.

## 11. Proof format

After every commit Codex pushes:

1. `PROOF/latest.json` is regenerated by `npm run truth-gates`.
2. `PROOF_E2E_REPORT.md` is regenerated by the same script.
3. The CI workflow auto-commits a refreshed proof on `main` push (with `[skip ci]`).
4. Phase 2: cosign-signed bundle alongside `PROOF/latest.json`; `gh attestation verify` available.

## 12. Failure protocol

If Codex cannot complete a step:

1. **Do not delete or revert** existing artifacts.
2. Run `hermes_release_files` on every file you locked but did not modify.
3. Create `handoffs/HANDOFF_TO_CLAUDE_<checkpoint>_BLOCKED.md` with: branch, locks at end, files changed (partial), tests/gates run + results, exact error output (last 50 lines, no truncation), suggested fix, risk notes.
4. Append `kind: handoff` evidence record naming the handoff file.
5. Do NOT push partial/broken work without the handoff file accompanying it.

## 13. Done criteria (per phase)

A phase is "done" when the Evidence Reporter can write a final response of the shape in [CLAUDE_REVIEW_TEAM_PROMPT.md](CLAUDE_REVIEW_TEAM_PROMPT.md) §4 with `PASS` and a green CI link.

## 14. Phase-specific handoffs

The actionable per-phase handoffs live in `handoffs/`:

- [handoffs/HANDOFF_TO_CODEX_README_VISUALS.md](../handoffs/HANDOFF_TO_CODEX_README_VISUALS.md) — README + 7 SVGs + Pages site (delivered c330814; preserved for reproducibility).

Future phases create new files in the same directory following the pattern `HANDOFF_TO_CODEX_<phase-tag>.md`.
