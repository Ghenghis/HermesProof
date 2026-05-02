# Setup: Claude Desktop

Use the Developer settings / MCP config editor in Claude Desktop and add this server:

```json
{
  "mcpServers": {
    "hermes3d-locks": {
      "command": "node",
      "args": [
        "G:\\Github\\Hermes3D\\tools\\hermes3d-mcp-lock-orchestrator\\src\\server.mjs"
      ],
      "env": {
        "MCP_LOCK_WORKSPACE": "G:\\Github\\Hermes3D"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

## Desktop usage prompt

```text
You are Claude Lead for Hermes3D. Before editing any project file, use hermes_claim_task and hermes_lock_files. If a file is locked by Codex or Windsurf, request a handoff instead of editing. Append evidence before releasing locks.
```

## Config file paths

| OS      | Path                                                              |
| ------- | ----------------------------------------------------------------- |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json`                     |
| macOS   | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux   | `~/.config/Claude/claude_desktop_config.json`                     |

Run `npm run print-configs` from the orchestrator package to print these paths plus paste-ready JSON.

## Notes

Claude Desktop local MCP support can be configured through Desktop Extensions or local developer-defined servers. For this project, use local stdio because the server needs direct access to your local workspace.

`HERMES3D_WORKSPACE` is also accepted as a backwards-compatible alias for `MCP_LOCK_WORKSPACE`.
