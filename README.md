<div align="center">

<img src="docs/diagrams/hero.svg" alt="HermesProof — verifiable multi-agent coordination over MCP" width="100%"/>

<br/>

[![Truth Gates](https://github.com/Ghenghis/HermesProof/actions/workflows/truth-gates.yml/badge.svg)](https://github.com/Ghenghis/HermesProof/actions/workflows/truth-gates.yml)
[![Pages](https://github.com/Ghenghis/HermesProof/actions/workflows/pages.yml/badge.svg)](https://ghenghis.github.io/HermesProof/)
[![MCP](https://img.shields.io/badge/MCP-2025--11--25-a855f7?style=flat-square)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-06b6d4?style=flat-square)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](./LICENSE)
[![Inspired by](https://img.shields.io/badge/inspired%20by-Hermes%20Agent-ec4899?style=flat-square)](https://hermes-agent.nousresearch.com/)

**🌐 Live site → [ghenghis.github.io/HermesProof](https://ghenghis.github.io/HermesProof/)**

**HermesProof** is the verifiable file-lock and proof layer that lets **Claude · Codex · Windsurf · Cascade** coordinate edits on the **same repository** — without clobbering each other.

[Quickstart](#-quickstart) · [Pipeline](#-end-to-end-pipeline) · [Truth Gates](#-truth-gates) · [Architecture](#-architecture) · [Coordination](#-multi-agent-coordination) · [Composition](#-composes-with-other-mcp-servers) · [Docs](#-documentation)

</div>

---

## ✦ End-to-end pipeline

Every edit flows through six gates, leaving an immutable trail behind.

<div align="center">
<img src="docs/diagrams/pipeline-flow.svg" alt="End-to-end pipeline: intent → claim → work → handoff → verify → attest" width="100%"/>
</div>

```text
01 INTENT     agent decides "I want to edit X"
02 CLAIM      claim_task + lock_files (atomic mkdir EEXIST, 90-min TTL)
03 WORK       edit owned files, heartbeat to extend TTL — others see "blocked"
04 HANDOFF    request_handoff → approve_handoff → ownership transferred
05 VERIFY     run_gate (allowlisted: git-status, diff-check, npm-test, audit, …)
06 ATTEST     append_evidence + release_files — append-only NDJSON ledger
```

Every push to `main` re-proves the entire chain through 12 truth gates, signs `PROOF/latest.json` with Sigstore (keyless OIDC), publishes a build-provenance attestation, and commits the refreshed proof bundle back to the repo automatically.

---

## ✦ Truth gates

The proof harness — `npm run truth-gates` — runs twelve independent verifications in sequence, capturing structured evidence at every step.

<div align="center">
<img src="docs/diagrams/truth-gates-animated.svg" alt="Truth-gate pipeline running twelve gates sequentially" width="100%"/>
</div>

| #   | Gate                                      | What it proves                                                                       |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| 01  | `source.integrity_manifest`               | SHA-256 manifest of `src/` + `scripts/` — tampering surfaces as hash drift           |
| 02  | `deps.parity`                             | `package.json` declared deps match the installed ones in `node_modules/`             |
| 03  | `tests.unit`                              | All 12 unit tests pass via direct `node --test` (npm pipe-routing bypassed)          |
| 04  | `server.stdio_handshake`                  | Real `node src/server.mjs` boots, completes MCP `initialize`, returns 16 tools       |
| 05  | `doctor.hermes3d`                         | `hermes_doctor` returns `ok: true` against the live workspace                        |
| 06  | `e2e.multi_agent_flow`                    | 14-step real stdio probe: claim → lock → block → handoff → gate → release            |
| 07  | `workspace.integrity`                     | No probe files leaked, no unexpected tracked changes in the workspace                |
| 08  | `clients.config_presence`                 | Claude Desktop, Claude Code, Codex, Windsurf all have `hermes3d-locks` wired         |
| 09  | `clients.claude_code_live`                | `claude mcp list` reports `hermes3d-locks: ✓ Connected` (round-trip live)            |
| 10  | `server.tool_description_hygiene`         | Tool descriptions free of prompt-injection markers (OWASP MCP tool poisoning)        |
| 11  | `evidence.hash_chain_valid`               | Round-trips append + verify, including detection of mid-chain tamper at right index  |
| 12  | `docs.master_prompt_deliverables_present` | All 10 master-prompt design / handoff documents exist, non-empty, with H1 headings   |

Outputs:

- `PROOF/latest.json` — machine-readable evidence (gate-by-gate JSON, manifest hashes, config snapshots)
- `PROOF/latest.json.cosign.bundle` — Sigstore keyless signature published to Rekor on every `main` push
- `PROOF_E2E_REPORT.md` — human-readable summary table at the repo root
- GitHub Actions artifact `proof-<sha>` — 90-day retention
- GitHub native build-provenance attestation — verifiable with `gh attestation verify PROOF/latest.json --repo Ghenghis/HermesProof`

> Run locally: `npm run truth-gates` · Run CI-only subset: `npm run truth-gates -- --ci` · Read latest: [`PROOF_E2E_REPORT.md`](./PROOF_E2E_REPORT.md)

---

## ✦ Architecture

Single stdio process per workspace, four MCP clients, two persistence surfaces.

<div align="center">
<img src="docs/diagrams/architecture.svg" alt="HermesProof system architecture: clients connect via stdio JSON-RPC to one MCP server, which writes to the workspace state directory and runs allowlisted gates" width="100%"/>
</div>

The server exposes **16 MCP tools** for coordination, gates, and diagnostics:

```text
CLAIM           claim_task          release_task
LOCK            lock_files          release_files       heartbeat
HANDOFF         request_handoff     approve_handoff
GATE            run_gate            list_gates
EVIDENCE        append_evidence     verify_evidence
DIAGNOSTICS     get_state           list_locks          recover_stale_locks
                doctor              read_policy
```

Each tool ships with MCP `2025-11-25` annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) so clients can render approval prompts that match the actual blast radius — read-only listing tools auto-allow, destructive recovery tools always confirm.

Evidence is hash-chained: every entry binds to the previous via `prev_hash` + canonical-JSON `entry_hash` (sha256), so any after-the-fact rewrite is detected by `hermes_verify_evidence`. State lives in `<workspace>/.hermes3d_orchestrator/`:

```text
.hermes3d_orchestrator/
├── locks/              one directory per locked file (mkdir EEXIST = atomic acquire)
│   └── <hash>/metadata.json
├── tasks/              active task records
├── handoffs/           pending + decided handoff requests
├── evidence/
│   └── ledger.ndjson   append-only attestation log
└── events.ndjson       append-only event stream (lock.acquired, handoff.decided, …)
```

---

## ✦ Multi-agent coordination

Claude leads with docs and contracts. Codex implements code. Reviewers audit. HermesProof keeps them out of each other's way.

<div align="center">
<img src="docs/diagrams/multi-agent-flow.svg" alt="Sequence diagram of Claude lead, Codex implementer, Claude reviewer, and HermesProof server coordinating an edit with handoff" width="100%"/>
</div>

### Per-file lock lifecycle

<div align="center">
<img src="docs/diagrams/lock-lifecycle.svg" alt="Lock lifecycle states: unlocked, held by A, handoff pending, held by B" width="100%"/>
</div>

The state machine is intentionally minimal:

- **unlocked** → no entry under `locks/`
- **held by owner A** → `locks/<hash>/metadata.json` exists; only A can release; heartbeat extends TTL
- **handoff pending** → `handoffs/<id>.json` exists; A still owns the lock
- **held by owner B** → after A approves; same metadata file, role updated to `handoff_receiver`
- **stale recovery** → after TTL expiry, any agent can call `recover_stale_locks` (the only safe override path)

---

## ✦ Composes with other MCP servers

HermesProof is intentionally narrow: it is the **governance layer**. It coexists with — never competes with — filesystem, transport, and bridge MCPs.

<div align="center">
<img src="docs/diagrams/mcp-composition.svg" alt="HermesProof composes with filesystem MCP and Codex bridges as peer servers, all sharing the same workspace" width="100%"/>
</div>

| Concern                                            | Server                                                                                                                                        | Status                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Per-file ownership / locking / handoffs / evidence | **HermesProof** (this repo)                                                                                                                   | shipped here          |
| Read / write / list files                          | [`@modelcontextprotocol/server-filesystem`](https://github.com/modelcontextprotocol/servers)                                                  | external — coexists   |
| Claude → Codex bridge                              | [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) · [`cexll/codex-mcp-server`](https://github.com/cexll/codex-mcp-server) | external — coexists   |
| Multi-agent spawning / routing                     | [`ruvnet/claude-flow`](https://github.com/ruvnet/claude-flow)                                                                                 | external — runs above |

See [`docs/INTEROP_WITH_OTHER_MCP.md`](./docs/INTEROP_WITH_OTHER_MCP.md) for full composition recipes.

---

## ✦ Quickstart

```powershell
# 1. Clone and install
git clone https://github.com/Ghenghis/HermesProof.git
cd HermesProof
npm install

# 2. Verify the package
npm run truth-gates                                 # 9/9 gates pass against your local machine
npm test                                            # 12 unit tests
npm run doctor -- --workspace G:\Github\Hermes3D    # non-destructive readiness probe

# 3. Bootstrap the target workspace
npm run init-project -- --workspace G:\Github\Hermes3D

# 4. Wire it into every MCP client (with backups)
npm run install-clients -- --workspace G:\Github\Hermes3D

# 5. Confirm it's live
claude mcp list                                     # expect "hermes3d-locks: ✓ Connected"
```

After step 4, restart Claude Desktop and Codex; refresh MCP servers in Cascade. Tell any agent:

```text
Use hermes_doctor and hermes_read_policy. Confirm workspace_root.
Then claim_task + lock_files before editing anything.
```

For projects other than Hermes3D, just point `--workspace` somewhere else — HermesProof is project-agnostic.

---

## ✦ MCP client configuration

Four clients are supported; `npm run install-clients` writes all of them with timestamped backups. Manual JSON for reference:

<details>
<summary><b>Claude Desktop</b> · <code>%APPDATA%\Claude\claude_desktop_config.json</code></summary>

```json
{
  "mcpServers": {
    "hermes3d-locks": {
      "command": "node",
      "args": ["G:\\Github\\HermesProof\\src\\server.mjs"],
      "env": { "MCP_LOCK_WORKSPACE": "G:\\Github\\Hermes3D" }
    }
  }
}
```
</details>

<details>
<summary><b>Claude Code</b> · CLI</summary>

```powershell
claude mcp add --transport stdio hermes3d-locks --scope user `
  --env MCP_LOCK_WORKSPACE="G:\Github\Hermes3D" `
  -- node "G:\Github\HermesProof\src\server.mjs"
```
</details>

<details>
<summary><b>Codex</b> · <code>~/.codex/config.toml</code></summary>

```toml
[mcp_servers.hermes3d-locks]
command = "node"
args = ["G:\\Github\\HermesProof\\src\\server.mjs"]
env = { MCP_LOCK_WORKSPACE = "G:\\Github\\Hermes3D" }
enabled = true
startup_timeout_sec = 10
tool_timeout_sec = 60
# Keep serialized for lock correctness; do not enable parallel tool calls.
```
</details>

<details>
<summary><b>Windsurf · Cascade</b> · <code>~/.codeium/windsurf/mcp_config.json</code></summary>

```json
{
  "mcpServers": {
    "hermes3d-locks": {
      "command": "node",
      "args": ["G:\\Github\\HermesProof\\src\\server.mjs"],
      "env": { "MCP_LOCK_WORKSPACE": "G:\\Github\\Hermes3D" }
    }
  }
}
```
</details>

---

## ✦ Environment

| Variable               | Default                  | Purpose                                                            |
| ---------------------- | ------------------------ | ------------------------------------------------------------------ |
| `MCP_LOCK_WORKSPACE`   | `cwd()`                  | Absolute path of the workspace HermesProof governs                 |
| `HERMES3D_WORKSPACE`   | —                        | Legacy alias for `MCP_LOCK_WORKSPACE` (still honored)              |
| `MCP_LOCK_STATE_DIR`   | `.hermes3d_orchestrator` | Name of the state dir inside the workspace; rejects slashes / `..` |
| `MCP_LOCK_SERVER_NAME` | `hermes3d-locks`         | Name surfaced to MCP clients (only used by `print-configs`)        |

---

## ✦ Documentation

- **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** — full system deep-dive with all diagrams
- **[`docs/LOCK_PROTOCOL.md`](./docs/LOCK_PROTOCOL.md)** — exactly when and how locks are acquired and released
- **[`docs/TOOL_REFERENCE.md`](./docs/TOOL_REFERENCE.md)** — every MCP tool, with example arguments and responses
- **[`docs/SECURITY_POLICY.md`](./docs/SECURITY_POLICY.md)** — what the server will and will not do, threat model, allowlist
- **[`docs/INTEROP_WITH_OTHER_MCP.md`](./docs/INTEROP_WITH_OTHER_MCP.md)** — composing with filesystem MCP, Codex bridges, claude-flow
- **[`docs/MAINTENANCE.md`](./docs/MAINTENANCE.md)** — repair scripts, debugging recipes, release checklist
- **[`docs/SETUP_CLAUDE_DESKTOP.md`](./docs/SETUP_CLAUDE_DESKTOP.md)** · **[`docs/SETUP_CLAUDE_CODE.md`](./docs/SETUP_CLAUDE_CODE.md)** · **[`docs/SETUP_CODEX.md`](./docs/SETUP_CODEX.md)** · **[`docs/SETUP_WINDSURF.md`](./docs/SETUP_WINDSURF.md)**
- **[`docs/SETUP_GENERIC_PROJECT.md`](./docs/SETUP_GENERIC_PROJECT.md)** — install into any repo (not just Hermes3D)
- **[`AGENTS.md`](./AGENTS.md)** — mandatory rules for any agent operating against this server
- **[`PROOF_E2E_REPORT.md`](./PROOF_E2E_REPORT.md)** — latest auto-generated proof report

---

## ✦ Inspiration & credits

HermesProof carries the [Hermes Agent](https://hermes-agent.nousresearch.com/) lineage from [Nous Research](https://nousresearch.com/) — the same emphasis on **verifiable, agentic capability** with an immutable trail of evidence.

Where Nous's [`hermes-agent`](https://github.com/nousresearch/hermes-agent) reasons and acts, HermesProof **governs and attests**: it is the layer that lets multiple Hermes-class agents cooperate on a real codebase without stepping on each other.

Built for the [Hermes3D](https://github.com/Ghenghis/Hermes3D) workflow; project-agnostic by design.

---

<div align="center">

`hermes3d-locks` is the deployed MCP server name (already wired into client configs).
**HermesProof** is the project, the harness, and the proof bundle.

</div>
