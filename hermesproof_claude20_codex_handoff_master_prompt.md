# HermesProof × Hermes3D — Claude 20-Agent Start Prompt + Codex Handoff Contract

**Use this entire file as the first prompt to Claude Code / Claude Desktop.**  
Target project: **HermesProof** for **Hermes3D OS**  
Primary repos / paths:

```text
Hermes3D source repo:     https://github.com/Ghenghis/Hermes3D
Hermes3D local path:      G:\Github\Hermes3D

HermesProof repo:         https://github.com/Ghenghis/HermesProof
HermesProof local path:   G:\Github\hermes3d-mcp-lock-orchestrator
HermesProof role:         governance + proof + MCP lock coordination layer for Hermes3D
```

Inspired by:

```text
https://hermes-agent.nousresearch.com/
https://github.com/nousresearch/hermes-agent
```

---

## 0. Mission

You are Claude Lead Architect for the HermesProof + Hermes3D visual documentation and coordination project.

Your job is to use the full Claude Max plan power **safely** by coordinating a 20-agent Claude review/design team, then hand off exact implementation work to Codex and its coding agents.

The project goal is:

1. Make **HermesProof** the clean, professional, visual GitHub front door for the proof/lock layer that makes Claude + Codex + Windsurf safe on Hermes3D.
2. Build a **GitHub README and docs system** that uses animated SVGs, source-audited diagrams, proof badges, clean Markdown, and e2e visual flow.
3. Keep everything inside GitHub Free-friendly constraints:
   - README must stay compact and not be overloaded.
   - Prefer SVG/PNG assets.
   - No sound in README.
   - No JavaScript in README.
   - No huge video/GIF dependency.
   - Keep every generated media file comfortably under 10 MB.
4. Make Claude and Codex work together through **HermesProof locks** so they never overwrite each other.
5. If either Claude or Codex cannot complete its part, it must create a precise handoff file for the other tool rather than stopping silently.

This is not just a README task. This is a full **agent coordination proof task**.

---

## 1. Non-negotiable operating rules

### 1.1 No uncoordinated edits

Before editing any file in **HermesProof** or **Hermes3D**, the acting agent must use HermesProof MCP tools:

```text
1. hermes_doctor
2. hermes_read_policy
3. hermes_claim_task
4. hermes_lock_files
5. edit only locked files
6. hermes_heartbeat during long work
7. hermes_append_evidence
8. hermes_release_files
9. hermes_release_task
```

If a file is locked by another agent:

```text
DO NOT edit it.
DO NOT force overwrite it.
DO NOT create a parallel version unless explicitly requested.
Use hermes_request_handoff.
Wait for hermes_approve_handoff.
Only edit after ownership transfers.
```

### 1.2 Never test destructive behavior in Hermes3D

Hermes3D is active and may be under development.

For integration tests, create a sandbox under:

```text
G:\Github\hermesproof-readme-sandbox
```

or:

```text
G:\Github\hermes3d-mcp-test-sandbox
```

The sandbox should mimic Hermes3D layout enough for tests:

```text
03_implementation/ui/src/tabs/
contracts/
docs/
README.md
.git/
```

Do not use destructive tests directly inside:

```text
G:\Github\Hermes3D
```

Hermes3D may be inspected read-only for source audit, tab inventory, route mapping, and screenshot planning.

### 1.3 Branch discipline

Never commit directly to `main` unless this is the initial empty repository bootstrap and the user explicitly expects direct push.

Preferred branches:

```text
feat/hermesproof-visual-readme
feat/hermesproof-docs-diagrams
feat/hermesproof-pages-showcase
fix/hermesproof-proof-gates
```

Every commit must include:

```text
- branch
- commit hash
- changed files
- tests/gates run
- proof artifact path
- known limitations
```

### 1.4 If blocked, create a handoff

If Claude cannot complete implementation, create:

```text
handoffs/HANDOFF_TO_CODEX_<checkpoint>.md
```

If Codex cannot complete implementation, it must create:

```text
handoffs/HANDOFF_TO_CLAUDE_<checkpoint>.md
```

Each handoff must include:

```text
- current branch
- exact files locked/released
- exact files changed
- what passed
- what failed
- exact next command or prompt
- screenshots/proof/logs paths
- risk notes
- no vague “continue this”
```

---

## 2. Free-plan GitHub README constraints

Claude must design for what GitHub README supports reliably.

Use:

```text
✅ Markdown
✅ relative image links
✅ SVG images
✅ PNG screenshots
✅ GIF only if tiny and necessary
✅ Mermaid diagrams where helpful
✅ collapsible <details> sections
✅ GitHub Actions badge
✅ links to PROOF/latest.json and PROOF_E2E_REPORT.md
```

