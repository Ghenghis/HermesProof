# Documentation Drift - Codex Audit

## Executive Summary

The headline `42 MCP tools` claim is correct: `src/server.mjs` registers 42 tools and live `tools/list` returned 42. The documentation drift is concentrated in the proof/gate story, protocol version wording, and the tool reference. Current proof artifacts contain 29 gate rows, while README, ARCHITECTURE, MAINTENANCE, and diagrams still claim 26, 14, or 9 gates. README's truth-gates table omits live gates such as `security.mcp_scan_pass`, `secrets.rotation_evidence_present`, and `sbom.cyclonedx_generated`; it also says `tests.unit` runs all Node smoke tests even though the truth-gate harness runs five selected files and `npm test` runs twelve. `docs/TOOL_REFERENCE.md` claims 42 tools but has only 18 detailed `## hermes_*` sections and its group table lists only the legacy 24-tool surface, missing anonymous role, USER session, A2A, dispatch, and Hermes Agent bridge tools. MCP protocol claims are mixed: Markdown and a 2025 request negotiate `2025-11-25`, but the architecture SVG and truth-gate probe use `2024-11-05`, so CI does not prove the documented version. ADR-019's state-file count, scoring formula, and A2A transitions mostly align, but its "8 new tools" scope is stale against the 18 live v0.7 additions.

## Summary

| ID | Severity | Type | Location | Confidence | Finding |
| --- | --- | --- | --- | --- | --- |
| DOC-01 | High | Numeric drift | `README.md:41`, `PROOF/latest.json`, `docs/diagrams/truth-gates-animated.svg:22` | 0.98 | Truth-gate count is 29 in proof but docs/diagrams say 26, 14, or 9. |
| DOC-02 | Medium | Table drift | `README.md:53`, `scripts/truth-gates.mjs:849`, `scripts/truth-gates.mjs:1153` | 0.96 | README truth-gates table omits live gates and misstates test scope. |
| DOC-03 | High | Reference completeness | `docs/TOOL_REFERENCE.md:3`, `docs/TOOL_REFERENCE.md:22`, `src/server.mjs:571` | 0.99 | Tool reference claims 42 tools but details only 18 sections and lists 24. |
| DOC-04 | Medium | Protocol drift | `docs/diagrams/architecture.svg:73`, `scripts/truth-gates.mjs:1301`, `README.md:124` | 0.90 | MCP spec version claims are mixed and CI probes the older version. |
| DOC-05 | Medium | ADR drift | `docs/ADR-019-anonymous-orchestration-v0.7.md:25`, `docs/ADR-019-anonymous-orchestration-v0.7.md:78` | 0.93 | ADR-019 still says v0.7 adds four modules and eight tools. |
| DOC-06 | Low | Diagram drift | `docs/diagrams/event-flow.svg:63`, `src/core/event-manager.mjs:23` | 0.91 | Event-flow SVG says 13 event types, implementation defines 15. |

## Findings

### DOC-01 - Truth-Gate Count Is Stale Across Docs and Diagrams

Severity: High

Type: Numeric documentation drift

Location: `README.md:41`, `docs/ARCHITECTURE.md:108`, `docs/MAINTENANCE.md:9`, `docs/diagrams/truth-gates-animated.svg:22`, `docs/diagrams/pipeline-flow.svg:169`, `PROOF/latest.json`

Confidence: 0.98

Finding: The current proof bundle contains 29 gate rows, but public docs and diagrams still advertise 26, 14, or 9 gates. This makes the proof surface look smaller or internally inconsistent depending on which artifact a reviewer reads.

Evidence: `PROOF/latest.json` has `gates.length === 29`. README and architecture text say 26; `truth-gates-animated.svg` line 22 says `9 GATES`; `pipeline-flow.svg` line 169 says `14-gate truth bundle`.

Suggested remediation: Update all gate counts to 29 or generate counts directly from `scripts/truth-gates.mjs` / `PROOF/latest.json`. Avoid hard-coded counts in SVG text where possible.

### DOC-02 - README Truth-Gates Table Omits Live Gates and Overstates Unit Scope

Severity: Medium

Type: Table drift

Location: `README.md:53`, `README.md:57`, `scripts/truth-gates.mjs:245`, `scripts/truth-gates.mjs:849`, `scripts/truth-gates.mjs:1153`, `scripts/truth-gates.mjs:1175`

Confidence: 0.96

Finding: README lists 26 gates and omits `security.mcp_scan_pass`, `secrets.rotation_evidence_present`, and `sbom.cyclonedx_generated`. It says `tests.unit` runs all Node smoke tests, but the truth-gate harness runs five selected files while `npm test` runs twelve.

