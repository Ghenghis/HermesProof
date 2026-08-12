# ADR-016 — Hermes Agent as the Anonymous USER

- **Status:** Accepted (2026-05-03)
- **Authors:** Claude (architect)
- **Supersedes:** none
- **Superseded by:** none

## Context

HermesProof orchestrates a multi-agent loop where Claude, Codex, and other
clients (KiloCode, Cursor, Windsurf, VSCode+Copilot) build, audit, and
ship code. Several actions in that loop require USER (human) approval:

- merging a PR
- cutting a release branch
- granting a destructive operation (force-push, branch delete, secret rotation)
- closing a BLOCKED escalation in the STREAM/ handoff loop
- approving an enhancement that crosses a scope boundary

When the human is away (asleep, in a meeting, on vacation), these actions
either **stall the loop** (PRs sit unreviewed, BLOCKED escalations pile up)
or get **bypassed unsafely** (someone configures auto-merge and accepts
the risk surface).

We need a mechanism that lets the loop continue forward-progress on
explicitly-pre-authorized scope while preserving the human's ability to
override any decision when they return.

## Decision

Introduce **anonymous role rotation** plus a **Hermes-Agent-as-USER bridge**:

1. **Anonymous roles** (BUILDER, CRITIC, SCRIBE, GATE-SMITH, DOC-KEEPER,
   WATCHDOG) — claimed by any client at message-write time, not at session
   start. Roles are 30-min TTL claims, renewable.
2. **USER role** is reserved. It cannot be self-claimed; it is granted
   via `grantUserSession()` calls from one of three sources:
   - `granted_by: "human"` — real user CLI/UI grants directly
   - `granted_by: "hermes-agent"` — bridge grants after reasoning (this ADR)
   - `granted_by: "ci"` — automation (e.g. workflow-pinning auto-merge after deps verify)
3. **Hermes Agent Bridge** — connects HermesProof to a Hermes Agent
   reasoning loop. The agent runs against a configured project-goals
   document and reasons about every USER-scope decision before granting.

### Provider routing for the Hermes Agent

Failover order (configurable):
1. **DeepSeek v4** (`DEEPSEEK_API_KEY`) — primary
2. **MiniMax highspeed 2.1-2.7** (`MINIMAX_API_KEY`) — fallback
3. **SiliconFlow** (`SILICONFLOW_API_KEY`) — tertiary
4. **LM Studio** (local, no key) — last-resort offline

Each provider is OpenAI-compatible chat-completions. The bridge cascades
on failure (HTTP error, timeout, malformed JSON). All four failures →
verdict defaults to "defer to human".

### Authorization model

A USER session has:
- `session_id` — opaque caller-chosen string ≥8 chars
- `granted_by` — `"human" | "hermes-agent" | "ci"`
- `scope` — capability whitelist (array of action names) OR null = unbounded
- `ttl_ms` — default 8h, max 48h
- `hash` — SHA-256 over (granted_by + session_id + issued_at), redacted from public state reads

Calling `checkUserAuthorization(actionName)`:
- No active session → `allowed: false`
- Active but expired → lazy-clear, `allowed: false`
- Active, scope is null → `allowed: true`
- Active, scope set, action in scope → `allowed: true`
- Active, scope set, action not in scope → `allowed: false`

The hash field is never exposed to public callers. It exists for evidence
ledger correlation.

### Bridge decision flow

When asked to grant or resolve:

1. Run health probe against each provider in failover order; first OK wins
2. POST `{system: <stable system prompt>, user: <task payload as JSON>}`
3. Expect `{verdict, rationale, scope_recommendation?}` JSON response
4. Strip markdown fences if present (some providers wrap)
5. On success → grant session (or post resolution); on failure → defer

The system prompt embeds the project-goals string and instructs the agent
to respond approve/decline/defer with a short rationale. Temperature 0.1
for determinism.

### MCP tools added

- `hermes_anonymous_claim` — claim a non-USER role
- `hermes_anonymous_release` — release a role
- `hermes_anonymous_state` — read role + session state (hash redacted)
- `hermes_user_grant_session` — direct grant (human/ci)
- `hermes_user_revoke_session` — revoke active session
- `hermes_user_check_authorization` — check action against active scope
- `hermes_agent_health` — probe DeepSeek/MiniMax/SiliconFlow/LM-Studio
- `hermes_agent_request_user_session` — bridge requests grant
- `hermes_agent_resolve_blocked` — bridge resolves a STREAM BLOCKED escalation
- `hermes_agent_revoke_session` — bridge surrenders authority

### Activation

The bridge is **disabled by default** (`HERMES_AGENT_ENABLED` not set).

To enable:
```bash
export HERMES_AGENT_ENABLED=1
export HERMES_AGENT_PROJECT_GOALS="<paragraph describing the project>"
export HERMES_AGENT_SCOPE="merge_pr,close_blocked,grant_minor_enhancement"
export DEEPSEEK_API_KEY=<read from G:\private\.env>
export MINIMAX_API_KEY=<read from G:\private\.env>
export SILICONFLOW_API_KEY=<read from G:\private\.env>
```

API keys MUST come from `G:\private\.env` (the user's secret store, per
`reference_secret_storage.md`) — never inlined in repo files. The hardened
`.gitleaks.toml` blocks any commit with these patterns.

## Consequences

### Positive

- Loop forward-progress survives the human's absence
- Decisions are bounded (capability scope + TTL)
- Decisions are evidenced (hash + rationale + provider+model in ledger)
- Multiple provider backends → no single-vendor outage halts the loop
- Cleanly disabled when not needed (default)

### Negative

- Reasoning quality bounded by chosen model — bad model → bad delegate
- Network calls add latency to the loop (mitigated by 60s overall timeout)
- API costs (mitigated: bridge is opt-in; user only enables for trusted projects)
- Adds 10 MCP tools to the surface (validators must cover them)

### Risks

- A poisoned project-goals document could manipulate the agent into
  approving unsafe scope. Mitigation: project-goals is loaded ONCE at
  bridge construction; rotation requires HermesProof restart.
- A leaked `DEEPSEEK_API_KEY` etc. would let an attacker exhaust the
  user's quota. Mitigation: hardened gitleaks pack scans for these
  patterns; keys live in `G:\private\.env` outside any repo.
- Agent JSON-injection: a malicious `correlation` or `summary` could
  contain prompt-injection. Mitigation: payloads are `JSON.stringify`'d
  before sending; the system prompt is fixed; eventual injection-scanner
  gate (separate ADR) further hardens this.

## Alternatives considered

1. **No bridge — human always required** — current state, cause of overnight stalls
2. **Statically-scoped auto-approve rules** — brittle; can't reason about novel situations
3. **Single-provider bridge (just LM Studio)** — fragile to local outages and incompatible with the user's preference for DeepSeek + MiniMax
4. **Public Anthropic / OpenAI models** — user explicitly chose DeepSeek + MiniMax + SiliconFlow + LM Studio; respected

## Implementation status

- [x] `src/core/anonymous-orchestrator.mjs` (12 unit tests, all green)
- [x] `src/core/hermes-agent-bridge.mjs` (provider failover, health probe)
- [x] 10 MCP tools wired in `src/server.mjs`
- [x] Smoke test `scripts/anonymous-orchestrator-smoke-test.mjs` (15/15 green)
- [ ] CHANGELOG.md entry
- [ ] PR opened on `main`
- [ ] Truth-gates regenerated to include the new tool surface
- [ ] STREAM/ updated with bridge enable instructions for the user
