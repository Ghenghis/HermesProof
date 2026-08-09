# Codex Next Prompts — Hermes3D-7 GUI Wiring
> Historical Hermes3D GUI prompt pack. This is not the current Kilo/HermesProof ecosystem handoff. Use `docs/STALENESS_AUDIT_2026-07-05.md` plus the Kilo `TRUE_MAP.md` and `HANDOFF.md` for current work.

**Last updated:** 2026-05-04
**Branch:** `feat/hermes3d-7-complete-gui-repo-wiring`
**Base dir:** `G:\Github\Hermes3D\03_implementation\`
**Contract kit:** `G:\Github\Hermes3D\Hermes3D-GUI-Wiring-Contract-Kit\`

Give these prompts to Codex one batch at a time. Each prompt is self-contained.
Codex must keep the heartbeat alive: `hermes_heartbeat owner=codex-master taskId=H3D-HERMES3D7-GUI-WIRING-2026-05-04` every 5 minutes.

---

## PROMPT A — After Step 5 completes: Steps 6–7 (Dashboard + Autopilot)

```
You are continuing Hermes3D-7 GUI wiring on branch feat/hermes3d-7-complete-gui-repo-wiring.
Working dir: G:\Github\Hermes3D\03_implementation\
Steps 1-5 are complete. Execute Steps 6 and 7 from G:\Github\Hermes3D\Hermes3D-GUI-Wiring-Contract-Kit\07_HANDOFFS\CODEX_MASTER_EXECUTION.md exactly.

STEP 6 — Dashboard Live Wiring (ui/src/tabs/Dashboard.tsx):
1. Replace mock job queue with adapters.getJobs('running,queued') in useEffect. Fallback to MOCK_JOBS on error or when VITE_HERMES3D_ADAPTER=mock.
2. Add SSE hook: when VITE_HERMES3D_ADAPTER=live, open EventSource('/api/events/stream'). Append events to local array capped at 50. Render newest-first in Agent Activity panel.
3. Verify the existing adapters.getPrinters() call is present; add data_source chip showing 'live' vs 'mock'.
4. Remove the comment "// Phase 3.1 live mode".
Acceptance: mock mode = no runtime errors. TypeScript clean.

STEP 7 — Autopilot Tab (ui/src/tabs/Autopilot.tsx):
Three-panel vertical layout:
Panel 1 "READINESS CHECKS": adapters.getAutopilotReadiness() polled every 30s. 16 rows with exact names:
  1.Printer Connectivity 2.Slicer Availability 3.Agent Health 4.Safety Gate Status 5.Proof Gate Status
  6.Filament Profile Loaded 7.Bed Mesh Calibrated 8.Nozzle Temp Verified 9.Movement Lock State
  10.Dispatch Gate Open 11.Model LLM Available 12.ComfyUI Available 13.Evidence Ledger Reachable
  14.Operator Approval Pending 15.Voice Layer Ready 16.Learning Mode State
  READY=green badge, NEEDS SETUP=amber badge + "→ Fix" button linking to relevant tab.

Panel 2 "SAFE ACTIONS": 4 stacked buttons:
  - "Autopilot To Next Safe Gate" → POST /api/autopilot/next-gate. Disabled unless all 16 READY. Confirmation modal. Emit proof event autopilot.action.triggered.
  - "Write Agent Plan" → POST /api/autopilot/write-plan. Always enabled. Toast "Plan generation started". Emit autopilot.plan.written.
  - "Write Setup Report" → POST /api/autopilot/write-report. Always enabled. Toast "Report generation started". Emit autopilot.report.written.
  - "Create Dry-Run Pilot Job" → POST /api/jobs body={type:'pilot_calibration_cube',dry_run:true}. Navigate to jobs tab. Emit autopilot.dry_run.job.created.

Panel 3 "ACTIVE GUARDRAILS": adapters.getAutopilotGuardrails(). Each row: policy name, active/override badge, last modified timestamp.

Add emitProofEvent(type: string, payload: Record<string,unknown>): Promise<void> to AdapterAPI; mock logs to console.
Root element: data-testid="autopilot-root"
Acceptance: Three panels render. "Autopilot To Next Safe Gate" disabled when mock returns any NEEDS SETUP. TypeScript clean.

After both steps:
- Run: cd ui && npx tsc --noEmit
- Commit: git add ui/src/tabs/Dashboard.tsx ui/src/tabs/Autopilot.tsx ui/src/api/adapters.ts && git commit -m "feat(gui): Step 6-7 Dashboard live wiring + Autopilot tab"
- Keep heartbeat alive: use hermes_heartbeat owner=codex-master taskId=H3D-HERMES3D7-GUI-WIRING-2026-05-04
```

---

## PROMPT B — Steps 8–9 (Design + Jobs)

```
You are continuing Hermes3D-7 GUI wiring on branch feat/hermes3d-7-complete-gui-repo-wiring.
Working dir: G:\Github\Hermes3D\03_implementation\
Steps 1-7 are complete. Execute Steps 8 and 9 from CODEX_MASTER_EXECUTION.md exactly.

