# Parallel Subagent Discipline

> **Why this doc exists.** During CP-HERMESPROOF-0.4 implementation, Codex spawned a parallel "scripts/test worker" subagent (Ohm) to handle script and test edits in parallel with Codex's own core integration work. Both started writing to the same files because their write scopes were not declared disjoint at spawn time. Codex caught the collision and closed Ohm before any commits were corrupted — clean recovery — but the near-miss exposed a real coordination gap that this doc fixes going forward.

## 1. The rule

**Before any lead agent (Codex, Claude, or otherwise) spawns parallel subagents in a repository where HermesProof MCP file locks do NOT apply, the lead MUST declare fully disjoint write scopes for every subagent.**

Two repositories where MCP locks don't apply:
- **HermesProof's own repo** (`G:\Github\hermes3d-mcp-lock-orchestrator`) — the lock store is rooted at `G:\Github\Hermes3D`, so MCP cannot lock HermesProof's own source. **Coordination primitive: git branches + explicit scope declaration.**
- **Any sibling repo** the MCP isn't pointed at.

In repos where MCP locks DO apply (`G:\Github\Hermes3D` today), `hermes_lock_files` provides the locking. Each subagent claims its own task ID and locks its own file set. This doc still helps but is enforced by the server.

## 2. Concrete failure mode (what happened)

```text
Codex spawns:
  Lagrange (read-only inspector)        ← safe, no writes
  Turing   (writer: docs + workflow)    ← scope declared
  Ohm      (writer: scripts + tests)    ← scope NOT declared as disjoint from Codex itself

Meanwhile Codex itself starts wiring scripts/* + tests/* locally.
Ohm and Codex now both target the same files.
Codex detects the collision and closes Ohm.
```

The bug isn't HermesProof. The bug is that Codex's spawn declaration didn't differentiate "scripts owned by Ohm" from "scripts owned by Codex itself." Three writers were racing in two write lanes.

## 3. Mandatory pre-spawn checklist

Before spawning ANY parallel subagent that writes files, the lead agent must explicitly state:

```text
PARENT TASK ID:        e.g. CP-HERMESPROOF-0.4
PARENT WRITE SCOPE:    files the LEAD itself will touch
SUBAGENT 1 SCOPE:      files SUBAGENT-1 alone may touch
SUBAGENT 2 SCOPE:      files SUBAGENT-2 alone may touch
SUBAGENT N SCOPE:      ...
INTERSECTION:          MUST BE EMPTY for every (lead, sub-i) and (sub-i, sub-j) pair
```

If the intersection is non-empty for any pair, the spawn is invalid. Either:
- Re-partition until disjoint, OR
- Serialize that intersection (do it sequentially, not in parallel)

The lead announces this in the spawn prompt to each subagent. Each subagent's instructions explicitly list its write scope and a "DO NOT modify any file outside this list" rule.

## 4. Conflict detection at spawn time

A simple check the lead can run before spawning:

```bash
# Imagine SCOPE_LEAD, SCOPE_SUB1, SCOPE_SUB2 are file-glob arrays
{ printf '%s\n' "${SCOPE_LEAD[@]}"
  printf '%s\n' "${SCOPE_SUB1[@]}"
  printf '%s\n' "${SCOPE_SUB2[@]}" ; } | sort | uniq -d
```

Any output = an intersection bug. Don't spawn.

## 5. Conflict detection during execution

If the lead is already writing while subagents are running, and the lead notices a sub touching a file in the lead's scope (or another sub's scope), the lead MUST:

1. **Stop the offending subagent immediately.** Codex did this correctly with Ohm.
2. Inspect the offending sub's working state. If it had already written files outside its declared scope, revert those edits (the offending sub did not have the right to make them).
3. Re-spawn with a corrected scope declaration if the work is still needed.

## 6. Read-only subagents are always safe

A subagent declared read-only (no `Write`, no `Edit`, no `git commit` in its toolset) cannot create write conflicts. Use these freely. Examples:
- Codex's Lagrange (inspection mapping)
- Claude's `Explore` subagent type

If you can do the work as inspection + reporting, do it. Save writers for genuinely independent work.

## 7. Disjoint scope patterns that work

| Lead | Sub 1 | Sub 2 |
|---|---|---|
| `src/**` + `scripts/**` (core wiring) | `docs/**` + `.github/workflows/**` | `examples/**` (NEW files only) |
| `<phase plan>.md` + `<adr>.md` | `handoffs/HANDOFF_TO_CODEX_*.md` | `tests/**/test_<this_phase>_*.py` |
| `Hermes3D` repo via MCP locks | `HermesProof` repo via git branch | `documentation` repo via git branch |

Patterns that DON'T work:
- "I'll do scripts, you do tests" — tests live in `04_testing/` AND in `scripts/*-test.mjs`. Overlap likely.
- "I'll do the implementation, you do the tests" — implementation usually requires test edits to keep them green. Overlap during gate runs.
- "I'll do the protocol, you do the docs that describe the protocol" — docs reference symbols from protocol; protocol changes ripple into docs mid-flight.

## 8. Codex-specific rule

When Codex spawns subagents (Lagrange / Turing / Ohm style), the spawn instruction MUST contain:

```text
WRITE SCOPE: <exact file globs>
INTERSECTION WITH OTHER SUBAGENTS: declared empty by lead at <timestamp>
ON DETECTING A FILE OUTSIDE YOUR SCOPE: stop and report; do not edit
```

If a subagent's instructions don't have this block, the spawn is malformed.

## 9. Claude-specific rule

When Claude (this assistant) dispatches `Agent` tool calls in parallel, the prompt to each subagent MUST list:
- `Files YOU may create (new) or modify (only the one script)`
- `Hard rules — DO NOT touch any file outside the list above`

The existing parallel dispatches I (claude-lead) have done so far follow this pattern (Wave A SVG / EXAMPLES / WORKFLOWS for HermesProof v0.3.0, my Agent A/B for v0.5/v0.6 architect work). The pattern works. New dispatches must match it.

## 10. HermesProof's role

HermesProof v0.3.0 already enforces this rule for any work in a repo it's pointed at — `hermes_lock_files` rejects overlapping locks atomically. The bug fixed by this doc is specifically about repos HermesProof CANNOT govern (its own meta-repo, sibling docs repos, etc.).

A future HermesProof feature (not in v0.4 or v0.5 scope) could add a "self-coordinate" mode where HermesProof points at its own repo via a sibling lock store. That's a CP-HERMESPROOF-0.6+ design exercise, not a fix for the immediate bug.

## 11. Acceptance: when is this rule "applied"

A parallel-subagent spawn complies with this rule when, before any subagent receives a write tool, the spawn prompt for each subagent contains:
1. An explicit `WRITE SCOPE` enumerated as file paths or globs
2. An explicit `INTERSECTION` declaration ("intersection with other subagents: empty")
3. An explicit "stop on out-of-scope file" rule

Codex's Ohm spawn would have caught the collision pre-spawn under this rule. Adopt going forward.
