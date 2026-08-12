# Documentation Drift Audit — HermesProof v0.7

**Audit date:** 2026-05-03
**Repo:** `hermes3d-mcp-lock-orchestrator`
**Branch:** `main` @ `41258ef`
**Scope:** documentation accuracy only (README, ADRs, ARCHITECTURE, MAINTENANCE, TOOL_REFERENCE, diagrams, AUTO_RECONNECT, policies, other markdown). Production code quality, security, and tests are owned by other audit lanes.

---

## Summary

The numeric claim that **disagrees most** across the documentation set is the gate count. README, ARCHITECTURE.md, MAINTENANCE.md, and `truth-gates-animated.svg` all advertise **26** truth gates, but the live harness emits **29** distinct gate IDs (24 core + 3 added later: `sbom.cyclonedx_generated`, `secrets.rotation_evidence_present`, `security.mcp_scan_pass`). The README's gate-by-gate table only enumerates 26 rows, so three real gates are entirely undocumented.

Tool-count claims of **42 MCP tools** are correct against `tools/list` and consistent across README, ADR-019, ARCHITECTURE.md, MAINTENANCE.md, TOOL_REFERENCE.md prose, and the `architecture.svg`/`hero.svg`/`truth-gates-animated.svg` text labels. However, `TOOL_REFERENCE.md`'s group table still lists only 24 v0.4 tools and contains only 18 detail sections — the v0.6 anonymous, v0.7 A2A, USER SESSION, and AGENT tool groups are missing entirely. The `expectedTools` array in `scripts/truth-gates.mjs` (line 271) also only enumerates 24 tools, so the `server.stdio_handshake` gate would never flag a tool name being **removed** from the v0.6/v0.7 surface.

`architecture.svg` advertises `JSON-RPC · MCP 2024-11-05` (line 73) while every other doc states the spec as `2025-11-25`. `FINAL_EVIDENCE_REPORT.md` is the most stale: `16 tools, 12 gates, 7 SVGs, 9 default gates`. ADR-019's three-new-state-files and weighting formulas match the code exactly.

### Numeric-claims table

