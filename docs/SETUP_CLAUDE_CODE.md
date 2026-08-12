# HermesProof Setup — Claude Code

After unzipping into `G:\Github\Hermes3D\tools\hermes3d-mcp-lock-orchestrator`:

```powershell
cd G:\Github\Hermes3D\tools\hermes3d-mcp-lock-orchestrator
npm install
npm test
```

Add the MCP to Claude Code:

```powershell
claude mcp add --transport stdio hermes3d-locks --scope local --env MCP_LOCK_WORKSPACE="G:\Github\Hermes3D" -- node "G:\Github\Hermes3D\tools\hermes3d-mcp-lock-orchestrator\src\server.mjs"
```

> `HERMES3D_WORKSPACE` is also accepted as a backwards-compatible alias.

Verify:

```powershell
claude mcp list
```

Inside Claude Code, run:

```text
/mcp
```

Then ask:

```text
Use hermes_get_state. Then claim task CP-MCP-SMOKE as claude-lead. Lock README.md. Append evidence. Release README.md. Release the task.
```

## Rule for Claude Code agents

Every Claude Code agent/team member must use a unique owner name:

```text
claude-lead
claude-reviewer-ux
claude-reviewer-tests
claude-reviewer-security
claude-reviewer-proof
```

Do not run all 20 agents on the same files. Use waves:

```text
Wave 1: Claude lead writes docs/prompts.
Wave 2: Codex locks code files and implements.
Wave 3: Claude reviewers inspect only; they request handoff before patching.
Wave 4: Codex applies correction list.
Wave 5: Claude verifies evidence.
```
