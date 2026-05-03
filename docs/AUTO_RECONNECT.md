# Auto-reconnect for the HermesProof MCP server

> Wraps `node src/server.mjs` in a supervisor that respawns the server on
> crash, OOM, panic, or transient failure. Adds resilience without changing
> the MCP protocol surface.

---

## Why

The MCP stdio transport doesn't have a built-in reconnect protocol. If the
server process dies, the client (Claude Code, Codex CLI, KiloCode, Cursor,
Windsurf, VSCode+Copilot) sees stdio close and stops calling.

The supervisor wraps the server and gives the client a continuous stdio
stream that survives server crashes. To the client, it looks like a single
long-running server.

---

## How it works

`scripts/mcp-supervisor.mjs`:

1. Spawns `node src/server.mjs` as a child process
2. Pipes stdin/stdout/stderr between the MCP client and the child
3. On child exit (non-zero code or signal), respawns with exponential
   backoff (1s → 2s → 4s → 8s → 16s → 30s cap)
4. Counts crashes in a 5-minute rolling window; trips a circuit breaker
   at 10 crashes (configurable) so structurally-broken servers surface
   to the client instead of looping forever
5. Forwards SIGTERM / SIGINT to the child for clean shutdown
6. Logs to `.hermes3d_orchestrator/supervisor.log` (rotated at 1MB)

---

## Activation per client

Replace `"command": "node", "args": ["src/server.mjs"]` with
`"command": "node", "args": ["scripts/mcp-supervisor.mjs"]` in any client
config.

### Claude Code

In `~/.config/claude-code/settings.json` (or `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "hermes3d-locks": {
      "command": "node",
      "args": ["G:/Github/hermes3d-mcp-lock-orchestrator/scripts/mcp-supervisor.mjs"]
    }
  }
}
```

### Codex CLI

In Codex's MCP config:

```json
{
  "mcpServers": {
    "hermes3d-locks": {
      "command": "node",
      "args": ["G:/Github/hermes3d-mcp-lock-orchestrator/scripts/mcp-supervisor.mjs"]
    }
  }
}
```

### Cursor / Windsurf / VSCode+Copilot

Same pattern — point the `command` at `scripts/mcp-supervisor.mjs` instead of `src/server.mjs`.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "hermes3d-locks": {
      "command": "node",
      "args": ["G:/Github/hermes3d-mcp-lock-orchestrator/scripts/mcp-supervisor.mjs"]
    }
  }
}
```

---

## Tunables (env vars)

| Var | Default | Purpose |
|---|---|---|
| `HERMESPROOF_SUPERVISOR_DISABLED` | unset | Set to `1` to bypass supervision (debugging) |
| `HERMESPROOF_SUPERVISOR_MAX_CRASHES` | `10` | Max crashes in window before circuit-breaker fires |
| `HERMESPROOF_SUPERVISOR_WINDOW_MS` | `300000` (5 min) | Rolling window for crash counting |
| `HERMESPROOF_SUPERVISOR_LOG` | `.hermes3d_orchestrator/supervisor.log` | Log path |

---

## Verifying it works

After updating your client config and restarting:

```bash
# 1. Confirm the server process is supervised
ps -ef | grep mcp-supervisor.mjs   # Linux/macOS
Get-Process node | Format-Table    # Windows PowerShell

# 2. Watch the supervisor log
tail -f .hermes3d_orchestrator/supervisor.log

# 3. Synthetic crash test (kills child server; supervisor respawns)
# In another terminal, find the child PID and kill it:
ps -ef | grep "src/server.mjs"
kill -9 <child-pid>
# Tail should show: "server crashed (code=null signal=SIGKILL)" → "backing off ... ms" → next spawn
```

---

## Disabling

To run the server directly (no supervision), revert the client config to
`"args": ["src/server.mjs"]`. Or set `HERMESPROOF_SUPERVISOR_DISABLED=1` and
the supervisor will exit cleanly without spawning.

---

## Compatibility

- Node 20+
- Works on Linux, macOS, Windows
- Zero new runtime deps (Node stdlib only)
- Compatible with the existing `npm run start`, `mcp:dev` scripts (those
  bypass the supervisor; use `npm run start:supervised` or
  `npm run mcp:supervised` for the supervised variants)