| Claim | Authoritative source | Matching docs | Diverging docs |
|---|---|---|---|
| Tool count = 42 | live `tools/list` (42 names); `expectedTools` array enumerates only 24 | README.md L58/L102, ADR-019 L91, ARCHITECTURE.md L17/L199, MAINTENANCE.md L7, TOOL_REFERENCE.md L3 (prose), `architecture.svg` L3/L82, `hero.svg` L3/L83, `truth-gates-animated.svg` L93, PROOF/latest.json | TOOL_REFERENCE.md group table (24), TOOL_REFERENCE.md detail sections (18), `scripts/truth-gates.mjs:271` `expectedTools` array (24), FINAL_EVIDENCE_REPORT.md (16), HERMES3D_SOURCE_AUDIT.md (16), HERMESPROOF_SETUP_AUDIT.md (15), README_MASTER_SPEC.md (15) |
| Gate count = 29 | `node scripts/truth-gates.mjs --ci` emits 29 unique gate IDs (25 core IDs run + 4 skipped local) → unique IDs = 29 | none — all docs say 26 | README.md L41/L47/L50/L246 (26), ARCHITECTURE.md L105/L108/L132/L207 (26), MAINTENANCE.md L4/L9 (twenty-six), `truth-gates-animated.svg` L1 (26), `hero.svg` L3/L76 (26), FINAL_EVIDENCE_REPORT.md L89 (12), MULTI_AGENT_LOOP_ROADMAP.md L26 (12) |
| MCP spec = 2025-11-25 | `package.json` `@modelcontextprotocol/sdk@^1.24.0`; `src/server.mjs` annotations comment line 125 | README.md L124, ADR-019, ARCHITECTURE.md L11/L16, FINAL_EVIDENCE_REPORT.md L14 (prose only) | `architecture.svg:73` (`MCP 2024-11-05`), README_MASTER_SPEC.md L42 (says it's stale), HERMESPROOF_SETUP_AUDIT.md L144 (says it's stale) |
| New state files added by v0.7 = 3 | `skill_rotation.json`, `reputation.json`, `a2a_tasks.json` (anonymous_orchestrator.json predates v0.7 — added in v0.6/ADR-016) | ADR-019 L127 ("Three new state files") | none |
| Schema versions = 1 (all state files) | `event-manager.mjs:21` `EVENT_SCHEMA_VERSION=1`, `queue-manager.mjs:16` `TASK_SCHEMA_VERSION=1`, `a2a-stub.mjs:57` `schema_version:1`, `reputation.mjs:47` `schema_version:1`, `skill-rotation.mjs:32` `schema_version:1`, `anonymous-orchestrator.mjs:58/69` `schema_version:1` | ARCHITECTURE.md L202/L203 mentions only `event_schema_version=1` and `task_schema_version=1`; doesn't list the four newer files | no doc lists the v0.6/v0.7 schema versions explicitly |
| Lock TTL = 90 min | `lock-manager.mjs:25` `DEFAULT_TTL_MINUTES=90` | README.md L34, FINAL_EVIDENCE_REPORT.md L87, `lock-lifecycle.svg` L3, `pipeline-flow.svg` (90-min) | none |
| Queue task TTL = 120 min | `queue-manager.mjs:17` `DEFAULT_TTL_MINUTES=120` | none (not advertised anywhere user-facing) | none cite it; missing from MAINTENANCE.md and QUEUE_PROTOCOL.md (gap rather than drift) |
| A2A task TTL = 24 h | `a2a-stub.mjs:40` `TASK_TTL_MS = 24*60*60*1000` | ADR-019 L127 ("24h TTL") | none |
| Reputation rolling window = 30 events | `reputation.mjs:27` `WINDOW_SIZE=30` | ADR-019 L41/L44 ("last 30 events") | none |
| Capability-dispatch recency window = 10 min | `capability-dispatch.mjs:30` `RECENCY_WINDOW_MS = 10*60*1000` | ADR-019 L55 ("10 min") | none |
| Supervisor crash window = 5 min, MAX_CRASHES = 10 | `mcp-supervisor.mjs:44/45` (MAX_CRASHES=10, WINDOW_MS=5min) | AUTO_RECONNECT.md L29-L30/L100-L101 | none |
| Dispatch weights (REP / FRESH / LOAD) = 0.5 / 0.3 / 0.2 | `capability-dispatch.mjs:27-29` | ADR-019 L54-L56 (formula matches exactly) | none |
| A2A state transitions | `a2a-stub.mjs:31-38` `VALID_TRANSITIONS` | ADR-019 L66-L71 (matches) | none |
| Default gates count | `gate-runner.mjs` allowlist (need `DEFAULT_GATES.length` to confirm) | none | FINAL_EVIDENCE_REPORT.md L88 says "9 default" |
| SVG count in `docs/diagrams/` = 8 | `ls docs/diagrams/*.svg` returns 8 | hero.svg `desc` describes 8 visual elements indirectly | ARCHITECTURE.md L223 (`7 SVGs`), FINAL_EVIDENCE_REPORT.md L62/L84 (`7×`/`7 SMIL-animated SVGs`) |

---

## Findings

## Gate count drift — README, ARCHITECTURE, MAINTENANCE, hero.svg, truth-gates-animated.svg all say 26 but real count is 29

**Severity:** High (load-bearing numeric drift; coderabbit explicitly calls this load-bearing)
**Type:** count-drift
**Locations:**
- `README.md:41` `26 truth gates`
- `README.md:47` `twenty-six independent verifications`
- `README.md:50` `<img alt="Truth-gate pipeline running twenty-six gates sequentially">`
- `README.md:53-80` table only contains 26 rows (gates 01–26); missing rows for `sbom.cyclonedx_generated`, `secrets.rotation_evidence_present`, `security.mcp_scan_pass`
- `README.md:246` `npm run truth-gates ... # 26/26 gates pass`
- `docs/ARCHITECTURE.md:105` alt text `twenty-six gates sequentially`
- `docs/ARCHITECTURE.md:108` `Twenty-six independent gates`
- `docs/ARCHITECTURE.md:110-127` table only enumerates 16 gates (01–16) — drops 10 of the actual 26 it advertises; misses all 13 of the gates that actually exist beyond gate 16
- `docs/ARCHITECTURE.md:132` comment `# run all 26 against your local Hermes3D`
- `docs/ARCHITECTURE.md:207` `# 26-gate harness`
- `docs/MAINTENANCE.md:4` alt text `twenty-six gates sequentially`
- `docs/MAINTENANCE.md:9` `twenty-six independent attestations`
- `docs/diagrams/hero.svg:3` `26 truth-gates`
- `docs/diagrams/hero.svg:76` `truth-gates: 26 / 26 PASS`
- `docs/diagrams/truth-gates-animated.svg:1` `aria-label="Truth gates pipeline — 26 gates running sequentially"`