STEP 8 — Design Tab (ui/src/tabs/Design.tsx):
Two-column layout: form left (col-span-5), pipeline right (col-span-7).

Left "DESIGN INTAKE FORM" (id="design.intake"):
- Title: <input type="text" required placeholder="Design name" />
- Description: <textarea required placeholder="Design intent, constraints, notes" />
- Target Printer: <select required> from adapters.getPrinters() filtered to exclude locked printers. Default: first non-locked.
- "Start Design" button: disabled until all required fields non-empty. On click: POST /api/design/intake with {title, description, target_printer_id}. Emit design.intake.submitted.

Right "DESIGN TOOLCHAIN" (id="design.toolchain"):
- adapters.getDesignToolchainStatus() polled every 15s.
- Five stage rows connected by dashed line:
  1. Hermes Agent System — agent health badge from GET /api/hermes/agents/health
  2. Modeling LLM — model name + endpoint status from GET /api/plugins/local-modeling-llm/status
  3. CAD Workers — CadQuery + OpenSCAD worker status
  4. Slicer Worker — active slicer name and profile
  5. Safety Gate — gate state from GET /api/hermes/gates?scope=design
- Each row: stage name, status badge (idle/running/pass/fail), last run timestamp, "View Logs" button (modal with last 50 log lines from /api/plugins/{stage_id}/logs?limit=50).

Root: data-testid="design-root". Acceptance: form submit disabled when empty. Pipeline renders 5 stages. TypeScript clean.

STEP 9 — Jobs Tab (ui/src/tabs/Jobs.tsx):
Merges PrintQueue.tsx + PrinterControl.tsx. Two-column: job list left (col-span-5), detail right (col-span-7, hidden when nothing selected).

Left: Filter tabs [Queued|Running|Done|Failed|Cancelled] with count badges. Active: border-b-2 border-accent-blue. adapters.getJobs(activeFilter). Refresh every 10s for Queued+Running.
Job rows: job name, type badge, created timestamp (HH:mm:ss), printer name if applicable, status badge. Click row → sets selectedJobId.

Right (when selectedJobId !== null): adapters.getJobDetail(selectedJobId). Three sub-panels (vertical tabs):
  - "Workflow Steps": step name, status badge, start/end time, duration in seconds.
  - "Artifacts": file name, type badge, size, path, Download button. GET /api/jobs/:id/artifacts/:artifact_id/download. Emit jobs.artifact.downloaded.
  - "Events": chronological list. For running jobs, open SSE GET /api/jobs/:id/events and append in real time.
Cancel button top-right: only for queued/running jobs. Confirmation modal "Cancel job {name}?". adapters.cancelJob(id). Emit jobs.job.cancelled.

Proof events: jobs.job.selected, jobs.artifact.downloaded, jobs.job.cancelled.
Root: data-testid="jobs-root". Acceptance: filter switching updates list. Detail panel on row click. TypeScript clean.

Run: cd ui && npx tsc --noEmit
Commit: git add ui/src/tabs/Design.tsx ui/src/tabs/Jobs.tsx && git commit -m "feat(gui): Step 8-9 Design + Jobs tabs"
Keep heartbeat alive.
```

---

## PROMPT C — Steps 10–11 (Printers + Observe)

```
You are continuing Hermes3D-7 GUI wiring on branch feat/hermes3d-7-complete-gui-repo-wiring.
Steps 1-9 complete. Execute Steps 10 and 11.

STEP 10 — Printers Tab (ui/src/tabs/Printers.tsx):
Header: "Moonraker Fleet Inventory" <h2> + "Refresh All" button (adapters.getPrinters(), emit printers.status.refreshed per printer).
Four cards in 2×2 grid:

Card FLSUN S1 (ip: 192.168.0.12):
  - State badge: red LOCKED
  - Amber safety block: "Maintenance lock: do not test or move. Movement may damage the hotend."
  - data-testid="s1-safety-message" on the amber block
  - NO Test button — do not render one
  - adapters.getPrinterLockState('flsun-s1') for lock reason
  - Emit printers.lock.displayed on render

Card T1-A (ip: 192.168.0.10, adapter: moonraker):
  - State badge: green MOONRAKER
  - Moonraker URL shown
  - Test button: adapters.testPrinter('t1-a'). Success=green "OK" 3s. Fail=red "FAIL". Emit printers.test.run.

Card T1-B (ip: 192.168.0.11): same as T1-A with id t1-b.
Card V400 (ip: 192.168.0.34): same as T1-A with id v400.
Poll Moonraker cards every 30s. data-printer-id attribute on each card.
Root: data-testid="printers-root". Acceptance: S1 has NO Test button. T1-A/T1-B/V400 have Test buttons. TypeScript clean.

STEP 11 — Observe Tab truthful disabled state (ui/src/tabs/Observe.tsx):
On mount: GET /api/plugins/camera-observer/status via adapters.getCameraObserverStatus(): Promise<{status:string,reason:string}>. Mock returns {status:'READY',reason:'Plugin not activated'}.

