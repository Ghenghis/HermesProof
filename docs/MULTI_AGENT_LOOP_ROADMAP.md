# Multi-Agent Loop Roadmap

The path from "HermesProof v0.3.0 (locks + proof + gates)" to "fully working Claude ↔ Codex ↔ Windsurf ↔ Claude Code ↔ Claude Desktop coordination loop."

This roadmap is the architecture spine. Each stage is a distinct PR / checkpoint. Stages are independent — each delivers value on its own and does not require subsequent stages to be useful.

---

## Honest framing (the rule that governs everything below)

HermesProof is and stays a **passive coordination + proof layer**. It does not call LLM APIs. It does not directly wake hosted chat sessions (Claude.ai, ChatGPT, Claude Desktop). The "loop" between agents is achieved by:

1. **Durable file-based events** that any process can observe
2. **Mechanical CI checks** that run without an LLM
3. **Optional local watchers / webhooks** that the user configures
4. **Optional headless agent runners** as a separate, opt-in tier

If you want a fully hands-free loop with no human bridge, that is **CP-HERMESPROOF-0.7+** (Optional Headless Runners) and is explicitly out of scope until the earlier stages prove the friction is gone everywhere else.

---

## Stage map

| Stage | Title | Effort | Status | What it unlocks |
|---|---|---|---|---|
| **0.3** (shipped) | locks + evidence chain + 12 gates + Sigstore | — | ✅ shipped | safe parallel agent edits, hash-chained ledger, signed PROOF |
| **0.4** | Trigger Bridge + Auto Handoff Router | M | 📋 brief in progress | events emitted on every state change; mechanical PR review checklist; review packet generator |
| **0.5** | Task Queue + Codex Auto-Pickup | M | ⏸ deferred | `tasks/{pending,claimed,blocked,done}/`; standing-prompt convention so Codex picks the next pending task on session start |
| **0.6** | Cross-agent client integration | S | ⏸ deferred | Claude Code SessionStart hook, Cursor `.cursorrules` rules, Windsurf rules, Claude Desktop project — all read the queue + emit events on tool-use |
| **0.7+** | Optional headless runners | L | ⏸ deferred (opt-in tier) | a separate `runners/` package that calls Codex CLI / Claude CLI in non-interactive mode against the queue. Pay for compute, get hands-free loop |
| **0.8+** | Cross-machine + multi-repo coordination | L | ⏸ speculative | runs HermesProof state on a tiny shared store (SQLite WAL or git-pushed `.hermes3d_orchestrator/`), so two laptops can coordinate against the same repo |

---

## Stage 0.4 — Trigger Bridge (this checkpoint)

**Brief:** [`handoffs/HANDOFF_TO_CODEX_CP-HERMESPROOF-0.4.md`](../handoffs/HANDOFF_TO_CODEX_CP-HERMESPROOF-0.4.md)

**What it adds:**

- HermesProof emits durable events on `task.released`, `task.blocked`, `handoff.created`, `handoff.approved`, `evidence.appended` (with safeguard against self-emission loop), `gate.failed`, `gate.passed`, `pr.opened` (carried in payload of `task.released` when present).
- Events stored at `.hermes3d_orchestrator/events/{outbox,handled,failed}/<event_id>.json` with atomic `fs.rename` transitions.
- 4 new MCP tools: `hermes_list_events`, `hermes_mark_event_handled`, `hermes_emit_event`, `hermes_create_blocked_handoff`.
- 3 new scripts: `scripts/watch-events.mjs` (3 modes: console / packet / optional webhook), `scripts/generate-review-packet.mjs`, `scripts/trigger-doctor.mjs`.
- 1 new GitHub Actions workflow: `hermesproof-review-check.yml` runs **LLM-free mechanical checks** on every PR open.
- Retention: `events/handled/*.json` older than 30 days pruned by `scripts/prune-events.mjs`.

**The biggest win:** the GitHub Actions checklist. It runs without anyone online and catches lock-discipline drift mechanically.

**What this stage does NOT do:**
- Wake Claude / Codex / any hosted chat
- Replace the human relay (you, the user)

**Acceptance:** [`handoffs/HANDOFF_TO_CODEX_CP-HERMESPROOF-0.4.md`](../handoffs/HANDOFF_TO_CODEX_CP-HERMESPROOF-0.4.md) §"Acceptance criteria"

---

## Stage 0.5 — Task Queue + Codex Auto-Pickup

**Status:** deferred until 0.4 has run for 1 week and we have evidence of saved friction.

**What it adds:**

