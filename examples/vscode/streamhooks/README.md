# VS Code Copilot STREAM Adapter

This adapter gives VS Code + GitHub Copilot a drop-in HermesProof MCP config
and repository instruction file.

## Files

- `.vscode/mcp.json` - stdio MCP registration.
- `.github/copilot-instructions.md` - repo-level STREAM discipline.

## Install

```powershell
node scripts/install-clients.mjs --workspace "<ABSOLUTE_WORKSPACE_PATH>" --target vscode
```

The `vscode-copilot` target remains supported; `vscode` is a shorter alias.
If you copy `.vscode/mcp.json` manually, replace
`<ABSOLUTE_HERMESPROOF_REPO>` and `<ABSOLUTE_WORKSPACE_PATH>` with real
absolute paths first.
