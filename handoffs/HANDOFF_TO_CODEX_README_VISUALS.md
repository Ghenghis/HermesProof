# HANDOFF_TO_CODEX_README_VISUALS

> **Status: SHIPPED.** The artifact described in this contract was delivered in commit [`c330814`](https://github.com/Ghenghis/HermesProof/commit/c330814) ("feat(brand): HermesProof rebrand with visual-first README and animated SVG diagrams"), with auto-refreshed proof in [`fcaf73f`](https://github.com/Ghenghis/HermesProof/commit/fcaf73f). This file is preserved as the historical contract so Codex behavior is reproducible if the rebrand needs to be re-derived.

## 1. Mission

Implement the HermesProof visual-first GitHub README and integrated docs/SVG system exactly as designed by Claude.

## 2. Repos and paths

```
HermesProof local:   G:\Github\hermes3d-mcp-lock-orchestrator
HermesProof remote:  https://github.com/Ghenghis/HermesProof
Hermes3D ref-only:   G:\Github\Hermes3D
                     https://github.com/Ghenghis/Hermes3D
```

## 3. Required locking

Before editing, call:

```text
hermes_doctor
hermes_read_policy
hermes_claim_task   owner=codex-visual-impl   taskId=HP-README-VISUALS
hermes_lock_files   files=[…see §6]
```

If any file is locked: `hermes_request_handoff` and wait. **Do not overwrite. Do not branch around the lock.**

## 4. Branch

```text
feat/hermesproof-visual-readme
```

## 5. SVG dimensions and style (delivered)

Per [docs/VISUAL_ASSET_SPEC.md](../docs/VISUAL_ASSET_SPEC.md) and [docs/SVG_ANIMATION_SPEC.md](../docs/SVG_ANIMATION_SPEC.md):

| File | viewBox | Delivered size | SMIL count |
|---|---|---|---|
| `docs/diagrams/hero.svg` | `0 0 1200 360` | 6,157 B | 13 |
| `docs/diagrams/pipeline-flow.svg` | `0 0 1200 520` | 13,338 B | 18 |
| `docs/diagrams/truth-gates-animated.svg` | `0 0 1200 540` | 13,372 B | 18 |
| `docs/diagrams/architecture.svg` | `0 0 1200 580` | 8,507 B | 7 |
| `docs/diagrams/lock-lifecycle.svg` | `0 0 1100 540` | 7,623 B | 5 |
| `docs/diagrams/multi-agent-flow.svg` | `0 0 1200 620` | 10,356 B | 3 |
| `docs/diagrams/mcp-composition.svg` | `0 0 1200 540` | 6,859 B | 6 |

Color tokens (from [VISUAL_ASSET_SPEC.md](../docs/VISUAL_ASSET_SPEC.md) §1):
deep-navy `#07091c`, mid `#0a0e27`, elevated `#101638`, cyan `#06b6d4`, violet `#a855f7`, magenta `#ec4899`, proof-green `#22c55e`, amber `#f59e0b`, red `#ef4444`.

> **Phase 1 follow-up:** the delivered SVGs lack `<desc>`, `aria-labelledby`, and the `prefers-reduced-motion` stanza in `<defs>`. The Phase 1 wave will add those — preserved as known limitations of c330814 for the audit trail.

## 6. Files locked / edited (delivered set)

```
README.md
docs/ARCHITECTURE.md
docs/INTEROP_WITH_OTHER_MCP.md
docs/LOCK_PROTOCOL.md
docs/MAINTENANCE.md
docs/SECURITY_POLICY.md
docs/SETUP_CLAUDE_CODE.md
docs/SETUP_CLAUDE_DESKTOP.md
docs/SETUP_CODEX.md
docs/SETUP_GENERIC_PROJECT.md
docs/SETUP_WINDSURF.md
docs/TOOL_REFERENCE.md
docs/diagrams/architecture.svg              (new)
docs/diagrams/hero.svg                      (new)
docs/diagrams/lock-lifecycle.svg            (new)
docs/diagrams/mcp-composition.svg           (new)
docs/diagrams/multi-agent-flow.svg          (new)
docs/diagrams/pipeline-flow.svg             (new)
docs/diagrams/truth-gates-animated.svg      (new)
package.json                                (rename: hermesproof@0.2.0)
LICENSE                                     (MIT 2026 Ghenghis)
AGENTS.md                                   (rebrand)
PROOF/latest.json                           (auto-refreshed)
PROOF_E2E_REPORT.md                         (auto-refreshed)
```

## 7. Files NOT edited (correct behavior)

```
G:\Github\Hermes3D\**
src/server.mjs                              (preserved; Phase 1+ scope)
src/core/*.mjs                              (preserved; Phase 1+ scope)
.github/workflows/truth-gates.yml           (preserved)
node_modules/**
.env, **/secrets.*, **/credentials.*
```

## 8. Deliverables (delivered)

1. ✅ Visual README — 14 KB, 7 embedded SVGs, GitHub-safe (no JS / audio / remote)
2. ✅ Animated SVGs — 7 files, total ~66 KiB, all SMIL-driven, no scripts
3. ✅ Updated docs — 11 markdown files in `docs/`
4. ✅ Proof artifacts — `PROOF/latest.json` + `PROOF_E2E_REPORT.md` regenerated
5. ✅ CI passing — `truth-gates.yml` green on `main`
6. (Deferred → Phase 0) FINAL_EVIDENCE_REPORT.md and the 9 spec docs above

## 9. Acceptance gates (delivered)

```powershell
npm install
npm test                  # all 12 unit tests pass
npm run truth-gates       # 9/9 gates pass
npm run truth-gates -- --ci   # 5/5 CI-applicable gates pass
git status --short        # tree clean
git diff --check          # no whitespace errors
```

## 10. GitHub proof (delivered)

```powershell
gh run list -R Ghenghis/HermesProof --limit 3
gh run watch <run-id> -R Ghenghis/HermesProof --exit-status
```

CI on `c330814`: green. CI on `fcaf73f` (auto-refreshed proof): green.

## 11. Known limitations (carried forward to Phase 1)

| Limitation | Severity | Closed by |
|---|---|---|
| 7 SVGs lack `<desc>`, `aria-labelledby`, reduced-motion | Med (a11y) | Phase 1 SVG a11y pass |
| README badge claims `MCP-2024-11-05` | Low (signal) | Phase 1 SDK bump |
| MCP SDK is `^1.19` (5 minors stale) | Med | Phase 1 SDK bump |
| `PROOF/latest.json` not cryptographically signed | Med | Phase 2 cosign sign-blob |
| GitHub Actions pinned to `@v4` tags, not SHAs | Med | Phase 1 workflow hardening |
| 9 spec / handoff docs absent | High | **Phase 0** (this branch closes it) |

## 12. Failure protocol (none used)

The implementation completed without blocks; no `HANDOFF_TO_CLAUDE_*_BLOCKED.md` was created. CI passed on first push.

## 13. Reproducibility

To re-derive this artifact from a clean clone:

```powershell
git clone https://github.com/Ghenghis/HermesProof.git
cd HermesProof
git checkout c330814^
# Apply the design specs in docs/{VISUAL_ASSET_SPEC,SVG_ANIMATION_SPEC,README_MASTER_SPEC}.md
# Author 7 SVGs in docs/diagrams/ per spec
# Author README.md per spec, embedding the 7 SVGs
# Update docs/* with rebranding (see git log -p c330814 for exact wording)
# npm run truth-gates    # must show 9/9 pass
# git commit + push
```

The result should match `c330814` modulo timestamps in `PROOF/latest.json`.
