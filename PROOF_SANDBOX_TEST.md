# Proof: End-to-End Sandbox Integration

This is the on-Windows proof that the orchestrator works against a real workspace through the actual MCP stdio transport, not just internal unit calls.

## Test layout

A throwaway sandbox project was built at:

```text
G:\Github\hermes3d-mcp-test-sandbox\
├── .git\                              # real git repo
├── .gitignore                         # auto-appended by init-project
├── .hermes3d_orchestrator\            # state dir created by orchestrator
│   ├── locks\                         # ephemeral
│   ├── tasks\
│   ├── handoffs\
│   ├── evidence\ledger.ndjson         # NDJSON evidence
│   ├── gates\                         # gate run reports
│   └── events.ndjson                  # append-only event log
├── README.md
├── 03_implementation\ui\src\tabs\
│   ├── Dashboard.tsx
│   ├── Agents.tsx
│   └── Workflows.tsx
└── contracts\
    ├── CP-UX-A_SCOPE_LOCK.md
    └── CP-UX-A_CODEX_IMPLEMENTATION.md
```

The layout intentionally mirrors the real `G:\Github\Hermes3D` paths verified to exist:

- `03_implementation/ui/src/tabs/Dashboard.tsx`
- `03_implementation/ui/src/tabs/Agents.tsx`
- `03_implementation/ui/src/tabs/Workflows.tsx`
- `03_implementation/ui/src/tabs/Gen3D.tsx`
- `03_implementation/ui/src/tabs/BlenderMCP.tsx`
- `03_implementation/ui/src/tabs/Slicing.tsx`
- `03_implementation/ui/src/tabs/PrintQueue.tsx`

**The real Hermes3D project was never modified.** No state dir was created in `G:\Github\Hermes3D\`; no probe files were left behind; `git status --short` reported a clean working tree after the test.

## What the integration test proved

`scripts/sandbox-integration.mjs` drives the actual `src/server.mjs` over stdio (the same way Claude Desktop, Claude Code, Codex, and Windsurf will drive it). It runs an MCP `initialize` → `tools/list` → `tools/call` sequence and asserts on each step.

```text
[ok] tools/list reports 15 tools, including doctor/policy/locks
[ok] hermes_doctor ok=true on git-initialized sandbox
[ok] hermes_read_policy reports correct workspace
[ok] claude-lead locked 2 contract files
[ok] codex-impl-01 locked 2 tab files (no conflict with claude's docs)
[ok] reviewer blocked when targeting codex-owned file
[ok] codex heartbeat refreshed 2 file lock(s)
[ok] handoff requested, id=handoff_738f37835affe36a
[ok] codex approved handoff -> ownership transferred
[ok] codex cannot silently re-lock the transferred file
[ok] git-status gate ran successfully (exit 0)
[ok] git-diff-check gate ran successfully
[ok] unknown gate rejected with allowlist enforcement
[ok] evidence ledger appended id=ev_45e6d1a97073e89f
[ok] all locks released
[ok] final state: 0 locks, 2 task records, 2 handoff records

[summary] evidence ledger entries: 6
[summary] event log entries:        26
[summary] state dir:                G:\Github\hermes3d-mcp-test-sandbox\.hermes3d_orchestrator

ALL CHECKS PASSED
```

## What the unit suite proved

`npm test` runs 12 named tests across two files:

- `scripts/coordination-smoke-test.mjs` — proves the multi-agent flow.
- `scripts/hardening-smoke-test.mjs` — proves the safety guarantees (path-escape rejection, refresh, blocked release, heartbeat, stale recovery, unknown gate id, escaped cwd, doctor on missing workspace, policy shape, custom state dir, malformed state dir name).

```text
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

## Sample evidence ledger entries (NDJSON)

```json
{"id":"gate_git-status_1777752595440","kind":"gate","summary":"git-status: PASS","data":{"exit_code":0,"duration_ms":44,"cwd":"G:\\Github\\hermes3d-mcp-test-sandbox"}}
{"id":"gate_git-diff-check_1777752595478","kind":"gate","summary":"git-diff-check: PASS","data":{"exit_code":0,"duration_ms":36}}
{"id":"ev_45e6d1a97073e89f","kind":"integration-test","summary":"End-to-end sandbox flow proved","owner":"claude-reviewer-ux","task_id":"CP-UX-A-REVIEW"}
```

## Sample event log entries (NDJSON)

```json
{"type":"lock.acquired","owner":"codex-impl-01","files":["03_implementation/ui/src/tabs/Agents.tsx","03_implementation/ui/src/tabs/Dashboard.tsx"]}
{"type":"lock.blocked","owner":"claude-reviewer-ux","conflicts":[{"file":"03_implementation/ui/src/tabs/Dashboard.tsx","current_owner":"codex-impl-01","is_stale":false}]}
{"type":"handoff.requested","request_id":"handoff_738f37835affe36a","requester":"claude-reviewer-ux","current_owner":"codex-impl-01"}
{"type":"handoff.decided","decision":"approve"}
{"type":"lock.blocked","owner":"codex-impl-01","conflicts":[{"current_owner":"claude-reviewer-ux"}]}
{"type":"lock.released","owner":"claude-reviewer-ux","files":["03_implementation/ui/src/tabs/Dashboard.tsx"]}
```

## Reproducing locally

```powershell
# 1. Build a fresh sandbox (NOT inside G:\Github\Hermes3D).
$sb = "G:\Github\hermes3d-mcp-test-sandbox"
Remove-Item $sb -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path "$sb\03_implementation\ui\src\tabs" -Force | Out-Null
New-Item -ItemType Directory -Path "$sb\contracts" -Force | Out-Null
"// Dashboard"   | Set-Content "$sb\03_implementation\ui\src\tabs\Dashboard.tsx"
"// Agents"      | Set-Content "$sb\03_implementation\ui\src\tabs\Agents.tsx"
"// Workflows"   | Set-Content "$sb\03_implementation\ui\src\tabs\Workflows.tsx"
"# scope"        | Set-Content "$sb\contracts\CP-UX-A_SCOPE_LOCK.md"
"# codex prompt" | Set-Content "$sb\contracts\CP-UX-A_CODEX_IMPLEMENTATION.md"
"# sandbox"      | Set-Content "$sb\README.md"
git -C $sb init -q -b main
git -C $sb add -A
git -C $sb -c user.email=sandbox@local -c user.name=sandbox commit -qm "sandbox: initial layout"

# 2. Initialize the orchestrator against it.
cd G:\Github\hermes3d-mcp-lock-orchestrator
npm install
npm test
node scripts/init-project.mjs --workspace $sb --server-name "sandbox-locks"

# 3. Run the end-to-end integration probe.
node scripts/sandbox-integration.mjs --workspace $sb

# 4. Inspect evidence and event logs.
Get-Content "$sb\.hermes3d_orchestrator\evidence\ledger.ndjson"
Get-Content "$sb\.hermes3d_orchestrator\events.ndjson"

# 5. (optional) Clean up.
Remove-Item $sb -Recurse -Force
```