If status !== 'ACTIVE': show full-height centered panel with:
  - Title: "Observe"
  - DISABLED badge (muted, rounded)
  - Reason text from API response
  - "Go to Plugins" button: sets activeTabId to 'plugins' via useStore
  Emit proof event observe.disabled_state.displayed with {reason, plugin_status}.

If status === 'ACTIVE': render placeholder "Camera feed active — wiring in Phase 6". Emit observe.unlocked.

Root: data-testid="observe-root". Acceptance: disabled state renders. "Go to Plugins" navigates to plugins tab. TypeScript clean.

Run: cd ui && npx tsc --noEmit
Commit: git add ui/src/tabs/Printers.tsx ui/src/tabs/Observe.tsx ui/src/api/adapters.ts && git commit -m "feat(gui): Step 10-11 Printers + Observe tabs"
Keep heartbeat alive.
```

---

## PROMPT D — Steps 12–13 (Voice + Learning)

```
You are continuing Hermes3D-7 GUI wiring on branch feat/hermes3d-7-complete-gui-repo-wiring.
Steps 1-11 complete. Execute Steps 12 and 13.

STEP 12 — Voice Tab (ui/src/tabs/Voice.tsx):
Single-column panel.
Header: "Hermes Voice Layer" (h2). Provider row: label "Provider:", value "Azure" (read-only unless azure-voice plugin ACTIVE + another provider available). Settings icon button (logs click for now).

8 agent rows from adapters.getVoiceAgents(). Exact agent names in order:
1.Factory Operator 2.Modeling Agent 3.Print Safety Agent 4.Mesh Go Agent 5.Mesh Repair Agent 6.Oliver QA Agent 7.Print Monitor Agent 8.Privacy Agent

Each row (data-testid="voice-agent-row" data-agent-id="{id}"):
- Agent name (read-only, w-48)
- Voice name: <input type="text"> editable, w-48
- Save button: adapters.saveVoiceAgent(agent.id, voiceName). Success: green checkmark 2s. Emit voice.agent.voice_saved.
- Preview button: adapters.previewVoice(agent.id, voiceName). Show amber "Playing..." while in flight. Emit voice.agent.preview.triggered.
- Safety Alert button: confirmation modal "Trigger safety alert voice test for {agentName}?". POST /api/voice/preview with {agent_id, voice_name, sample_text:'SAFETY ALERT: STOP ALL OPERATIONS'}. Emit voice.agent.safety_alert.triggered.

All 3 buttons disabled when azure-voice plugin status !== ACTIVE. title tooltip: "Azure Voice plugin must be ACTIVE to use voice features."

Root: data-testid="voice-root". Acceptance: 8 rows render. Buttons disabled in mock mode with tooltip. TypeScript clean.

STEP 13 — Learning Tab (ui/src/tabs/Learning.tsx):
Two-column: config left (col-span-5), reports right (col-span-7).

Left "IDLE LEARNING MODE" (id="learning.config"):
Subtitle: "idle-research-reporting". adapters.getLearningConfig(). Each field saves on blur via PUT /api/learning/config.
- Research Only Agents: read-only chips
- Cadence: <select> with options: idle | operator triggered
- Reports Directory: <input type="text">
- Next Topic: <input type="text">
- Agents: read-only chips
- Safety Scope: <input type="text">
- Scope: <input type="text">
Each editable field has Save button right-side. Emit learning.config.saved.

Right "RESEARCH REPORTS" (id="learning.reports"):
adapters.getLearningReports(). Rows: filename (format YYYY-MM-DDTHH-MM-SS_topic.md), file size KB, View button.
View: modal rendering markdown from GET /api/learning/reports/:filename. Emit learning.report.viewed.

Root: data-testid="learning-root". Acceptance: Both panels render. TypeScript clean.

Run: cd ui && npx tsc --noEmit
Commit: git add ui/src/tabs/Voice.tsx ui/src/tabs/Learning.tsx ui/src/api/adapters.ts && git commit -m "feat(gui): Step 12-13 Voice + Learning tabs"
Keep heartbeat alive.
```

---

## PROMPT E — Steps 14–17 (Artifacts + Approvals + Plugins + Roadmap)

```
You are continuing Hermes3D-7 GUI wiring on branch feat/hermes3d-7-complete-gui-repo-wiring.
Steps 1-13 complete. Execute Steps 14, 15, 16, 17.

