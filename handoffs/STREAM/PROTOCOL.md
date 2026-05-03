# STREAM/ — Real-Time Anonymous Handoff Protocol (HermesProof mirror)

> **Purpose:** Mirror of the Hermes3D STREAM/ protocol so HermesProof-side
> work coordinates without drift. The two repos share message types,
> directory layout, polling cadence, and conflict resolution. Cross-repo
> messages use mirror posts (same correlation ID in both inboxes).
>
> **The authoritative spec lives at:**
> `Hermes3D/handoffs/STREAM/PROTOCOL.md` (single source of truth)
>
> When the two diverge (regenerated via `scripts/sync-stream-protocol.mjs`),
> the Hermes3D copy wins. This file is regenerated, not hand-edited —
> see CHANGELOG entries at the bottom.

---

## 1. Scope of this mirror

HermesProof is a separate npm/Node workspace (`hermes3d-mcp-lock-orchestrator`)
that ships the lock manager + truth-gate harness used by Hermes3D. STREAM/
on this side handles:

- HermesProof-internal coordination (e.g., gate-pack PRs, perf companions, registry hardening)
- HermesProof-side cross-repo mirrors of Hermes3D-originated requests that affect both
- Gate-coverage proposals that require harness changes (`scripts/truth-gates.mjs`)

Hermes3D-only work (orchestrator, agents, UI tabs, marketing site) lives in
the Hermes3D STREAM and does NOT mirror here unless it changes a HermesProof
contract.

---

## 2. Cross-repo mirror rules

A message is a "cross-repo mirror" when:

- It changes a contract HermesProof publishes (lock-API, evidence schema, gate harness)
- A new gate added in HermesProof needs evidence/wiring on the Hermes3D side
- A queue item references both repos in `dependencies:`

Mirror posts:
- Same `correlation:` ID on both sides
- Header includes `cross-repo: yes`
- Both sides ACK independently (each in their own inbox)
- One side resolves the other side's message when both PRs land + green

Single-repo messages (e.g., a HermesProof typo fix) do not mirror.

---

## 3. The shared message types

Same as Hermes3D PROTOCOL.md §4. Types: `CORRECTION_REQUEST`, `FIX_PUSHED`,
`AUDIT_VERDICT`, `ENHANCEMENT_PROPOSAL`, `GATE_GAP_FOUND`, `GATE_LANDED`,
`TASK_CLAIMED`, `TASK_RELEASED`, `STATE_UPDATE`, `HEARTBEAT`, `LGTM`,
`BLOCKED`, `QUESTION`, `ANSWER`.

All caps. Type goes in the H2 subject after `msg-<id> — <TYPE> — <slug>`.

---

## 4. Tooling that enforces the protocol

The HermesProof side ships the validators (since this repo owns Node tooling):

- `scripts/stream-validate.mjs` — checks message format on every commit (pre-commit hook + CI gate)
- `scripts/stream-archive.mjs` — moves resolved/expired messages to LEDGER.md
- `scripts/stream-state-snapshot.mjs` — refreshes STATE.md from real `gh` + `hermes_get_state` data
- `scripts/sync-stream-protocol.mjs` — regenerates this mirror from the Hermes3D source

These are runnable from either repo (they auto-detect via `git rev-parse --show-toplevel`
and read both STREAM/ dirs when needed).

The CI gate `Layer S — STREAM hygiene` runs on PRs touching `handoffs/STREAM/**`:
- All messages pass `stream-validate`
- LEDGER.md is append-only (diff has no deletions)
- Messages older than 6h are archived
- No secrets pattern matches (gitleaks rules)

---

## 5. Foolproofing layers

The protocol survives the following failure modes:

| Failure mode | Mitigation |
|---|---|
| MCP lock manager drops mid-session | STREAM is markdown — works without MCP. State files reconcile when MCP reconnects. |
| Message format drift | `scripts/stream-validate.mjs` rejects malformed messages at PR time. |
| Stale messages pile up | `scripts/stream-archive.mjs` auto-archives `resolved`/`expired` >6h old. |
| Conflicting AUDIT_VERDICTs | NEEDS-FIX wins (belt-and-suspenders, §7 of source PROTOCOL). |
| Both sides claim the same task | First TASK_CLAIMED by timestamp wins; loser drops + picks next. |
| Infinite ping-pong on a correlation | >3 messages no-progress → BLOCKED, escalates to morning report. |
| Secrets accidentally posted | Gitleaks pack scans STREAM/, blocks commit. |
| Cross-repo mirrors fall out of sync | `sync-stream-protocol.mjs` regenerates; nightly CI checks divergence. |
| User wakes up confused | LEDGER.md is the audit trail; STATE.md is the snapshot. |
| Agents run in main worktree (collision) | All STREAM-driven Agent spawns use `isolation: "worktree"`. |
| `.env`/secret files leak via STREAM | Hardened `.gitignore` + gitleaks blocks any commit touching `.env*` outside `.env.example`. |
| Action plan rotting | LEDGER.md is the queryable history; any CRITIC can re-audit. |

---

## 6. Bootstrap on this side

Both `STREAM/` dirs were created together. HermesProof side is initialized with:

- This PROTOCOL.md mirror
- An empty STATE.md ready for first snapshot
- An empty CLAUDE_INBOX.md / CODEX_INBOX.md (waiting for first messages)
- LEDGER.md with the bootstrap entry
- GATE_GAP_QUEUE.md seeded with HermesProof-specific gate gaps
- ENHANCEMENT_QUEUE.md seeded with HermesProof unfinished items (v0.5.1 perf, registry hardening, etc.)

---

*Mirror v1 — 2026-05-03. Regenerate via `node scripts/sync-stream-protocol.mjs` if the source PROTOCOL drifts.*

---

## CHANGELOG

- **v1 / 2026-05-03** — initial mirror, synced from Hermes3D PROTOCOL.md commit-pending
