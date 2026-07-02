# HermesProof — Lock Protocol

<div align="center">
<img src="./diagrams/lock-lifecycle.svg" alt="Per-file lock lifecycle: unlocked → held(A) → handoff_pending → held(B) → unlocked" width="100%"/>
</div>

## Golden rule

No agent edits a file unless it owns the lock for that file. The server enforces this; conventions cannot.

## Required lifecycle

```text
0. (optional, once per session) hermes_doctor and/or hermes_read_policy
1. hermes_update_presence with status, skills, task, and files
2. hermes_claim_task
3. hermes_lock_files
4. edit files
5. hermes_heartbeat during long work
6. hermes_run_gate for allowlisted checks
7. hermes_complete_work to append evidence, release locks, release task, and update presence
```

## Conflict lifecycle

```text
1. Agent tries hermes_lock_files.
2. Server returns blocked with current_owner.
3. Agent stops. No edit.
4. Agent calls hermes_request_unlock with files + reason.
5. HermesProof discovers active owners and emits handoff.created events.
6. Current owner approves or denies via hermes_approve_handoff.
7. If approved, ownership transfers.
8. If denied, requester must choose another file/task.
```

`hermes_request_handoff` remains available when the requester already knows the exact current owner and wants the lower-level call.

## Live interaction loop

```text
1. Agent calls hermes_live_status before work to see locks, queue, handoffs, presence, inbox-triggering events, and recent events.
2. Agent claims and locks files.
3. If blocked, requester calls hermes_request_unlock.
4. Owner watches hermes_wait_for_events after its last seen event id or checks hermes_get_inbox.
5. Owner approves with hermes_approve_handoff or denies with a note.
6. If approved, ownership transfers.
7. Requester resumes after hermes_wait_for_unlock reports ready.
```

## Skills routing

Agents should advertise lightweight skill tags in `hermes_update_presence`, such as `python`, `docs`, `testing`, `review`, or `release`. HermesProof does not execute skills; it uses tags to help agents find the best available collaborator through `hermes_find_agents`.

```text
1. Agent A is blocked or needs review.
2. Agent A calls hermes_find_agents with requiredSkills and taskType.
3. Agent A sends the chosen agent a hermes_send_message inbox item.
4. Agent B acknowledges with hermes_ack_message and claims or requests the needed files.
```

## Stale lock lifecycle

```text
1. Agent lists locks.
2. Lock is stale only if expires_utc is in the past.
3. Agent calls hermes_recover_stale_locks with note.
4. Server archives stale lock metadata to evidence.
```

Stale recovery is not a normal collaboration path. Prefer handoff for active owners. If `hermes_request_unlock` sees only stale owners for the requested files, it reports `stale_available` and recommends `hermes_recover_stale_locks` instead of waiting on an inbox reply that may never arrive.

## Event semantics

The lock protocol emits passive trigger-bridge events for coordination state changes. Events are durable JSON files under `.hermes3d_orchestrator/events/outbox/`; HermesProof does not directly wake chat sessions, invoke LLM APIs, or route prompts.

Events are emitted for:

```text
task.claimed
task.released
task.blocked
task.recovered
agent.presence
message.sent
message.acked
unlock.requested
work.completed
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

`pr.opened` is emitted only when the caller supplies `payload.pr_url`. `evidence.appended` is skipped for internal bookkeeping rows where `data.system` is `event-manager`, which prevents recursive self-emission.

Event files use `event_schema_version: 1` and are created through a temporary file plus same-filesystem rename into `events/outbox/`. Consumers that finish processing should call `hermes_mark_event_handled`, which atomically renames the file into `events/handled/`. Failed events move to `events/failed/` for operator inspection.

See [`EVENT_SCHEMA.md`](./EVENT_SCHEMA.md) for the full envelope and concurrency rules.

## Ownership naming

Good:

```text
claude-lead
claude-reviewer-ux
codex-impl-01
codex-fix-01
windsurf-cascade
```

Bad:

```text
agent
me
bot
worker
```