STEP 14 — Artifacts Tab (ui/src/tabs/Artifacts.tsx):
Two-column: form left (col-span-5), list right (col-span-7).
Left "ATTACH VISUAL EVIDENCE" (id="artifacts.attach"):
Fields (all required unless noted): Job <select> from adapters.getJobs(), Evidence Type <select> [photo|screenshot|mesh|g-code|log|other], Agent <select> from adapters.getAgents(), Stage <input> hint [INTAKE|MODELING|SLICING|PRINT_APPROVAL|PRINT_RUN|COMPLETE], Gate <input>, Label <input>, File <input type="file" accept=".png,.jpg,.stl,.3mf,.gcode,.txt,.log,.md">, Notes <textarea optional>.
"Attach Evidence" button: disabled until all required filled. adapters.attachEvidence(form) → multipart POST /api/artifacts. Success: reset form, emit artifacts.evidence.attached.
Right "ARTIFACTS LIST" (id="artifacts.list"):
Subtitle "Models, evidence, G-code, and logs". adapters.getArtifacts(). Grouped by job name. Each: evidence type badge, job name (group header), file path, size, timestamp, View/Download button. Emit artifacts.artifact.viewed.
Root: data-testid="artifacts-root".

STEP 15 — Approvals Tab (ui/src/tabs/Approvals.tsx):
Two-section vertical: Pending top, History bottom.
Pending (id="approvals.pending"): Title "PENDING APPROVALS" + count badge. adapters.getPendingApprovals(). Refresh every 15s.
Each card (data-testid="approval-card" data-approval-id="{id}" data-approval-type="{type}"):
  - Badge: MODEL_APPROVAL=amber, PRINT_APPROVAL=cyan
  - Job/model name, requesting agent, requested-at timestamp, evidence link (navigate Artifacts filtered by job)
  - Approve: modal "Approve {type} for {name}?" + notes <textarea> + Confirm. adapters.approveApproval(id,notes). Emit approvals.approval.approved.
  - Reject: modal "Reject {type} for {name}?" + reason <input required> + Confirm. adapters.rejectApproval(id,reason). Emit approvals.approval.rejected.
History (id="approvals.history"): adapters.getApprovalHistory(). Each row: type badge, name, decision badge (APPROVED=green,REJECTED=red), decided-by, decided-at, evidence link. History is IMMUTABLE — no edit/delete buttons.
On mount emit approvals.pending.loaded with {pending_count}.
Root: data-testid="approvals-root".

STEP 16 — Plugins Tab (ui/src/tabs/Plugins.tsx):
Responsive grid (4 col lg, 3 md, 2 sm, 1 xs). adapters.getPlugins(). Exactly 20 cards in this order:
1.Moonraker ACTIVE 2.Autopilot Setup ACTIVE 3.Camera Observer READY 4.PrusaSlicer PLANNED 5.OrcaSlicer PLANNED 6.CadQuery PLANNED 7.OpenSCAD PLANNED 8.TRELLIS.2 PLANNED 9.Hunyuan3D-2.1 PLANNED 10.TripoSR PLANNED 11.Blender/Trimesh PLANNED 12.Azure Voice ACTIVE 13.MiniMax-MCP Vision ACTIVE 14.DeepSeek V4 READY 15.Visual Evidence ACTIVE 16.Local Modeling LLM PLANNED 17.FDM Monster PLANNED 18.Maintenance ACTIVE 19.Filament PLANNED 20.Evidence Ledger ACTIVE

Each card (data-testid="plugin-card" data-plugin-id="{id}" data-plugin-state="{state}"):
- Name (h3), state badge (ACTIVE=green,READY=amber,PLANNED=muted), description
- ACTIVE/READY: Settings + Logs buttons → modals (placeholder). Emit plugins.plugin.settings.opened / plugins.plugin.logs.opened.
- PLANNED: disabled "Not installed" label, no buttons.
- READY: Activate button → modal "Activate {name}?" → adapters.activatePlugin(id). Emit plugins.plugin.state.changed.
Root: data-testid="plugins-root".

STEP 17 — Roadmap Tab (ui/src/tabs/Roadmap.tsx):
Single-column. Title "Roadmap" <h1>. Subtitle "Daily-use completion path".
adapters.getRoadmapItems(). On mount emit roadmap.viewed with {done_count,in_progress_count,not_started_count}.
13 items (data-testid="roadmap-item" data-item-number="{n}"):
  Number (1-13), description, state badge (NOT STARTED=muted,IN PROGRESS=amber,DONE=green), nav link to relevant tab.
Exact descriptions + link targets from ROADMAP_CONTRACT.md Section 3 — render verbatim.
Checkboxes: data-testid="roadmap-checkbox-{n}" disabled attribute always set — read-only.
Root: data-testid="roadmap-root".

Run: cd ui && npx tsc --noEmit
Commit: git add ui/src/tabs/Artifacts.tsx ui/src/tabs/Approvals.tsx ui/src/tabs/Plugins.tsx ui/src/tabs/Roadmap.tsx ui/src/api/adapters.ts && git commit -m "feat(gui): Step 14-17 Artifacts + Approvals + Plugins + Roadmap"
Keep heartbeat alive.
```

---

## PROMPT F — Steps 18–20 (Gen3D replace + Settings replace + Agents wiring)

```
You are continuing Hermes3D-7 GUI wiring on branch feat/hermes3d-7-complete-gui-repo-wiring.
Steps 1-17 complete. Execute Steps 18, 19, 20.

