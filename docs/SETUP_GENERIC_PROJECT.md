# Setup: Any Project (new or existing)

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

Run the bootstrapper. It is idempotent and never prompts.

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

| Variable | Required? | Purpose |
| --- | --- | --- |
| `MCP_LOCK_WORKSPACE` | yes | Absolute path to the project root. |
| `MCP_LOCK_STATE_DIR` | optional | Override the hidden state dir name. Default: `.hermes3d_orchestrator`. |
| `HERMES3D_WORKSPACE` | optional | Legacy alias for `MCP_LOCK_WORKSPACE`. Honored when the new name is unset. |

## Per-client wiring

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
