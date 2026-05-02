# HermesProof Setup Audit

**Audit date:** 2026-05-02. **Branch:** `feat/hermesproof-spec-docs`. **Last shipped commit on `main`:** `c330814` (visual rebrand) + `fcaf73f` (auto-refreshed proof).

## 1. Repository identity

- **Repo URL:** https://github.com/Ghenghis/HermesProof
- **Local path:** `G:\Github\hermes3d-mcp-lock-orchestrator`
- **Package name:** `hermesproof@0.2.0` (private)
- **Bin:** `hermesproof` → `src/server.mjs`
- **License:** MIT (Ghenghis 2026)
- **Node engine:** `>=20.0.0`
- **Module type:** ESM (`"type": "module"`)

## 2. Source layout (verified)

```
src/server.mjs                 221 LOC  — MCP server entry, registers 15 tools
src/core/lock-manager.mjs      554 LOC  — locks, tasks, handoffs, heartbeat, recovery
src/core/gate-runner.mjs       208 LOC  — allowlisted command runner
src/core/fs-utils.mjs          144 LOC  — atomic JSON, NDJSON append, path validation, IDs
scripts/truth-gates.mjs                 — 9-gate harness, emits PROOF/latest.json + PROOF_E2E_REPORT.md
scripts/coordination-smoke-test.mjs     — 14-step e2e claim→lock→handoff→gate→release flow
scripts/hardening-smoke-test.mjs        — stale-lock + TTL + atomic acquisition
scripts/doctor.mjs                      — workspace diagnostics
scripts/init-project.mjs                — bootstrap state dir into target workspace
scripts/install-clients.mjs             — wires MCP into Claude Desktop / Code / Codex / Windsurf
scripts/print-configs.mjs               — config inspector
scripts/reset-demo-state.mjs            — wipe state dir (dev only)
scripts/sandbox-integration.mjs         — sandbox e2e for CI
```

## 3. MCP tool inventory (15)

```
claim_task          release_task         heartbeat
lock_files          release_files
request_handoff     approve_handoff
run_gate            list_gates
append_evidence
get_state           list_locks           recover_stale_locks
doctor              read_policy
```

All registered in `src/server.mjs:38–218` via legacy `server.tool()` form (Phase 1 will migrate to `server.registerTool` with annotations).

## 4. Truth gates (9 today, 10 after Phase 0)

| # | Gate ID | Type | Verifies |
|---|---|---|---|
| 1 | `source.integrity_manifest` | required | SHA-256 manifest of `src/` + `scripts/` |
| 2 | `deps.parity` | required | `package.json` declared deps == installed |
| 3 | `tests.unit` | required | `node --test` against both smoke suites |
| 4 | `server.stdio_handshake` | required | live `initialize` + `tools/list` returns 15 tools |
| 5 | `doctor.hermes3d` | required | `hermes_doctor` against workspace |
| 6 | `e2e.multi_agent_flow` | required | 14-step real-stdio probe |
| 7 | `workspace.integrity` | required | no probes leaked, no unexpected workspace edits |
| 8 | `clients.config_presence` | required | 4 client configs all wire `hermes3d-locks` |
| 9 | `clients.claude_code_live` | required | `claude mcp list` shows ✓ Connected |
| **10** | **`docs.master_prompt_deliverables_present`** | **required** | **all 10 master-prompt deliverables exist + non-empty** |

`--ci` skips local-only gates 5, 7, 8, 9 (no Hermes3D workspace, no client configs in container).

## 5. Persistence layout (state dir per workspace)

```
.hermes3d_orchestrator/
├── locks/<sha-id>/metadata.json    one dir per locked file (mkdir EEXIST = atomic)
├── tasks/<task-id>.json            active task records
├── handoffs/<id>.json              pending + decided handoff requests
├── evidence/ledger.ndjson          append-only attestation log
└── events.ndjson                   lock.acquired, handoff.decided, …
```

State-dir name configurable via `MCP_LOCK_STATE_DIR` (rejects slashes / `..`).

## 6. Proof artifacts

- `PROOF/latest.json` (~6.9 KB) — gates with durations, manifest hashes, tool call shapes, config snapshots
- `PROOF_E2E_REPORT.md` (~1.6 KB) — human-readable summary table
- `PROOF_LOCAL_TEST.md`, `PROOF_SANDBOX_TEST.md` — local + sandbox notes

**Gap (Phase 2):** `PROOF/latest.json` is hashed but **not cryptographically signed**. Sigstore `cosign sign-blob` + `actions/attest-build-provenance` will close this in Phase 2.

## 7. CI workflows

- `.github/workflows/truth-gates.yml` — push to `main`, PR, manual; runs `npm ci` + `truth-gates -- --ci`; on `main` push, refreshes `PROOF/latest.json` + `PROOF_E2E_REPORT.md` and commits with `[skip ci]`.
- `.github/workflows/pages.yml` — push to `main` on `site/**` / `docs/diagrams/**` / itself, or manual; assembles `_site/` from `site/*` + `docs/diagrams/*.svg`, deploys to GitHub Pages at https://ghenghis.github.io/HermesProof/.