STEP 18 — Replace Gen3D tab (ui/src/tabs/Gen3D.tsx):
Replace the existing mock component with three-column layout (col-span-3 / col-span-5 / col-span-4).

Left "Service Status" (id="gen3d.services.status"):
4 rows: ComfyUI (GET {COMFYUI_URL}/system_stats via adapters proxy), Workflows (count from GET /api/gen3d/workflows), Toolchain (active engine + health), Truth Gate (GET /api/truth-gate/gates).

Center "Image To Print Run" (id="gen3d.form") with sub-label "Creates evidence only" (amber badge, non-interactive):
- Job: <input type="text" required>
- Source Image: <input type="file" accept=".png,.jpg" required> + thumbnail preview on selection
- Object Intent: <textarea required>
- Engine: <select required> with 3 options in order: "TRELLIS.2 · primary" (value trellis2, default), "Hunyuan3D-2.1 · comparison" (value hunyuan3d21), "TripoSR · fast preview" (value triposr). Each disabled if plugin status != ACTIVE.
- Scale Estimate: <input type="number" optional placeholder="mm">
"Create Generation Evidence" CTA: disabled until Job+Image+Intent+Engine filled. POST /api/generation/run. Emit gen3d.generation.started.

Right "Printability Truth Gate" (id="gen3d.truth-gate"):
11 sequential gate rows. adapters.getTruthGateResults(jobId) (add to AdapterAPI). Gate names in order:
1.Mesh Watertight 2.Manifold Mesh 3.Fixed Normals 4.Repaired Holes 5.Real-World Scale 6.Minimum Wall Thickness 7.Bed-Size Fit 8.Overhang/Support Estimate 9.Slicer Dry-Run Success 10.Material/Printer Compatibility 11.Moonraker-Ready Upload Package
Status badges: pending=muted, pass=green, fail=red, skipped=border/muted. Failed gate → all subsequent = skipped.
Below right: Services Config rows with editable URL fields for Primary/Comparison/FastPreview/ComfyUI/TRELLIS.2.
Root: data-testid="gen3d-root".

STEP 19 — Replace Settings tab (ui/src/tabs/Settings.tsx):
Three contract panels (add to existing, make primary):

Panel 1 "APPEARANCE" (id="settings.appearance"):
Four theme cards 2×2 (data-testid="theme-card" data-theme="{theme}"): Midnight, Alloy, Ember, Forest.
Each: name, description (dark blue-black / dark steel-grey / warm orange-brown / dark green), 16×16 color swatch.
Selected: ring-2 ring-accent-blue. On select: adapters.saveSettings({theme}). Emit settings.theme.changed. Apply class to document.documentElement.

Panel 2 "RUNTIME PORTS" (id="settings.ports"):
8 rows (port name, current value input, default badge, Save button per row):
API(8000), Web(3000), Camera Proxy(8080), Telemetry(9090), Model LLM(11434), CadQuery Worker(8001), OpenSCAD Worker(8002), Slicer Worker(8003).
Save: adapters.saveSettings({ports:{[name]:value}}). Emit settings.port.saved. Toast "Port change requires application restart."

Panel 3 "PRINTER CONNECTIONS" (id="settings.printers"):
4 rows: FLSUN S1 (LOCKED badge, lock message, URL read-only, NO Test button), T1-A (URL input default http://192.168.0.10, Test button), T1-B (http://192.168.0.11), V400 (http://192.168.0.34).
Test: POST /api/printers/:id/test-connection. Success: green "Connected" 3s. Fail: red "Failed". Emit settings.printer.connection.tested.
URL save on blur. FLSUN S1 URL input must have readOnly attribute.
Root: data-testid="settings-root".

STEP 20 — Agents Tab partial wiring (ui/src/tabs/Agents.tsx):
Add two panels above existing content:

Panel 1 "WORK LOOP MODE" (id="agents.work-loop"):
Segmented button group: Manual | Semi-Auto | Autonomous.
On change: modal "Change work loop mode to {mode}?" → PUT /api/agents/work-loop/mode. Emit agents.work_loop.mode.changed.

Panel 2 "WORK QUEUE" (id="agents.work-queue"):
adapters.getAgentsWorkQueue() (add to AdapterAPI, mock returns 9 items with status:'queued').
9 items in order:
1.DesignSpec v0 2.Agentic Modeling Loop v0 3.Vision Agent Contract v0 4.Anonymous Mode v0 5.OS Command Center v0 6.AI 3D Generation Watch 7.Agentic Modeling Automation Watch 8.Autonomous CAD-CAM Watch 9.Tolerance Twin And Calibration Watch
Items ending in "v0": muted amber badge "v0", tooltip "Draft contract — not yet promoted to active".
Each row: number, name, status badge, assigned agent, last activity, View/Open button. Emit agents.work_item.opened.
Root: data-testid="agents-root".

Run: cd ui && npx tsc --noEmit && npm run build
Commit: git add ui/src/tabs/Gen3D.tsx ui/src/tabs/Settings.tsx ui/src/tabs/Agents.tsx ui/src/api/adapters.ts && git commit -m "feat(gui): Step 18-20 Gen3D + Settings + Agents wiring"
Keep heartbeat alive.
```

---

## PROMPT G — Backend: SQLite DB + FastAPI Routes + SSE (Extended Steps 15–18)

```
You are continuing Hermes3D-7 GUI wiring on branch feat/hermes3d-7-complete-gui-repo-wiring.
Frontend Steps 1-20 complete. Execute backend Extended Steps 15-18.

These steps are at the end of CODEX_MASTER_EXECUTION.md under "Extended Steps 15-25".

STEP 15 (Extended) — TypeScript types:
Read G:\Github\Hermes3D\Hermes3D-GUI-Wiring-Contract-Kit\04_BACKEND_WIRING\DATA_TYPES_AND_INTERFACES.md.
Create files in ui/src/types/ as listed in the step: module.ts, approval.ts, artifact.ts, plugin.ts, voice.ts, roadmap.ts, design.ts, generation.ts, learning.ts, job_extended.ts.
Export only the types listed. No any escapes. tsc --noEmit must pass.

STEP 16 (Extended) — SQLite DB:
a) Create src/hermes3d/db/schema.sql with all 12 tables: modules, bridge_tasks, jobs, job_steps, job_events, approvals, artifacts, plugins, voice_assignments, proof_events, roadmap_items, settings, truth_gate_results. Full DDL is in CODEX_MASTER_EXECUTION.md Step 16a.

