# Hermes3D Source Audit

**Audit type:** read-only. No edits made to `G:\Github\Hermes3D`.
**Audit date:** 2026-05-02.
**Scope:** establish what Hermes3D is so the HermesProof README and integration recipes can describe their relationship accurately.

---

## 1. Summary

Hermes3D is an agentic 3D-printing orchestration kit (`hermes3d` v5.0.0) for a 12-printer Klipper / Moonraker fleet. Python core (88%) + React 18 / Vite UI (8.5%). It produces HMAC-signed proof envelopes for every dispatch decision and ships its own `hermes3d-mcp` MCP server. HermesProof does **not** print, slice, or drive printers — it is the lock + coordination + attestation layer that lets Claude / Codex / Windsurf safely edit Hermes3D's source.

## 2. Top-level layout (one level deep)

```
00_overview/         contracts, master spec, ledger, manifest, gates
01_requirements/     product guides (AI programmer, agentic automation, brain layer, fleet)
02_architecture/     ARCHITECTURE.md, SECURITY, TROUBLESHOOTING, CHANGELOG, diagrams
03_implementation/   runnable codebase (Python core + React/TS UI)
04_testing/          pytest (unit/conformance/integration), acceptance, Playwright
05_truth_proof/      PROOF_PROTOCOL, conformance verifier, evidence schemas, proof bundles
06_release/          rollback runbook, release docs, cross-platform installer
agents/              machine-readable agent role manifests (12 YAML files + _schema.json)
scripts/             top-level entrypoints (preflight, wizard, build-bundle, hooks)
env/                 environment templates
var/                 runtime artifacts (gitignored: logs, preflight output, proof bundles)
```

## 3. UI tabs (`03_implementation/ui/src/tabs/`, 13 files)

| Tab | Purpose (one line) |
|---|---|
| `Dashboard.tsx` | KPI cards, fleet grid, pipeline preview, active agents, proof verification, Dimensional Truth Engine |
| `PrintQueue.tsx` | Job queue by priority, printer assignment suggestions, job inspector |
| `PrinterControl.tsx` | Printer selector, jog/temp, G-code console, emergency stop |
| `Fleet.tsx` | 12-printer status table, adapter health, IP/port/USB |
| `Agents.tsx` | Agent roster, live activity log, model/provider selector |
| `Workflows.tsx` | Active workflows, visual pipeline, 7-stage + 12-stage DTE templates |
| `Slicing.tsx` | File queue, slicer/profile per printer, slice output cards |
| `BlenderMCP.tsx` | Blender process status, MCP tool checklist, viewport screenshot, 3MF export |
| `Gen3D.tsx` | Prompt + reference image, provider, generated model cards |
| `DockedApps.tsx` | External GUI placeholders (Fluidd, Mainsail, OctoPrint, slicer, Blender) |
| `Proof.tsx` | Proof bundle matrix, gate verdicts, screenshots, commit/branch metadata |
| `Settings.tsx` | AI providers, Blender MCP, repo registry, slicers, adapters, OTA, safety, theme |
| `SystemLogs.tsx` | Unified logs, filters (level/source/search), export |

UI framework: React 18.3 + Tailwind CSS 3.4. Dark-first tokens at `03_implementation/ui/tailwind.config.ts` (bg `#0a0e1a`, surface `#0f1626`, surface2 `#141d33`, border `#1f2a44`, accents cyan/blue/green/amber/red). Inter (UI) + JetBrains Mono (code). Icons: `lucide-react`.

## 4. Python core subsystems

| Directory | Purpose |
|---|---|
| `core/agents/` | Orchestrator (12-node LangGraph), Executor-Critic-Optimizer loop, job queue |
| `core/orchestration/` | Print workflow engine, state graph, checkpointing |
| `core/validation/` | **Truth Gate** — 8-check printability validator |
| `core/proof/` | **Proof Envelope** — HMAC-SHA256 signed JSON |
| `core/farm/` | 12-printer fleet management |
| `core/printers/` | Klipper / Moonraker / OctoPrint clients |
| `core/slicer/` | Slicer process control, profile management |
| `core/modeling/` | Blender MCP server integration, 3MF |
| `core/visual/` | Screenshot + viewport rendering for proof |
| `core/notifications/` | Agent notifications, event broadcast |
| `core/memory/` | Agent memory / history |
| `core/intelligence/` | LLM provider abstraction (Ollama default) |
| `adapters/` | Hardware adapter registry |

## 5. Hermes3D MCP server (`03_implementation/api/mcp_server.py`)

Tool name: `hermes3d-mcp`. Exposes 16 tools (read-only or simulation-safe in default config):