Avoid:

```text
❌ JavaScript in README
❌ audio/sound in README
❌ remote CSS/JS
❌ heavyweight videos
❌ bloated README
❌ claims not proven by source or proof gates
```

Target README size:

```text
README.md target: under 120 KiB
README.md hard ceiling: under 500 KiB
Each SVG target: under 100 KiB
Each screenshot target: under 1 MB when possible
Any GIF/video: avoid unless absolutely needed; keep under 10 MB
```

If a richer experience is needed, use GitHub Pages later. The README is the polished front door, not the whole website.

---

## 3. Required output from Claude before Codex starts

Claude must produce these files first.

```text
docs/README_MASTER_SPEC.md
docs/README_COVERAGE_MATRIX.md
docs/VISUAL_ASSET_SPEC.md
docs/SVG_ANIMATION_SPEC.md
docs/HERMES3D_SOURCE_AUDIT.md
docs/HERMESPROOF_SETUP_AUDIT.md
docs/CODEX_IMPLEMENTATION_HANDOFF.md
docs/CLAUDE_REVIEW_TEAM_PROMPT.md
docs/ACCEPTANCE_GATES.md
handoffs/HANDOFF_TO_CODEX_README_VISUALS.md
```

Claude must not hand Codex a vague request. Codex gets an exact file-by-file execution contract.

---

## 4. Claude 20-agent roster

Run the 20 agents as specialist roles. Do not make all 20 edit files at once. Most should audit/review/design. Only the Lead Architect and Evidence Clerk write docs unless locks are assigned.

### Agent 01 — Lead Architect
Owns the plan, scope lock, and final Codex handoff.

### Agent 02 — Hermes3D Source Cartographer
Reads Hermes3D source structure and identifies real tabs, routes, panels, workflows, and proof surfaces.

### Agent 03 — HermesProof System Cartographer
Audits HermesProof source, MCP tools, truth gates, proof artifacts, and CI workflow.

### Agent 04 — README Information Architect
Designs README structure and compact narrative.

### Agent 05 — Visual System Designer
Defines dark Hermes-Agent-inspired look: navy surfaces, violet/cyan/pink glow, proof green, amber warning, monospace labels.

### Agent 06 — SVG Motion Designer
Specifies animated SVGs using SMIL only; no scripts.

### Agent 07 — GitHub Markdown Compliance Agent
Checks README features are GitHub-safe and free-plan-safe.

### Agent 08 — Accessibility Agent
Requires alt text, reduced-motion-safe design, readable contrast, no essential information hidden only in animation.

### Agent 09 — Truth Gates Architect
Maps README claims to proof gates and acceptance checks.

### Agent 10 — HermesProof Setup Agent
Verifies HermesProof repo setup, package metadata, actions workflow, PROOF artifacts, and MIT/license status.

### Agent 11 — Hermes3D Integration Agent
Confirms HermesProof points at `G:\Github\Hermes3D` without destructive tests inside Hermes3D.

### Agent 12 — Playwright/Screenshot Planner
Designs screenshot capture if UI screenshots are added later. Must be non-destructive.

### Agent 13 — GitHub Pages Planner
Plans optional GitHub Pages upgrade without blocking README completion.

### Agent 14 — Security/Secrets Auditor
Scans docs, SVGs, configs, and screenshots for leaked tokens, local secrets, API keys, or machine-specific data that should not be public.

### Agent 15 — Asset Optimizer
Keeps SVGs small, self-contained, and GitHub-renderable.

### Agent 16 — Docs Integrator
Ensures every top-level doc embeds the correct diagram and links back to README.

### Agent 17 — Codex Task Splitter
Turns the design into exact Codex tasks, file list, lock plan, and acceptance gates.

### Agent 18 — Handoff Marshal
Creates all `handoffs/*.md` files and ensures every incomplete task has an owner.

### Agent 19 — Release / Branch Agent
Checks branch, commits, remote, CI status, GitHub Actions, and clean working tree.

### Agent 20 — Evidence Clerk
Owns proof summary, final report, and what the user sees.

---

## 5. Claude wave execution plan

### Wave 0 — Safety and diagnostics

Claude Lead must run or request:

```text
hermes_doctor
hermes_read_policy
git status --short
git branch --show-current
```

Then create a scope lock:

```text
docs/README_MASTER_SPEC.md
docs/README_COVERAGE_MATRIX.md
docs/VISUAL_ASSET_SPEC.md
docs/SVG_ANIMATION_SPEC.md
docs/CODEX_IMPLEMENTATION_HANDOFF.md
docs/ACCEPTANCE_GATES.md
```