**Authoritative source:** `node scripts/truth-gates.mjs --ci` (run during this audit) emits 29 unique gate IDs:
```
source.integrity_manifest, deps.parity, tests.unit, server.stdio_handshake,
doctor.hermes3d, events.directory_present, tasks.directory_present,
trigger.doctor_passes, queue.doctor_passes, wizard.dry_run_passes,
e2e.multi_agent_flow, workspace.integrity, clients.config_presence,
clients.claude_code_live, server.tool_description_hygiene,
security.mcp_scan_pass, evidence.hash_chain_valid,
docs.master_prompt_deliverables_present, provider.registry.validate,
local.models.catalog.validate, continue.llm_classes.validate,
kilocode.provider.mapping.validate, lmstudio.health, ollama.health,
secret.scan, secrets.rotation_evidence_present,
sbom.cyclonedx_generated, licenses.scan, dependency.fresh
```

**Confidence:** High (live harness execution attached as `PROOF/latest.json`; 29 named gate ids).

**Finding:** The README's gate table claims 26 numbered rows, but three real gates (`sbom.cyclonedx_generated`, `secrets.rotation_evidence_present`, `security.mcp_scan_pass`) are entirely undocumented in the README, ARCHITECTURE.md, MAINTENANCE.md, and the SVG. The README badge ("26 truth gates") and the SVG label ("26 / 26 PASS") will appear correct to a casual reader, masking the fact that three CI-enforced gates do not appear anywhere in user-facing docs. CodeRabbit's policy explicitly calls gate-count load-bearing.

