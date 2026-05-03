# Queue Discipline — cross-client coordination

The standing-prompt convention every HermesProof-aware agent should follow on session start, regardless of which client (Claude Code, Claude Desktop, Codex, Windsurf, Cursor, VS Code Copilot) it is running in.

This document is the **cross-client source of truth** for the four-step pickup protocol. Per-client bundles (`examples/claude_code/`, `examples/cursor/`, `examples/windsurf/`, etc.) reference this file rather than duplicating the protocol.

---

## Why this exists

When 3+ agents share a workspace, "who's editing what" is a protocol question, not a vibe. HermesProof solves the *enforcement* layer (atomic locks, evidence, gates). This file solves the *behavior* layer: what an agent does when it wakes up so it doesn't trample other agents' in-flight work.

---

## The four steps

### Step 0 — pre-flight (every session start, before any edit)

```text
hermes_doctor                    confirm ok=true
hermes_read_policy               surface workspace_root
hermes_get_state                 see active locks/tasks/handoffs

If any task in `tasks` has owner matching <your-owner-prefix>-* and
status="claimed": RESUME it. Do not start fresh.

Else if HermesProof v0.5+ exposes hermes_pick_task:
  hermes_pick_task owner=<your-owner> prefer_task_id=<if-user-named-one>

Else: read handoffs/HANDOFF_TO_<your-target>_*.md and pick the most
recent one. Confirm with the user before claiming.

Else: stand by for explicit instructions from the user.
```

### Step 1 — when picking up a brief

```text
hermes_claim_task   owner=<your-owner>  taskId=<exact_id_from_brief>
                    role=<implementation|architect|reviewer>
                    title=<from brief>

hermes_lock_files   owner=<your-owner>  taskId=<task_id>
                    files=[<exact list from brief — no additions>]
                    ttlMinutes=<as briefed, default 90>

If any lock returns blocked:
  hermes_request_handoff requester=<you> currentOwner=<them>
                          files=[just the conflicting ones]
  Wait for hermes_approve_handoff. Never overwrite. Never create
  parallel files to bypass.
```

### Step 2 — during work

```text
For sessions over 10 minutes:
  hermes_heartbeat   owner=<you>   taskId=<task_id>   (every 20 min)

For shell commands that change state (test runs, builds, lint):
  hermes_run_gate    gateId=<allowlisted gate>  cwd=.
  Never invoke bash/pwsh directly for state-changing operations.

If you discover the brief is wrong (paths don't exist, scope mismatch,
missing dependency), STOP. Do not edit fabricated paths. Use the
blocked-handoff path in step 3.
```

### Step 3 — close out

**On success:**

```text
hermes_append_evidence   owner=<you>  taskId=<task_id>
                          kind="checkpoint"
                          summary="<one-line: what landed in PR #N (commit <SHA>)>"

hermes_release_files     owner=<you>  files=[every locked file]
hermes_release_task      owner=<you>  taskId=<task_id>
```

**On block (HermesProof v0.4+):**

```text
hermes_create_blocked_handoff
  task_id=<task_id>
  owner=<you>
  reason="<concrete reason: 'CP5.1-C scoped paths under src/hermes3d/X
            do not exist on this branch; expected core/ segment'>"
  blocked_files=[paths attempted]
  suggested_correct_paths=[paths that DO exist]
  handoff_path="handoffs/HANDOFF_TO_CLAUDE_<TASK>_BLOCKED.md"
  release_locks=true
```

This single call writes the handoff markdown, emits a `task.blocked` event into the outbox, appends evidence, and releases your locks. Then stop. Don't push partial work without the handoff file accompanying it.

**On block (HermesProof v0.3 fallback):** write `handoffs/HANDOFF_TO_CLAUDE_<TASK>_BLOCKED.md` by hand, append evidence with `kind: "block"`, release files, release task.

---

## Per-client mechanism table

