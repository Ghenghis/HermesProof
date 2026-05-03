# VS Code Copilot STREAM Adapter

This adapter gives VS Code + GitHub Copilot a drop-in HermesProof MCP config
and repository instruction file.

## Files

- `.vscode/mcp.json` - stdio MCP registration.
- `.github/copilot-instructions.md` - repo-level STREAM discipline.

## Install

```powershell
node scripts/install-clients.mjs --workspace "G:\Github\Hermes3D" --target vscode
```

The `vscode-copilot` target remains supported; `vscode` is a shorter alias.
