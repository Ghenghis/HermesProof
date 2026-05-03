# ADR-019: Anonymous Orchestration v0.7 — Skill Rotation, Reputation, Capability Dispatch, A2A Protocol

**Status:** Accepted  
**Date:** 2026-05-03  
**Author:** Claude (Lead Architect) + Ghenghis  

---

## Context

HermesProof v0.6 introduced the AnonymousOrchestrator (ADR-016): agents claim roles (BUILDER, CRITIC, SCRIBE, GATE-SMITH, DOC-KEEPER, WATCHDOG) from a shared file-based state, and the Hermes Agent bridge can act as the USER delegate. This gives identity-less coordination without requiring agent authentication.

v0.6's missing pieces:
1. **No skill tracking** — orchestrator doesn't know which agents are good at which tasks, so task assignment is first-come-first-served rather than merit-based.
2. **No reputation** — no consequence for agents that timeout, produce bad gates, or have their PRs rejected. Good agents and bad agents are treated identically.
3. **No routing** — no mechanism to *recommend* an agent for a task type; agents must self-assign entirely.
4. **No A2A protocol** — agents cannot submit tasks to each other in a structured way; all coordination is through the shared lock/task queue, which is file-level and not agent-to-agent.

---

## Decision

### Scope

v0.7 adds four new modules and eight new MCP tools on top of the existing v0.6 orchestrator. These are ADDITIVE — the v0.6 anonymous role system is unchanged.

### Modules

#### `src/core/skill-rotation.mjs` — SkillRotation

Persists a per-actor task-type histogram at `.hermes3d_orchestrator/skill_rotation.json`. Every `hermes_record_task` call increments the actor's count for that task type. `leastLoadedForType(type)` returns actors sorted by ascending count — the routing layer uses this for load-balancing.

Design choices:
- **File-based, not in-memory** — survives MCP server restarts (same reason as the lock manager).
- **Unbounded task types** — the standard set (`gate | lock | review | handoff | build | docs | test | infra`) is advisory; callers can use any string.
- **No cross-actor normalization** — counts are absolute; routing uses relative comparison within a candidate set, not global percentile.
- **Actor pruning** — if the roster exceeds 1000 actors, entries idle for > 24h are pruned to bound file size.

#### `src/core/reputation.mjs` — ReputationTracker

Persists per-actor rolling reputation at `.hermes3d_orchestrator/reputation.json`. Score starts at 1.0. Four outcomes: `merge (+1.0)`, `lgtm (+0.5)`, `timeout (-0.25)`, `reject (-1.0)`. Rolling window: last 30 events. Score is floor-clamped to 0.0.

Design choices:
- **Rolling window (30 events) not cumulative** — prevents early excellent performance from masking recent deterioration; prevents early failures from permanently marking a good agent.
- **Four outcomes chosen** — coarse enough to be unambiguous; fine enough to signal "LGTM is good but not as good as merge."
- **No decay function** — decay requires a time-based recalculation job. Rolling window achieves the same recency effect without a background process.
- **Score floor at 0.0** — negative scores don't add information and could create perverse incentives (an agent at -5 loses nothing from another reject).

#### `src/core/capability-dispatch.mjs` — CapabilityDispatch

Combines ReputationTracker and SkillRotation into a composite routing score:

```text
composite = reputation_score × 0.5
          + recency_bonus    × 0.3   (1.0 if active in last 10 min, else 0.5)
          - load_penalty     × 0.2   (this_actor_count / max_actor_count for type)
```

Exposed via `hermes_dispatch_recommend(task_type, candidates[])`. Returns `{ actor_id, score, reasoning }`. The recommendation is **advisory** — no hard lock is issued, agents remain free to self-assign. This preserves the spirit of anonymous coordination while adding a lightweight routing layer.

#### `src/core/a2a-stub.mjs` — A2AStub