b) Create src/hermes3d/db/init.py with init_db(), _seed_roadmap() (13 items), _seed_plugins() (20 plugins with exact states), _seed_voice_assignments() (8 assignments). Full code is in CODEX_MASTER_EXECUTION.md Step 16b.

c) Create src/hermes3d/db/load_modules.py. Reads G:\Github\Hermes3D\Hermes3D-GUI-Wiring-Contract-Kit\03_REPO_REGISTRY\external_repos_registry.yaml. Upserts all entries into modules + bridge_tasks tables. Full code is in CODEX_MASTER_EXECUTION.md Step 16c.

Acceptance: python -m hermes3d.db.init creates var/hermes3d.db. SELECT COUNT(*) FROM roadmap_items = 13. SELECT COUNT(*) FROM plugins = 20. SELECT COUNT(*) FROM voice_assignments = 8.

STEP 17 (Extended) — FastAPI Routes:
Create S1 safety helper src/hermes3d/api/safety.py:
  S1_PRINTER_ID = "flsun-s1"
  S1_LOCK_REASON = "Maintenance lock: do not test or move. Movement may damage the hotend."
  def check_s1_lock(printer_id): raises HTTPException 423 if printer_id == S1_PRINTER_ID.

Create all route files in src/hermes3d/api/routes/ as listed in CODEX_MASTER_EXECUTION.md Step 17:
  modules.py, jobs.py, approvals.py, artifacts.py, plugins.py, voice.py, learning.py, roadmap.py, design.py, generation.py, printers.py, settings.py, ports.py, autopilot.py, events.py

Each file: router = APIRouter() + DB connection from hermes3d.db + mock-compatible responses.
Register all in src/hermes3d/api/app.py.
Acceptance: uvicorn hermes3d.api.app:app starts clean. GET /api/plugins returns 20 plugins. GET /api/printers/flsun-s1/test returns 423.

STEP 18 (Extended) — SSE Event Stream:
a) Complete src/hermes3d/api/routes/events.py with broadcast() helper and _event_generator() with 15s keepalive. Full code in CODEX_MASTER_EXECUTION.md Step 18.

b) Create ui/src/api/event-stream.ts with createEventStream() that auto-reconnects after 3s on error. Full code in CODEX_MASTER_EXECUTION.md Step 18.

c) Add to Zustand store: eventStreamConnected: boolean (default false), setEventStreamConnected(connected: boolean): void.

d) Create ui/src/components/EventStreamBanner.tsx: amber banner "Live event stream disconnected. Reconnecting…" when eventStreamConnected===false AND adapter=live. data-testid="event-stream-banner". Mount in App.tsx above tab panel.

Commit: git add src/hermes3d/ ui/src/types/ ui/src/api/event-stream.ts ui/src/components/EventStreamBanner.tsx ui/src/store/ ui/src/App.tsx && git commit -m "feat(backend): Extended Steps 15-18 types + SQLite + FastAPI + SSE"
Keep heartbeat alive.
```

---

## PROMPT H — Test Suite + Proof Bundle + Security (Extended Steps 19–25)

```
You are continuing Hermes3D-7 GUI wiring on branch feat/hermes3d-7-complete-gui-repo-wiring.
Extended Steps 15-18 complete. Execute Extended Steps 19-25.

