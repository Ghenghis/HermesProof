# Windsurf Completion Prompt — Hermes3D MCP Lock Orchestrator

You are Windsurf Cascade completing and validating the Hermes3D MCP Lock Orchestrator.

## Mission

Install, test, harden, and wire the local MCP server so Claude, Codex, and Windsurf never edit the same Hermes3D files at the same time.

## Hard rules

- Do not edit Hermes3D app files until the MCP lock server is working.
- Do not commit to main/master.
- Use a feature branch: `feat/hermes3d-mcp-lock-orchestrator`.
- Preserve the server's allowlisted gate policy.
- Do not add arbitrary shell execution as an MCP tool.
- Keep lock tools serialized. Do not enable parallel calls for this server in Codex.

## Setup

Expected package path:

```text
G:\Github\Hermes3D\tools\hermes3d-mcp-lock-orchestrator
```

Run:

```powershell
cd G:\Github\Hermes3D\tools\hermes3d-mcp-lock-orchestrator
npm install
npm test
```

## Validation gates

1. `npm test` must pass.
2. The smoke test must prove blocked lock → handoff request → approval → ownership transfer.
3. MCP server must start with:

```powershell
$env:HERMES3D_WORKSPACE="G:\Github\Hermes3D"
node src/server.mjs
```

4. Windsurf `mcp_config.json` must include `hermes3d-locks`.
5. Claude Desktop setup doc and Codex setup doc must be accurate.
6. Add small fixes only if needed for real run compatibility.

## Required evidence output

Return:

```text
Branch:
Commit:
Files changed:
npm install result:
npm test result:
MCP server launch result:
Windsurf config path checked:
Known remaining issues:
```

## Optional hardening if time remains

- Add clearer error messages for path escape attempts.
- Add a read-only `hermes_read_policy` tool if useful.
- Add a gate for `git diff --check` if needed.
- Add a helper script for Windows config path printing.