- File-based queue at `.hermes3d_orchestrator/tasks/{pending,claimed,blocked,done}/`.
- New MCP tools: `hermes_enqueue_task`, `hermes_list_pending_tasks`, `hermes_pick_task` (claim atomically with priority + owner-affinity).
- Standing-prompt convention in `examples/AGENTS.snippet.md` + `examples/claude_code/skills/hermesproof/SKILL.md`: "Step 0: `hermes_pick_task` — pick the highest-priority pending task assigned to your owner-class."
- Optional helper script `scripts/next-task.sh` for non-MCP clients.

**What this stage does NOT do:**
- Trigger Codex's chat session
- Run anything in the background

**Why deferred:** the task-queue value depends on the TRIGGER BRIDGE (0.4) being in place. Without 0.4 emitting events, the queue is just another folder no one watches. Ship 0.4 first; let evidence decide if 0.5 is worth it.

---

## Stage 0.6 — Cross-agent client integration

**Status:** deferred until 0.4 + 0.5 are stable.

**What it adds (per client):**

| Client | Integration | Files in `examples/` |
|---|---|---|
| **Claude Code** | `SessionStart` hook calls `hermes_doctor` + `hermes_list_events --status=outbox`. `PreToolUse` Edit/Write hook calls `hermes_lock_files`. `SubagentStop` hook calls `hermes_release_files`. | `examples/claude_code/settings.hooks.json` (already shipped — extend) + new `examples/claude_code/skills/hermesproof-watch/SKILL.md` |
| **Codex CLI** | `~/.codex/config.toml` `[mcp_servers.hermes3d-locks]` (already shipped). New `AGENTS.md` snippet directing Codex to `hermes_pick_task` at session start. | `examples/AGENTS.snippet.md` (extend) |
| **Windsurf / Cascade** | `~/.codeium/windsurf/mcp_config.json` (already shipped). New `.windsurfrules` snippet for queue discipline. | new `examples/windsurf/.windsurfrules` |
| **Cursor** | `.cursor/mcp.json` + `.cursor/rules/hermesproof.mdc` (already shipped). Extend rule with queue-pickup step. | extend existing |
| **Claude Desktop** | `claude_desktop_config.json` (already shipped). Add Project-mode prompt template. | new `examples/claude_desktop/PROJECT_PROMPT_TEMPLATE.md` |
| **VS Code Copilot** | `.vscode/mcp.json` (already shipped). Extend `copilot-instructions.snippet.md` with queue. | extend existing |

**No client-specific code is added to HermesProof itself.** All integration is configuration that consumers paste into their client.

**What this stage does NOT do:**
- Make the loop hands-free across machines
- Trigger an offline agent

---

## Stage 0.7+ — Optional Headless Runners (separate tier)

**Status:** speculative; opt-in product tier.

**What it would add:**

- New top-level `runners/` package (separate npm or python module).
- `runners/codex-poller.mjs` — invokes `codex` CLI in non-interactive headless mode against the queue (`hermes_pick_task` → `codex apply <brief>` → `hermes_release_task`).
- `runners/claude-poller.mjs` — same shape against Claude CLI / Claude Agent SDK.
- Cron + systemd unit examples.
- Cost / token-budget tracking via the existing evidence ledger.

**Why a separate tier:** this is where compute costs actually accrue (background LLM calls). Should be opt-in, separately documented, with token-budget gates.

---

## Stage 0.8+ — Cross-machine + multi-repo (speculative)

**Status:** not committed.

Possible directions:
- Replace JSON-on-disk with a tiny SQLite WAL store so multiple machines coordinate (still file-based, still git-diffable on demand via `sqlite3 .dump`).
- Or push `.hermes3d_orchestrator/` to a dedicated `state` branch on the repo, so any clone has the same coordination state.

**Don't build until two machines actually need it.**

---

## Sequencing decision

```
Now:    Codex implements 0.4 (this PR + handoff brief)
+1 wk:  Decide if 0.5 (queue) is worth shipping based on 0.4 evidence
+2 wk:  Decide if 0.6 (cross-agent integration) is worth shipping based on 0.5 friction
+1 mo:  Decide if 0.7+ (headless runners) is worth shipping based on 0.6 adoption
```

Hard rule for every stage: **ship working software that delivers value on its own**, not a multi-stage castle that only works when complete.

---

## Architect / implementer split (unchanged)

```text
Claude  = design brain      (writes plans, ADRs, briefs, reviews)
Codex   = coding hands       (implements scoped tasks, runs gates, opens PRs)
HermesProof = traffic control + proof   (locks, evidence, gates, events)
User    = bridge between Claude and Codex sessions   (until headless runners exist)
```

Stage 0.4 keeps this split intact. The trigger bridge gives the user better tools (review packets, mechanical checklists) for the bridging step but does not remove the user from the loop. That's by design — automating the user out is a Stage 0.7+ concern.