### Wave 1 — Source audit

Read-only audit of:

```text
G:\Github\Hermes3D
G:\Github\hermes3d-mcp-lock-orchestrator
https://github.com/Ghenghis/Hermes3D
https://github.com/Ghenghis/HermesProof
```

Required audit outputs:

```text
docs/HERMES3D_SOURCE_AUDIT.md
docs/HERMESPROOF_SETUP_AUDIT.md
docs/README_COVERAGE_MATRIX.md
```

The coverage matrix must include:

```text
- HermesProof MCP server
- file locks
- handoffs
- heartbeat
- recovery
- allowlisted gates
- evidence ledger
- PROOF/latest.json
- PROOF_E2E_REPORT.md
- GitHub Actions truth-gates workflow
- Hermes3D integration
- Claude Desktop
- Claude Code
- Codex
- Windsurf
- sandbox testing
```

### Wave 2 — Visual README design

Claude must define the final README visual architecture.

Required README sections:

```text
1. animated hero
2. e2e pipeline flow
3. why HermesProof exists
4. multi-agent coordination
5. lock lifecycle
6. truth gates
7. architecture
8. MCP composition
9. quickstart
10. client setup
11. docs index
12. proof links
13. credits / inspiration
```

Required SVGs:

```text
docs/diagrams/hero.svg
docs/diagrams/pipeline-flow.svg
docs/diagrams/truth-gates-animated.svg
docs/diagrams/multi-agent-flow.svg
docs/diagrams/lock-lifecycle.svg
docs/diagrams/architecture.svg
docs/diagrams/mcp-composition.svg
```

### Wave 3 — Claude creates Codex handoff

Claude must create:

```text
handoffs/HANDOFF_TO_CODEX_README_VISUALS.md
```

It must include:

```text
- exact branch to create
- exact file locks Codex must claim
- exact files Codex may edit
- exact files Codex must not edit
- exact SVG dimensions and style
- exact README structure
- exact docs to update
- exact tests/gates to run
- exact proof format
- failure handoff protocol
```

### Wave 4 — Codex implementation

Codex must use its own agents and complete the implementation.

Codex agent roles:

```text
1. Codex Lead Implementer
2. SVG Asset Agent
3. README Assembly Agent
4. Docs Update Agent
5. CI / Truth Gate Agent
6. Link Validation Agent
7. Security / Secrets Scan Agent
8. Evidence Reporter
```

Codex must lock files before editing.

Codex may edit:

```text
README.md
docs/ARCHITECTURE.md
docs/LOCK_PROTOCOL.md
docs/TOOL_REFERENCE.md
docs/SECURITY_POLICY.md
docs/INTEROP_WITH_OTHER_MCP.md
docs/MAINTENANCE.md
docs/SETUP_CLAUDE_CODE.md
docs/SETUP_CLAUDE_DESKTOP.md
docs/SETUP_CODEX.md
docs/SETUP_WINDSURF.md
docs/SETUP_GENERIC_PROJECT.md
docs/diagrams/*.svg
package.json
LICENSE
AGENTS.md
PROOF/latest.json
PROOF_E2E_REPORT.md
.github/workflows/truth-gates.yml
```

Codex must not edit Hermes3D source except if the user explicitly asks later.

### Wave 5 — Claude review team

Claude runs review agents after Codex.

Review checklist:

```text
- README visually renders
- SVGs are self-contained and animated
- README is compact and not bloated
- no scripts in README
- no secrets
- no broken links
- docs all link correctly
- HermesProof branding is consistent
- Hermes3D relationship is clear
- Hermes Agent inspiration is credited
- truth gates pass
- CI passes
```

### Wave 6 — Codex correction pass

Codex receives a small correction handoff only.

No new features during correction.

### Wave 7 — Final evidence

Claude Evidence Clerk produces:

```text
FINAL_EVIDENCE_REPORT.md
```

with:

```text
Branch:
Commit:
GitHub URL:
Files changed:
SVG count:
README size:
Largest asset:
Local truth-gates:
CI truth-gates:
Known limitations:
Next recommended checkpoint:
```

---

## 6. Codex implementation handoff template

Claude must give Codex this exact structure.

