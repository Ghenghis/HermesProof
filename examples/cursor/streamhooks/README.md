# Cursor STREAM Adapter

Cursor can join the HermesProof loop with a workspace-local rule file and MCP
registration.

## Files

- `.cursor/rules/stream.mdc` - always-on STREAM polling and lock discipline.
- `.cursor/mcp.json` - stdio MCP registration template.

## Install

```powershell
node scripts/install-clients.mjs --workspace "<ABSOLUTE_WORKSPACE_PATH>" --target cursor
```

The installer copies `stream.mdc` beside the existing HermesProof Cursor rules.
