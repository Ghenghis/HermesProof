# HermesProof — Repository Manifest

> Canonical locations for every HermesProof-related repository, working
> copy, frozen release, and research artifact. Read this before opening
> a PR, before claiming work, and before merging.

## Canonical main repo

| Role | Path | Remote |
| --- | --- | --- |
| **Main repo (local)** | `G:\Github\HermesProof` | `https://gitlab.com/Ghenghis/HermesProof.git` |
| Public mirror | this repo on GitLab | `https://gitlab.com/Ghenghis/HermesProof.git` |
| Public mirror | this repo on GitHub | `https://github.com/Ghenghis/HermesProof.git` |
| Dave AI fork (GitLab Ultimate) | remote | `https://gitlab.com/daveai1/HermesProof.git` |

All editing work happens in the local main repo. Push from there.

## In-tree submodules

| Path | URL | Pinned commit | Purpose |
| --- | --- | --- | --- |
| `external/gitlab-daveai1/` | `https://gitlab.com/daveai1/HermesProof.git` | `985478e` (main HEAD) | Dave AI fork, GitLab Ultimate controls |
| `external/github-ghenghis/` | `https://github.com/Ghenghis/HermesProof.git` | `8b5ea93` (v0.9.0-1) | Public GitHub mirror, primary release source |

Update with:

```bash
git submodule update --remote external/gitlab-daveai1
git submodule update --remote external/github-ghenghis
```

## Working copies (not submodules — separate dev branches)

These are parallel development worktrees that share ancestry with the
main repo but carry in-flight uncommitted work. They are **not**
submodules and should not be added as such; they exist as independent
working environments for codex / claude branches.

| Path | Branch | HEAD | Status |
| --- | --- | --- | --- |
| `G:\Github\hermes3d-mcp-lock-orchestrator` | `codex/hermesproof-workspace-realtime-unlocks` | `fae63a4` | 27 modified files uncommitted; 35+ new files cherry-picked into main on 2026-08-26 |
| `G:\Github\hermesproof-helper-runtime-repair` | same `fae63a4` (shared history) | `fae63a4` | 3 modified files uncommitted; helper-runtime specific work |
| `G:\Github\HermesProof2` | n/a (workspace root) | n/a | Holds `HermesProof/`, `Testing-Claude-Minimax-Mcp/`, `claude-codex-devin/`, `tests-testing-repo/` sub-repos |

**Working copies are NOT yet committed.** Their uncommitted WIP is at risk
of being lost on machine reformat. Commit or push before long pauses.

### What was cherry-picked into main on 2026-08-26

From `G:\Github\hermes3d-mcp-lock-orchestrator` (uncommitted at the time):

- **New `src/core/` modules** (HP-MHA + helper runtime + workspace hygiene):
  `archive-plan.mjs`, `archive-plan.test.mjs`, `evidence-checkpoints.test.mjs`,
  `helper-runtime.mjs`, `helper-runtime.test.mjs`, `hp-mha.mjs`, `hp-mha.test.mjs`,
  `staleness.mjs`, `staleness.test.mjs`, `storage-census.mjs`,
  `storage-census.test.mjs`, `workspace-hygiene.mjs`, `workspace-hygiene.test.mjs`.
- **New docs**: `HP_MHA_V4_RELEASE_NOTES.md`, `HYBRID_HELPER_RUNTIME.md`,
  `KILOCODE_OPENHANDS_INTEGRATION.md`, `STALENESS_AUDIT_2026-07-05.md`,
  `helper-runtime-activation-2026-07-10.md`, `audits/2026-08-06-hp-mha-phase3.codex.md`.
- **New scripts**: `anti-slop-realness-gate.test.mjs`,
  `hybrid-helper-stdio.test.mjs`, `wire-supervisor.mjs`.
- **New examples**: `examples/hp-mha/` (full harness-card + task-set example)
  and `examples/kilocode/openhands-hermesproof/README.md`.
- **New CI helpers**: `ci/blocker-report.mjs`, `ci/release-truth.mjs`.
- **Continuation prompts**: `CONTINUATION_CLAUDE.md`, `CONTINUATION_CODEX.md`.
- **Proof checkpoint ledger**: `PROOF/evidence-ledger-checkpoints.json`.

### What was NOT cherry-picked

- **Modified tracked files in the orchestrator** (27 files, 2962 insertions,
  313 deletions uncommitted). These touch the orchestrator's diverged
  history and need real review before merging into main. Notable:
  `src/server.mjs` (+666), `src/core/lock-manager.mjs` (+22),
  `src/core/kilocode-integration.mjs` (+710 / -x), `package.json`, etc.
- **`.serena/`** — Serena MCP cache; not source.
- **`tools/Sakana-Fugu/`** — third-party content with image assets; not
  HermesProof code.

## Frozen release snapshot

| Path | Date | Status |
| --- | --- | --- |
| `S:\HermesProof-v0.9.0` | 2026-08-08 (mtime) | Frozen snapshot of the repo at v0.9.0 release. **NOT a git repo.** No `.git` directory. Reference only. |

If you need to rebuild v0.9.0, use the tagged commit
`v0.9.0` from `external/github-ghenghis` instead of the snapshot.

## Research artifacts

| Path | Type | Status |
| --- | --- | --- |
| `G:\Github\HermesProof-MCP-Research` | Docs + JSON | **NOT a git repo.** Research notes only. |
| `docs/research/mcp-research-2026-07-11/README.md` | In-tree copy | Snapshotted from `G:\Github\HermesProof-MCP-Research\HermesProof-MCP-Skills-Research.md` on 2026-08-26. |
| `docs/research/mcp-research-2026-07-11/mcp-registry.json` | In-tree copy | Snapshotted from the same source. |
| `G:\Github\HermesProof-MCP-Research\index.html` | Original artifact | Not copied; reference only. |
| `G:\Github\HermesProof-MCP-Research\HermesProof-MCP-Research-2026-07-11.zip` | Original archive | Not copied; reference only. |

## Workspace context

The main repo at `G:\Github\HermesProof` is checked out on `main`. The
working copies (`hermes3d-mcp-lock-orchestrator`, `hermesproof-helper-runtime-repair`)
are checked out on long-running codex branches and carry uncommitted WIP.
Treat them as **read-only integration references** unless you are the
owner of the active branch.

## Canonical documents

These docs are the source of truth for the cross-cutting concerns; every
agent session should read them on first contact with the project:

- [`docs/security/AGENT_SECRET_ARCHITECTURE.md`](security/AGENT_SECRET_ARCHITECTURE.md)
  — OIDC + credential broker + vault; the canonical secret-handling
  architecture.
- [`docs/security/OIDC_INTEGRATION.md`](security/OIDC_INTEGRATION.md) —
  how OIDC workload identity plugs into the HermesProof credential broker.
- [`docs/SECURITY_POLICY.md`](SECURITY_POLICY.md) — HermesProof's own
  narrow MCP threat model (locks, gates, evidence, signing).
- [`AGENTS.md`](../AGENTS.md) — root-level agent contract every session
  reads first.

## How to keep this manifest current

When you create a new working copy, frozen release, or research artifact
that references HermesProof:

1. Add it to this file with path, branch/HEAD, and status.
2. If it's a remote URL, decide whether it should be a submodule (under
   `external/`) or a documented reference (here).
3. Commit the manifest change in the same PR as the related work.