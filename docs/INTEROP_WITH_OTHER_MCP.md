# HermesProof — Interop with Other MCP Servers

<div align="center">
<img src="./diagrams/mcp-composition.svg" alt="HermesProof composes with filesystem MCP and Codex bridges as peer servers, all sharing the same workspace" width="100%"/>
</div>

HermesProof solves **one** problem well: keeping Claude, Codex, Windsurf, and review agents from clobbering each other on the same files. It is intentionally narrow.

You will usually want to run it **alongside** other MCP servers and bridges. This doc explains how it composes with each pattern you may have seen recommended, and what (if anything) was extracted into our codebase versus left external.

In v0.4, HermesProof also exposes a passive trigger bridge: state changes become durable JSON files under `.hermes3d_orchestrator/events/outbox/`. Other MCP servers, shell watchers, or CI jobs may observe those files and decide what to do. HermesProof itself does not call LLM APIs, send prompts into a chat session, or directly wake Claude/Codex/Windsurf.

## Recommended day-to-day client config

Every MCP-capable agent that touches the project should see these three classes of server:

1. **`hermes3d-locks`** — this project. Owns coordination state.
2. **A filesystem MCP** — gives agents read/write access to the workspace.
3. **A Codex bridge** — only if you want Claude → Codex hand-offs in the same session.
4. **An optional event watcher** — only if you want review packets, webhook posts, or external routing based on HermesProof events.

Everything below explains how each external piece fits with `hermes3d-locks` without weakening its safety guarantees.

---

## 0. Passive event watchers

**Pattern.** A separate process watches `.hermes3d_orchestrator/events/outbox/*.json` and reacts to events such as `task.released`, `task.blocked`, `handoff.created`, `gate.failed`, or `pr.opened`.

**How it composes with us.** The watcher is a consumer, not part of the lock protocol. It can print summaries, generate review packets, or POST JSON to an operator-owned webhook:

```powershell
node scripts\watch-events.mjs --workspace G:\Github\Hermes3D --poll 30
node scripts\watch-events.mjs --workspace G:\Github\Hermes3D --write-review-packets
$env:HERMESPROOF_WEBHOOK_URL="https://example.internal/hermesproof"
node scripts\watch-events.mjs --workspace G:\Github\Hermes3D --mark-handled
```

Consumers should call `hermes_mark_event_handled` only after durable downstream handling. That call renames the event from `outbox/` to `handled/` atomically. If two watchers race, one wins and the other should surface `event_already_handled`.

**Why it stays passive.** Direct chat wake-up requires product-specific APIs, user consent, credentials, and delivery guarantees outside the lock manager's scope. HermesProof provides the durable outbox and schema; bridge processes provide notification policy.

---

## 1. Shared filesystem (`@modelcontextprotocol/server-filesystem`)

**Pattern.** Both Claude Desktop and Codex point at the same workspace via the official filesystem MCP. They each "see" the files the other writes in real time.

**How it composes with us.** The filesystem MCP gives agents the *capability* to edit files; `hermes3d-locks` gives them the *permission* model on top. Agents must call `hermes_lock_files` before using the filesystem MCP to write. If an agent skips the lock call, the orchestrator cannot stop it — that is a process discipline problem solved by the agent rules in `AGENTS.md` and the Windsurf rule in `.windsurf/rules/`.

**Sample combined Claude Desktop config:**

```json
{
  "mcpServers": {
    "hermes3d-locks": {
      "command": "node",
      "args": ["G:\\Github\\Hermes3D\\tools\\hermes3d-mcp-lock-orchestrator\\src\\server.mjs"],
      "env": { "MCP_LOCK_WORKSPACE": "G:\\Github\\Hermes3D" }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "G:\\Github\\Hermes3D"]
    }
  }
}
```

**Why we did not absorb it.** The official filesystem server is well-maintained, audited, and has its own permission model (allowed roots, read-only mode, etc.). Forking it into our package would be duplication and a maintenance liability. We coexist with it cleanly.

---

## 2. Codex bridge — `openai/codex-plugin-cc`

**Pattern.** The official OpenAI plugin for Claude Code lets you invoke Codex from inside `claude` CLI sessions: adversarial review, hand-offs, deep refactors.

**How it composes with us.** Treat it as a **caller**, not a competitor. Inside Claude Code:

1. `hermes_claim_task` + `hermes_lock_files` for the files Claude will own.
2. Use `codex-plugin-cc` to send Codex a scoped task referencing files you have NOT locked (so Codex can lock them).
3. Codex performs its own `hermes_claim_task` + `hermes_lock_files` from its own session.
4. When you need to merge their work, do it through `hermes_request_handoff` rather than direct edit.

**Install (separate from this package):**

```powershell
claude mcp add codex-plugin-cc
```

