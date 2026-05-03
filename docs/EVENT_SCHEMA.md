# HermesProof - Event Schema

HermesProof v0.4 writes durable, passive event files so other processes can observe coordination state changes. Events are an outbox contract, not a chat wake-up mechanism: HermesProof does not call LLM APIs, send messages into Claude/Codex/Windsurf, or guarantee that any human has seen an event.

## Directories

```text
<workspace>/.hermes3d_orchestrator/events/
├── outbox/    pending events
├── handled/   events acknowledged by a consumer
└── failed/    events rejected or failed by a consumer
```

Events are first written to a temporary path and then moved into `outbox/` with `fs.rename` on the same filesystem. Handled and failed transitions also use `fs.rename`.

## Envelope

Every event file is UTF-8 JSON with this envelope:

```json
{
  "event_schema_version": 1,
  "event_id": "evt_20260503T000000000Z_a1b2c3",
  "event_type": "task.released",
  "created_utc": "2026-05-03T00:00:00.000Z",
  "workspace_root": "G:\\Github\\Hermes3D",
  "task_id": "H3D-CP5.1-B",
  "owner": "codex-impl-01",
  "branch": "feat/example",
  "files": [],
  "summary": "Task released for review.",
  "evidence_ids": [],
  "next_actor": "claude",
  "recommended_action": "review_pr",
  "payload": {}
}
```

Required fields:

| Field | Type | Semantics |
| --- | --- | --- |
| `event_schema_version` | integer | Required. Current value is `1`. Consumers must fail closed on unknown versions. |
| `event_id` | string | Stable file stem, formatted `evt_<utc_iso_compact>_<6char_sha>`. |
| `event_type` | string | One of the event types below. |
| `created_utc` | string | ISO-8601 UTC timestamp. |
| `workspace_root` | string | Absolute workspace governed by this HermesProof server. |
| `task_id` | string or null | Task associated with the event, or null when not task-bound. |
| `owner` | string or null | Actor responsible for the state change. |
| `branch` | string or null | Current source branch when known. |
| `files` | array of strings | Workspace-relative paths relevant to the event. |
| `summary` | string | Short human-readable event summary. |
| `evidence_ids` | array of strings | Evidence rows for `task_id`, resolved at emit time and ordered by the `prev_hash` chain. |
| `next_actor` | string | `claude`, `codex`, `human`, or `unassigned`. |
| `recommended_action` | string | `review_pr`, `fix_scope`, `merge`, `review_handoff`, `acknowledge`, or `none`. |
| `payload` | object | Event-specific metadata. |

## Event types

```text
task.claimed
task.released
task.blocked
handoff.created
handoff.approved
handoff.denied
lock.acquired
lock.released
lock.recovered
evidence.appended
gate.failed
gate.passed
pr.opened
```

`pr.opened` is emitted only when the caller provides `payload.pr_url`.

`evidence.appended` is not emitted for event-manager bookkeeping rows. Those rows carry `data.system: "event-manager"` and are intentionally skipped to avoid recursive event emission.

## Versioning

Consumers must inspect `event_schema_version` before using an event. Version `1` is the only valid version for CP-HERMESPROOF-0.4. A consumer that sees an unknown version should move the event to `events/failed/` and record `error: "unknown_schema_version"` in its own logs or failure metadata.

Compatible additions may extend `payload`. Incompatible envelope changes require a new schema version.

## Concurrency

The outbox is designed for multiple watchers:

1. Producers write a temp file and `fs.rename` it into `events/outbox/`.
2. Consumers read from `events/outbox/`.
3. A consumer that has durably processed an event calls `hermes_mark_event_handled`.
4. `hermes_mark_event_handled` uses `fs.rename` from `outbox/` to `handled/`.

Because the rename is atomic on the same filesystem, only one consumer can win. Consumers that lose the race should surface `event_already_handled`, not process the event twice.

Failed processing should move the event to `events/failed/` with the same atomic rename rule. Failed events are for operator inspection and should not be silently retried forever.

## Retention

Retention applies only to handled events. Operators may run:

```powershell
node scripts\prune-events.mjs --workspace G:\Github\Hermes3D --before 2026-04-03T00:00:00.000Z --dry-run
node scripts\prune-events.mjs --workspace G:\Github\Hermes3D --before 2026-04-03T00:00:00.000Z
```

A common cutoff is 30 days. `events/outbox/` is live work and `events/failed/` is manual-inspection work; neither is auto-pruned.
