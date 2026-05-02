---
name: hermesproof
description: Coordinate edits across multi-agent sessions via HermesProof locks. Use this when starting any edit task in a workspace that is governed by the hermes3d-locks MCP server. Auto-claims the task, locks the files, runs allowlisted gates, and releases on subagent stop.
---

# HermesProof coordination skill

When invoked:

1. Call `mcp__hermes3d-locks__hermes_doctor` and confirm `ok: true`.
2. Call `mcp__hermes3d-locks__hermes_read_policy` and surface the workspace_root.
3. Before any Edit / Write / MultiEdit, call `mcp__hermes3d-locks__hermes_lock_files` with the file paths.
4. If a lock is held by another owner, call `mcp__hermes3d-locks__hermes_request_handoff` and wait. Do NOT overwrite.
5. After the work, call `mcp__hermes3d-locks__hermes_append_evidence` describing the change.
6. On end of session, call `mcp__hermes3d-locks__hermes_release_files` and `mcp__hermes3d-locks__hermes_release_task`.

The user's owner string MUST match `^[a-z][a-z0-9-]{1,63}$` — e.g. `claude-lead`, `codex-impl-01`.
