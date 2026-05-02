# Setup: Windsurf / Cascade

Windsurf Cascade supports MCP servers through `mcp_config.json`.

Config path:

| OS      | Path                                              |
| ------- | ------------------------------------------------- |
| Windows | `%USERPROFILE%\.codeium\windsurf\mcp_config.json` |
| macOS   | `~/.codeium/windsurf/mcp_config.json`             |
| Linux   | `~/.codeium/windsurf/mcp_config.json`             |

Add the `hermes3d-locks` block:

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

> The legacy env var `HERMES3D_WORKSPACE` is also honored as a fallback if you prefer it. Both names point at the same workspace root.

Then refresh MCP servers in Cascade.

## Pre-flight (recommended)

Before adding the server to Cascade, run:

```powershell
cd G:\Github\Hermes3D\tools\hermes3d-mcp-lock-orchestrator
npm install
npm test
npm run doctor -- --workspace "G:\Github\Hermes3D"
```

If `doctor` reports any `error`-level findings, address them before connecting. The doctor is non-destructive — it only writes a temporary probe file and removes it.

## Windsurf completion task

Give Windsurf the prompt in:

```text
prompts/WINDSURF_COMPLETE_AND_TEST_PROMPT.md
```

Windsurf should:

1. Install dependencies.
2. Run `npm test`.
3. Connect the MCP in Windsurf.
4. Verify tools appear.
5. Run the sample Hermes3D UX-A coordination test.
6. Add any missing docs or small corrections.
7. Return evidence.
