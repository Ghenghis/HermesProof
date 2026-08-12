# Current release and source of truth

Last audited: 2026-08-12

## Authoritative lineage

- Product: HermesProof `0.9.2`
- Release branch: `release/hp-mha-serena-shippable`
- Stable tag: `v0.9.2`
- Authoritative OTA remote: `https://gitlab.com/Ghenghis/HermesProof.git`
- GitHub compatibility metadata: retained for older tooling, but not a v0.9.2 publication target
- Release facts: [`config/release-facts.json`](../config/release-facts.json)

The release branch is the only publication source and GitLab is the only v0.9.2 release/OTA authority. The inactive GitHub repository is not used to decide currency and is not updated by this run. A folder name, modification date, generated proof file, or uncommitted worktree is never evidence that a checkout is current.

## Local checkout audit

The 2026-08-12 ancestry and content audit found:

| Checkout | Finding | Release use |
|---|---|---|
| isolated `hermesproof-release` worktree | contains the reconciled history plus the four-agent-audited v0.9.2 stability patch | source of truth for `v0.9.2` |
| `G:\Github\HermesProof` | stable GitLab checkout | refresh from the verified v0.9.2 merge after publication |
| `G:\Github\HermesProof2\HermesProof` | duplicate of the same clean RC checkout | not a separate lineage |
| `G:\Github\HermesProof2` | parent directory, not a Git repository | never use as a source |
| `G:\Github\hermes3d-mcp-lock-orchestrator` | July commit; 55 commits behind with 640 dirty/untracked entries | preserve for audit only; never push directly |

The dirty July checkout contained 568 untracked files under vendored `tools/` projects and two stale continuation notes that are not HermesProof release inputs. Its applicable HermesProof files were either identical to, or superseded by, the stable release branch. Unrelated vendored repositories, secrets, caches, temporary worktrees, and generated junk remain excluded from the product release.

## August harness currency

The release branch contains every relevant harness and release commit found across the audited checkouts through August 10. No audited repository contains a later August 11 harness commit.

| Area | Included provenance |
|---|---|
| measured, fail-closed HP-MHA core, benchmark, cards, and smoke | `3a5e422` — 2026-08-09 |
| governed `hp-mha-serena` composite server and capability packs | `492126b` — 2026-08-09 |
| pinned, lock-aware Serena ecosystem integration and E2E | `d95afda`, hardened by `3d9be5c` — 2026-08-09/10 |
| managed updater, rollback, and quarantine lifecycle | `213c8ab` — 2026-08-09 |
| signed Windows archive and fail-closed installer/candidate probes | `54e9ebe`, `2f3b70a`, `d6ba4d7` — 2026-08-09/10 |
| shell-free Windows npm/npx OTA gate execution | `8759655` — 2026-08-12 |

These commits are ancestors of the stable release branch and their suites are part of `npm test`. Duplicate checkout timestamps do not supersede this commit ancestry.

## Safe continuation

Before changing or publishing HermesProof:

1. Fetch GitLab and check out `release/hp-mha-serena-shippable` in a clean, isolated worktree.
2. Verify that GitLab `main` is an ancestor of the release branch; reconcile with a normal merge commit, never a destructive reset.
3. Load [`config/release-facts.json`](../config/release-facts.json) instead of copying version, tool-count, Serena, or release URL values into scripts.
4. Run the local gates from [`GITLAB_RELEASE_RUNBOOK.md`](GITLAB_RELEASE_RUNBOOK.md). Do not spend GitLab shared-runner minutes.
5. Build with the external Ed25519 key, publish the complete asset set to GitLab, download it into an empty directory, and verify it independently before declaring the release current.
6. After publication, refresh `G:\Github\HermesProof` from the verified tag. Keep duplicate or dirty trees out of the release workflow until separately archived or reconciled.

If any invariant above fails, stop publication and treat the release as incomplete.