**Gaps (Phase 1):**
- Action versions are `@v4` tags (force-push risk; March 2026 trivy/tj-actions/axios incidents).
- No top-level `permissions:` block (default token has overly broad scope).
- No `step-security/harden-runner` egress monitor.

## 8. Documentation suite (`docs/`, 11 markdown files + 7 SVGs)

```
ARCHITECTURE.md            (11 KB)  system design + tool reference
TOOL_REFERENCE.md          (3.5 KB) 15-tool API reference card
LOCK_PROTOCOL.md           (1.4 KB) lock acquisition semantics + TTL
INTEROP_WITH_OTHER_MCP.md  (8.8 KB) composition with other MCP servers
SECURITY_POLICY.md         (2.0 KB) threat model + invariants
MAINTENANCE.md             (6.0 KB) troubleshooting + state recovery
SETUP_CLAUDE_DESKTOP.md    (1.6 KB)
SETUP_CLAUDE_CODE.md       (1.3 KB)
SETUP_CODEX.md             (1.2 KB)
SETUP_WINDSURF.md          (1.7 KB)
SETUP_GENERIC_PROJECT.md   (4.0 KB)

docs/diagrams/
  hero.svg                       6,157 B  · 1200×360 · 13 SMIL animations
  pipeline-flow.svg             13,338 B  · 1200×520 · 18 SMIL animations
  truth-gates-animated.svg      13,372 B  · 1200×540 · 18 SMIL animations
  architecture.svg               8,507 B  · 1200×580 ·  7 SMIL animations
  lock-lifecycle.svg             7,623 B  · 1100×540 ·  5 SMIL animations
  multi-agent-flow.svg          10,356 B  · 1200×620 ·  3 SMIL animations
  mcp-composition.svg            6,859 B  · 1200×540 ·  6 SMIL animations
```

All SVGs have `role="img"` and `<title>` but no `<desc>` and no `prefers-reduced-motion` honoring → **WCAG 2.2 AA gap, fixed in Phase 1**.

## 9. Client integration examples (`examples/`)

```
claude_desktop_config.example.json    268 B  JSON template
codex_config.example.toml             457 B  TOML template
windsurf_mcp_config.example.json      268 B  JSON template
claude_code_add_command.ps1           260 B  PowerShell setup line
HERMES3D_UX_A_COORDINATION_TEST.md  2.0 KB   coordination scenario
```

**Phase 2 additions:** `examples/claude_code/{settings.hooks.json, skills/hermesproof/SKILL.md}`, `examples/cursor/.cursor/{mcp.json, rules/hermesproof.mdc}`, `examples/vscode/.vscode/mcp.json` + `copilot-instructions.snippet.md`.

## 10. AGENTS.md and policy

`AGENTS.md` (1.3 KB) contains the mandatory coordination rules echoed in this session: claim_task → lock_files → block-or-handoff → run_gate (allowlisted) → append_evidence → release. Owner-string format: `<role>-<id>`, lowercase + hyphen. Never edit locked files without ownership transfer; never bypass via parallel files.

## 11. Known gaps (closed by this plan)

| Gap | Severity | Closed in |
|---|---|---|
| 9 master-prompt §3 spec/handoff docs missing | High (contract violation) | **Phase 0** (this branch) |
| WCAG 2.2 AA: SVG `<desc>` + reduced-motion missing | Med (a11y) | Phase 1 |
| Stale README `MCP-2024-11-05` badge | Low (signal) | Phase 1 |
| MCP SDK `^1.19` (5 minors stale; 1.24.3 current) | Med (security + features) | Phase 1 |
| `owner` validator accepts whitespace/control chars | Med (spoofing surface) | Phase 1 |
| Evidence ledger NDJSON unchained | Med (integrity claim) | Phase 1 |
| Path-traversal not hardened in fs-utils | Med (PipeLab 82% MCP failure rate) | Phase 1 |
| Workflow actions unpinned (`@v4` tags) | Med (supply chain) | Phase 1 |
| `PROOF/latest.json` unsigned (despite name) | Med (claim-vs-reality) | Phase 2 |
| No Claude Code hook bundle | High (adoption blocker) | Phase 2 |

## 12. Lock-store workspace observation

The MCP lock server in this session reports `workspace_root = G:\Github\Hermes3D` (correct for coordinating Hermes3D edits, but mismatched for editing HermesProof itself). That is by design: HermesProof governs OTHER repos. When HermesProof edits HermesProof, run a **separate** server instance with `MCP_LOCK_WORKSPACE=G:\Github\hermes3d-mcp-lock-orchestrator` or skip locks (single-agent operation, like this branch). Documented for future operators.
