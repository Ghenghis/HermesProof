# Hermes3D UX-A Coordination Test

This is the first real-world coordination test for Claude + Codex + Windsurf using the MCP lock orchestrator.

## Source audit

The current UI audit found 13 actual tabs, 6 complete tabs, 7 partial tabs, and 9 UX gaps. The goal is not to add features. The goal is to make existing UI affordances honest and locked/wired correctly.

## Task split

### Claude Lead owns docs

Owner:

```text
claude-lead
```

Files:

```text
contracts/CP-UX-A_SCOPE_LOCK.md
contracts/CP-UX-A_CODEX_IMPLEMENTATION.md
contracts/CP-UX-A_REVIEW_PROMPT.md
```

Claude creates the locked scope and Codex prompt.

### Codex owns code

Owner:

```text
codex-impl-01
```

Files:

```text
03_implementation/ui/src/tabs/Dashboard.tsx
03_implementation/ui/src/tabs/Agents.tsx
03_implementation/ui/src/tabs/Workflows.tsx
03_implementation/ui/src/tabs/Gen3D.tsx
03_implementation/ui/src/tabs/BlenderMCP.tsx
03_implementation/ui/src/tabs/Slicing.tsx
03_implementation/ui/src/tabs/PrintQueue.tsx
```

Codex implements only UX-A fixes.

### Claude Reviewers inspect first

Owners:

```text
claude-reviewer-ux
claude-reviewer-tests
claude-reviewer-proof
```

Reviewers may inspect code. If they need to patch a file, they must request a handoff from `codex-impl-01` first.

## Expected conflict test

1. Codex locks `03_implementation/ui/src/tabs/Dashboard.tsx`.
2. Claude reviewer attempts to lock the same file.
3. MCP returns `blocked`.
4. Claude reviewer calls `hermes_request_handoff`.
5. Codex approves only after finishing its Dashboard work.
6. MCP transfers ownership.
7. Codex cannot continue editing Dashboard without asking for a handoff back.

## Gates

Run these through `hermes_run_gate` where applicable:

```text
git-status
npm-typecheck
npm-build
playwright
```

## Evidence

Each agent must append evidence:

```text
- scope created
- locks acquired
- conflicts/handoffs
- gates passed/failed
- files released
- final verdict
```
