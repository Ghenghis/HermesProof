<!-- stream-state-snapshot:start -->
# STREAM/STATE.md — Live snapshot (Ghenghis/HermesProof)

## Last update
- **UTC:** 2026-05-18T17:36:04.980Z
- **By role:** WATCHDOG (auto-cron)

## Open PRs

| PR | Title | Branch | CI |
|---|---|---|---|
| #50 | fix(P1): hermes_list_agents shows roles + CapabilityDispatch DI | fix/p1-list-agents-and-dispatch-di | 🟢 2 ok / 0 skip |
| #49 | feat(P1): stdio round-trip smoke test for all v0.7 MCP tools | feat/p1-v07-stdio-roundtrip-tests | 🟢 3 ok / 0 skip |

## Health
- snapshot type: cron-auto
- gh availability: ok

_Refreshed by stream-state-snapshot at 2026-05-18T17:36:04.980Z._

<!-- stream-state-snapshot:end -->

# STREAM/STATE.md — Live snapshot (HermesProof side)

---

## Last update

- **UTC:** 2026-05-03T11:35:00Z
- **By role:** SCRIBE (Claude-side)
- **Reason:** Initial bootstrap of STREAM/ on HermesProof side

---

## Active correlations (cross-repo only)

| Correlation | Type | Status | Owner | Aged | Note |
|---|---|---|---|---|---|
| boot-stream-v1 | STATE_UPDATE | open | SCRIBE | 0min | mirror of Hermes3D #001 |
| hp-v0.5.1-perf | ENHANCEMENT_PROPOSAL | open | BUILDER (claude-impl-hp-perf) | 0min | HermesProof-only |

---

## Open PRs — HermesProof

None at this snapshot.

`main` HEAD: c2b15a5 — "ci: refresh truth-gate proof for 9102cb9 [skip ci]"

Local untracked: `scripts/license-and-deps-gates.mjs` (stub for license-coverage-gate work)
Local modified: `README.md`, `scripts/coordination-smoke-test.mjs`, `scripts/truth-gates.mjs`, `src/core/queue-manager.mjs`

---

## Open cross-repo PRs (from Hermes3D side)

See Hermes3D STATE.md. Mirrors only when a HermesProof contract changes.

---

## Locks held

- Last `hermes_doctor`: ok=true (Codex confirmed)
- Active locks: 0
- Active tasks: pending Codex's PR #38 audit close-out
- Evidence ledger length: see `node scripts/truth-gates.mjs` proof

---

## Queue depth — HermesProof-relevant

- **GATE_GAP_QUEUE (this side):** 4 items mirrored from Hermes3D queue (license, SBOM, dep-fresh, workflow-pinning)
- **ENHANCEMENT_QUEUE (this side):** 1 item (v0.5.1 perf companion)

---

## Health

- Truth-gate count on `main`: 17 (per v0.5.0 release; 6 new gates queued)
- Gitleaks scan: clean (per merged PRs #18, #19)
- HERMES3D_ENV_FILE resolution: deployed in #19, exists-aware fallback shipped

---

## What's running here

- **Claude:** parallel agents on license/dep gate impl + v0.5.1 perf
- **Codex:** awaiting STREAM ACK + may pick from HermesProof items if Hermes3D is saturated
