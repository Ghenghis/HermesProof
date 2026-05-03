# HermesProof — Tool Reference

The server exposes 42 MCP tools across coordination, gates, evidence, events, queue pickup, anonymous orchestration, A2A task exchange, Hermes Agent bridging, and diagnostics.

<div align="center">
<img src="./diagrams/architecture.svg" alt="HermesProof architecture showing the MCP tools surfaced over stdio JSON-RPC" width="100%"/>
</div>

| Group           | Tools                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| Claim / release | `hermes_claim_task`, `hermes_release_task`                                                                   |
| Lock            | `hermes_lock_files`, `hermes_release_files`, `hermes_heartbeat`                                              |
| Handoff         | `hermes_request_handoff`, `hermes_approve_handoff`                                                           |
| Gate            | `hermes_run_gate`, `hermes_list_gates`                                                                       |
| Evidence        | `hermes_append_evidence`, `hermes_verify_evidence`                                                           |
| Events          | `hermes_list_events`, `hermes_emit_event`, `hermes_mark_event_handled`, `hermes_create_blocked_handoff`      |
| Queue           | `hermes_enqueue_task`, `hermes_list_pending_tasks`, `hermes_pick_task`, `hermes_recover_stale_tasks`         |
| Diagnostics     | `hermes_get_state`, `hermes_list_locks`, `hermes_recover_stale_locks`, `hermes_doctor`, `hermes_read_policy` |

---

## hermes_get_state

Returns active locks, tasks, handoff requests, workspace root, and state directory.

## hermes_claim_task

Claims a task before editing.

Required:

```json
{ "owner": "codex-impl-01", "taskId": "CP-UX-A-CODEX" }
```

## hermes_lock_files

Atomically locks files. If one file is blocked, all newly acquired locks in that call are rolled back.

```json
{
  "owner": "codex-impl-01",
  "taskId": "CP-UX-A-CODEX",
  "files": ["03_implementation/ui/src/tabs/Dashboard.tsx"],
  "reason": "Implement UX-A Dashboard fixes."
}
```

## hermes_request_handoff

Asks a current owner to transfer locks.

```json
{
  "requester": "claude-reviewer-ux",
  "currentOwner": "codex-impl-01",
  "files": ["03_implementation/ui/src/tabs/Dashboard.tsx"],
  "reason": "Reviewer needs to apply one approved patch."
}
```

## hermes_approve_handoff

Approves or denies a handoff. Only the current lock owner can do this.

```json
{
  "owner": "codex-impl-01",
  "requestId": "handoff_...",
  "decision": "approve",
  "note": "Dashboard edits completed. Reviewer may patch."
}
```

## hermes_run_gate

Runs allowlisted gates only.

```json
{ "owner": "codex-impl-01", "gateId": "npm-build", "cwd": "03_implementation/ui" }
```

## hermes_append_evidence

Appends evidence to `.hermes3d_orchestrator/evidence/ledger.ndjson`.

```json
{ "owner": "codex-impl-01", "kind": "build", "summary": "npm-build PASS", "data": { "duration_ms": 4321 } }
```

## hermes_verify_evidence

Verifies the evidence hash chain and reports the first invalid row if the ledger was edited after the fact.

```json
{}
```

## hermes_list_events

Lists durable trigger-bridge events in chronological order. The event bridge is passive: listing events does not notify a chat session or call an LLM API.

```json
{ "status": "outbox", "limit": 25 }
```

`status` may be `outbox`, `handled`, `failed`, or `all`.

## hermes_emit_event

Manually inserts an `event_schema_version: 1` event into `.hermes3d_orchestrator/events/outbox/`. Callers provide the semantic fields; the manager fills generated fields such as `event_id`, `created_utc`, `workspace_root`, and evidence-chain references.

```json
{
  "event_type": "pr.opened",
  "task_id": "H3D-CP5.1-B",
  "owner": "codex-impl-01",
  "branch": "feat/example",
  "files": ["docs/ARCHITECTURE.md"],
  "summary": "PR opened for review.",
  "next_actor": "claude",
  "recommended_action": "review_pr",
  "payload": { "pr_url": "https://github.com/org/repo/pull/123" }
}
```

## hermes_mark_event_handled

Acknowledges one event by atomically renaming it from `events/outbox/<event_id>.json` to `events/handled/<event_id>.json`, then appending non-emitting evidence. Concurrent consumers that lose the rename race should receive or surface `event_already_handled` rather than processing the same event twice.

```json
{ "event_id": "evt_20260503T000000000Z_a1b2c3", "handled_by": "claude-reviewer", "note": "Review packet consumed." }
```

## hermes_create_blocked_handoff

Writes a Markdown handoff for a blocked task, appends evidence, emits `task.blocked`, and optionally releases locks owned by the caller.

```json
{
  "task_id": "H3D-CP5.1-B",
  "owner": "codex-impl-01",
  "reason": "Requested path is outside the approved scope.",
  "blocked_files": ["src/example.mjs"],
  "suggested_correct_paths": ["docs/ARCHITECTURE.md"],
  "handoff_path": "handoffs/HANDOFF_TO_CLAUDE_H3D-CP5.1-B_BLOCKED.md",
  "release_locks": true
}
```

## hermes_enqueue_task

Writes a `task_schema_version: 1` task to `.hermes3d_orchestrator/tasks/pending/`. Re-enqueueing an existing `task_id` is a no-op success. `priority` is numeric and clamped to `[-100, 100]`; `target_owner_pattern` is validated before the file is written.

```json
{
  "task_id": "CP-HERMESPROOF-0.5",
  "title": "Task queue",
  "summary": "Implement queue pickup.",
  "handoff_path": "handoffs/HANDOFF_TO_CODEX_CP-HERMESPROOF-0.5.md",
  "branch_hint": "feat/cp-hermesproof-0.5-task-queue",
  "files_hint": ["src/core/queue-manager.mjs"],
  "priority": 5,
  "target_owner_pattern": "^codex-.*$"
}
```

## hermes_list_pending_tasks

Lists pending queue tasks sorted by priority descending, then enqueue time ascending. `owner_filter` limits the response to tasks whose owner-affinity regex matches that owner.

```json
{ "owner_filter": "codex-impl-01", "limit": 10 }
```

## hermes_pick_task

Atomically claims the highest-priority pending task matching the caller. `prefer_task_id` can request one specific task; owner-affinity still applies. Concurrent losers receive `task_already_claimed` or `no_pending_tasks_for_owner`.

```json
{ "owner": "codex-impl-01", "prefer_task_id": "CP-HERMESPROOF-0.5" }
```

## hermes_recover_stale_tasks

Moves expired claimed tasks back to `pending/` and emits `task.recovered`. The optional `files` field is interpreted as a list of task ids, mirroring the existing recovery tool's shape while keeping queue recovery task-scoped.

```json
{ "owner": "claude-lead", "files": ["CP-HERMESPROOF-0.5"], "note": "owner session expired" }
```

## hermes_read_policy

Read-only policy snapshot. Returns the resolved workspace root, state dir, default TTL, and the env vars currently honored. Use this at the start of a session to confirm the orchestrator is pointed at the right workspace.

```json
{}
```

## hermes_doctor

Non-destructive pre-flight check. Returns:

- `checks[]`: per-check `{id, ok}` summary.
- `findings[]`: `error | warn | info` entries each with a `message` and a `fix` suggestion.
- `ok`: true only when no `error`-level findings exist.

```json
{}
```

The doctor probes write permission with a temporary file in the workspace root and removes it. It does **not** create the state dir tree — that happens only when `init()` is called by the running server.