| Tool | Inputs (high level) | Returns |
|---|---|---|
| `hermes3d.dispatch` | mesh extents, material, quality, strategy, allowed/excluded printers | `{selected_printer_id, rationale, candidates[]}` |
| `hermes3d.fleet_status` | optional paths/timeout | `{fleet[]}` |
| `hermes3d.queue_list` | optional state filter | `{jobs[]}` |
| `hermes3d.queue_enqueue` | mesh path, sha256, material, quality, layer, strategy, notes | `{job}` |
| `hermes3d.queue_cancel` | job_id | `{job}` |
| `hermes3d.spool_list` | optional printer/material filter | `{spools[]}` |
| `hermes3d.proof_verify` | proof_path, check_files? | `{verified, schema_version?, mesh_sha256?}` |
| `hermes3d.estimate_cost` | printer, material, filament_g, duration_h, prices | `{filament_cost, energy_cost, total, confidence}` |
| `hermes3d.list_materials` | — | `{materials[]}` |
| `hermes3d.truth_gate` | mesh_path, optional printer | `{passed, overall_status, duration_s, checks[]}` |
| `hermes3d.skill_list` | optional kind | `{skills[]}` |
| `hermes3d.skill_lookup` | kind, optional printer/material/quality/hour | `{matches[]}` |
| `hermes3d.predict_failure` | printer, material | `{failure_prob, confidence, sources[]}` |
| `hermes3d.analyze_mesh` | mesh_path | `{bbox, volume, overhangs, supports, walls, risks}` |
| `hermes3d.generate_profile` | printer, material, quality | `{profile_id, settings, ini_text, output_path}` |
| `hermes3d.parallel_plan` | parts[] | `{plan[]}` |

**HermesProof composition opportunity:** `hermes3d.truth_gate`, `hermes3d.proof_verify`, `hermes3d.analyze_mesh` are read-only and side-effect-free; HermesProof's gate-runner can wrap them as native gates when the workspace under coordination IS Hermes3D.

## 6. Proof Envelope schema (`core/proof/proof_envelope.py`)

JSON, HMAC-SHA256 signed. Canonical encoding: `json.dumps(doc, sort_keys=True, separators=(",", ":"))`, UTF-8, no trailing newline.

```json
{
  "schema_version": "1.0.0",
  "timestamp_unix": 0.0,
  "generator": {"name": "...", "version": "x.y.z", "signature": "..."},
  "mesh": {"path": "...", "sha256": "...", "vertex_count": 0, "face_count": 0,
           "bbox_mm": [[x,y,z],[x,y,z]], "extents_mm": [dx,dy,dz],
           "volume_mm3": 0.0, "is_watertight": false},
  "truth_gate_report": {"...": "TruthGateReport.to_dict()"},
  "slicer_report": null,
  "visual_evidence": [{"path": "...", "sha256": "...", "view_name": "..."}],
  "signature": {"algorithm": "HMAC-SHA256", "value": "<hex>"}
}
```

HMAC key env var: `HERMES3D_PROOF_KEY`. Default value warns and is non-secret.

**HermesProof note:** `PROOF/latest.json` should NOT impersonate this schema. We may *embed* a Hermes3D proof envelope as nested data when relevant, but HermesProof's own attestation is about coordination intent, not printability.

## 7. Truth Gate checks (`core/validation/truth_gate.py`)

Eight checks, each toggleable in `TruthGateConfig`:

1. `watertight` — no open edges
2. `manifold` — 2-manifold (winding-consistent)
3. `normals` — outward-facing
4. `bed_fit` — extents ≤ rectangular bed
5. `printer_fit` — kinematics-aware (delta xy-radius)
6. `minimum_volume` — ≥ `min_volume_mm3` (default 100)
7. `wall_thickness` — ≥ `min_wall_thickness_mm` (default 1.2)
8. `self_intersection` — broken faces ≤ `max_self_intersection_ratio` (default 0.001)

Returns `TruthGateReport` with `overall_status: PASS|FAIL|SKIP|ERROR` and `checks[]: CheckResult`.

## 8. Agent role manifests (`agents/*.yaml`, 12 files)

`architect`, `implementer`, `qa`, `repair`, `reviewer`, `releaser`, `auditor`, `preflight`, `branchguard`, `bundlesigner`, `orchestrator`, `multi_agent`. All validated by `agents/_schema.json`. Common shape: `role`, `description`, `model`, `inputs[]`, `action_sequence[]`, `outputs[]`, `gates[]`, `retry_policy`, `escalate_to`.

**HermesProof reuse:** the lock `owner` field can mirror these role names (`architect`, `implementer`, `qa`, …). Owner-string regex must allow lowercase + hyphen (matches `claude-lead`, `codex-impl-01`, plus all 12 agent role names).

## 9. Hermes3D-side references to HermesProof

Searched for `hermesproof`, `hermes-proof`, `lock-orchestrator`. **Zero matches.** Hermes3D does not yet know HermesProof exists. Integration is greenfield.

## 10. Files HermesProof must NOT edit

Per master prompt §1.2:

- Anything under `G:\Github\Hermes3D\` outside an explicit user-authorized scope.
- For destructive integration tests, use a sandbox at `G:\Github\hermesproof-readme-sandbox` or `G:\Github\hermes3d-mcp-test-sandbox` mimicking the layout `03_implementation/ui/src/tabs/` + `contracts/` + `docs/` + `README.md` + `.git/`.

## 11. Where HermesProof's diagrams refer to Hermes3D

The README states HermesProof is "for the Hermes3D workflow" and points users to bootstrap it via `npm run init-project -- --workspace G:\Github\Hermes3D`. The default `hermes3d_workspace` in `scripts/truth-gates.mjs` is hard-coded to `G:\\Github\\Hermes3D` on Windows. This is a convenience, not a coupling — HermesProof works against any project (see [`SETUP_GENERIC_PROJECT.md`](SETUP_GENERIC_PROJECT.md)).
