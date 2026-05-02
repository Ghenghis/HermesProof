# README Master Specification

The contract `README.md` MUST satisfy. The visual rebrand in commit `c330814` was implemented before this spec; this document reverse-engineers the requirements that the shipped artifact already meets, and locks them in for future edits.

## 1. Constraints (hard limits)

| Constraint | Limit | Verifier |
|---|---|---|
| Total size | ≤ 120 KiB target, ≤ 500 KiB ceiling | `wc -c README.md` (current ~14 KB) |
| JavaScript | Forbidden | `! grep '<script' README.md` |
| Audio / video | Forbidden | `! grep -Ei '<audio|<video' README.md` |
| Remote CSS / JS | Forbidden | `! grep -E '(href|src)="https?://[^"]*\.(css|js)' README.md` |
| External font imports | Forbidden | `! grep '@font-face\|fonts.googleapis' README.md` |
| Each embedded SVG | ≤ 100 KiB (target), self-contained | per [VISUAL_ASSET_SPEC.md](VISUAL_ASSET_SPEC.md) |
| Inline raster `<img>` | ≤ 1 MiB per image | manual audit |
| Markdown features | GFM only (no GitHub Pages-only Liquid) | rendered preview on github.com |

## 2. Required sections (in order)

1. **Hero** — `<div align="center">` block with `docs/diagrams/hero.svg`, badges (max 5), one-line value proposition, anchor TOC, live-site CTA. Must be < 50 lines of markdown.
2. **End-to-end pipeline** — `docs/diagrams/pipeline-flow.svg` + ASCII summary of the 6 stages. ≤ 30 lines of body.
3. **Truth gates** — `docs/diagrams/truth-gates-animated.svg` + table of all gates with one-line "what it proves" each. After Phase 0: 10 gates listed.
4. **Architecture** — `docs/diagrams/architecture.svg` + the 15-tool block + state-dir tree. ≤ 35 lines.
5. **Multi-agent coordination** — `docs/diagrams/multi-agent-flow.svg` + `docs/diagrams/lock-lifecycle.svg` + 4 lifecycle states described in 6 lines.
6. **Composes with other MCP servers** — `docs/diagrams/mcp-composition.svg` + 4-row composition table.
7. **Quickstart** — 5-step PowerShell block (clone → install → truth-gates → init-project → install-clients).
8. **MCP client configuration** — 4 collapsible `<details>` blocks (Claude Desktop, Claude Code, Codex, Windsurf).
9. **Environment** — single env-vars table (4 rows).
10. **Documentation** — bullet list linking every doc in `docs/`, plus AGENTS.md and PROOF_E2E_REPORT.md.
11. **Inspiration & credits** — 2-3 sentences crediting Hermes Agent (Nous Research) and naming Hermes3D as the original target. Explicit non-affiliation.
12. **Footer** — `hermes3d-locks` (deployed server name) vs `HermesProof` (project name) note.

## 3. Required visual coverage

Every section in §2 except the hero, environment table, and footer MUST have at least one inline SVG (or in §10's case, link to docs that contain SVGs). Total: minimum 7 SVG embeds. (Currently shipped: 7. ✓)

## 4. Forbidden content

- Claims that HermesProof prints, slices, or controls printers (it does not — see Hermes3D for that)
- Claims of "AI-driven 3D printing" capability (those belong to Hermes3D)
- Claims of cryptographic signing of PROOF artifacts before Phase 2 lands
- Claims of MCP spec version `2025-11-25` before SDK is bumped (currently `2024-11-05`; updated in Phase 1)
- Phrases that imply Anthropic, OpenAI, or Nous Research endorsement / affiliation

## 5. Required claims (must be visible in §1-§5)

- "verifiable" / "verified" / "attest" — at least once each in the first 30 lines
- Names of all four supported clients: Claude Desktop, Claude Code, Codex, Windsurf
- The phrase "atomic mkdir" or "EEXIST" once (it is the lock primitive)
- The exact tool count: **15 tools** (will become 16 after Phase 1's `hermes_verify_evidence`; update README accordingly)
- The exact gate count: **9 gates** (becomes **10** after Phase 0, **11** after Phase 1's `mcp-scan`; update README accordingly)
- Reference to "evidence ledger" or "append-only" once

## 6. Anchor IDs (deep links the docs depend on)

The TOC at the top of the README links to these anchors. They MUST exist:

- `#-end-to-end-pipeline` (note the leading `-` from the `✦ ` prefix)
- `#-truth-gates`
- `#-architecture`
- `#-multi-agent-coordination`
- `#-composes-with-other-mcp-servers`
- `#-quickstart`
- `#-mcp-client-configuration`
- `#-environment`
- `#-documentation`

If section icons are removed (a Phase-3 a11y consideration), the anchors will change shape — TOC must update in the same commit.

## 7. Update protocol

Every change to README.md MUST:

1. Hold a HermesProof lock on `README.md` for the duration of the edit.
2. Run `npm run truth-gates` locally afterward; gate `docs.master_prompt_deliverables_present` (10) verifies the spec docs still exist.
3. Re-run the GitHub Pages workflow after merge (auto-triggers on `site/**` and `docs/diagrams/**` only — for README-only changes, GitHub Pages does not redeploy, which is correct).
4. Update [README_COVERAGE_MATRIX.md](README_COVERAGE_MATRIX.md) if any required claim or anchor changes.

## 8. Versioning

This spec is `v1.0` (matches `c330814` shipped state). Breaking changes (new required section, removed required claim) bump to `v2.0` and require a coordinated update of README + this doc + coverage matrix in the same PR.
