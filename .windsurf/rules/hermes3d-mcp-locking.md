# Windsurf Rule: Hermes3D MCP Locking

Before Cascade edits any project file, it must use the `hermes3d-locks` MCP server. This rule applies to any project the orchestrator is installed into; the server name `hermes3d-locks` is just the default identifier.

Required sequence:

1. `hermes_get_state`
2. (first call of session) `hermes_read_policy` to confirm `workspace_root` matches the IDE workspace
3. `hermes_claim_task` with owner `windsurf-cascade`
4. `hermes_lock_files` for every target file
5. If blocked, stop and request handoff with `hermes_request_handoff`
6. Edit only owned files
7. Run gates with `hermes_run_gate`
8. Append evidence with `hermes_append_evidence`
9. Release locks and task

Do not modify files owned by Claude, Codex, or another Windsurf session unless the server returns an approved handoff.

If `hermes_read_policy` reports a different `workspace_root` than the open IDE workspace, stop and notify the user — do not edit until the MCP client config is fixed.
