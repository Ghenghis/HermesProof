## HermesProof coordination

When editing files in this workspace, use the `hermes3d-locks` MCP server for coordination:

- Before edits: `hermes_get_state` and `hermes_lock_files`
- After edits: `hermes_append_evidence`
- On request to edit a locked file: `hermes_request_handoff`, wait, then proceed only after `hermes_approve_handoff` returns `approved`

Owner string format: `^[a-z][a-z0-9-]{1,63}$`. Use `copilot-<handle>`.
