# Windsurf STREAM Adapter

This adapter gives Cascade a minimal STREAM loop for HermesProof-governed
workspaces.

## Files

- `.windsurfrules` - copy to the workspace root.
- `mcp_config.json` - user-config template for Windsurf MCP settings.

## Install

```powershell
node scripts/install-clients.mjs --workspace "G:\Github\Hermes3D" --target windsurf
```

The installer writes Windsurf MCP config and copies `.windsurfrules` into the
target workspace.