STEP 19 — Source OS live data:
Wire SourceOS.tsx to use adapters.getSourceOSModules() and adapters.getSourceOSModule(id) instead of static data files. ModuleList.tsx calls adapters.getModules(category). AppDetailPanel.tsx calls adapters.getModule(id). BridgeTasks.tsx calls adapters.getBridgeTasks(moduleId).
Implement Install button flow per CODEX_MASTER_EXECUTION.md Step 19:
1. Click Install → GET /api/modules/{id}/install-plan → modal with plan, Confirm/Cancel buttons.
2. Confirm → POST /api/modules/{id}/install → SSE progress stream /api/modules/{id}/install/stream.
3. install.complete event → close modal, refresh module, emit source_os.module.install.complete.
4. install.failed → error toast, emit source_os.module.install.failed.

STEP 20 — Add data-testid to ALL components:
Audit every file in ui/src/tabs/ and ui/src/components/. Add these attributes as specified:
- Top nav tabs: data-tab-id="{id}" on <button>
- Tab roots: data-testid="{id-with-dashes}-root" (e.g. source-os-root, gen3d-root)
- Module cards: data-testid="module-card" data-module-id="{id}"
- Printer cards: data-testid="printer-card" data-printer-id="{id}"
- Plugin cards: data-testid="plugin-card" data-plugin-id="{id}" data-plugin-state="{state}"
- Theme cards: data-testid="theme-card" data-theme="{theme}"
- Roadmap rows: data-testid="roadmap-item" data-item-number="{n}"
- Roadmap checkboxes: data-testid="roadmap-checkbox-{n}" disabled (always)
- Truth Gate rows: data-testid="truth-gate-row" data-gate-name="{name}"
- Approval cards: data-testid="approval-card" data-approval-id="{id}" data-approval-type="{type}"
- Artifact entries: data-testid="artifact-entry" data-artifact-id="{id}"
- Job rows: data-testid="job-row" data-job-id="{id}" data-job-status="{status}"
- Voice agent rows: data-testid="voice-agent-row" data-agent-id="{id}"
- Bridge task rows: data-testid="bridge-task-row" data-task-id="{id}"
- Install modals: data-testid="install-plan-modal" / "install-progress-modal"
- S1 safety block: data-testid="s1-safety-message"
- Readiness rows: data-testid="readiness-check-row" data-check-name="{name}"
- Source OS secondary nav: data-testid="secondary-nav-tab" data-section="{section}"
Verify: grep -r 'data-testid' ui/src/tabs/ | wc -l → must be >= 16.

STEP 21 — Run all 16 tab Playwright tests:
npx playwright test tests/e2e/
Fix every failure — no skips allowed unless CODEX_MASTER_EXECUTION.md marks it Phase 6+.
See Step 21 failure mode table for fixes. Re-run individual specs after each fix.
Acceptance: npx playwright test exits 0, 16 passed.

STEP 22 — Proof bundle:
Create scripts/generate_proof_bundle.py from CODEX_MASTER_EXECUTION.md Step 22.
Add afterAll screenshot hooks to every Playwright spec file:
  test.afterAll(async ({ page }) => { await page.screenshot({ path: `proof/screenshots/${TAB_ID}.png`, fullPage: true }); });
Run: python scripts/generate_proof_bundle.py → must exit 0.
39 baselines required (see CODEX_MASTER_EXECUTION.md Step 22 REQUIRED_BASELINES list).

STEP 23 — Security scans (zero violations required):
1. grep -rn "AZURE_SPEECH_KEY\|api_key\|secret\|password\|token" ui/src/ --include="*.ts" --include="*.tsx" | grep -v "// " | grep -v "test\|mock\|spec\|placeholder" → must return 0 matches
2. grep -rn "192.168.0.12" ui/src/ --include="*.tsx" --include="*.ts" → every match must be in read-only display context only (NO href/fetch/axios/new URL/EventSource)
3. grep -rn "flsun-s1\|flsun_s1" ui/src/ --include="*.tsx" --include="*.ts" | grep -v "lock\|safety\|display\|readonly\|data-printer-id" → must return 0 matches
Record scan output for the PR body.

STEP 24 — Final checklist: verify all items in CODEX_MASTER_EXECUTION.md Step 24.
STEP 25 — Create PR using git commit and gh pr create with the template from CODEX_MASTER_EXECUTION.md Step 25.
PR body must include: "Hermes evidence chain: PASS", proof bundle table, all 39 screenshot baselines, test results "16 passed 0 failed 0 skipped", security scan results.

Keep heartbeat alive throughout.
```

---

## PROMPT I — Commit the 58 Adapter Schemas (can run in parallel with Prompt G or H)

```
You are on branch feat/hermes3d-7-complete-gui-repo-wiring.
Working dir: G:\Github\Hermes3D\03_implementation\

There are 58 untracked JSON schema files in adapter_registry/schemas/ that need to be committed.
These are the complete adapter schemas for all 58 external modules.