Evidence: `truth-gates.mjs:245-249` lists five test files. `PROOF_E2E_REPORT.md` shows 29 gate results, including the three omitted rows.

Suggested remediation: Regenerate the README table from the gate registry/report with level (`required`, `warn`, `skipped`) and actual test membership.

### DOC-03 - Tool Reference Claims 42 Tools but Documents Only the Legacy Surface

Severity: High

Type: Reference completeness

Location: `docs/TOOL_REFERENCE.md:3`, `docs/TOOL_REFERENCE.md:9`, `docs/TOOL_REFERENCE.md:22`, `src/server.mjs:571`

Confidence: 0.99

Finding: `TOOL_REFERENCE.md` says the server exposes 42 MCP tools, but its group table lists only 24 legacy tools and it has only 18 detailed `## hermes_*` sections. It omits all detailed coverage for anonymous roles, reputation, skill rotation, dispatch, USER sessions, A2A, Hermes Agent bridge tools, and several legacy tools like `heartbeat`, `release_files`, `list_locks`, and `list_gates`.

Evidence: `Select-String '^## hermes_' docs/TOOL_REFERENCE.md` returns 18 headings. Live `tools/list` returns 42 names.

Suggested remediation: Add one section per live tool with schema, side effects, annotations, and examples. Add CI that compares `TOOL_REFERENCE.md` headings against live `tools/list`.

### DOC-04 - MCP Protocol Version Claims Are Mixed

Severity: Medium

Type: Protocol drift

Location: `docs/diagrams/architecture.svg:73`, `scripts/truth-gates.mjs:1301`, `README.md:124`, `docs/ARCHITECTURE.md:11`

Confidence: 0.90

Finding: Markdown claims MCP `2025-11-25`, and a live initialize request using `2025-11-25` negotiates that version. However, `architecture.svg` still labels the transport as `MCP 2024-11-05`, and the truth-gate handshake requests `2024-11-05`, so the required CI gate proves backward compatibility rather than the documented protocol version.

Evidence: Live probes returned `protocolVersion` matching the requested version for both `2024-11-05` and `2025-11-25`. The truth-gate script hard-codes `protocolVersion: "2024-11-05"`.

Suggested remediation: Update SVG text to `2025-11-25` and either make truth-gates request/assert `2025-11-25` or explicitly document the gate as backwards-compat coverage.

### DOC-05 - ADR-019 Understates the v0.7 Module and Tool Surface

Severity: Medium

Type: ADR drift

Location: `docs/ADR-019-anonymous-orchestration-v0.7.md:25`, `docs/ADR-019-anonymous-orchestration-v0.7.md:78`, `src/server.mjs:632`, `src/server.mjs:857`

Confidence: 0.93

Finding: ADR-019 says v0.7 adds four modules and eight new MCP tools. The live v0.7 server includes additional USER session and Hermes Agent bridge tools, and the code also includes `hermes_agent_health`, `hermes_agent_request_user_session`, `hermes_agent_resolve_blocked`, and `hermes_agent_revoke_session`. Relative to the old 24-tool list in truth-gates, live surface is now 42, or 18 additional tools.

Evidence: ADR lines 78-89 list only eight tools. Live `tools/list` includes 42 total tools and v0.7 registrations span `server.mjs:571-937`.

Suggested remediation: Update ADR-019 with a v0.7.1 addendum or revised scope table distinguishing original anonymous/A2A tools from later USER/Hermes Agent bridge tools.

### DOC-06 - Event Type Count in Diagram Is Stale

Severity: Low

Type: Diagram drift

Location: `docs/diagrams/event-flow.svg:63`, `src/core/event-manager.mjs:23`

Confidence: 0.91

Finding: `event-flow.svg` says `13 event types`, but `EVENT_TYPES` defines 15 event types.

Evidence: `event-manager.mjs` includes task enqueued/claimed/released/blocked/recovered, handoff created/approved/denied, lock acquired/released/recovered, evidence appended, gate failed/passed, and pr.opened.

Suggested remediation: Update the SVG text to 15 or remove the explicit count.

## Coverage notes

I did not read Claude's audit docs or any non-Codex audit reports. I scanned README, ADR-019, ARCHITECTURE, MAINTENANCE, TOOL_REFERENCE, every SVG under `docs/diagrams`, `scripts/truth-gates.mjs`, `PROOF/latest.json`, and live MCP initialize/tools-list behavior. Tool count was confirmed at 42. Current proof gate rows were confirmed at 29. ADR-019's state-file count, scoring formula, reputation window, and A2A transition diagram matched implementation aside from the stale module/tool scope.