```markdown
# HANDOFF_TO_CODEX_README_VISUALS

## Mission

Implement the HermesProof visual-first GitHub README and integrated docs/SVG system exactly as designed by Claude.

## Repos / Paths

HermesProof local path:

```text
G:\Github\hermes3d-mcp-lock-orchestrator
```

HermesProof remote:

```text
https://github.com/Ghenghis/HermesProof
```

Hermes3D reference-only source:

```text
G:\Github\Hermes3D
https://github.com/Ghenghis/Hermes3D
```

## Required locking

Before editing, call:

```text
hermes_doctor
hermes_read_policy
hermes_claim_task owner=codex-visual-impl taskId=HP-README-VISUALS
hermes_lock_files files=[...]
```

If any file is locked, request handoff. Do not overwrite.

## Files to edit

[List exact files.]

## Files not to edit

```text
G:\Github\Hermes3D\**
Any real user config containing API keys
Any active Hermes3D work branch files not listed in the task
```

## Deliverables

1. Visual README
2. Animated SVGs
3. Updated docs
4. Proof artifacts
5. CI passing
6. Final evidence report

## Acceptance gates

```powershell
npm install
npm test
npm run truth-gates
npm run truth-gates -- --ci
git status --short
git diff --check
```

## GitHub proof

After push:

```powershell
gh run list -R Ghenghis/HermesProof --limit 3
gh run watch <run-id> -R Ghenghis/HermesProof --exit-status
```

## Failure protocol

If blocked, create:

```text
handoffs/HANDOFF_TO_CLAUDE_README_VISUALS_BLOCKED.md
```

Include exact error output and suggested fix.
```

---

## 7. HermesProof setup requirement

Claude must explicitly verify HermesProof setup.

If HermesProof is empty or incomplete, Claude must either:

1. Set it up directly if it has shell/git access, or
2. Create a Codex handoff to set it up.

Required HermesProof setup:

```text
README.md
package.json
package-lock.json
src/server.mjs
src/core/*.mjs
scripts/*.mjs
docs/*.md
docs/diagrams/*.svg
PROOF/latest.json
PROOF_E2E_REPORT.md
.github/workflows/truth-gates.yml
LICENSE
AGENTS.md
```

Required GitHub Actions behavior:

```text
- Run on push and pull_request
- npm ci
- npm run truth-gates -- --ci
- upload PROOF artifact
- on main push, refresh PROOF/latest.json and PROOF_E2E_REPORT.md
- avoid infinite CI loop with [skip ci]
```

Required proof:

```text
Local full truth gates: 9/9 pass
CI truth gates: pass
```

---

## 8. Hermes3D relationship requirement

The README must make this clear:

```text
HermesProof is not Hermes3D itself.
HermesProof is the proof, lock, and coordination layer for Hermes3D.
Hermes3D is the AI-driven 3D printing OS.
HermesProof lets Claude, Codex, Windsurf, and review agents work on Hermes3D safely.
```

Do not claim HermesProof prints objects, slices files, or controls printers.

HermesProof proves coordination, locking, handoffs, gates, and evidence.

---

## 9. Visual design requirements

Use a style inspired by Hermes Agent and Hermes3D:

```text
Background: deep navy / near black
Accent 1: electric cyan
Accent 2: violet / purple
Accent 3: magenta / pink
Proof pass: green
Warnings: amber
Failures: red
Typography: clean sans + monospace for proof/gates
Mood: advanced, agentic, verified, cybernetic, professional
```

SVG animation rules:

```text
✅ SMIL animation only
✅ animated gradients
✅ pulsing nodes
✅ flowing dashed lines
✅ staged checkmarks
✅ subtle scanlines
✅ no JavaScript
✅ no external fonts
✅ no external images
✅ no embedded secrets
```

---

## 10. README acceptance checklist

The final README must answer, visually:

```text
What is HermesProof?
Why does Hermes3D need it?
How do Claude and Codex avoid collisions?
What happens when one agent needs another agent's file?
How is every change proven?
What gates run?
How do I install it?
How does it connect to Claude Desktop, Claude Code, Codex, and Windsurf?
Where is the proof?
How is it inspired by Hermes Agent?
```

---

## 11. Required final response from Claude

Claude must end with:

```text
CLAUDE ARCHITECT PASS / FAIL:

Branch:
Commit:
Files created:
Files changed:
Files locked:
Files released:
Codex handoff created:
HermesProof setup status:
Hermes3D untouched except allowed read-only audit:
Truth gates required:
Known risks:
Next command for Codex:
```

If Claude cannot complete a step, it must say:

```text
I could not complete <step> because <specific reason>.
I created handoff file <path>.
Codex should start with <exact command/prompt>.
```

No vague ending.
No “continue from here” without a file.
No hidden tasks.

---

## 12. Start command for Claude

Begin now.

First, call:

```text
hermes_doctor
hermes_read_policy
```

Then create the Claude design/spec docs and Codex handoff.

Do not let Codex edit anything until the handoff is precise, locked, and source-audited.