| Client | Standing-prompt mechanism | Bundle | Owner-prefix |
|---|---|---|---|
| **Claude Code** | `SessionStart` hook + skill + AGENTS.md | [`claude_code/`](claude_code/) (incl. `hermesproof-watch` skill for review) | `claude-impl-<h>` / `claude-arch-<h>` |
| **Claude Desktop** | Project Prompt | [`claude_desktop/`](claude_desktop/) | `claude-desktop-<h>` |
| **Codex CLI** | `~/.codex/config.toml` + `AGENTS.md` snippet | repo root [`AGENTS.md`](../AGENTS.md) + [`AGENTS.snippet.md`](AGENTS.snippet.md) | `codex-impl-<NN>` |
| **Windsurf / Cascade** | `.windsurfrules` at workspace root | [`windsurf/`](windsurf/) | `windsurf-cascade-<h>` |
| **Cursor** | `.cursor/rules/hermesproof.mdc` + `hermesproof-queue-discipline.mdc` | [`cursor/`](cursor/) | `cursor-<h>` |
| **VS Code (Copilot agent)** | `.vscode/mcp.json` + `.github/copilot-instructions.md` | [`vscode/`](vscode/) | `copilot-<h>` |

Owner-prefix lets you tell at a glance which client did what — lock owner `claude-impl-dave` is a Claude Code edit, `windsurf-cascade-alex` is a Windsurf edit. The server-side regex is `^[a-z][a-z0-9-]{1,63}$`; lowercase, digits, hyphens only.

---

## Read-only review sessions

Some sessions only review (PR review, evidence chain audit, queue inspection). They MUST NOT call mutating tools. Use the `hermesproof-watch` Claude Code skill or its equivalent in your client. Read-only owner-prefix: `<client>-arch-<handle>` (e.g. `claude-arch-dave`). Mutation tools rejected by skill scope, audit trail clean.

---

## Hard rules

- DO use `hermes_pick_task` if v0.5+. The queue is the canonical pickup source.
- DO release locks AND task at session end. Stale locks block other agents until TTL recovery.
- DO heartbeat every 20 min on long work. The server doesn't auto-extend TTLs.
- DO write `kind: "checkpoint"` evidence on close-out. PR reviewers grep for this in the chain.
- DO NOT bypass via `--no-verify`, parallel files, or shell that escapes the gate runner.
- DO NOT release another agent's locks. Use `hermes_recover_stale_locks` only for genuinely expired TTLs.
- DO NOT edit files outside the brief's lock list. The intersection rule from `docs/PARALLEL_SUBAGENT_DISCIPLINE.md` applies at the agent level too.

---

## Honest framing

This is **discipline-based queue automation**, not daemon-based. HermesProof remains a passive coordination layer:

- It does not start chat sessions.
- It does not poll for "stuck" agents.
- It does not call any LLM API.

The "auto" in auto-pickup is **protocol consistency** — every agent runs the same Step 0 on session start. If an agent doesn't run Step 0, no task moves. That's the user's lever: when you start a fresh chat in any client, Step 0 fires from the standing prompt; HermesProof's locks + queue + events surface the right next move; you confirm or redirect.

Headless background runners that wake an agent without a chat session are a separate v0.7+ tier (see [`docs/MULTI_AGENT_LOOP_ROADMAP.md`](../docs/MULTI_AGENT_LOOP_ROADMAP.md) §"Stage 0.7+").

---

## Cross-reference

- Roadmap: [`../docs/MULTI_AGENT_LOOP_ROADMAP.md`](../docs/MULTI_AGENT_LOOP_ROADMAP.md)
- Parallel sub-agent rules: [`../docs/PARALLEL_SUBAGENT_DISCIPLINE.md`](../docs/PARALLEL_SUBAGENT_DISCIPLINE.md)
- v0.4 trigger bridge: [`../docs/EVENT_SCHEMA.md`](../docs/EVENT_SCHEMA.md)
- v0.5 task queue brief: [`../handoffs/HANDOFF_TO_CODEX_CP-HERMESPROOF-0.5.md`](../handoffs/HANDOFF_TO_CODEX_CP-HERMESPROOF-0.5.md) (will land as `docs/QUEUE_PROTOCOL.md` once v0.5 ships)
