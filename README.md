# Hermes3D MCP Lock Orchestrator

[![Truth Gates](https://github.com/Ghenghis/HermesProof/actions/workflows/truth-gates.yml/badge.svg)](https://github.com/Ghenghis/HermesProof/actions/workflows/truth-gates.yml)

Local stdio MCP server that coordinates Claude, Codex, Windsurf/Cascade, and review agents on the **same code repository** by enforcing per-file locks, atomic transactions, and explicit handoffs.

Every push runs the `truth-gates` harness against a clean sandbox and refreshes `PROOF/latest.json` + `PROOF_E2E_REPORT.md` automatically. See [`PROOF_E2E_REPORT.md`](./PROOF_E2E_REPORT.md) for the latest attestation.

It is designed for the Hermes3D workflow but is **project-agnostic** — install it into any new or existing repository.

```text
Claude creates scope locks, docs, reviews, and correction packets.
Codex edits code and runs gates.
Claude review agents audit the result.
Windsurf can complete/setup/test the MCP and then use it as the IDE control layer.
No agent edits another agent's files unless it owns the lock or receives an approved handoff.
```

## What this server provides

### Coordination tools

- `hermes_claim_task`
- `hermes_release_task`
- `hermes_lock_files`
- `hermes_release_files`
- `hermes_list_locks`
- `hermes_heartbeat`
- `hermes_request_handoff`
- `hermes_approve_handoff`
- `hermes_recover_stale_locks`
- `hermes_append_evidence`
- `hermes_get_state`

### Diagnostic tools

- `hermes_read_policy` — read-only policy view (workspace, state dir, env-var resolution).
- `hermes_doctor` — non-destructive pre-flight: workspace exists, writable, env wired, git present, Node version.

### Gate tools

- `hermes_list_gates`
- `hermes_run_gate`

The gate runner is **allowlist-only**. Built-in gates: `git-status`, `git-branch`, `git-diff-check`, `git-diff-staged`, `git-log-recent`, `npm-test`, `npm-build`, `npm-lint`, `npm-typecheck`, `npm-audit`, `playwright`. It does not expose arbitrary shell execution.

## Install in the Hermes3D repo

Recommended repo layout:

```text
G:\Github\Hermes3D\
  tools\
    hermes3d-mcp-lock-orchestrator\
      README.md
      src\server.mjs
      ...
```

Steps:

```powershell
cd G:\Github\Hermes3D
mkdir tools -Force
# unzip this package into tools\hermes3d-mcp-lock-orchestrator
cd tools\hermes3d-mcp-lock-orchestrator
npm install
npm test
npm run init-project -- --workspace "G:\Github\Hermes3D"
```

`init-project` is idempotent. It creates the hidden state dir, appends `.gitignore` rules, runs `hermes_doctor`, and prints ready-to-paste MCP client configs.

## Install into any other project (new or existing)

The same package works for any repository. Pick a workspace path and tell the orchestrator about it through `MCP_LOCK_WORKSPACE`:

```powershell
# 1. Drop the package somewhere reusable
cd C:\path\to\YourProject
mkdir tools -Force
# unzip into tools\hermes3d-mcp-lock-orchestrator (the folder name is fine; the server is project-agnostic)
cd tools\hermes3d-mcp-lock-orchestrator
npm install
npm test

# 2. Point it at the project you actually want to govern
npm run init-project -- --workspace "C:\path\to\YourProject"

# 3. (optional) override the hidden state dir name and MCP server identifier
npm run init-project -- --workspace "C:\path\to\YourProject" --state-dir ".project_locks" --server-name "your-project-locks"
```

The default suite (`npm test`) covers two files and 12 named tests:

**`scripts/coordination-smoke-test.mjs`** — proves the multi-agent flow:
1. Claude locks contract docs.
2. Codex locks UI code files.
3. A reviewer tries to lock a Codex-owned file and is **blocked**.
4. The reviewer requests a handoff.
5. Codex approves the handoff.
6. Ownership transfers to the reviewer.
7. Codex cannot silently resume editing the transferred file without requesting it back.

**`scripts/hardening-smoke-test.mjs`** — proves the safety guarantees:

- Path-escape attempts (absolute paths, `..` traversal, locking the workspace root) are rejected with an explicit error.
- An owner can refresh its own lock without conflict.
- `releaseFiles` from a non-owner is blocked, not silently allowed.
- Heartbeat extends lock expiry.
- Stale lock recovery archives metadata and clears the lock.
- The gate runner rejects unknown gate IDs without spawning anything.
- `cwd` values that escape the workspace are rejected.
- `doctor()` reports actionable findings with suggested fixes.
- `getPolicy()` exposes env-var resolution and stable policy fields.
- Custom state dir names work end-to-end.
- `MCP_LOCK_STATE_DIR` values containing slashes or `..` are rejected.

## Runtime state

State is stored inside the workspace under a single hidden directory. Default name: `.hermes3d_orchestrator/`. Override with `MCP_LOCK_STATE_DIR` (must be a single directory name without slashes or `..`).

```text
.hermes3d_orchestrator/
  locks/                # one directory per locked file (atomic mkdir guards EEXIST)
  tasks/                # JSON per claimed task
  handoffs/             # JSON per handoff request/decision
  evidence/             # ledger.ndjson + per-event archives
  gates/                # gate run reports
  events.ndjson         # append-only event log
  config.json           # written once on first init()
```

`init-project` adds this dir and `tools/hermes3d-mcp-lock-orchestrator/node_modules/` to the workspace's `.gitignore`. You can intentionally commit an evidence bundle by overriding the gitignore for a specific run.

## Environment variables

| Variable               | Purpose                                                   | Default                  |
| ---------------------- | --------------------------------------------------------- | ------------------------ |
| `MCP_LOCK_WORKSPACE`   | Project root the orchestrator governs (preferred).        | _unset_                  |
| `HERMES3D_WORKSPACE`   | Legacy alias; honored when `MCP_LOCK_WORKSPACE` is unset. | _unset_                  |
| `MCP_LOCK_STATE_DIR`   | Override the hidden state dir name.                       | `.hermes3d_orchestrator` |
| `MCP_LOCK_SERVER_NAME` | Override the MCP server identifier in printed configs.    | `hermes3d-locks`         |

## Safety policy

1. Every agent must claim a task before editing.
2. Every file edit must be preceded by `hermes_lock_files`.
3. If `hermes_lock_files` returns `blocked`, the agent must stop and call `hermes_request_handoff`.
4. Only the current owner can approve or deny a handoff.
5. Approval transfers lock ownership; denial keeps the lock.
6. Every checkpoint appends evidence.
7. Gates are allowlisted only.
8. Stale recovery is manual and must append evidence.

## Quick config generator

For Hermes3D:

```powershell
$env:MCP_LOCK_WORKSPACE="G:\Github\Hermes3D"
node scripts/print-configs.mjs
```

For any other project:

```powershell
$env:MCP_LOCK_WORKSPACE="C:\path\to\YourProject"
$env:MCP_LOCK_SERVER_NAME="your-project-locks"
node scripts/print-configs.mjs
```

The script emits the OS-specific paths for the Claude Desktop, Windsurf, and Codex config files alongside paste-ready JSON/TOML blocks.

## Recommended owner names

Use stable owner names. Do not use vague names like `agent`.

```text
claude-lead
claude-reviewer-ux
claude-reviewer-tests
claude-reviewer-security
codex-impl-01
codex-fix-01
windsurf-cascade
```

## First real Hermes3D test task

Use the included UX-A task in `examples/HERMES3D_UX_A_COORDINATION_TEST.md`. It is intentionally small but complex enough to prove real multi-agent coordination around the current UI audit.
