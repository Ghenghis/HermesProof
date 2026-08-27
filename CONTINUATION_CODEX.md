# Codex Continuation — HermesProof + Hermes3D Session State

> Historical pre-reboot snapshot. Do not use this as current Kilo/HermesProof handoff state; read `docs/STALENESS_AUDIT_2026-07-05.md` and the Kilo `TRUE_MAP.md` instead.

**Date:** 2026-05-03 (pre-reboot snapshot)
**User:** fnice1971@gmail.com

## Status as of last sync

- Hermes3D PR #51 — **DONE** (Codex completed, audited, merged, locks released)
- HermesProof PR #25 audit — was in progress; **HALTED** by user when Claude began editing the same files
- All Codex sub-agents shut down by user
- Hermes locks released (verified `hermes_doctor` ok, 0 active locks)
- Codex posted "CODEX NO-HOLD" comments on HermesProof PR #29 and PR #31
- HermesProof PR #49 (Hermes3D Pages workflow) failing: `actions/configure-pages` "Resource not accessible by integration" — Pages permission issue (workflow needs `pages: write` permission)

## Standing rules (from user, do not violate)

1. **No overlap with Claude.** If Claude is editing a file/PR, Codex stays out until handoff confirms release.
2. **Free/OSS only** — no paid services. Sigstore + GitHub Attestations + GitHub Packages, never Azure Artifact Signing.
3. **API keys live at `G:/private/.env`** only — never in repo workspaces, never echoed, never committed.
4. **Weakness-correction is strict** — every audit finding must be fixed in a PR, not noted-and-skipped. No AI slop.
5. **Auto-merge all green PRs ASAP** — user authorized standing merge.

## Remaining HermesProof PRs (all DIRTY = merge conflict with base, NOT Codex-locked)

Worktree paths Claude has been using (do NOT touch while Claude is active in them):

| PR | Worktree | Branch | Status |
|----|----------|--------|--------|
| #25 | `G:/Github/merge-pr25` | `feat/gate-workflow-pinning` | Claude SHA-pinned 2 actions (commit `a61d575`); awaiting CI |
| #29 | `G:/Github/merge-pr29` | `feat/gate-accessibility-wcag-aa` | Forward-merged post-PR#20 (`a7cb830`); mechanical-review still failing |
| #30 | `G:/Github/merge-pr30` | `feat/gate-batch-perf-quality` | Forward-merged post-PR#20 (`30fc97c`); mechanical-review still failing |
| #32 | `G:/Github/hp-registry` | `feat/gate-provider-registry` | Forward-merged post-PR#20 (`fa18cf7`); awaiting CI |
| #38 | `G:/Github/hermes3d-mcp-lock-orchestrator` | `feat/hp-v0.7-anonymous-orchestration-full` | **UNRESOLVED merge** in Claude's working tree (server.mjs + package.json) |

## Audit findings still requiring code fixes (Codex-actionable AFTER Claude handoff)

If Claude assigns these to Codex via `hermes_claim_task`:

### PR #20 (already merged → needs follow-up PR against main)
- `_resolvedProviders()` reads wrong map (`_providers` instead of `_mergedProviders`)
- Session hash leaks in error/log paths — must be redacted
- `hermes_user_grant_session` is public — must be scoped/internal

### PR #29 — accessibility-wcag-aa
- Gate is named `accessibility.wcag_aa_pass` but only runs axe-core in JSDOM (no CSS load, no JS execution, color-contrast incompletes silently downgraded to warnings)
- **Fix option A (cheap):** rename gate to `accessibility.axe_jsdom_smoke` and update description
- **Fix option B (proper):** add Playwright/Chromium-backed scan that loads CSS, executes app.js, asserts color-contrast
- The real-site test silently no-ops if `site/index.html` missing — should hard-fail or skip explicitly

### PR #30 — perf/docs/checksum/coderabbit gates
- `perf-budget` gate accepts a stale cached report → false-pass; must verify cache freshness or recompute
- `release-checksum` gate writes hashes but doesn't verify them against the artifact bytes
- mechanical-review failing — PR body missing checklist fields

### PR #32 — provider-registry pack
- `secret.scan` gate fail-open: gitleaks exit 1 logs but doesn't fail the gate
- YAML parser has a bug (Codex audit identified location TBD — Codex re-audit needed)
- `local.models.catalog.validate` can false-pass — needs schema check + non-empty assertion

### PR #33 (already merged → needs follow-up PR)
- `stdout/stderr` piped with `end: true` closes the wrapper's own stdio when child exits — must use `end: false`
- SIGTERM handlers accumulate across reconnects — must be removed before re-attaching
- Circuit breaker calls `process.exit()` — should propagate as MCP error instead

### PR #38 — v0.7 anonymous-orchestration-full
- mechanical-review failing — PR body missing "Hermes evidence chain: PASS" + 1 other field
- Need to read `.github/workflows/hermesproof-review-check.yml` to enumerate ALL required PR-body fields before re-edit

### PR #49 (Hermes3D, separate fix)
- Pages workflow failing: `actions/configure-pages` returns "Resource not accessible by integration"
- **Fix:** add `permissions: pages: write` and `id-token: write` to the workflow job (or workflow level)

## Codex's queue when ready to resume

1. Wait for explicit handoff from Claude (or user direct assignment via `hermes_claim_task`)
2. Re-acquire locks via `hermes_doctor` → `hermes_read_policy` → `hermes_claim_task` → `hermes_lock_files`
3. Pick from audit-fix list above (whichever lane Claude isn't working)
4. Heartbeat every 20 min on long fixes
5. Always `hermes_release_files` → `hermes_release_task` on completion
6. Push truth-gate proof + open follow-up PR against `main`

## Cascade merge protocol (informational, in case Codex assists)

Every merge to main triggers conflicts in:
- `package.json` test-array
- `scripts/truth-gates.mjs` imports + test array
- Sometimes `policies/provider-registry/*.csv`

**Resolution = UNION** (keep all branch-specific entries + add main's new entries).

For CSV conflicts in `hp-registry`, the HEAD schema (8 columns: device,arch,params,publisher,model_id,quant,size,modified) is canonical — use `git checkout --ours <csv>`.

## Hermes3D status

- All Hermes3D PRs reported merged in earlier session
- Hermes3D #51 merged this session
- v5.3.0 release pending after final review

## Final-day deliverable (user-requested)

User asked Claude for a comprehensive **Codex Master Prompt** containing:
- 3 different types of truth/proof audits for both codebases
- Depth/layered audits using all agents
- E2E multi-pass for bugs, memory leaks, improvements, enhancements
- Loop for enhancements/improvements/polishing/fine-tuning
- Docs/webpage/README updates
- Always merge green, fix everything, never skip

This master prompt is **not yet written** — it's pending after the PR-merge backlog clears.

## Key reference paths

- HermesProof main: `G:/Github/hermes3d-mcp-lock-orchestrator`
- Hermes3D main: `G:/Github/Hermes3D`
- Secrets: `G:/private/.env`
- Memory index: `C:/Users/Admin/.claude/projects/G--Github-hermes3d-mcp-lock-orchestrator/memory/MEMORY.md`
- Plan file: `C:/Users/Admin/.claude/plans/https-github-com-ghenghis-hermesproof-g-moonlit-pony.md`