Implements the [Google A2A](https://github.com/google/A2A) task lifecycle as file-persisted MCP-accessible state. Tasks live at `.hermes3d_orchestrator/a2a_tasks.json`.

State machine:
```text
submitted → working → completed
                    → failed
                    → input_required → working
          → canceled (from any non-terminal state)
```

This is called a "stub" because:
1. It does not orchestrate execution — that remains the agent's responsibility.
2. It does not implement HTTP transport — HermesProof is stdio JSON-RPC; bridging to HTTP is the gateway's job.
3. It provides the A2A TASK lifecycle primitives (create, get, update, list) via MCP tools, which is sufficient for inter-agent coordination within a single orchestrator session.

### New MCP Tools (8)

| Tool | Description |
|---|---|
| `hermes_list_agents` | List all known agents with reputation score, skill histogram, and optional dispatch ranking |
| `hermes_record_outcome` | Record merge/lgtm/timeout/reject outcome → updates rolling reputation |
| `hermes_record_task` | Record a task performed → updates skill histogram |
| `hermes_dispatch_recommend` | Get routing recommendation for a task_type from a candidate list |
| `hermes_a2a_create_task` | Create an A2A task (returns task_id) |
| `hermes_a2a_get_task` | Get A2A task state by ID |
| `hermes_a2a_update_task` | Transition A2A task status |
| `hermes_a2a_list_tasks` | List A2A tasks with optional filters |

Tool count: 42 MCP tools, confirmed from the live `tools/list` response on the v0.7 branch.

---

## Integration with Hermes Agent Bridge

Once PR #20 (anonymous orchestrator + Hermes Agent bridge) is merged:
- The Hermes Agent bridge calls `hermes_record_outcome("hermes-agent", outcome)` after each action.
- The bridge queries `hermes_dispatch_recommend` before delegating tasks to sub-providers (DeepSeek / MiniMax / SiliconFlow).
- The A2A task tools allow the bridge to submit review tasks to Codex and receive results without blocking.

---

## Alternatives Considered

**In-memory-only tracking** — rejected; doesn't survive MCP server restarts. File-based state is a HermesProof design invariant.

**ML-based reputation** — rejected; a rolling arithmetic score is sufficient for this use case, interpretable, and has no external dependency.

**Full A2A HTTP server** — rejected; HermesProof is a stdio MCP server. HTTP would require an additional port, process management, and security surface. MCP-over-stdio is sufficient for the current multi-agent coordination use case.

**CRDT-based score merging** — rejected; reputation is single-writer per actor (the orchestrator), so CRDT complexity is unnecessary.

**Post-quantum signing of outcomes** — rejected; Sigstore/cosign handles the artifact-level signing. Outcome entries are appended to the evidence ledger (hash-chained NDJSON) which already provides tamper-evidence without outcome-level signatures.

---

## Consequences

**Positive:**
- Task assignment is now merit-based rather than first-come-first-served.
- A2A protocol support enables the Hermes Agent bridge to delegate tasks to Codex without blocking.
- Reputation creates a lightweight accountability loop for agents in the anonymous system.
- Eight new tools increase the capability surface for CI gates and downstream tooling.

**Negative / Mitigations:**
- Three new state files (skill_rotation.json, reputation.json, a2a_tasks.json) added alongside existing orchestrator state. Bounded by pruning / 24h TTL.
- `hermes_list_agents` is O(n×m) over actors × candidates if `task_type` is provided. Bounded in practice (< 100 active agents in any realistic session).
- Dispatch is advisory, not enforced — agents can ignore recommendations. This is intentional (preserve anonymous coordination spirit).

---

## Future Work (v0.8+)

- Anonymous role promotion: an agent with reputation > 3.0 earns auto-approval for USER-scoped actions (reducing dependency on human presence).
- Peer reputation: agents rate each other's outputs (not just gate outcomes).
- A2A HTTP gateway adapter: thin HTTP layer wrapping the MCP A2A tools for external consumers.
- Capability profiles: structured agent manifests listing supported task types and resource limits.
