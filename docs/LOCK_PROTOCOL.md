# HermesProof — Lock Protocol

<div align="center">
<img src="./diagrams/lock-lifecycle.svg" alt="Per-file lock lifecycle: unlocked → held(A) → handoff_pending → held(B) → unlocked" width="100%"/>
</div>

## Golden rule

No agent edits a file unless it owns the lock for that file. The server enforces this; conventions cannot.

## Required lifecycle

```text
0. (optional, once per session) hermes_doctor and/or hermes_read_policy
1. hermes_claim_task
2. hermes_lock_files
3. edit files
4. hermes_heartbeat during long work
5. hermes_run_gate for allowlisted checks
6. hermes_append_evidence
7. hermes_release_files
8. hermes_release_task
```

## Conflict lifecycle

```text
1. Agent tries hermes_lock_files.
2. Server returns blocked with current_owner.
3. Agent stops. No edit.
4. Agent calls hermes_request_handoff.
5. Current owner approves or denies via hermes_approve_handoff.
6. If approved, ownership transfers.
7. If denied, requester must choose another file/task.
```

## Stale lock lifecycle

```text
1. Agent lists locks.
2. Lock is stale only if expires_utc is in the past.
3. Agent calls hermes_recover_stale_locks with note.
4. Server archives stale lock metadata to evidence.
```

Stale recovery is not a normal collaboration path. Prefer handoff.

## Event semantics

The lock protocol emits passive trigger-bridge events for coordination state changes. Events are durable JSON files under `.hermes3d_orchestrator/events/outbox/`; HermesProof does not directly wake chat sessions, invoke LLM APIs, or route prompts.

Events are emitted for:

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
