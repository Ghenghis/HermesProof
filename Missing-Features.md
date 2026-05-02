# Missing Features

**Companion to [FINAL_EVIDENCE_REPORT.md](FINAL_EVIDENCE_REPORT.md).** Catalogues every capability researched during the v0.3.0 cycle that did NOT ship, why, and what conditions would justify revisiting. Three buckets:

1. **Deferred** — useful, not yet shipped, likely to revisit
2. **Carry-forward** — known small follow-ups from shipped work
3. **Researched and rejected** — actively decided against, with rationale

Anything not on this list is either shipped (see [FINAL_EVIDENCE_REPORT.md §3](FINAL_EVIDENCE_REPORT.md)) or out of scope entirely (e.g. anything that prints, slices, or controls printers — that's [Hermes3D](https://github.com/Ghenghis/Hermes3D)).

---

## 1. Deferred

### 1.1 API provider integration (`v0.4.0` candidate)

User has paid MiniMax high-speed (≈ 15k requests / 5h, $80 budget) plus access to many model providers. Three forks were discussed:

| Option | Scope | Effort | Status |
|---|---|---|---|
| A — passthrough | Document env-var shape (`MINIMAX_API_KEY`, `ANTHROPIC_API_KEY`, …) + `.env.example` + `install-clients` template population. HermesProof itself does not call providers. | ~1 h | **Deferred** |
| B — provider tool | New tool `hermes_invoke_provider(provider, model, prompt, ...)`; routes calls through HermesProof, logs hash-chained evidence (token counts, NOT key/prompt body), enforces rate budget, masks keys. New gate `model_budget.within_limits`. | ~6–10 h | **Deferred** |
| C — autopilot agent | HermesProof becomes a self-driving runtime: picks tasks off queue, calls models, edits code, gates, commits. v1.0 product line. | ~30–50 h | **Deferred** |

**Why deferred:** Claude Code (already wired via [`examples/claude_code/settings.hooks.json`](examples/claude_code/settings.hooks.json)) provides autopilot UX today — HermesProof stays the gate, Claude Code stays the runtime. Adding B+C inside HermesProof bloats scope past "coordination + proof layer."

**Revisit when:**
- Need to enforce a 15k/5h MiniMax budget across multiple parallel sessions (Option B becomes high value)
- Want fully hands-free Hermes3D iteration with no editor open (Option C)
- A second provider (other than the user's editor's default) becomes a primary code-edit consumer

**Anonymous-mode policy** (still applies if/when B or C lands):
- HermesProof never logs API keys
- Key is masked in evidence ledger and `PROOF/latest.json`
- `User-Agent: hermesproof/<version>` (generic, not user-fingerprinting)
- No user-identifying telemetry added to outbound calls beyond what providers strictly require

### 1.2 VHS terminal demo

Replace static screenshots / ASCII pipeline in README with a deterministic `vhs` recording (`tape/quickstart.tape` → `docs/demos/quickstart.gif`, < 1 MB), refreshed via `charmbracelet/vhs-action` in CI.

**Why deferred:** the existing 7 SMIL-animated SVGs already cover the "first-screen moving thing" requirement. Adds CI complexity (Linux-only renderer) and a second motion source.

**Revisit when:** authoring a launch post / HN submission where a terminal recording is the canonical demo medium.

### 1.3 Theme-aware light/dark SVG variants

Duplicate the 3 most-prominent SVGs (`hero`, `pipeline-flow`, `architecture`) as `*-light.svg` palette flips; wrap in `<picture><source media="(prefers-color-scheme: light)">…</picture>` in README.

**Why deferred:** dark-only renders fine on both GitHub themes (the deep-navy canvas works on white). Doubles SVG maintenance cost. WCAG 2.2 contrast is met against both backgrounds.

**Revisit when:** light-mode users complain about contrast on a specific diagram (none have).

### 1.4 Lighthouse CI gate in `pages.yml`

Add `treosh/lighthouse-ci-action` post-deploy step; fail PR if a11y < 95 or perf < 90.

**Why deferred:** the static site is hand-tuned (no JS deps, no remote assets); the per-PR feedback loop has marginal ROI for a 4-page demo. Worth it once `site/` grows.

**Revisit when:** site grows past 5 pages or starts sourcing from a doc framework (Astro Starlight etc.).

### 1.5 Fencing tokens in `lock-manager.mjs`

Per-Kleppmann monotonic counter at `.hermes3d_orchestrator/fence.json`, stamped into lock metadata + every evidence entry. Closes the zombie-write hole where a delayed/paused owner could write after its TTL elapsed.

**Why deferred:** HermesProof is single-server-per-workspace. The race only matters for genuinely distributed coordination, which isn't the current model. The 90-min TTL + heartbeat already covers the realistic failure modes.

**Revisit when:** anyone proposes running multiple HermesProof instances against a shared workspace (e.g., over NFS or with multiple host machines coordinating).

### 1.6 Tighten `cosign verify-blob` step from `continue-on-error`

[`.github/workflows/truth-gates.yml`](.github/workflows/truth-gates.yml) currently has the verify step as `continue-on-error: true` to avoid red-CI on first-run OIDC trust setup. The first push to `main` (`8d07c04`) confirmed the trust path works. The flag can now be removed.

**Why deferred:** trivial (single line edit) but holds value as a safety net during identity-policy changes.

**Revisit:** any next workflow PR. Drop `continue-on-error` and treat verify failure as fail-closed.

### 1.7 Redraw `truth-gates-animated.svg` from 3×3 to 4×3 / 3×4

The visual still shows 9 cells from when there were 9 gates; aria-label and `<desc>` now correctly say 12 but the visual cells are stale. Redrawing to 12 cells (likely 4×3) preserves layout and matches reality.

**Why deferred:** the diagram is decorative; alt-text is correct (a11y holds). Visual redraw is hand SVG work, ~30–60 min.

**Revisit when:** a 13th truth gate is added — redraw to 4×3 or 4×4 in the same PR.

---

## 2. Carry-forward hardening (small adds, no architectural change)

### 2.1 OpenSSF Scorecard

`ossf/scorecard-action` runs daily; publishes a score badge. Free for public repos.

**Effort:** S. **Value:** baseline supply-chain hygiene signal, easy to track over time.

### 2.2 CodeQL

GitHub's static analysis. Free for public repos. Catches injection, deserialization, common JS footguns.

**Effort:** S. **Value:** another lens on the 1k-LOC server source; complements the existing `server.tool_description_hygiene` gate.

### 2.3 Stryker.js mutation testing

Nightly mutation score against the smoke tests. Confirms tests would actually catch regressions.

**Effort:** M. **Value:** confidence in the 12-test suite. Worth ≥ 75 % mutation-score threshold.

### 2.4 fast-check property tests for `lock-manager` state machine

Random-state property tests (e.g. "claim → lock → release leaves zero locks for any owner permutation"). Complements the existing example-based tests.

**Effort:** M. **Value:** edge-case coverage in the lock state machine — the most safety-critical surface.

### 2.5 `dependency-review-action` + `dependabot.yml`

PR-time dep diff + automated bumps. 2-dep tree means dependabot churn is minimal.

**Effort:** S. **Value:** keeps `@modelcontextprotocol/sdk` and `zod` patched.

### 2.6 SECURITY.md at repo root

Currently `docs/SECURITY_POLICY.md` exists. GitHub's UI surfaces a top-level `SECURITY.md` automatically; either move or symlink.

**Effort:** S. **Value:** triage path for vulnerability reports.

---

## 3. Researched and explicitly rejected

These were investigated during the 2026-enhancement research wave (10 parallel agents) and deliberately not adopted. Listed with the rationale so future contributors don't re-litigate.

| Item | Reason rejected |
|---|---|
| **CRDT collaborative editing** (Yjs / Loro / Automerge) | Silent convergence is incompatible with truth-gate review; HermesProof's value is gated, auditable, sequential edits with attestation. Even for `docs/*.md`, a future Mergiraf integration gives 80 % of the benefit without a runtime CRDT. |
| **Per-line / AST-node locks via tree-sitter** | Brittle range-tracking through edits (offsets shift, nodes split); per-language grammars; high adoption cost for a small payoff when files are usually < 2k LOC. |
| **Migration to embedded etcd / Consul / SQLite** | JSON-on-disk is a feature, not a debt — preserves git-diffable evidence and air-gap operation. Lose more than gain. If cross-machine ever matters, prefer a tiny SQLite WAL over etcd. |
| **Redlock** | Single-host orchestrator; multi-Redis quorum is irrelevant and Kleppmann's safety critique still stands without fencing. |
| **Post-quantum signatures** (ML-DSA / SLH-DSA, FIPS 204/205) | Sigstore / cosign / GitHub Artifact Attestations all on ECDSA-P256 in 2026; rolling our own = ecosystem isolation. Revisit when the upstream Sigstore stack moves. |
| **TEE attestation** (AMD SEV-SNP / Intel TDX / NVIDIA CC) | Overkill for a Node CLI emitting JSON; relevant only for confidential AI inference, which is not what HermesProof does. |
| **C2PA Content Credentials for code** | Wrong domain (media provenance), wrong shape for source artifacts. |
| **W3C VC / DID agent identity** | Fulcio's OIDC-bound certificate already gives time-bound verifiable agent identity within the GitHub trust boundary. VCs become useful only across organizational boundaries. |
| **Vector-store shared scratchpad** | Hype-trap for code-edit coordination. The append-only NDJSON evidence ledger already serves the role and is grep-able / git-diffable. |
| **Phoenix / LangSmith / Langfuse / Helicone export** | Out of scope for a small local stdio coordinator. NDJSON ledger is Loki-compatible if anyone wants to ship logs onward. |
| **Token-cost observability** | HermesProof never sees model tokens — that's the IDE/runtime's job. Becomes relevant only if Option B (provider tool) ships. |
| **Replit Agent / Devin / Lovable / v0 integration** | Closed platforms with no public MCP config files. No actionable surface. Document as "not addressable today." |
| **OpenSSF Allstar** | Org-policy bot; branch protection rules already cover this for a single-repo project. |
| **Jazzer.js fuzzing** | Zod already validates inputs at the MCP boundary; low marginal ROI for a 16-tool surface. |
| **Bencher.dev / hyperfine** | Lock acquisition is sub-millisecond on local FS; perf gating would be theatre. |
| **Renovate / Semgrep / Snyk / Socket.dev** | Dependabot + CodeQL (carry-forward §2.1, §2.2) already cover this surface for free. |
| **Mass diagram migration to D2 / Mermaid / Excalidraw** | Hand-authored SMIL gives motion + brand fit; D2 / Mermaid / Excalidraw don't animate and don't match the visual identity. Revisit only if motion is dropped as a design rule. |
| **Astro Starlight / Docusaurus migration** | `site/index.html` static site is sufficient at current docs volume. Migrate when versioned docs become required. |
| **WebContainer / StackBlitz in-browser MCP demo** | High-leverage *if* shipped, but the 7-SVG + Pages site already conveys "what does this do." Defer until a user actually asks. |

---

## 4. Out of scope (HermesProof will never do these)

For absolute clarity:

- Print, slice, or control 3D printers (that's Hermes3D)
- Generate 3D models or call generative-3D providers (Hermes3D's `Gen3D` tab)
- Manage filament inventory / spool tracking (Hermes3D)
- Drive Klipper / Moonraker / OctoPrint endpoints (Hermes3D)
- Execute arbitrary shell — only the allowlisted gate runner

If a feature request implies any of the above, it belongs in [Hermes3D](https://github.com/Ghenghis/Hermes3D), not here.

---

## How to revisit an item

1. Open an issue referencing the section above (e.g. "MissingFeatures §1.1 — implement Option B").
2. Pick a feature branch `feat/<scope>-<n>` per master prompt §1.3.
3. If touching coordination protocol, propose evidence-schema changes in [docs/README_COVERAGE_MATRIX.md](docs/README_COVERAGE_MATRIX.md) FIRST.
4. Land via PR + truth-gates green; auto-merge.
