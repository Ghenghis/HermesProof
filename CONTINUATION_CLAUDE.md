# Claude Continuation — HermesProof Session State

> Historical pre-reboot snapshot. Do not use this as current Kilo/HermesProof handoff state; read `docs/STALENESS_AUDIT_2026-07-05.md` and the Kilo `TRUE_MAP.md` instead.

**Date:** 2026-05-03 (pre-reboot snapshot)
**User:** fnice1971@gmail.com
**Standing authorizations:** YOLO/overnight, merge all green ASAP, free/OSS only, fix all weaknesses (no AI slop), API keys at G:/private/.env

## Merged this session (HermesProof)

- ✅ **PR #33** — supervisor auto-reconnect (squashed into main)
- ✅ **PR #20** — anonymous role + Hermes Agent USER bridge (squashed into main)
- ✅ Hermes3D PR #51 (Codex completed)

## Active worktrees (state at reboot)

| PR | Worktree | Branch | Pushed Status |
|----|----------|--------|---------------|
| #25 | `G:/Github/merge-pr25` | `feat/gate-workflow-pinning` | ✅ pushed `a61d575` (SHA-pin fix applied + post-PR#20 forward merge) |
| #29 | `G:/Github/merge-pr29` | `feat/gate-accessibility-wcag-aa` | ✅ pushed `a7cb830` (post-PR#20 forward merge) |
| #30 | `G:/Github/merge-pr30` | `feat/gate-batch-perf-quality` | ✅ pushed `30fc97c` (post-PR#20 forward merge) |
| #32 | `G:/Github/hp-registry` | `feat/gate-provider-registry` | ✅ pushed `fa18cf7` (CSV schema fix + post-PR#20 forward merge) |
| #38 | `G:/Github/hermes3d-mcp-lock-orchestrator` (main worktree) | `feat/hp-v0.7-anonymous-orchestration-full` | ⚠️ **UNRESOLVED merge in working tree** — see below |

## CRITICAL: v0.7 main worktree unfinished merge

`G:/Github/hermes3d-mcp-lock-orchestrator` has an in-progress `git merge origin/main` after PR #20 squash. UU files:

- `package.json` — 2 conflict blocks (version 0.7.0 vs 0.6.0, test-array union)
- `src/server.mjs` — 4+ conflict blocks (imports, init, tool registrations)

