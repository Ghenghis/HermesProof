# HermesProof — Queue Protocol

HermesProof v0.5 adds a passive file-based task queue under:

```text
<workspace>/.hermes3d_orchestrator/tasks/
├── pending/
├── claimed/
├── blocked/
└── done/
```

The queue lets one agent enqueue work and another agent pick it up through MCP without a paste-and-relay step. It is still passive: HermesProof never starts a chat session, calls a model, or wakes an agent. Standing prompts and external automation decide when to call `hermes_pick_task`.

## Task Envelope

Every task file is JSON with `task_schema_version: 1`:

```json
{
  "task_schema_version": 1,
  "task_id": "H3D-CP5.1-C",
  "title": "Profile generator + doctor envelope",
  "summary": "Implement the scoped handoff.",
  "handoff_path": "handoffs/HANDOFF_TO_CODEX_CP5.1-C.md",
  "branch_hint": "feat/example",
  "files_hint": [],
  "priority": 0,
  "target_owner_pattern": "^codex-impl-[0-9]+$",
  "enqueued_by": "claude-lead",
  "enqueued_utc": "2026-05-03T00:00:00.000Z",
  "claimed_by": null,
  "claimed_utc": null,
  "ttl_minutes": 120,
  "heartbeat_utc": null,
  "done_utc": null,
  "blocked_reason": null,
  "data": {}
}
```

Unknown schema versions are not claimed. They are moved to `blocked/` with `blocked_reason: "unknown_schema_version"` so an operator can inspect them.

## Lifecycle

```text
ENQUEUE  -> pending/<task_id>.json
PICK     -> pending/<task_id>.json --fs.rename--> claimed/<task_id>.json
DONE     -> claimed/<task_id>.json --fs.rename--> done/<task_id>.json
BLOCK    -> claimed/<task_id>.json --fs.rename--> blocked/<task_id>.json
RECOVER  -> claimed/<task_id>.json --fs.rename--> pending/<task_id>.json
```

All directory transitions use `fs.rename` on the same filesystem. `hermes_pick_task` also uses a per-task claim guard so concurrent pickers cannot both win on platforms where rename semantics allow replacement. Losers receive `task_already_claimed` or a no-pending result rather than double-processing the task.

## Priority

`priority` is numeric and clamped to `[-100, 100]`. Picking sorts by:

1. Highest `priority` first.
2. Oldest `enqueued_utc` first for tasks with equal priority.
3. `task_id` as a stable final tie breaker.

This makes emergency handoffs easy without sacrificing FIFO fairness within a priority class.

## Owner Affinity

`target_owner_pattern` is a JavaScript regular expression string. It is validated at enqueue time; invalid regexes are rejected with `invalid_owner_pattern`.

`hermes_pick_task` only claims tasks whose pattern matches the caller's `owner`. A mismatch returns `task_owner_mismatch`, so standing prompts can tell the operator that work exists but belongs to another agent lane.

## Stale Recovery

Claimed tasks carry `claimed_utc`, `heartbeat_utc`, and `ttl_minutes`. `hermes_heartbeat` updates matching claimed queue records alongside file locks. If a task is claimed beyond its TTL, `hermes_recover_stale_tasks` moves it back to `pending/` and emits a `task.recovered` event.

## Events

Queue transitions emit the same durable event envelopes as the trigger bridge:

- `task.enqueued`
- `task.claimed`
- `task.released`
- `task.blocked`
- `task.recovered`

Watchers can turn those outbox events into review packets or webhook notifications. The queue itself remains file-based and LLM-free.