**Why we did not absorb it.** It is OpenAI-published, lives under their org, and ships a Claude Code plugin format we don't want to vendor. We just need to coexist via shared state in the workspace.

---

## 3. Codex bridge — `cexll/codex-mcp-server`

**Pattern.** Community wrapper that exposes Codex CLI capabilities (`@` file refs, `codex-exec` sandbox) as MCP tools that Claude Desktop can call.

**How it composes with us.** Same model as `codex-plugin-cc`. Add it as a peer MCP server in Claude Desktop's config:

```json
{
  "mcpServers": {
    "hermes3d-locks": { "...": "..." },
    "filesystem":     { "...": "..." },
    "codex-cli":      { "command": "npx", "args": ["-y", "@cexll/codex-mcp-server"] }
  }
}
```

The same lock discipline applies: every Codex-driven edit must funnel through the orchestrator's claim/lock/release cycle, even when initiated by Claude calling Codex.

**Why we did not absorb it.** It's an out-of-tree project that may go stale or change. Tracking it inside our repo would couple our release cadence to theirs. Better to document the integration and let users pin a known-good version themselves.

---

## 4. Swarm orchestrator — `ruvnet/claude-flow`

**Pattern.** A higher-level "swarm" that orchestrates Claude + Codex + Gemini agents simultaneously. Bigger surface area than a lock manager.

**How it composes with us.** They solve different problems and stack cleanly:

| Concern                   | Claude Flow | This orchestrator        |
| ------------------------- | ----------- | ------------------------ |
| Spawning agents           | yes         | no                       |
| Routing prompts           | yes         | no                       |
| Monitoring agent health   | yes         | partial (heartbeat only) |
| File ownership / locks    | partial     | **primary purpose**      |
| Atomic transactions       | no          | yes                      |
| Handoff approval workflow | no          | yes                      |
| Path-escape protection    | unknown     | yes                      |
| Evidence ledger           | no          | yes (NDJSON)             |
| Allowlisted gate runner   | no          | yes                      |

If you adopt Claude Flow for spawning, run our orchestrator under it as the per-file coordination layer. The two are complementary, not redundant.

**Why we did not absorb it.** Different scope. We deliberately stay narrow so the audit story is simple: ~600 lines of locking logic + an explicit allowlist. Adding a swarm controller would explode the security surface.

---

## 5. Google Workspace bridge — `@google/mcp-server-workspace`

**Pattern.** Multiple agents read/write the same Google Docs/Drive folder so specs and code stay in sync across machines.

**How it composes with us.** Out of scope. This orchestrator governs **local file system** state; cloud documents are not lockable through us. If your team wants per-Doc serialization, that's a Google API problem, not an MCP-locks problem.

---

## What we extracted vs left external

| Concept                                | Source                                                    | Status                                                              |
| -------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| Atomic file locking via `mkdir` EEXIST | (our own)                                                 | shipped here                                                        |
| Handoff request → approval → transfer  | hinted at in `codex-plugin-cc` adversarial-review pattern | shipped here as `hermes_request_handoff` + `hermes_approve_handoff` |
| Evidence ledger                        | (our own)                                                 | shipped here as NDJSON                                              |
| Durable event outbox                   | (our own)                                                 | shipped here as passive `event_schema_version: 1` JSON files        |
| Chat-session wake-up                   | external bridges / product APIs                           | **not shipped**                                                     |
| Allowlisted gate runner                | (our own; not in any of the listed projects)              | shipped here                                                        |
| Filesystem read/write                  | `@modelcontextprotocol/server-filesystem`                 | **external — coexists**                                             |
| Codex CLI access from Claude           | `openai/codex-plugin-cc`, `cexll/codex-mcp-server`        | **external — coexists**                                             |
| Multi-agent spawning / routing         | `ruvnet/claude-flow`                                      | **external — runs above us**                                        |
| Cloud-document sync                    | `@google/mcp-server-workspace`                            | **out of scope**                                                    |

**Bottom line:** the listed projects don't replace anything we ship; they sit at higher layers (spawning, transport, file IO) where this orchestrator deliberately doesn't operate. Use them in combination.

## Validation checklist when running multiple servers

If you wire up several MCP servers in the same client config:

1. The clientInfo names should be distinct so logs are readable.
2. Make sure only `hermes3d-locks` governs the workspace state dir; do not point another server at the same `MCP_LOCK_STATE_DIR`.
3. Set `MCP_LOCK_WORKSPACE` (or `HERMES3D_WORKSPACE`) on the lock orchestrator only — other servers may use their own conventions for workspace.
4. Restart the MCP client after editing its config so all servers reload together.
5. After the client reloads, ask the agent to call `hermes_doctor` and confirm `ok: true`. If filesystem or Codex bridges block disk writes, the doctor will surface it.
6. If you run multiple event watchers, make sure each treats `event_already_handled` as a normal lost race, not as data loss.
