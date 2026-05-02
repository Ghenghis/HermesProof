## Coordination — HermesProof

This workspace is governed by the `hermes3d-locks` MCP server (HermesProof).

Mandatory protocol for any agent making edits:

1. `hermes_doctor` and `hermes_read_policy` at session start.
2. `hermes_claim_task` with `owner` matching `^[a-z][a-z0-9-]{1,63}$`.
3. `hermes_lock_files` before opening files for write.
4. If blocked: `hermes_request_handoff`, wait for `hermes_approve_handoff`. Never overwrite.
5. After edits: `hermes_append_evidence` (kind `edit`).
6. `hermes_release_files` and `hermes_release_task` at end.

Allowlisted shell commands run only via `hermes_run_gate`. See `hermes_list_gates` for the inventory.
