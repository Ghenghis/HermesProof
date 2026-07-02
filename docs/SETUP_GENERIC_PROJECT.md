# HermesProof Setup — Any Project (new or existing)

The MCP Lock Orchestrator is project-agnostic. Use the same package to coordinate agents on **any** repository — Hermes3D was just the first project that needed it.

## Required

- Node.js 20 LTS or newer.
- A workspace directory you control (the project root).
- One or more MCP-capable agents (Claude Desktop, Claude Code, Codex CLI/IDE, Windsurf Cascade).

## One-time installation

```powershell
# Pick where to keep the orchestrator package. Two options:

# Option A: vendored inside the project (recommended for solo projects)
cd C:\path\to\YourProject
mkdir tools -Force
# unzip into tools\hermes3d-mcp-lock-orchestrator
cd tools\hermes3d-mcp-lock-orchestrator
npm install
npm test

# Option B: shared install used by multiple projects
mkdir C:\tools -Force
# unzip into C:\tools\hermes3d-mcp-lock-orchestrator
cd C:\tools\hermes3d-mcp-lock-orchestrator
npm install
npm test
```

## Wire it to your project

Recommended path: run the interactive wizard. It validates the workspace path,
detects supported MCP clients, writes timestamped backups before changing any
config, bootstraps `.hermes3d_orchestrator/`, and prints the first agent prompt.

```powershell
npm run wizard
```

For unattended installs, pass the workspace and clients explicitly:

```powershell
npm run wizard -- --workspace "C:\path\to\YourProject" --clients codex,claude-code --yes
```

Manual/reference path: run the bootstrapper. It is idempotent and never prompts.

```powershell
npm run init-project -- --workspace "C:\path\to\YourProject"
```

This will:

1. Initialize the hidden state dir inside the workspace.
2. Append `<state-dir>/` and `tools/hermes3d-mcp-lock-orchestrator/node_modules/` to the workspace's `.gitignore`.
3. Run `hermes_doctor` and print findings.
4. Print paste-ready MCP client configs for Claude Desktop, Claude Code, Codex, and Windsurf, all with absolute paths and the right env vars.

### Override defaults if you want a project-specific identity

```powershell
npm run init-project -- `
  --workspace "C:\path\to\YourProject" `
  --state-dir ".project_locks" `
  --server-name "yourproject-locks"
```

`--state-dir` must be a single directory name (no slashes, no `..`). `--server-name` is the identifier MCP clients will use to reference the server.

## Environment variables an MCP client should set

| Variable             | Required? | Purpose                                                                    |
| -------------------- | --------- | -------------------------------------------------------------------------- |
| `MCP_LOCK_WORKSPACE` | yes       | Absolute path to the project root.                                         |
| `MCP_LOCK_STATE_DIR` | optional  | Override the hidden state dir name. Default: `.hermes3d_orchestrator`.     |
| `HERMES3D_WORKSPACE` | optional  | Legacy alias for `MCP_LOCK_WORKSPACE`. Honored when the new name is unset. |

### Shared install across many workspaces

Keep `MCP_LOCK_WORKSPACE` pointed at a default safe repo, then switch at runtime when an agent starts work in a different project:

```json
{ "tool": "hermes_get_workspace", "arguments": {} }
```

```json
{
  "tool": "hermes_set_workspace",
  "arguments": {
    "owner": "codex-impl-01",
    "workspaceRoot": "C:\\path\\to\\AnotherProject",
    "reason": "Start coordinated edits in AnotherProject",
    "allowActiveLocks": false
  }
}
```

After switching, call `hermes_join_project` so the agent profile, live presence, inbox, backend status, and current project summary are hydrated in one step. `hermes_live_status` shows active locks, stale locks, queue counts, recent outbox events, presence, and anonymous-agent state. Use `includeProfiles: true` when an agent needs the registered host/capability profiles. Agents that need low-latency handoff awareness can call `hermes_wait_for_events` with the last event id they observed, and agents waiting on direct work can call `hermes_wait_for_inbox`.

If an agent needs a collaborator, call `hermes_request_assistance` with required skills and task type. HermesProof ranks active agents using live presence, lock load, and learned dispatch history, sends typed inbox messages, and emits `assistance.requested`. The requester can then call `hermes_wait_for_assistance` to see who accepted, declined, or timed out. If an agent needs a locked file, call `hermes_request_unlock` with the file list and reason. HermesProof discovers active owners, creates handoff requests, sends inbox messages, and emits `unlock.requested` / `handoff.created` events. The owner then calls `hermes_approve_handoff`; the requester waits with `hermes_wait_for_unlock`. If the lock owner is stale, `hermes_request_unlock` reports `stale_available` and points to `hermes_recover_stale_locks` instead of blocking on an absent owner. Finishing agents should call `hermes_complete_work` so evidence, task release, lock release, notifications, and presence update happen in one step.

## Per-client wiring

The wizard is the recommended way to wire clients. The manual command below is
kept for operators who need to inspect or paste config by hand.

Run:

```powershell
$env:MCP_LOCK_WORKSPACE = "C:\path\to\YourProject"
$env:MCP_LOCK_SERVER_NAME = "yourproject-locks"   # optional
node scripts\print-configs.mjs
```

Paste the printed JSON / TOML / CLI command into the appropriate config file. The script also prints OS-specific paths for those files.

## Verify

After wiring the MCP client, ask the agent to call:

1. `hermes_doctor` — should return `ok: true` with no `error` findings.
2. `hermes_read_policy` — should report `workspace_root` equal to your project path.
3. `hermes_get_state` — should report empty locks/tasks/handoffs on a fresh install.

If any of those return unexpected values, fix the env var in the client config (the MCP client may need a restart to pick up env changes).

## House rules to enable on day one

Add to your project's `AGENTS.md` or contributor docs:

- Use stable, role-prefixed owner names: `claude-lead`, `claude-reviewer-ux`, `codex-impl-01`, `windsurf-cascade`.
- Always claim a task before locking files.
- Never edit a file you don't own; always go through `hermes_request_handoff`.
- Append evidence on every checkpoint.
- Stale recovery is the **last** resort, not the first.

## Updating the orchestrator

```powershell
cd <wherever you installed the package>
git pull   # or unzip a newer build over the same directory
npm install
npm test
npm run doctor -- --workspace "C:\path\to\YourProject"
```

State files inside the project workspace are forward-compatible across patch versions; the orchestrator versions config alongside the data and migrates only when needed.