First verify count: ls adapter_registry/schemas/*.schema.json | wc -l → must be 58.
Then validate one schema to confirm format: python -c "import json; json.load(open('adapter_registry/schemas/blender.schema.json'))" → must not raise.

Run: git add adapter_registry/schemas/
git commit -m "feat(schemas): add all 58 adapter registry schemas

Covers waves 1-4: slicers(11), modelers(13), print_farm(10), firmware(6),
three_d_generation(6), agents(7), library(1), materials(1), hardware(3),
utilities(1), research(1)
All schemas: additionalProperties:false, secret:true on credentials"
```

---

## PROMPT J — Agent System (Steps 26–35, separate PR)

```
You are continuing Hermes3D-7 on branch feat/hermes3d-7-complete-gui-repo-wiring (or a new branch feat/hermes3d-7-agent-system).
GUI wiring PR (Steps 1-25) is merged. Execute Steps 26-35 from CODEX_MASTER_EXECUTION.md.

These steps add the Hermes Agent autonomous system on top of the wired GUI.
Source of truth: all 4 HERMES_AGENT_* contracts + OBSERVE_CONTRACT.md (v2.0) in G:\Github\Hermes3D\Hermes3D-GUI-Wiring-Contract-Kit\04_BACKEND_WIRING\ and 02_UI_CONTRACTS\.

STEP 26: Create TypeScript types: ui/src/types/agent_core.ts, autonomous.ts, notification.ts, observe.ts.
STEP 27: Expand Agents.tsx to 3-panel (25/40/35). Create ConversationPanel.tsx, MessageBubble.tsx, PersonaSelector.tsx, AgentStatusBadge.tsx. All 8 agent personas. ACTION_PROPOSAL Confirm/Deny buttons.
STEP 28: Add AgentConfigSection.tsx to Settings tab. Fields: Model Name, API Base URL, API Key (masked), Temperature slider, Max Tokens, Safety Filter (locked ON), Active Personas checkboxes (Safety locked checked), Notification email, Test Connection.
STEP 29: Notification system — NotificationBell.tsx (bell + unread badge in nav), NotificationCenter.tsx (slide-out), NotificationRow.tsx, ToastNotification.tsx (HIGH=8s,CRITICAL=manual), ToastContainer.tsx (bottom-right, max 3), TabBadge.tsx (red count, auto-clears on tab enter). Zustand slice. EventSource /api/notifications/stream on mount.
STEP 30: While Away — WhileAwaySection.tsx (status+cadence+prerequisites btn+enable/disable), PrerequisiteChecklist.tsx (21 rows), ConfirmWhileAwayModal.tsx, ActionLedger.tsx. Add to Autopilot.tsx below Safe Actions. Add WhileAwayBanner.tsx to Dashboard.tsx above 3-col layout (only when status=active).
STEP 31: Full Observe.tsx — ObserveDisabledCard when plugin != active, CameraGrid.tsx (1x1/2x2/3x3), CameraCell.tsx (MJPEG + evidence capture + AnomalyOverlay), MJPEGStream.tsx, AnomalyOverlay.tsx, AgentWatchBadge.tsx, EvidenceCaptureButton.tsx. S1 cell: no capture, lock message. Agent Watch toggle in toolbar.
STEP 32: Create 4 FastAPI routes: agents.py (8 endpoints), autonomous.py (8 endpoints), notifications.py (7 endpoints), observe.py (7 endpoints, S1 capture = 423). Register in app.py.
STEP 33: Create src/hermes3d/services/autonomous_loop.py with AutonomousLoop class. Never touch S1. Log every action. Emit notification for every action and escalation.
STEP 34: Create 4 Playwright specs: agents_chat.spec.ts (15 tests), autonomous.spec.ts (10 tests), notifications.spec.ts (12 tests), observe_full.spec.ts (12 tests). Add afterAll screenshot hooks.
STEP 35: Create PR using template in CODEX_MASTER_EXECUTION.md Step 35.

Read the full step details from CODEX_MASTER_EXECUTION.md for exact specs.
Keep heartbeat alive. Contract source files are in G:\Github\Hermes3D\Hermes3D-GUI-Wiring-Contract-Kit\.
```

---

## State summary for Claude (not for Codex)

| Step range | Status | Who |
|---|---|---|
| Steps 1-4 (app shell, routes, types, AdapterAPI) | Done (Codex confirmed, uncommitted) | Codex |
| Step 5 (Source OS full) | In progress | Codex |
| Steps 6-7 (Dashboard + Autopilot) | Pending | → Prompt A |
| Steps 8-9 (Design + Jobs) | Pending | → Prompt B |
| Steps 10-11 (Printers + Observe) | Pending | → Prompt C |
| Steps 12-13 (Voice + Learning) | Pending | → Prompt D |
| Steps 14-17 (Artifacts + Approvals + Plugins + Roadmap) | Pending | → Prompt E |
| Steps 18-20 (Gen3D + Settings + Agents) | Pending | → Prompt F |
| Schema commit (58 files) | Pending (files exist) | → Prompt I (anytime) |
| Extended 15-18 (Types + SQLite + FastAPI + SSE) | Pending | → Prompt G |
| Extended 19-25 (live wiring + tests + proof + PR) | Pending | → Prompt H |
| Steps 26-35 (Agent system) | Pending (separate PR) | → Prompt J |