**Suggested fix:**
- README.md: change three `26` instances on L41, L47, L246 to `29`; replace `twenty-six` with `twenty-nine` on L47; rewrite the alt text on L50; extend the table on L53–L80 by three rows for the missing gates with their actual descriptions.
- docs/ARCHITECTURE.md: change `twenty-six` to `twenty-nine` (L105 alt, L108 prose), `26` to `29` on L132 and L207, AND extend the table L110–L127 from 16 rows to 29 rows (10 are already documented in the README's table — copy them over and add the 3 newly identified gates).
- docs/MAINTENANCE.md: change L4 alt text and L9 prose to `twenty-nine`.
- docs/diagrams/hero.svg: change L3 desc and L76 text to `29 truth-gates` / `truth-gates: 29 / 29 PASS`.
- docs/diagrams/truth-gates-animated.svg: change L1 `aria-label="Truth gates pipeline — 26 gates running sequentially"` to `29 gates`.

---

## TOOL_REFERENCE.md group table and detail sections cover only v0.4 surface (24 tools / 18 detail sections vs 42 actual)

**Severity:** High (the doc whose entire purpose is enumerating tools is missing 18/42 of them)
**Type:** missing-update
**Locations:**
- `docs/TOOL_REFERENCE.md:9-19` group table — 8 groups, 24 tool names listed
- `docs/TOOL_REFERENCE.md:22-200` detail sections — only 18 `## hermes_*` headings

**Authoritative source:** Live `tools/list` returns 42 tools — all `hermes_anonymous_*`, `hermes_record_outcome`, `hermes_record_task`, `hermes_dispatch_recommend`, `hermes_list_agents`, `hermes_a2a_*`, `hermes_user_*`, `hermes_agent_*` are missing from this doc. Compare to README.md L104–L122 which lists all 42 in the text block correctly.

**Confidence:** High (`grep -cE "^## hermes_" docs/TOOL_REFERENCE.md` returns 18; `tools/list` returns 42).

**Finding:** TOOL_REFERENCE.md's prose claims "42 MCP tools" (L3) but its group table omits the `Anonymous`, `Record`, `Dispatch`, `A2A`, `USER SESSION`, and `AGENT` categories. There are no detail sections for any v0.6 anonymous orchestration tool, any v0.7 A2A tool, any agent-bridge tool, or any user-session tool. A reader trying to learn how to call `hermes_dispatch_recommend` or `hermes_a2a_create_task` will find nothing in the file labeled the canonical tool reference.

**Suggested fix:** Extend the group table at L9–L19 to add 4 new rows: `Anonymous`, `Reputation/Dispatch`, `USER session`, `A2A`, `Agent bridge`. Add a `## hermes_*` detail section for each of the 24 tools that currently have no entry, mirroring the structure of the existing sections (1-line description + minimal example JSON for required args). The argument shapes can be lifted from `src/server.mjs` where each tool's Zod schema is the source of truth.

---

## ARCHITECTURE.md gate table only enumerates 16 of 29 gates (drops gate 17 onward entirely)

**Severity:** High (Architecture doc body contradicts its own surrounding prose count)
**Type:** content-drift / missing-update
**Locations:** `docs/ARCHITECTURE.md:110-127` (table). Prose says "Twenty-six independent gates" but the table contains only 16 numbered rows (`01 source.integrity_manifest` through `16 queue.doctor_passes`). The README has 26 rows; ARCHITECTURE.md is even more out of date than the README.
**Authoritative source:** `scripts/truth-gates.mjs` runs 29 gates (live harness output above).
**Confidence:** High.

**Finding:** ARCHITECTURE.md's gate table stops at gate 16; gates 17 (`wizard.dry_run_passes`) through 29 (`dependency.fresh`) are absent. This makes ARCHITECTURE.md materially less informative than the README on this exact subject and creates a divergence within ARCHITECTURE.md itself between its prose ("twenty-six independent gates") and its tabular content (16 rows).

**Suggested fix:** Replace the table at `docs/ARCHITECTURE.md:110-127` with all 29 gate rows, copying descriptions from README (which has 26) and adding the three gates the README is also missing.

---

## architecture.svg advertises `MCP 2024-11-05` but every other doc says `2025-11-25`

**Severity:** Medium (load-bearing claim per coderabbit policy, but this single SVG label is the only divergence)
**Type:** content-drift
**Locations:** `docs/diagrams/architecture.svg:73`
**Authoritative source:** `src/server.mjs:125` comment `// per MCP spec 2025-11-25`; README.md L124 (`MCP 2025-11-25 annotations`); ARCHITECTURE.md L11/L16; FINAL_EVIDENCE_REPORT.md L14.
**Confidence:** High.

**Finding:** The architecture diagram's stdio JSON-RPC label still says `MCP 2024-11-05` while the rest of the documentation set (and the server's own annotation comments) advertises `MCP 2025-11-25`. (Note: the truth-gate harness itself still negotiates with `protocolVersion: "2024-11-05"` in `truth-gates.mjs:1301`, `sandbox-integration.mjs:104`, `next-task.sh:57` — that is a known intentional negotiation-version compatibility setting and is documented in FINAL_EVIDENCE_REPORT.md as "negotiates down to client". The SVG label, however, is meant to advertise the server's *supported* spec, which is 2025-11-25.)

**Suggested fix:** Edit `docs/diagrams/architecture.svg:73` from `JSON-RPC · MCP 2024-11-05` to `JSON-RPC · MCP 2025-11-25`.

---

## ARCHITECTURE.md file-layout block claims `7 SVGs` but `docs/diagrams/` contains 8

**Severity:** Low
**Type:** count-drift
**Locations:** `docs/ARCHITECTURE.md:223` `# 7 SVGs (this doc + README + 5 others)`
**Authoritative source:** `ls docs/diagrams/*.svg | wc -l` = 8 (architecture, event-flow, hero, lock-lifecycle, mcp-composition, multi-agent-flow, pipeline-flow, truth-gates-animated).
**Confidence:** High.

**Finding:** SVG count claim is off by one. `truth-gates-animated.svg` was added but the file-layout block was not refreshed.

**Suggested fix:** Change `# 7 SVGs (this doc + README + 5 others)` to `# 8 SVGs (this doc + README + 6 others)`.

---

## FINAL_EVIDENCE_REPORT.md is heavily stale (16 tools, 12 gates, 9 default gates, 7 SVGs)

**Severity:** Medium (point-in-time historical doc, but its title and root location imply current)
**Type:** stale-claim
**Locations:**
- `FINAL_EVIDENCE_REPORT.md:14` `MCP spec version: 2025-11-25` (correct)
- `FINAL_EVIDENCE_REPORT.md:53` `MCP 2025-11-25 annotations`
- `FINAL_EVIDENCE_REPORT.md:56` `expectedTools count 16`
- `FINAL_EVIDENCE_REPORT.md:61` `claim updates: 16 tools, 12 gates`
- `FINAL_EVIDENCE_REPORT.md:62` `7× docs/diagrams/*.svg` and `15→16 tools, 9→12 gates`
- `FINAL_EVIDENCE_REPORT.md:84-94` setup status block: `7 SMIL-animated SVGs`, `16 tools`, `9 default + extensible`, `12 gates total`

**Authoritative source:** Live `tools/list` = 42; `truth-gates.mjs --ci` = 29 unique gate IDs; `ls docs/diagrams/*.svg` = 8.

**Confidence:** High (every count is verifiable against current state).

**Finding:** The "Final Evidence Report" was generated 2026-05-02 against PR #1 (Phase 0/1/2). The repo has since shipped v0.4, v0.5, v0.6 (PR #20 anonymous orchestration), and v0.7 (PR #38 v0.7 anonymous orchestration full); none of those waves updated this doc. A reader landing on it will believe the system has 16 tools and 12 gates.

**Suggested fix:** Either (a) prepend a banner at L1 noting the doc is a frozen snapshot of v0.3 / PR #1, with a pointer to README.md and PROOF_E2E_REPORT.md for current numbers; or (b) refresh L13–L94 to current numbers (42 tools, 29 gates, 8 SVGs). Option (a) preserves history with a single 1-line edit.

---

## `expectedTools` array in `scripts/truth-gates.mjs` enumerates only 24/42 tools

**Severity:** Medium (defensive coverage — the gate would not flag a regression that drops a v0.6/v0.7 tool)
**Type:** stale-claim (in code that the audit policy treats as authoritative for the gate description)
**Locations:** `scripts/truth-gates.mjs:271-296` (`expectedTools` array).
**Authoritative source:** `tools/list` returns 42 names; the array contains only 24 of them (all v0.4-era). `hermes_anonymous_*` (3), `hermes_a2a_*` (4), `hermes_agent_*` (4), `hermes_user_*` (3), `hermes_dispatch_recommend`, `hermes_list_agents`, `hermes_record_outcome`, `hermes_record_task` are absent.
**Confidence:** High (read directly from the source file).

**Finding:** The gate prints `42 tools` because it counts `got.length` from the live response — but the existence/absence check (`expectedTools.filter((t) => !got.includes(t))`) only validates that the v0.4 surface is intact. A regression that removes any of the 18 v0.6/v0.7 tools would not be caught by this gate.

**Suggested fix:** Extend the `expectedTools` array at `scripts/truth-gates.mjs:271-296` to include all 42 tool names. (This is a code change, not a doc change — flagging here because coderabbit's policy says the gate description is part of the authoritative numeric set, and an incomplete `expectedTools` weakens the assertion behind the description.)

---

## Older audit/spec docs still cite v0.3 / v0.4 tool and gate counts (15 / 16 / 9 / 12)

**Severity:** Low (these are historical design / audit docs by name)
**Type:** stale-claim
**Locations:**
- `docs/HERMES3D_SOURCE_AUDIT.md:69` `Exposes 16 tools`
- `docs/HERMESPROOF_SETUP_AUDIT.md:18` `registers 15 tools`
- `docs/HERMESPROOF_SETUP_AUDIT.md:54` `tools/list returns 15 tools`
- `docs/README_MASTER_SPEC.md:50` `15 tools (will become 16 after Phase 1)`
- `docs/README_MASTER_SPEC.md:51` `9 gates ... becomes 11 after Phase 1's mcp-scan`
- `docs/MULTI_AGENT_LOOP_ROADMAP.md:26` `12 gates`
- `handoffs/HANDOFF_TO_CODEX_README_VISUALS.md:130` `MCP-2024-11-05`
- `docs/HERMESPROOF_SETUP_AUDIT.md:144` `MCP-2024-11-05` (called out as stale)

**Authoritative source:** Current state = 42 tools / 29 gates / `MCP 2025-11-25`.

**Confidence:** High.

**Finding:** These docs were the design / audit basis for the original implementation and are dated. They are not labelled "historical", so a reader can land on them via `docs/` directory listing and treat them as current. README_MASTER_SPEC.md explicitly anticipates phase changes ("becomes N after Phase 1") but the actual phases have moved well beyond Phase 1.

**Suggested fix:** Add a single-line "Snapshot of v0.3 / Phase 0–1 design" banner at the top of each (HERMES3D_SOURCE_AUDIT.md, HERMESPROOF_SETUP_AUDIT.md, README_MASTER_SPEC.md, MULTI_AGENT_LOOP_ROADMAP.md, HANDOFF_TO_CODEX_README_VISUALS.md) pointing to the current README and PROOF_E2E_REPORT.md. Lower-cost than a full refresh and preserves the historical record.

---

## AUTO_RECONNECT.md "How it works" list does not describe the just-fixed clean-shutdown semantics

**Severity:** Medium (the doc claims "clean shutdown when supervisor receives SIGTERM" but does not document the two specific fixes that landed: stdin EOF propagation, and exit-on-clean-child-exit)
**Type:** missing-update
**Locations:** `docs/AUTO_RECONNECT.md:21-34`
**Authoritative source:** `scripts/mcp-supervisor.mjs:115-127, 195-207`. Two behaviours were added recently and are not documented:
1. `process.stdin.pipe(child.stdin)` (line 125) with `end:true` (default) — when the MCP client closes its end, EOF propagates to the child, letting `src/server.mjs` exit cleanly. The supervisor then unpipes on child exit so respawn cycles still work.
2. `if (result.code === 0 && result.signal === null) { ...; process.exit(0); }` (lines 203–207) — a clean child exit (code 0) makes the supervisor exit cleanly too, instead of treating it as a crash and respawning.
3. `shutdownSignal` tracking (lines 102–105, 198–201) — SIGTERM/SIGINT during a spawn iteration causes a clean supervisor exit between iterations rather than a respawn.
**Confidence:** High.

**Finding:** AUTO_RECONNECT.md L27–L33 lists only "respawn on crash" and "forward SIGTERM/SIGINT" — does not say (a) that an MCP client closing stdio will cleanly tear down both server and supervisor, (b) that a server `process.exit(0)` will be respected (no respawn), or (c) the per-spawn `process.once` leak that the recent refactor closed. A reader debugging the reconnect path will not know to look for these behaviours.

**Suggested fix:** Extend the list at `docs/AUTO_RECONNECT.md:21-34` with three bullets:
- "stdin EOF propagation: when the MCP client closes stdin, the supervisor pipes EOF to the child, letting src/server.mjs shut down cleanly. unpipe() on child exit prevents respawn cycles from breaking."
- "Clean child exit (code=0, signal=null) is honored: the supervisor exits 0 instead of respawning."
- "Top-level SIGTERM/SIGINT handler tracks shutdown intent so a signal arriving mid-backoff still results in a clean supervisor exit, not a respawn."

---

## ARCHITECTURE.md state-file enumeration is missing v0.6/v0.7 state files

**Severity:** Medium
**Type:** missing-update
**Locations:** `docs/ARCHITECTURE.md:202-203` (only mentions `event_schema_version=1` and `task_schema_version=1`); README.md L131-L146 lists `locks/`, `tasks/{pending,claimed,blocked,done}`, `handoffs/`, `evidence/ledger.ndjson`, `events/{outbox,handled,failed}`, `review_packets/` but does NOT list `anonymous_orchestrator.json`, `skill_rotation.json`, `reputation.json`, `a2a_tasks.json`.
**Authoritative source:** `src/core/anonymous-orchestrator.mjs:49`, `skill-rotation.mjs:25`, `reputation.mjs:40`, `a2a-stub.mjs:46`.
**Confidence:** High.

**Finding:** Both ARCHITECTURE.md and the README's state-tree layout block omit the four state files added in v0.6 and v0.7. A reader unfamiliar with the recent ADRs cannot find these files documented as part of the on-disk state.

**Suggested fix:** Extend the README's state tree at L131–L146 with four sibling entries (`anonymous_orchestrator.json`, `skill_rotation.json`, `reputation.json`, `a2a_tasks.json`) — each with a one-line caption. Mirror the same change in ARCHITECTURE.md L195–L223.

---

## hero.svg desc cites `26 truth-gates`, contradicting its own visible badge that this audit recommends changing to 29

**Severity:** Low (rolls into the gate-count drift finding above; flagged separately because it's an `aria-labelledby` description that screen readers will hear)
**Type:** count-drift
**Locations:** `docs/diagrams/hero.svg:3`
**Authoritative source:** 29 gates (per truth-gate harness).
**Confidence:** High.

**Finding:** The hero diagram's accessible description specifies "26 truth-gates", which means the count drift is also exposed to screen-reader users.

**Suggested fix:** Change `26 truth-gates` to `29 truth-gates` in `docs/diagrams/hero.svg:3`.

---

## QUEUE_PROTOCOL.md / MAINTENANCE.md do not advertise the queue-task TTL of 120 minutes

**Severity:** Low (gap rather than drift — but contributes to the documentation set being incomplete)
**Type:** missing-update
**Locations:** `docs/QUEUE_PROTOCOL.md` (no mention of TTL); `docs/MAINTENANCE.md` (no queue-TTL guidance)
**Authoritative source:** `src/core/queue-manager.mjs:17` `DEFAULT_TTL_MINUTES=120`.
**Confidence:** Medium (this is a documentation gap rather than a contradiction; flagging because the audit prompt explicitly asks about queue/task TTL coverage).

**Finding:** The queue's 120-minute default TTL is not surfaced in either MAINTENANCE.md (which advertises operational best-practices) or QUEUE_PROTOCOL.md (which is the canonical user-facing description of the queue surface). Users debugging "why did my pending task disappear?" have no doc-side anchor to find the constant.

**Suggested fix:** Add a one-line "Default task TTL is 120 minutes (`task.ttl_minutes`); blocks shorter than 1 minute or longer than 7 days are clamped" to QUEUE_PROTOCOL.md, and a single line to MAINTENANCE.md's repair-procedures section linking the same constant.

---

## ADR-019's scoring formulas, transition table, and three-new-files claim all match the code exactly

**Severity:** Info (this is a positive finding — the ADR is accurate)
**Type:** none
**Locations:**
- `docs/ADR-019-anonymous-orchestration-v0.7.md:54-56` matches `src/core/capability-dispatch.mjs:27-29` (`WEIGHT_REP=0.5, WEIGHT_FRESH=0.3, WEIGHT_LOAD=0.2`)
- `docs/ADR-019-anonymous-orchestration-v0.7.md:66-71` state-machine matches `src/core/a2a-stub.mjs:31-38` `VALID_TRANSITIONS`
- `docs/ADR-019-anonymous-orchestration-v0.7.md:127` "Three new state files (skill_rotation.json, reputation.json, a2a_tasks.json)" matches the file-paths declared in `skill-rotation.mjs:25`, `reputation.mjs:40`, `a2a-stub.mjs:46`. (`anonymous_orchestrator.json` is correctly excluded — it predates v0.7.)
- `docs/ADR-019-anonymous-orchestration-v0.7.md:91` `Tool count: 42 MCP tools` matches the live count.
- `docs/ADR-019-anonymous-orchestration-v0.7.md:78-89` 8 new tools match the 8 v0.7-introduced names visible in `tools/list`.

**Confidence:** High.

**Finding:** ADR-019 is internally consistent and consistent with the code. No drift found.

---

## Coverage notes

Files / directories scanned:

- `README.md` (full read for L1–L246)
- `CHANGELOG.md` (numeric-claim grep)
- `FINAL_EVIDENCE_REPORT.md` (L1–L100)
- `docs/ADR-019-anonymous-orchestration-v0.7.md` (full read)
- `docs/ADR-016-hermes-agent-as-anonymous-user.md` (numeric-claim grep)
- `docs/ARCHITECTURE.md` (L1–L223, including gate table, file layout)
- `docs/AUTO_RECONNECT.md` (full read)
- `docs/MAINTENANCE.md` (L1–L80 + grep)
- `docs/TOOL_REFERENCE.md` (L1–L60 + tool-section count)
- `docs/EVENT_SCHEMA.md` (numeric-claim grep)
- `docs/HERMES3D_SOURCE_AUDIT.md` (numeric-claim grep)
- `docs/HERMESPROOF_SETUP_AUDIT.md` (numeric-claim grep)
- `docs/HERMES_AGENT_ENABLE.md` (numeric-claim grep)
- `docs/INTEROP_WITH_OTHER_MCP.md` (numeric-claim grep)
- `docs/LOCK_PROTOCOL.md` (numeric-claim grep)
- `docs/MULTI_AGENT_LOOP_ROADMAP.md` (numeric-claim grep)
- `docs/PARALLEL_SUBAGENT_DISCIPLINE.md` (numeric-claim grep)
- `docs/QUEUE_PROTOCOL.md` (TTL-coverage check)
- `docs/README_COVERAGE_MATRIX.md` (MCP-spec grep)
- `docs/README_MASTER_SPEC.md` (numeric-claim grep)
- `docs/SECURITY_POLICY.md` (numeric-claim grep)
- `docs/SETUP_*.md` (numeric-claim grep — no findings)
- `docs/SVG_ANIMATION_SPEC.md` (numeric-claim grep)
- `docs/TOOL_REFERENCE.md` (tool inventory + tool detail-section count)
- `docs/VISUAL_ASSET_SPEC.md` (numeric-claim grep)
- `docs/diagrams/architecture.svg` (text labels, L1–L100)
- `docs/diagrams/hero.svg` (text labels, L1–L100)
- `docs/diagrams/truth-gates-animated.svg` (text labels)
- `docs/diagrams/event-flow.svg`, `lock-lifecycle.svg`, `mcp-composition.svg`, `multi-agent-flow.svg`, `pipeline-flow.svg` (tool-name grep)
- `policies/provider-registry/AUDIT.md` (not opened — provider-registry data not in scope)
- `handoffs/HANDOFF_TO_CODEX_README_VISUALS.md` (numeric-claim grep)
- `hermesproof_claude20_codex_handoff_master_prompt.md` (not opened — handoff prompt, out of scope)
- `Missing-Features.md`, `AGENTS.md`, `PROOF_LOCAL_TEST.md`, `PROOF_SANDBOX_TEST.md` (numeric-claim grep — no new findings beyond what is documented above)

Authoritative-source probes performed:
- `node src/server.mjs` stdio probe with `tools/list` → 42 tool names captured.
- `node scripts/truth-gates.mjs --ci` full run → 29 unique gate IDs captured.
- `ls docs/diagrams/*.svg` → 8 SVGs.
- Grep over `src/core/` for `defaultTtlMs`, `TASK_TTL_MS`, `WINDOW_SIZE`, `RECENCY_WINDOW_MS`, `MAX_CRASHES`, `WINDOW_MS`, `WEIGHT_REP/FRESH/LOAD`, `VALID_TRANSITIONS`, `schema_version`.

Files / paths intentionally not scanned (out of scope per audit prompt):
- Production code quality / security review (other lanes).
- Test coverage analysis (other lanes).
- Tool annotation correctness against the MCP spec (only the version label was checked).
