# README Coverage Matrix

Every claim made in [`README.md`](../README.md) is mapped here to (a) the README section asserting it, (b) the source file proving it, and (c) the truth gate that fails if the claim drifts. Used as the audit table during review waves.

## 1. Coverage rule

A README claim is **covered** when it has BOTH a source file in this repo AND a truth gate that exercises it. A claim that has only one is **partial**; a claim with neither is **unsupported** and MUST be removed.

Status legend: ✅ covered · ◐ partial · ❌ unsupported

## 2. Matrix

| README claim | README section | Source file | Truth gate(s) | Status |
|---|---|---|---|---|
| HermesProof exposes 15 MCP tools | Architecture | [src/server.mjs:38-218](../src/server.mjs) | `server.stdio_handshake` checks the exact 15-tool list | ✅ |
| Atomic-mkdir per-file locking with `EEXIST` | Pipeline + Coordination | [src/core/lock-manager.mjs](../src/core/lock-manager.mjs) `lockDirForPath` | `e2e.multi_agent_flow` step `lock.docs` | ✅ |
| 90-min default TTL with heartbeat extension | Pipeline | [src/core/lock-manager.mjs](../src/core/lock-manager.mjs) constants | `tests.unit` covers TTL math via hardening smoke | ✅ |
| Allowlisted gate runner | Pipeline + Architecture | [src/core/gate-runner.mjs](../src/core/gate-runner.mjs) `DEFAULT_GATES` | `e2e.multi_agent_flow` step `gate.unknown_rejected` | ✅ |
| Append-only NDJSON evidence ledger | Pipeline + Architecture | [src/core/fs-utils.mjs](../src/core/fs-utils.mjs) `appendNdjson` | `e2e.multi_agent_flow` step `evidence.appended` | ✅ |
| Workspace-escape protection on gate cwd | (implicit, Security) | [src/core/gate-runner.mjs](../src/core/gate-runner.mjs) | `e2e.multi_agent_flow` step `gate.escaped_cwd_rejected` | ✅ |
| Handoff cannot be silently re-captured by previous owner | Coordination | [src/core/lock-manager.mjs](../src/core/lock-manager.mjs) approve_handoff path | `e2e.multi_agent_flow` step `handoff.codex_cannot_silently_recapture` | ✅ |
| Stale-lock recovery is the only safe override | Coordination | [src/core/lock-manager.mjs](../src/core/lock-manager.mjs) `recoverStaleLocks` | `tests.unit` (hardening smoke) | ✅ |
| 9 truth gates run per push (10 after Phase 0; 11 after Phase 1) | Truth gates | [scripts/truth-gates.mjs](../scripts/truth-gates.mjs) | runs itself in CI via `truth-gates.yml` | ✅ |
| `PROOF/latest.json` machine-readable | Truth gates | [PROOF/latest.json](../PROOF/latest.json) | `truth-gates.mjs` writes it; CI uploads artifact | ✅ |
| `PROOF_E2E_REPORT.md` human-readable | Truth gates | [PROOF_E2E_REPORT.md](../PROOF_E2E_REPORT.md) | same | ✅ |
| 4 MCP clients supported (Claude Desktop, Code, Codex, Windsurf) | Quickstart + Client config | [scripts/install-clients.mjs](../scripts/install-clients.mjs) | `clients.config_presence` (local) | ✅ |
| `claude mcp list` reports `hermes3d-locks: ✓ Connected` | (implicit) | [examples/claude_code_add_command.ps1](../examples/claude_code_add_command.ps1) | `clients.claude_code_live` (local) | ✅ |
| Composes with filesystem MCP, codex bridges, claude-flow | Composition | [docs/INTEROP_WITH_OTHER_MCP.md](INTEROP_WITH_OTHER_MCP.md) | none (documentation only) | ◐ |
| Project-agnostic (works for any workspace) | Quickstart | [docs/SETUP_GENERIC_PROJECT.md](SETUP_GENERIC_PROJECT.md) | `tests.unit` smoke uses an arbitrary tmp workspace | ✅ |
| Hermes3D integration is read-only audit, no destructive tests | (implicit) | [docs/SECURITY_POLICY.md](SECURITY_POLICY.md) | `workspace.integrity` gate | ✅ |
| GitHub Actions workflow runs `truth-gates` on push + PR | Truth gates | [.github/workflows/truth-gates.yml](../.github/workflows/truth-gates.yml) | the workflow IS the gate | ✅ |
| GitHub Pages site auto-deploys from `site/` + diagrams | Hero badge | [.github/workflows/pages.yml](../.github/workflows/pages.yml) | the workflow IS the gate | ✅ |
| Inspired by Hermes Agent (Nous Research) | Credits | n/a (attribution claim) | none required (factual reference) | ◐ |
| HermesProof does NOT print, slice, or control printers | (implicit by absence) | n/a (negative claim) | source code review confirms zero printing code | ✅ |

Phase 1 will add:

| Claim | Source | Gate |
|---|---|---|
| 16 MCP tools (adds `hermes_verify_evidence`) | [src/server.mjs](../src/server.mjs) | updated `server.stdio_handshake` expectedTools list |
| Evidence ledger entries are hash-chained | [src/core/fs-utils.mjs](../src/core/fs-utils.mjs) | new gate `evidence.hash_chain_valid` |
| Owner field is regex-validated | [src/server.mjs](../src/server.mjs) | new test in `coordination-smoke-test.mjs` |
| Path traversal rejected | [src/core/fs-utils.mjs](../src/core/fs-utils.mjs) | new test in `hardening-smoke-test.mjs` |
| MCP spec `2025-11-25` (after SDK bump) | `package.json` | `server.stdio_handshake` reads `protocolVersion` |
| Tool annotations declare hints | [src/server.mjs](../src/server.mjs) | new gate `server.tool_annotations_present` (or extend handshake) |

Phase 2 will add:

| Claim | Source | Gate |
|---|---|---|
| `PROOF/latest.json` is Sigstore-signed | new step in [.github/workflows/truth-gates.yml](../.github/workflows/truth-gates.yml) | `cosign verify-blob` step in CI |
| Build provenance attestation published | same workflow | `gh attestation verify` step |
| Claude Code hook bundle ships | new in `examples/claude_code/` | wired into `clients.config_presence` (extended) |

## 3. Anti-coverage (claims we deliberately do NOT make)

| Anti-claim | Reason |
|---|---|
| "Cryptographically signed" | Until Phase 2 cosign lands, claim is unbacked |
| "AI-driven" or "agentic" capabilities of HermesProof itself | HermesProof governs agents, it is not one |
| "Tested against [model]" | We don't gate per-model behavior |
| Specific concurrency numbers (e.g. "100 agents") | Untested claim |
| "Production-ready" | Until SLSA L2 + signed proof, this is overstated |

## 4. Audit cadence

- **On every README PR:** review this matrix; fail PR if a removed claim leaves a gate orphaned, or if a new claim has no source / gate.
- **Quarterly (or after major dependency bumps):** re-validate every ✅ row by spot-checking the source file still defines the behavior.
- **Truth-gate run anomaly:** if `docs.master_prompt_deliverables_present` (gate 10) fails, this matrix is suspect — re-audit before re-asserting README claims.
