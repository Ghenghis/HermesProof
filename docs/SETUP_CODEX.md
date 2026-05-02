# Setup: Codex CLI / Codex IDE

Add this to `~/.codex/config.toml`:

```toml
[mcp_servers.hermes3d-locks]
command = "node"
args = ["G:\\Github\\Hermes3D\\tools\\hermes3d-mcp-lock-orchestrator\\src\\server.mjs"]
env = { MCP_LOCK_WORKSPACE = "G:\\Github\\Hermes3D" }
enabled = true
startup_timeout_sec = 10
tool_timeout_sec = 60
# Important for locks: keep this server serialized.
# Do not set supports_parallel_tool_calls = true for hermes3d-locks.
# HERMES3D_WORKSPACE is also accepted as a backwards-compatible alias.
```

Then restart Codex.

## Codex implementation rule

```text
Before editing any file, call hermes_claim_task and hermes_lock_files.
If hermes_lock_files returns blocked, stop and request a handoff.
Never edit a locked file without approved ownership.
After the patch, run allowlisted gates through hermes_run_gate, append evidence, release files, and release the task.
```

## Optional: exposing Codex as an MCP server

Advanced setup only:

```powershell
codex mcp-server
```

This can let an MCP client invoke Codex. For Hermes3D, keep the lock orchestrator as the shared control plane either way.