**Resolution strategy** (must preserve ALL of HEAD's v0.7 features AND ALL of main's PR #20 anonymous-orchestrator features):

1. `package.json` line 3-7: keep `"version": "0.7.0"`
2. `package.json` test-array: union — `coordination-smoke-test + hardening-smoke-test + perf-v0.5.1-smoke-test + mcp-scan-static-gate.test + skill-rotation.test + reputation.test + a2a-stub.test + anonymous-orchestrator-smoke-test + mcp-supervisor-smoke-test + secret-rotation-smoke-test`
3. `src/server.mjs` lines 9-18: keep ALL imports (SkillRotation, ReputationTracker, CapabilityDispatch, A2AStub from HEAD + AnonymousOrchestrator, ANON_ROLES, HermesAgentBridge, loadRegistryProviders from main)
4. `src/server.mjs` lines 51-82: keep ALL initializations from both sides
5. `src/server.mjs` lines 574+: each conflict is a tool-registration block; keep BOTH tools (HEAD's v0.7 tools + main's anonymous tools), ensuring proper closing braces and `);` between each `registerTool(...)` call

After resolving, also check that `truth-gates.mjs` has no orphaned conflict markers (last session had this issue).

## Outstanding code fixes (audit findings — STRICT must-fix)

| PR | Issue | Action |
|----|-------|--------|
| #20 (merged) | `_resolvedProviders()` reads wrong map; session-hash leakage; `hermes_user_grant_session` is public | Fix in follow-up PR against main |
| #25 | ✅ FIXED: 2 unpinned workflow actions in `stream-watchdog-cron.yml` (commit `a61d575`) | Verify CI green, then merge |
| #29 | Codex audit: gate is named WCAG-AA but doesn't scan CSS/JS/rendered page | Either rename gate honestly to `accessibility.axe_jsdom_smoke` OR add browser-backed scan |
| #30 | `perf-budget` gate can false-pass on stale cache; `release-checksum` doesn't verify hashes | Fix both gate logic issues |
| #30 | mechanical-review FAILURE | Update PR body with required checklist fields |
| #32 (pushed, awaiting CI) | secret.scan fail-open (gitleaks exit 1 should fail gate); YAML parser bug; local model catalog false-pass | Fix all three |
| #33 (merged) | `stdout/stderr` piped with `end:true` closes wrapper's stdio; SIGTERM handlers accumulate; circuit breaker exits process | Fix in follow-up PR |
| #38 | mechanical-review FAILURE — body missing "Hermes evidence chain: PASS" + 1 other check | Update PR body |

## Mechanical-review checklist requirements (in PR body)

The check at `.github/workflows/hermesproof-review-check.yml` requires:

1. `Hermes evidence chain: PASS` (exact regex match)
2. Task ID matching `(?:task[_ -]?id|task):\s*\`?[A-Z0-9.-]+\`?` (e.g., `Task: HP-V0.6-X`)
3. `hermes_run_gate` keyword
4-6. **Unknown — read the workflow file to enumerate all `add(...)` checks** before fixing #38/#30/#29

## Cascade merge pattern (DO NOT FORGET)

Every squash-merge to main causes ALL remaining feature branches to conflict at:
- `package.json` test-array (and sometimes scripts section)
- `scripts/truth-gates.mjs` imports + test array
- Sometimes other shared files

**Protocol after each merge:**
```bash
cd /g/Github/<worktree>
git fetch origin main
git merge origin/main --no-edit
# Edit conflicts: keep HEAD branch-specific + ADD main's new entries (UNION)
git add <resolved-files>
git commit -m "merge: forward merge post-PR#NN (<reason>)"
git push origin <branch>
```

**For hp-registry CSV conflicts:** PR #32's HEAD has the canonical 8-column schema. Use `git checkout --ours policies/provider-registry/lmstudio_local_models.csv`.

## Pending tasks (in order)

1. **Resolve v0.7 main worktree merge** (above) — commit + push to `feat/hp-v0.7-anonymous-orchestration-full`
2. **Fix mechanical-review for #29, #30, #38** (read workflow to enumerate all checks first)
3. **Fix audit-found code bugs in #29, #30, #32** (per "weakness-correction is strict")
4. **Wait for CI green on #25, #29, #30, #32 → merge each** (cascade-forward after each merge)
5. **Wait for CI green on #38 → merge** (final HermesProof PR)
6. **Cut v0.6.0 HermesProof release** (or v0.7.0 if v0.7 ships with #38)
7. **Cut v5.3.0 Hermes3D release**
8. **Create comprehensive Codex master prompt** (user requested):
   - 3 different types of truth/proof audits for both codebases
   - Depth/layered audits using all agents
   - E2E multi-pass: bugs, memory leaks, improvements
   - Loop for enhancements/improvements/polishing/fine-tuning
   - Docs/webpage/README updates
   - Always merge green; fix everything, never skip

## Hermes lock state (verified by Codex)

- `hermes_doctor`: ok=true
- `hermes_get_state`: active locks = 0
- All locks released; safe to resume from any worktree

## Codex coordination

- Codex sub-agents shut down by user; main Codex idle
- Codex posted "CODEX NO-HOLD" comments on PR #29 and #31
- Codex confirmed: remaining HermesProof PRs blocked only by `mergeStateStatus=DIRTY` (merge conflicts with base), no Codex locks
- PR #49 (Hermes3D Pages workflow) failed: `actions/configure-pages` "Resource not accessible by integration" — Pages permission issue, separate fix needed

## Key files to re-read on resume

- `G:/Github/hermes3d-mcp-lock-orchestrator/.github/workflows/hermesproof-review-check.yml` (enumerate all mechanical-review checks)
- `G:/Github/hermes3d-mcp-lock-orchestrator/src/server.mjs` (resolve 4+ conflicts)
- `G:/Github/hermes3d-mcp-lock-orchestrator/package.json` (resolve 2 conflicts)
- `C:/Users/Admin/.claude/projects/G--Github-hermes3d-mcp-lock-orchestrator/memory/MEMORY.md` (auto-memory index)
