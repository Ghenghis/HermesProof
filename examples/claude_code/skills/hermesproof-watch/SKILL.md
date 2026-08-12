---
name: hermesproof-watch
description: Architect / review session helper for HermesProof-coordinated repos. Use when reviewing PRs, watching the lock state, walking the evidence chain, or writing handoff briefs. Read-only against the MCP — never claims, locks, or releases. Use the sibling `hermesproof` skill for implementation work.
---

# HermesProof — architect / watch skill

This skill is for **review and observation** sessions, not implementation. It uses only read-only HermesProof MCP tools and never mutates server state. The sibling [`hermesproof`](../hermesproof/SKILL.md) skill is for implementation (claim, lock, edit, release).

## When invoked

1. Call `mcp__hermes3d-locks__hermes_doctor` and confirm `ok: true`.
2. Call `mcp__hermes3d-locks__hermes_get_state` and surface:
   - active locks (count + owners)
   - active tasks (count + statuses)
   - pending handoffs (count)
3. Call `mcp__hermes3d-locks__hermes_list_locks` for the lock detail rendering.
4. Call `mcp__hermes3d-locks__hermes_verify_evidence` and confirm `ok: true` and `first_break: null`. If the chain is broken, surface the break index immediately and stop — don't continue review until the chain is explained.
5. (HermesProof v0.4+) Call `mcp__hermes3d-locks__hermes_list_events` with `status: "outbox"` to see un-acted events. Cross-reference task IDs against open PRs.

## Read-only tool list

These are the tools this skill MAY call:

- `mcp__hermes3d-locks__hermes_doctor`
- `mcp__hermes3d-locks__hermes_get_state`
- `mcp__hermes3d-locks__hermes_list_locks`
- `mcp__hermes3d-locks__hermes_list_gates`
- `mcp__hermes3d-locks__hermes_read_policy`
- `mcp__hermes3d-locks__hermes_verify_evidence`
- `mcp__hermes3d-locks__hermes_list_events`
- `mcp__hermes3d-locks__hermes_list_pending_tasks` (HermesProof v0.5+)

## Tools this skill MUST NEVER call

- `hermes_claim_task` / `hermes_release_task`
- `hermes_lock_files` / `hermes_release_files`
- `hermes_heartbeat`
- `hermes_request_handoff` / `hermes_approve_handoff`
- `hermes_recover_stale_locks` / `hermes_recover_stale_tasks`
- `hermes_run_gate`
- `hermes_append_evidence`
- `hermes_emit_event` / `hermes_mark_event_handled`
- `hermes_create_blocked_handoff`
- `hermes_pick_task` (HermesProof v0.5+)
- `hermes_enqueue_task` (HermesProof v0.5+)

## Drafting handoff briefs (the architect job)

Architect briefs go in `handoffs/HANDOFF_TO_<TARGET>_<TASK>.md`. They are file edits via the regular Write tool — **no HermesProof lock required for the handoff file itself** because the lock store is for files in the workspace under coordination, not for this repo's own meta-docs.

Brief structure (mirror the prior shape from `handoffs/HANDOFF_TO_CODEX_CP-HERMESPROOF-0.4.md`):

1. Status (READY / DRAFT / BLOCKED)
2. Mission
3. Workspace + branch
4. Bump (version / tool count / gate count)
5. Files allowed to modify (exact list)
6. Required behavior
7. Required tests
8. Gates to run before push
9. Acceptance criteria
10. Commit + push + PR shape
11. Failure protocol
12. Hard rules
13. Done criteria checklist (paste into PR body)
14. Reference

## Owner string

If this skill ever needs to be referenced as an actor (e.g. in evidence ledger entries), use `claude-arch-<handle>`. Distinct from the implementation skill's `claude-impl-<handle>` so the audit trail clearly separates architect actions from implementer actions.

## Hard rules

- DO NOT use any tool listed under "MUST NEVER call".
- DO NOT edit source files (anything under `src/`, `scripts/`, `.github/`, `docs/diagrams/`). That's implementer work.
- DO write handoff briefs in `handoffs/`, ADRs in `docs/architecture/adr/`, and roadmap updates in `docs/MULTI_AGENT_LOOP_ROADMAP.md` — those ARE architect-side files.
- If a review surfaces a bug or fix, write a correction handoff (`handoffs/HANDOFF_TO_<TARGET>_<TASK>_CORRECTION.md`) for the implementer agent. Don't fix it yourself unless explicitly assigned.

## Cross-reference

- Implementation skill: [`../hermesproof/SKILL.md`](../hermesproof/SKILL.md)
- Cross-client discipline: [`../../QUEUE_DISCIPLINE.md`](../../QUEUE_DISCIPLINE.md)
- Parallel-subagent rules: [`../../../docs/PARALLEL_SUBAGENT_DISCIPLINE.md`](../../../docs/PARALLEL_SUBAGENT_DISCIPLINE.md)
