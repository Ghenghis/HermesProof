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
