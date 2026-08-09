# HermesProof — Tool Reference

The server exposes 119 MCP tools across coordination, workspace switching, workspace release hygiene, project connection, workspace bug tickets, testing/release mode, project contracts, anti-slop reviews, claim audits/correction packets, agentic loop ticks, agent watchdog recovery, agent profiles, agent presence, inbox messaging, assistance routing, skills routing, unlock requests, live status, event long-polling, backend/GitLab readiness, GitLab project and merge-request work, WinMerge comparison, gates, evidence, events, queue pickup, anonymous orchestration, provider-performance routing, KiloCode/OpenHands delegation governance, KiloCode project guardrails, KiloCode agent-bus proof enforcement, A2A task exchange, Hermes Agent bridging, HP-MHA Model–Harness Attribution, and diagnostics.

<div align="center">
<img src="./diagrams/architecture.svg" alt="HermesProof architecture showing the MCP tools surfaced over stdio JSON-RPC" width="100%"/>
</div>

| Group           | Tools                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Claim / release | `hermes_claim_task`, `hermes_release_task`                                                                                                  |
| Lock            | `hermes_lock_files`, `hermes_release_files`, `hermes_heartbeat`, `hermes_list_locks`, `hermes_recover_stale_locks`                         |
| Handoff         | `hermes_request_handoff`, `hermes_request_unlock`, `hermes_approve_handoff`, `hermes_create_blocked_handoff`                                 |
| Gate            | `hermes_run_gate`, `hermes_list_gates`                                                                                                      |
| Evidence        | `hermes_append_evidence`, `hermes_verify_evidence`                                                                                          |
| Events          | `hermes_list_events`, `hermes_emit_event`, `hermes_mark_event_handled`                                                                      |
| Queue           | `hermes_enqueue_task`, `hermes_list_pending_tasks`, `hermes_pick_task`, `hermes_recover_stale_tasks`                                        |
| Workspace       | `hermes_get_workspace`, `hermes_set_workspace`, `hermes_connect_project`, `hermes_workspace_hygiene`                                        |
| Test / Tickets  | `hermes_get_test_mode`, `hermes_set_test_mode`, `hermes_report_bug`, `hermes_list_bug_tickets`, `hermes_update_bug_ticket`, `hermes_submit_bug_fix` |
| Contracts       | `hermes_upsert_project_contract`, `hermes_list_project_contracts`, `hermes_read_project_contract`, `hermes_anti_slop_review`, `hermes_list_contract_reviews` |
| Claim Audit     | `hermes_decompose_claims`, `hermes_audit_claims`, `hermes_list_claim_audits`, `hermes_agentic_tick`                                 |
| Watchdog        | `hermes_agent_watchdog`                                                                                                                |
| Realtime        | `hermes_live_status`, `hermes_wait_for_events`                                                                                              |
| Backend         | `hermes_backend_status`                                                                                                                     |
| GitLab          | `hermes_gitlab_status`, `hermes_gitlab_ensure_project`, `hermes_gitlab_list_merge_requests`, `hermes_gitlab_create_merge_request`, `hermes_gitlab_ultimate_status`, `hermes_gitlab_bootstrap_ultimate` |
| Compare         | `hermes_winmerge_status`, `hermes_winmerge_compare`                                                                                         |
| Profiles        | `hermes_register_agent_profile`, `hermes_get_agent_profile`, `hermes_list_agent_profiles`, `hermes_update_agent_capabilities`, `hermes_join_project` |
| Presence        | `hermes_update_presence`, `hermes_list_presence`, `hermes_find_agents`                                                                      |
| Assistance      | `hermes_request_assistance`, `hermes_wait_for_assistance`                                                                                   |
| Inbox           | `hermes_send_message`, `hermes_get_inbox`, `hermes_wait_for_inbox`, `hermes_ack_message`                                                    |
| Completion      | `hermes_wait_for_unlock`, `hermes_complete_work`                                                                                            |
| Diagnostics     | `hermes_get_state`, `hermes_doctor`, `hermes_read_policy`                                                                                   |
| Anonymous       | `hermes_list_agents`, `hermes_anonymous_claim`, `hermes_anonymous_release`, `hermes_anonymous_state`, `hermes_record_outcome`, `hermes_record_task` |
| Dispatch        | `hermes_dispatch_recommend`                                                                                                                 |
| Providers       | `hermes_provider_record_outcome`, `hermes_provider_stats`, `hermes_provider_rank`                                                           |
| KiloCode        | `hermes_kilocode_status`, `hermes_kilocode_set_guardrails`, `hermes_kilocode_policy_check`, `hermes_kilocode_checkpoint_progress`, `hermes_kilocode_evaluate_installed_vsix_release_proof`, `hermes_kilocode_evaluate_roadmap_completion_proof`, `hermes_kilocode_record_delegation`, `hermes_kilocode_evaluate_agent_bus_event`, `hermes_kilocode_record_agent_bus_event`, `hermes_kilocode_evaluate_infrastructure_proof`, `hermes_kilocode_record_infrastructure_proof` |
| USER session    | `hermes_user_grant_session`, `hermes_user_revoke_session`, `hermes_user_check_authorization`                                                |
| A2A             | `hermes_a2a_create_task`, `hermes_a2a_get_task`, `hermes_a2a_update_task`, `hermes_a2a_list_tasks`                                          |
| Hermes Agent | `hermes_agent_health`, `hermes_agent_request_user_session`, `hermes_agent_resolve_blocked`, `hermes_agent_revoke_session` |
| Hybrid helpers | `hermes_helper_runtime_evaluate`, `hermes_helper_runtime_evaluate_consensus`, `hermes_staleness_evaluate` |
| HP-MHA          | `hermes_hp_mha_harness_card_record`, `hermes_hp_mha_experiment_plan_lock`, `hermes_hp_mha_benchmark_run_attest`, `hermes_hp_mha_trace_bundle_verify`, `hermes_hp_mha_trace_index_record`, `hermes_hp_mha_trace_search`, `hermes_hp_mha_trace_metrics`, `hermes_hp_mha_trace_prune`, `hermes_hp_mha_model_harness_attribution`, `hermes_hp_mha_promotion_evaluate`, `hermes_hp_mha_experiment_report`, `hermes_hp_mha_sub_gate` |

---

## hermes_get_state

Returns active locks, tasks, handoff requests, workspace root, and state directory.

## hermes_get_workspace

Returns the active workspace root, state directory, registry-provider load status, environment mapping, and recent runtime workspace switches. Use this before locking files when multiple projects share one MCP server process.

```json
{}
```

## hermes_set_workspace

Switches the active workspace root for later HermesProof tool calls. The target has to be an existing absolute directory. The tool writes `workspace.switch` evidence in the target workspace. If the current workspace still has active locks, the switch is rejected unless `allowActiveLocks` is explicitly true.

```json
{
  "owner": "codex-impl-01",
  "workspaceRoot": "G:\\Github\\AI-CE",
  "reason": "Coordinate Codex and KiloCode on AICE",
  "allowActiveLocks": false
}
```

## hermes_connect_project

Switches to a workspace, optionally finds/creates the GitLab project, optionally adds or updates a local git remote, publishes the caller's agent presence, and returns inbox/live/backend status in one redacted response. Use this when an agent moves from one repo to another or joins a project after work has already started.

```json
{
  "owner": "codex-impl-01",
  "workspaceRoot": "G:\\Github\\AI-CE",
  "projectFullPath": "Ghenghis/AICE",
  "ensureGitLabProject": false,
  "addRemote": true,
  "remoteName": "ghenghis-aice",
  "remoteProtocol": "ssh",
  "status": "idle",
  "skills": ["code", "review", "gitlab"],
  "taskTypes": ["release", "repair"]
}
```

## hermes_workspace_hygiene

Read-only dirty-to-clean inspection for the active workspace. It uses real `git status --porcelain=v1`, classifies tracked modifications, unexpected untracked files, leaked MCP probe files, install-related `.gitignore` changes, and reviewed expected-diff manifests. A current hash-bound manifest can make a recovery batch eligible for focused work, but never makes it release-ready. Only a zero-dirty tree returns `pass` / `clean`. It never runs `git reset`, `git clean`, `git stash`, checkout, delete, move, stage, or commit commands.

```json
{
  "expectedManifestPath": ".hermes3d_orchestrator/expected-diff.json",
  "allowExpectedDirty": false
}
```

`allowExpectedDirty` is retained for caller compatibility and cannot bypass the clean-release rule. The result contains a factual `verdict`: `pass`/`proven`, `blocked`/`insufficient`, or `fail`/`rejected`, alongside a non-destructive recovery plan.

## hermes_storage_census

Read-only bounded storage census for approved project, temporary, build, and artifact roots. It reports aggregate file count, bytes, age bands, and metadata-only retention classes. An unknown group, unreadable directory, or file-limit cutoff returns `blocked`; the tool does not read content, delete files, or label anything safe to delete.

```json
{
  "roots": ["G:\\Github\\kilocode-2026-openhands\\test-results"],
  "maxFiles": 10000,
  "maxDepth": 8,
  "groupDepth": 1
}
```

The requested roots must be inside the active workspace or an explicit `HERMESPROOF_STORAGE_ROOTS` allowlist. Use the report to preserve, quarantine, or review data before any separately approved cleanup.

## hermes_set_test_mode

Enables workspace testing mode or returns the workspace to release mode. Testing mode is project-local, so switching from HermesProof to AI-CE switches to that workspace's own mode and ticket board.

```json
{
  "owner": "codex-impl-01",
  "mode": "testing",
  "reason": "KiloCode is reporting findings during release hardening",
  "releaseBlockingOpenTickets": true
}
```

## hermes_get_test_mode

Reads the active workspace testing/release flag and whether open tickets block release readiness.

```json
{}
```

## hermes_report_bug

Creates a workspace-local bug ticket from an agent finding, emits `bug.reported`, notifies active agents, and can enqueue the ticket as a normal HermesProof repair task.

```json
{
  "reporter": "kilocode-fix-01",
  "ticketId": "aice-chat-scan-types",
  "title": "AICE Chat scan type dropdown hides CE value types",
  "severity": "high",
  "files": ["src/aice_chat/agent_chat.py"],
  "reproduction": "Open the panel and compare its value types to Cheat Engine.",
  "expected": "Full CE scan type surface is available.",
  "actual": "Only a reduced subset appears.",
  "tags": ["aice", "scan", "ui"],
  "enqueue": true
}
```

## hermes_list_bug_tickets

Lists active or historical tickets for the current workspace. Use this before picking work so agents can avoid duplicating each other.

```json
{
  "status": "active",
  "releaseBlockersOnly": true,
  "limit": 50
}
```

## hermes_update_bug_ticket

Assigns, triages, reopens, closes, downgrades, or annotates a ticket with evidence.

```json
{
  "owner": "codex-impl-01",
  "ticketId": "aice-chat-scan-types",
  "status": "assigned",
  "assignee": "kilocode-fix-01",
  "note": "Take the Lua panel; Codex is handling Python normalization."
}
```

## hermes_submit_bug_fix

Attaches a fix result to a ticket with branch, commit, MR URL, changed files, and gate evidence. This does not bypass file locks or release gates; it records the fix for review.

```json
{
  "owner": "kilocode-fix-01",
  "ticketId": "aice-chat-scan-types",
  "summary": "Expanded CE scan types and added proof tests.",
  "branch": "kilocode/aice-scan-types",
  "commit": "abc123",
  "gates": [{ "gate": "python -m pytest", "status": "pass" }],
  "files": ["external/cheatengine-mcp-bridge/ce_chat_panel.lua"],
  "verdict": "submitted"
}
```

## hermes_upsert_project_contract

Creates or updates a workspace-local contract that tells every connected agent what claims require proof, which paths are protected, which gates count, and when risky findings should become tickets.

```json
{
  "owner": "codex-impl-01",
  "contractId": "aice-release-contract",
  "scope": "AI-CE and Cheat Engine Chat release work",
  "requiredGates": ["python -m pytest", "python scripts/_proof_check.py"],
  "protectedPaths": [".gitlab-ci.yml", "external/", "aice_chat/"],
  "autoTicketThreshold": "high"
}
```

## hermes_list_project_contracts

Lists saved project contracts for the active workspace. By default it also returns the virtual `project-truth-contract` so agents always have a baseline rule set.

```json
{
  "includeDefault": true,
  "limit": 50
}
```

## hermes_read_project_contract

Reads one contract by id. Use this before major edits, release claims, or handoffs so all agents judge completeness against the same rules.

```json
{
  "contractId": "project-truth-contract"
}
```

## hermes_anti_slop_review

Runs a bounded, fast review of a proposed completion claim, changed files, gates, and optional summaries. It flags unproven release claims, protected-path edits without passing gates, large blast radius without review, secret-like patterns, and destructive workflow patterns. High or critical findings can automatically open a shared bug ticket.

```json
{
  "owner": "kilocode-review-01",
  "taskId": "aice-chat-release-check",
  "claim": "CE Chat scan types repaired; pytest and proof check passed.",
  "files": ["aice_chat/agent_chat.py", "external/cheatengine-mcp-bridge/ce_chat_panel.lua"],
  "gates": [
    { "gate": "python -m pytest", "status": "pass" },
    { "gate": "python scripts/_proof_check.py", "status": "pass" }
  ],
  "scanFileContent": true,
  "maxFilesToScan": 25,
  "autoTicket": true
}
```

## hermes_decompose_claims

Splits an agent answer into structured claims with type, severity, confidence,
and `needs_grounding`. Use this before accepting long status reports or
provider output as truth.

```json
{
  "text": "Everything is fixed and release ready. npm test: 316 passed.",
  "maxClaims": 40
}
```

## hermes_audit_claims

Runs the agentic hallucination guard. HermesProof decomposes claims, checks
them against supplied evidence/gates/project contracts, stores a correction
packet, emits `claim.audit.passed` or `claim.audit.failed`, can open a ticket,
and can record provider outcomes for routing.

```json
{
  "owner": "minimax-controller",
  "taskId": "pacman-timer-scan",
  "text": "Timer freeze is complete and all tests passed.",
  "gates": [],
  "evidence": [],
  "latencyMode": "instant",
  "generatorProvider": "minimax",
  "auditorProvider": "deepseek"
}
```

## hermes_list_claim_audits

Lists stored claim audits and correction packets so later agents can resume
from the exact unsupported claims, grounding requests, and provider outcomes.

```json
{
  "status": "needs_correction",
  "limit": 25
}
```

## hermes_agentic_tick

Runs one bounded coordination step for agentic work. The tick audits the latest
agent output, ranks provider candidates such as MiniMax, DeepSeek, SiliconFlow,
LM Studio, and Ollama, checks active agents, queues correction/grounding work
when needed, notifies helpers, and emits an `agentic.tick` event.

```json
{
  "owner": "minimax-controller",
  "taskId": "pacman-loop",
  "mode": "autopilot",
  "objective": "Find PAC-MAN timer and speed addresses",
  "latestOutput": "Timer freeze is complete and all tests passed.",
  "providerCandidates": ["minimax", "deepseek", "siliconflow", "lm-studio"],
  "primaryProvider": "minimax",
  "keepGoing": true,
  "progressSignals": ["bridge reachable", "candidate count decreased"]
}
```

## hermes_agent_watchdog

Checks whether connected agents are stale, idle too long, or holding claimed
tasks with old heartbeats. It returns a recovery checkpoint with task ids,
owned locks, queued work, last presence, and last evidence pointer. In active
mode it can poke agents through durable inbox messages, emit watchdog events,
recover stale locks/tasks, and enqueue resume work for another agent.

```json
{
  "owner": "watchdog-agent",
  "targetOwners": ["minimax-controller"],
  "idleSeconds": 300,
  "taskHeartbeatSeconds": 300,
  "poke": true,
  "recover": false,
  "enqueueRecovery": true
}
```

## hermes_provider_record_outcome

Records proof-backed model-provider performance by project and task lane. Use it when an agent finishes or fails a provider-backed job, for example MiniMax live CE control, DeepSeek reverse-analysis planning, SiliconFlow embedding recall, or LM Studio vision review. This updates `.hermes3d_orchestrator/provider_performance.json`; it does not call any provider and does not store secrets.

```json
{
  "provider_id": "minimax",
  "model_name": "MiniMax-M3",
  "task_type": "aice_live_controller",
  "outcome": "verified",
  "reward": 1,
  "latency_ms": 820,
  "context": "PAC-MAN timer scan narrowed and table row added",
  "evidence": "AICE live proof 30/30 ce_ping"
}
```

## hermes_provider_stats

Reads provider score, success rate, failure rate, average reward, latency, and recommendation. Use `task_type` to keep lanes separate; a provider can be good at embeddings and bad at live CE control without one result polluting the other.

```json
{
  "provider_id": "siliconflow",
  "task_type": "embedding_recall",
  "include_history": true
}
```

## hermes_provider_rank

Ranks providers for a task. Unknown providers keep a neutral baseline so new models can be tried; providers with repeated proof-backed failures are pushed down or marked `avoid`.

```json
{
  "task_type": "pacman_timer_scan",
  "candidates": ["minimax", "deepseek", "siliconflow", "lm-studio"],
  "min_score": 0
}
```

## hermes_kilocode_status

Returns a redacted readiness snapshot for KiloCode using OpenHands through HermesProof. It reports whether MiniMax and OpenHands-related environment names are present, whether the Hermes Agent bridge is enabled, provider-registry health, current project guardrails, visual-progress checkpoint timing, and optional provider ranking for `kilocode_openhands_delegation`. It never returns secret values.

```json
{
  "includeProviderRank": true,
  "candidates": ["minimax", "deepseek", "siliconflow", "lm-studio", "ollama"],
  "task_type": "kilocode_openhands_delegation"
}
```

## hermes_kilocode_set_guardrails

Updates workspace-local KiloCode project guardrails. These are active controls for project completion: MVP-first work, visual proof, screenshot checkpoints, blocked new scope until the current milestone is usable, focus mode, and `hyperfocus_visual_mode`. The tool stores only booleans, interval values, and a redacted reason.

```json
{
  "owner": "kilocode-agent",
  "reason": "keep first usable milestone visible",
  "mvp_first": true,
  "require_visual_proof": true,
  "block_until_usable": true,
  "hyperfocus_visual_mode": true
}
```

## hermes_kilocode_policy_check

Evaluates whether KiloCode should handle a task locally, delegate to OpenHands, ask first, or deny delegation because the request contains raw secrets or violates active project guardrails. It is a policy check only; it does not start OpenHands, call a model, or execute commands. Responses include `guardrail_goals`, `required_actions`, `visual_proof_required`, `blocked_by_guardrails`, and checkpoint timing.

```json
{
  "trigger": "ssh",
  "risk": "high",
  "capabilities": ["ssh", "external_network"],
  "explicit": false,
  "repeated_failures": 2,
  "action_summary": "inspect approved VPS logs without embedding credentials",
  "scope_change": false,
  "visual_proof_provided": false,
  "current_milestone_usable": false
}
```

## hermes_kilocode_checkpoint_progress

Records a real KiloCode milestone checkpoint with optional visual proof paths, gate results, usable/complete status, guardrail effects, and hash-chained HermesProof evidence. If `visual_proof_paths` are supplied, HermesProof verifies the paths exist before recording the checkpoint.

```json
{
  "owner": "kilocode-agent",
  "milestone_id": "first-screen",
  "milestone_goal": "Make the first project screen usable",
  "status": "usable",
  "summary": "The first screen launches and is visible.",
  "visual_proof_paths": ["proof/first-screen.png"],
  "gates": [{ "gate": "manual visual proof", "status": "pass", "evidence": "proof/first-screen.png exists" }],
  "next_action": "Run OpenHands delegation smoke",
  "current_milestone_usable": true
}
```

## hermes_kilocode_evaluate_installed_vsix_release_proof

Evaluates KiloCode's strict installed-VSIX release contract without writing evidence. The proof must use contract version `kilocode.e2e-proof-contract.2026-07-10`, bind to an installed VSIX SHA-256, include every required gate snapshot and heartbeat, prove real OpenHands/Aider/Goose results where claimed, and include all required `preflightResults`.

HermesProof applies the same special checks as KiloCode for `visible-ui-driver`, `settings-ui-driver`, and `chat-task`. It recursively rejects mock, fake, stub, simulated, skipped, or UI-only metadata. A focused artifact can diagnose a surface, but it is not a release pass.

```json
{
  "proof": {
    "schema": "kilocode.installed_vsix.release.v1",
    "contractVersion": "kilocode.e2e-proof-contract.2026-07-10",
    "vsixSha256": "<64-hex-sha256>",
    "gates": {},
    "heartbeat": [],
    "preflightResults": {}
  },
  "required_gate_count": 21
}
```

The authoritative KiloCode policy is `ci/e2e-gate-proof-policy.json`; the current operational explanation is `docs/current-e2e-recovery-contract-2026-07-10.md`. A change to either contract requires a matching HermesProof evaluator and test update.

## hermes_kilocode_evaluate_roadmap_completion_proof

Evaluates completion claims for KiloCode's roadmap and action plan without writing evidence. Completed items require a real `ev_*` id, runner command or API path, status and duration, and a hashed artifact. Required truth documents include `ROADMAP.md`, `ACTION_PLAN.md`, `HANDOFF.md`, the current E2E recovery contract, real-E2E governance, and the machine-readable policy.

```json
{
  "proof": {
    "schema": "kilocode.roadmap_completion.v1",
    "docs": [
      "ROADMAP.md",
      "ACTION_PLAN.md",
      "HANDOFF.md",
      "docs/current-e2e-recovery-contract-2026-07-10.md",
      "docs/real-e2e-proof-governance.md",
      "ci/e2e-gate-proof-policy.json"
    ],
    "items": []
  },
  "require_all_complete": true
}
```

## hermes_kilocode_record_delegation

Records a completed KiloCode/OpenHands sidecar result in both provider-performance stats and the hash-chained evidence ledger. Inputs are redacted before storage, so callers should still pass summaries and proof references rather than raw prompts, private file contents, or secrets.

```json
{
  "owner": "kilocode-agent",
  "task_id": "repo-setup-smoke",
  "provider_id": "minimax",
  "model_name": "MiniMax-M3",
  "openhands_conversation_id": "conversation-reference",
  "trigger": "missing_tool",
  "risk": "medium",
  "outcome": "verified",
  "latency_ms": 1200,
  "summary": "OpenHands completed the missing terminal setup step.",
  "evidence": "smoke-test passed",
  "permission_decision": "allow",
  "secret_scan": "passed"
}
```

## hermes_winmerge_status

Detects local WinMerge, reports the resolved executable, and lists safe compare
roots. Secret values and private paths are not returned.

```json
{}
```

## hermes_winmerge_compare

Launches WinMerge for a two-way or optional three-way compare between existing
safe paths. Use this to compare copied experiment workspaces against baselines
or to review agent edits before closing a ticket. Paths must stay under the
active workspace, `HERMES_WINMERGE_ALLOWED_ROOTS`, or the approved local
`G:\Github` lab root, and private/env/git paths are rejected.

```json
{
  "owner": "codex-impl-01",
  "leftPath": "G:\\Github\\Steam_Games\\PAC-MAN Championship Edition DX+",
  "rightPath": "G:\\Github\\Steam_Games\\_aice_workspaces\\PAC-MAN\\run-001\\baseline\\files",
  "recursive": true,
  "readOnly": false,
  "wait": false
}
```

## hermes_list_contract_reviews

Lists recent anti-slop reviews, including verdicts, severity, linked tickets, and duration. Agents use this as a shared quality board before duplicating review work.

```json
{
  "verdict": "needs_review",
  "limit": 25
}
```

## hermes_backend_status

Returns a redacted backend/API readiness snapshot. Secret values and private env-file paths are never returned; only env var names, booleans, and source labels are shown.

```json
{ "includeCli": true }
```

## hermes_gitlab_status

Checks GitLab configuration and optional API authentication with a supported GitLab token env var or the dedicated GitLab env file. Use `probe:false` for a local redacted config check without a network call.

```json
{
  "probe": true,
  "includeIdentity": false
}
```

## hermes_gitlab_ensure_project

Finds or creates a GitLab project, records evidence, emits `gitlab.project.ready`, and can optionally add or update a local git remote in the active workspace.

```json
{
  "owner": "codex-impl-01",
  "namespacePath": "Ghenghis",
  "projectPath": "AI-CE",
  "visibility": "private",
  "description": "AICE workspace coordination repo",
  "addRemote": true,
  "remoteName": "gitlab",
  "remoteProtocol": "ssh",
  "updateExistingRemote": false
}
```

## hermes_gitlab_list_merge_requests

Lists GitLab merge requests for a project using env-provided credentials. Returns merge-request metadata only.

```json
{
  "projectFullPath": "Ghenghis/AI-CE",
  "state": "opened",
  "sourceBranch": "codex/hermesproof-workspace-realtime-unlocks",
  "limit": 20
}
```

## hermes_gitlab_create_merge_request

Creates a GitLab merge request, or returns the existing open MR for the same source/target branch. Records evidence and emits `gitlab.merge_request.ready`.

```json
{
  "owner": "codex-impl-01",
  "projectFullPath": "Ghenghis/AI-CE",
  "sourceBranch": "codex/hermesproof-workspace-realtime-unlocks",
  "targetBranch": "main",
  "title": "HermesProof realtime coordination improvements",
  "description": "Proof: npm test and truth gates.",
  "draft": true,
  "removeSourceBranch": false,
  "labels": ["hermesproof", "agent-coordination"]
}
```

## hermes_gitlab_ultimate_status

Checks whether one GitLab project has the high-value Ultimate controls HermesProof can automate: merge pipeline/status gates, merge trains, protected default branch, CODEOWNER approval, approval settings, and approval rules.

```json
{
  "projectFullPath": "Ghenghis/HermesProof",
  "defaultBranch": "main"
}
```

## hermes_gitlab_bootstrap_ultimate

Idempotently applies the last-day GitLab Ultimate capture workflow: project merge/security settings, approval settings, protected default branch with CODEOWNER approval, optional approval rule, CODEOWNERS, a HermesProof GitLab CI include with security/proof jobs, a policy template, and a governance MR. Existing root `.gitlab-ci.yml` files are preserved; HermesProof only creates a root CI file when the project does not already have one.

```json
{
  "owner": "codex-impl-01",
  "projectFullPath": "Ghenghis/HermesProof",
  "defaultBranch": "main",
  "codeOwnerRefs": ["@Ghenghis"],
  "approverUsernames": [],
  "commitReleaseFiles": true,
  "createGovernanceMergeRequest": true,
  "dryRun": false
}
```

## hermes_register_agent_profile

Persists a structured per-owner capability profile and optionally syncs it into live presence for routing.

```json
{
  "owner": "minimax-m3-cechat-01",
  "displayName": "MiniMax M3 in Cheat Engine Chat",
  "host": "cheat-engine-chat",
  "model": "minimax-m3",
  "mode": "release-operator",
  "role": "builder",
  "skills": ["code", "docs", "testing", "release", "gitlab"],
  "taskTypes": ["build", "repair", "review", "release"],
  "hostSupplies": ["filesystem-read-write", "shell", "git"],
  "hermesproofSupplies": ["locks", "gates", "evidence", "inbox"],
  "workspaceRoots": ["G:\\Github\\AI-CE"],
  "releaseGates": ["npm test", "node scripts/truth-gates.mjs --ci"],
  "gitRemotes": ["gitlab:Ghenghis/AI-CE"],
  "notes": "High-trust user-owned host agent.",
  "updatePresence": true
}
```

## hermes_get_agent_profile

Reads one agent profile, optionally including the current presence record.

```json
{
  "owner": "minimax-m3-cechat-01",
  "includePresence": true
}
```

## hermes_list_agent_profiles

Lists profiles with optional filtering by skill, task type, host, mode, and presence.

```json
{
  "requiredSkills": ["gitlab", "release"],
  "taskType": "release",
  "host": "cheat-engine-chat",
  "mode": "release-operator",
  "includePresence": true,
  "limit": 10
}
```

## hermes_update_agent_capabilities

Merges or replaces capability tags on an existing profile and can sync the changed skills/task types back into presence.

```json
{
  "owner": "minimax-m3-cechat-01",
  "skills": ["python", "aice"],
  "taskTypes": ["review"],
  "hostSupplies": ["browser-automation"],
  "releaseGates": ["python -m pytest"],
  "gitRemotes": ["gitlab:Ghenghis/HermesProof"],
  "notes": "Added Python and AICE review capability.",
  "merge": true,
  "updatePresence": true
}
```

## hermes_join_project

Registers or refreshes an agent profile, publishes live presence, and returns the durable inbox, profile list, recent outbox events, and backend status. This is the preferred first call for agents that connect after work has already started.

```json
{
  "owner": "kilocode-fix-01",
  "displayName": "KiloCode repair agent",
  "host": "kilocode",
  "model": "minimax-m3",
  "mode": "coordinated-dev",
  "role": "builder",
  "status": "idle",
  "skills": ["code", "docs", "testing", "gitlab"],
  "taskTypes": ["repair", "review", "release"],
  "hostSupplies": ["filesystem-read-write", "shell", "git"],
  "hermesproofSupplies": ["locks", "gates", "evidence", "inbox"],
  "workspaceRoots": ["G:\\Github\\AI-CE"],
  "notes": "Ready to pick up handoffs."
}
```

## hermes_update_presence

Writes the caller's live status, current task, files, advertised skills, task affinities, wait reason, and expiry.

```json
{
  "owner": "codex-impl-01",
  "status": "working",
  "taskId": "release-prep",
  "files": ["src/server.mjs"],
  "skills": ["python", "docs", "testing"],
  "taskTypes": ["build", "release"],
  "note": "Finishing release prep",
  "canInterrupt": true,
  "ttlSeconds": 300
}
```

## hermes_list_presence

Lists live and stale agent presence records for the active workspace.

```json
{ "includeStale": true }
```

## hermes_find_agents

Ranks live agents by advertised skills, task affinity, interrupt preference, current lock load, and learned dispatch history.

```json
{
  "requiredSkills": ["review", "docs"],
  "taskType": "review",
  "includeBusy": false,
  "limit": 5
}
```

## hermes_request_assistance

Routes a help request to the active agent pool by required skills and task type, writes durable inbox requests to the best candidates, and emits `assistance.requested`. Candidate ranking blends live presence, interrupt preference, active lock load, and learned dispatch/reputation history. Recipients can acknowledge, reply, review, or request a lock handoff if they need file ownership.

```json
{
  "requester": "codex-impl-01",
  "requiredSkills": ["review", "python"],
  "taskType": "review",
  "subject": "Need help reviewing the backend bridge",
  "body": "Please check the GitLab MR path and truth-gate output.",
  "taskId": "release-prep",
  "files": ["src/server.mjs", "src/core/gitlab-client.mjs"],
  "priority": "high",
  "responseDeadlineSeconds": 300,
  "includeBusy": false,
  "limit": 3
}
```

## hermes_wait_for_assistance

Long-polls the acknowledgement state for an assistance request until one candidate accepts, all candidates decline, the response deadline expires, or the wait timeout elapses.

```json
{
  "requester": "codex-impl-01",
  "messageIds": ["msg_..."],
  "responseDeadlineUtc": "2026-07-02T13:45:00.000Z",
  "timeoutMs": 25000,
  "pollMs": 500
}
```

## hermes_send_message

Writes durable inbox messages to one or more agents and emits `message.sent`.

```json
{
  "sender": "codex-impl-01",
  "recipients": ["kilocode-reviewer"],
  "type": "ping",
  "priority": "normal",
  "subject": "Review availability",
  "body": "Can you review the release prep?",
  "taskId": "release-prep",
  "files": ["docs/release.md"]
}
```

## hermes_get_inbox

Reads durable inbox messages for one owner.

```json
{
  "owner": "kilocode-reviewer",
  "includeAcked": false,
  "limit": 25
}
```

## hermes_wait_for_inbox

Long-polls one agent's durable inbox until a matching unread message exists or the timeout expires. Use this for realtime-ish agent interaction without polling global events in a tight loop.

```json
{
  "owner": "kilocode-reviewer",
  "type": "assistance_request",
  "timeoutMs": 25000,
  "pollMs": 500,
  "limit": 25
}
```

## hermes_ack_message

Marks one inbox message acknowledged, done, or dismissed and emits `message.acked`.

```json
{
  "owner": "kilocode-reviewer",
  "messageId": "msg_...",
  "status": "acknowledged",
  "note": "I can review it now.",
  "notifySender": true
}
```

## hermes_wait_for_unlock

Waits until requested files are available, transferred, denied, stale, or timed out.

```json
{
  "requester": "kilocode-reviewer",
  "files": ["src/server.mjs"],
  "timeoutMs": 30000,
  "pollMs": 1000
}
```

## hermes_complete_work

Records completion evidence, releases owned locks, optionally releases the task, updates presence, preserves advertised skills, notifies recipients, and emits `work.completed`.

```json
{
  "owner": "kilocode-reviewer",
  "taskId": "release-review",
  "files": ["docs/release.md"],
  "summary": "Review complete and lock released.",
  "status": "completed",
  "notifyRecipients": ["codex-impl-01"]
}
```

## hermes_claim_task

Claims a task before editing.

Required:

```json
{ "owner": "codex-impl-01", "taskId": "CP-UX-A-CODEX" }
```

## hermes_lock_files

Atomically locks files. If one file is blocked, all newly acquired locks in that call are rolled back.

```json
{
  "owner": "codex-impl-01",
  "taskId": "CP-UX-A-CODEX",
  "files": ["03_implementation/ui/src/tabs/Dashboard.tsx"],
  "reason": "Implement UX-A Dashboard fixes."
}
```

## hermes_request_handoff

Asks a current owner to transfer locks.

```json
{
  "requester": "claude-reviewer-ux",
  "currentOwner": "codex-impl-01",
  "files": ["03_implementation/ui/src/tabs/Dashboard.tsx"],
  "reason": "Reviewer needs to apply one approved patch."
}
```

## hermes_request_unlock

Creates handoff requests for locked files without requiring the requester to know the current owner first. Unlocked files and files already owned by the requester are reported separately. Active owners can watch `handoff.created` through `hermes_wait_for_events`, `hermes_live_status`, or `hermes_get_inbox`, then approve with `hermes_approve_handoff`. Stale owners are not inbox-blocking; the tool reports `stale_available` and recommends `hermes_recover_stale_locks`.

```json
{
  "requester": "codex-impl-01",
  "files": ["src/example.mjs", "docs/release.md"],
  "reason": "Need release-prep edits",
  "taskId": "release-prep"
}
```

## hermes_approve_handoff

Approves or denies a handoff. Only the current lock owner can do this.

```json
{
  "owner": "codex-impl-01",
  "requestId": "handoff_...",
  "decision": "approve",
  "note": "Dashboard edits completed. Reviewer may patch."
}
```

## hermes_run_gate

Runs allowlisted gates only.

```json
{ "owner": "codex-impl-01", "gateId": "npm-build", "cwd": "03_implementation/ui" }
```

## hermes_append_evidence

Appends evidence to `.hermes3d_orchestrator/evidence/ledger.ndjson`.

```json
{ "owner": "codex-impl-01", "kind": "build", "summary": "npm-build PASS", "data": { "duration_ms": 4321 } }
```

## hermes_verify_evidence

Verifies the evidence hash chain and reports invalid rows if the ledger was edited after the fact. If `PROOF/evidence-ledger-checkpoints.json` is present and its checkpoint hash is valid, the verifier accepts only the exact historical fork rows listed there, returns `ok: true`, and keeps `strict_ok: false` so operators can see that a documented historical fork was accepted rather than rewritten.

```json
{}
```

## hermes_list_events

Lists durable trigger-bridge events in chronological order. The event bridge is passive: listing events does not notify a chat session or call an LLM API.

```json
{ "status": "outbox", "limit": 25 }
```

`status` may be `outbox`, `handled`, `failed`, or `all`.

## hermes_live_status

Returns a compact snapshot for the active workspace: active locks, stale locks, queue counts, handoff count, recent outbox events, and anonymous-agent state. This is the quickest way for an agent to orient before claiming or editing.

```json
{
  "includeEvents": true,
  "includeAgents": true,
  "eventLimit": 20
}
```

## hermes_wait_for_events

Long-polls the event outbox and returns events newer than `afterEventId`. This gives agents a request/response-friendly way to watch collaboration changes without a separate filesystem watcher.

```json
{
  "status": "outbox",
  "afterEventId": "evt_20260702T120000000Z_ab12cd",
  "limit": 25,
  "timeoutMs": 15000,
  "pollMs": 1000
}
```

## hermes_emit_event

Manually inserts an `event_schema_version: 1` event into `.hermes3d_orchestrator/events/outbox/`. Callers provide the semantic fields; the manager fills generated fields such as `event_id`, `created_utc`, `workspace_root`, and evidence-chain references.

```json
{
  "event_type": "pr.opened",
  "task_id": "H3D-CP5.1-B",
  "owner": "codex-impl-01",
  "branch": "feat/example",
  "files": ["docs/ARCHITECTURE.md"],
  "summary": "PR opened for review.",
  "next_actor": "claude",
  "recommended_action": "review_pr",
  "payload": { "pr_url": "https://github.com/org/repo/pull/123" }
}
```

## hermes_mark_event_handled

Acknowledges one event by atomically renaming it from `events/outbox/<event_id>.json` to `events/handled/<event_id>.json`, then appending non-emitting evidence. Concurrent consumers that lose the rename race should receive or surface `event_already_handled` rather than processing the same event twice.

```json
{ "event_id": "evt_20260503T000000000Z_a1b2c3", "handled_by": "claude-reviewer", "note": "Review packet consumed." }
```

## hermes_create_blocked_handoff

Writes a Markdown handoff for a blocked task, appends evidence, emits `task.blocked`, and optionally releases locks owned by the caller.

```json
{
  "task_id": "H3D-CP5.1-B",
  "owner": "codex-impl-01",
  "reason": "Requested path is outside the approved scope.",
  "blocked_files": ["src/example.mjs"],
  "suggested_correct_paths": ["docs/ARCHITECTURE.md"],
  "handoff_path": "handoffs/HANDOFF_TO_CLAUDE_H3D-CP5.1-B_BLOCKED.md",
  "release_locks": true
}
```

## hermes_enqueue_task

Writes a `task_schema_version: 1` task to `.hermes3d_orchestrator/tasks/pending/`. Re-enqueueing an existing `task_id` is a no-op success. `priority` is numeric and clamped to `[-100, 100]`; `target_owner_pattern` is validated before the file is written.

```json
{
  "task_id": "CP-HERMESPROOF-0.5",
  "title": "Task queue",
  "summary": "Implement queue pickup.",
  "handoff_path": "handoffs/HANDOFF_TO_CODEX_CP-HERMESPROOF-0.5.md",
  "branch_hint": "feat/cp-hermesproof-0.5-task-queue",
  "files_hint": ["src/core/queue-manager.mjs"],
  "priority": 5,
  "target_owner_pattern": "^codex-.*$"
}
```

## hermes_list_pending_tasks

Lists pending queue tasks sorted by priority descending, then enqueue time ascending. `owner_filter` limits the response to tasks whose owner-affinity regex matches that owner.

```json
{ "owner_filter": "codex-impl-01", "limit": 10 }
```

## hermes_pick_task

Atomically claims the highest-priority pending task matching the caller. `prefer_task_id` can request one specific task; owner-affinity still applies. Concurrent losers receive `task_already_claimed` or `no_pending_tasks_for_owner`.

```json
{ "owner": "codex-impl-01", "prefer_task_id": "CP-HERMESPROOF-0.5" }
```

## hermes_recover_stale_tasks

Moves expired claimed tasks back to `pending/` and emits `task.recovered`. The optional `files` field is interpreted as a list of task ids, mirroring the existing recovery tool's shape while keeping queue recovery task-scoped.

```json
{ "owner": "claude-lead", "files": ["CP-HERMESPROOF-0.5"], "note": "owner session expired" }
```

## hermes_read_policy

Read-only policy snapshot. Returns the resolved workspace root, state dir, default TTL, and the env vars currently honored. Use this at the start of a session to confirm the orchestrator is pointed at the right workspace.

```json
{}
```

## hermes_doctor

Non-destructive pre-flight check. Returns:

- `checks[]`: per-check `{id, ok}` summary.
- `findings[]`: `error | warn | info` entries each with a `message` and a `fix` suggestion.
- `ok`: true only when no `error`-level findings exist.

```json
{}
```

The doctor probes write permission with a temporary file in the workspace root and removes it. It does **not** create the state dir tree — that happens only when `init()` is called by the running server.

## hermes_release_task

Marks a claimed task complete after evidence and file releases have been recorded.

```json
{ "owner": "codex-impl-01", "taskId": "CP-UX-A-CODEX", "note": "PR merged" }
```

## hermes_release_files

Releases one or more locks held by the caller.

```json
{ "owner": "codex-impl-01", "files": ["src/example.mjs"], "note": "done" }
```

## hermes_heartbeat

Refreshes owned locks and claimed task metadata while work is still active.

```json
{ "owner": "codex-impl-01", "taskId": "CP-UX-A-CODEX" }
```

## hermes_list_locks

Lists current file locks, including owner, task id, TTL, and stale status.

```json
{}
```

## hermes_recover_stale_locks

Recovers only locks whose TTL has expired. This is the explicit stale-recovery path and should be paired with evidence.

```json
{ "owner": "claude-lead", "files": ["src/example.mjs"], "note": "owner session expired" }
```

## hermes_list_gates

Lists the gate ids allowlisted for `hermes_run_gate`.

```json
{}
```

## hermes_list_agents

Summarizes anonymous-role, reputation, and skill-rotation state for active actors.

```json
{}
```

## hermes_anonymous_claim

Claims one anonymous role such as reviewer, implementer, or tester without binding the workflow to a named person.

```json
{ "role": "reviewer", "actor_id": "codex-review-01", "purpose": "PR review" }
```

## hermes_anonymous_release

Releases an anonymous role currently held by an actor.

```json
{ "role": "reviewer", "actor_id": "codex-review-01" }
```

## hermes_anonymous_state

Returns anonymous-role and USER-session state.

```json
{}
```

## hermes_record_outcome

Records an actor outcome for reputation scoring.

```json
{ "actor_id": "codex-review-01", "outcome": "merge_success", "weight": 1 }
```

## hermes_record_task

Records a task type in the actor skill histogram used by rotation and routing.

```json
{ "actor_id": "codex-review-01", "task_type": "review" }
```

## hermes_dispatch_recommend

Recommends an actor for a requested capability using current reputation and skill history.

```json
{ "capability": "review", "candidates": ["codex-review-01", "claude-reviewer"] }
```

## hermes_user_grant_session

Grants a scoped AS_USER session. Human grants require the configured human-secret path; Hermes Agent grants flow through the bridge.

```json
{ "granted_by": "hermes-agent", "session_id": "session-123", "scope": ["resolve_blocked"] }
```

## hermes_user_revoke_session

Revokes the active USER session by id.

```json
{ "session_id": "session-123" }
```

## hermes_user_check_authorization

Checks whether the active USER session permits a named action.

```json
{ "action": "resolve_blocked" }
```

## hermes_a2a_create_task

Creates an Agent-to-Agent task and returns its `task_id`.

```json
{ "from_agent": "claude-lead", "to_agent": "codex-impl-01", "title": "Review docs", "description": "Audit drift" }
```

## hermes_a2a_get_task

Reads one A2A task by id.

```json
{ "task_id": "a2a_123" }
```

## hermes_a2a_update_task

Transitions an A2A task through the allowed state machine.

```json
{ "task_id": "a2a_123", "status": "working", "output": "started" }
```

## hermes_a2a_list_tasks

Lists A2A tasks, optionally filtered by agent or status.

```json
{ "agent": "codex-impl-01", "status": "working" }
```

## hermes_agent_health

Checks configured HermesAgent providers in deterministic order and reports the first healthy provider. The default is MiniMax M3 first, then DeepSeek. Other providers must be explicitly listed in `HERMES_AGENT_FAILOVER`.

```json
{}
```

## hermes_helper_runtime_evaluate

Evaluates one redacted HermesAgent or ZeroClaw local/VPS worker envelope. A completed result needs a distinct worker identity, run/commit/VSIX lineage, terminal runner status, artifact hashes, `secretValuesReturned: false`, and a real HermesProof `ev_*` id. This tool is read-only and never turns an agent summary into evidence.

```json
{ "envelope": { "schema": "hermesproof.helper-runtime.v1" } }
```

## hermes_staleness_evaluate

Evaluates whether a document, runner, artifact, installed-VSIX proof, config result, or evidence record is current for the stated commit, VSIX hash, and contract version. It rejects stale/future timestamps, stale current claims, mixed-run hashes, broken supersession, fake metadata, secret signals, and missing completed-proof evidence.

```json
{ "report": { "schema": "hermesproof.staleness.v1", "records": [] } }
```

## hermes_storage_census

Reads metadata from explicitly approved storage roots and groups proof, protected, dependency, temporary, quarantine, and unknown material. Partial scans and unknown material are blocked. It never reads private file content, moves files, or deletes data.

```json
{ "roots": ["<approved-root>"], "maxFiles": 10000, "maxDepth": 8 }
```

## hermes_archive_plan

Builds a read-only archive proposal from a hash-bound `hermesproof.expected-diff-manifest.v2`. It rechecks every source SHA-256, requires a separate approved archive root, and returns relative archive destinations. It never copies, moves, purges, or permits source deletion.

```json
{
  "sourceRoot": "<approved-source-root>",
  "archiveRoot": "<approved-separate-archive-root>",
  "archiveId": "candidate-20260710",
  "manifest": { "schema": "hermesproof.expected-diff-manifest.v2", "entries": [] }
}
```

## hermes_helper_runtime_evaluate_consensus

Evaluates the required local and VPS helper envelopes together. They must share a run id, commit, and VSIX SHA-256, while retaining separate worker identities. Any mismatch, timeout, nonzero exit, failed worker, missing artifact, or missing evidence blocks the result.

```json
{ "required_locations": ["local", "vps"], "envelopes": [] }
```

## hermes_agent_request_user_session

Asks Hermes Agent to evaluate a requested scope and, on approval, grant a scoped USER session.

```json
{ "requested_scope": ["resolve_blocked"], "ttl_hours": 8 }
```

## hermes_agent_resolve_blocked

Asks Hermes Agent to reason about a blocked handoff using the active USER session.

```json
{ "correlation": "handoff_123", "summary": "Reviewer needs approval", "full_thread": "..." }
```

## hermes_agent_revoke_session

Revokes the Hermes Agent's own active USER session.

```json
{}
```

---

## HP-MHA Model–Harness Attribution

The seven tools below implement the HP-MHA-001..010 contract from
`docs/48-Point Lever.md`. They record a complete experiment bundle
(harness card → locked plan → attested runs → verified trace → attribution
→ promotion verdict) into a dedicated hash-chained ledger
(`<workspace>/.hermes3d_orchestrator/evidence/hp_mha.ndjson`). Each entry
chains to the previous one; the final `hermes_hp_mha_promotion_evaluate`
verdict is the canonical machine-readable result consumed by the
`HP-HARNESS-ATTRIBUTION` release sub-gate.

The tools emit six `ev_*` evidence families:

| Family                  | Tool                                  | Purpose                                                              |
| ----------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| `ev_harness_*`          | `hermes_hp_mha_harness_card_record`   | Canonicalize and hash a complete seven-layer harness configuration    |
| `ev_experiment_*`       | `hermes_hp_mha_experiment_plan_lock`  | Lock model cells, harness cells, task set, evaluator, environment    |
| `ev_run_*`              | `hermes_hp_mha_benchmark_run_attest`  | Bind each completed run to the locked plan; classify contamination    |
| `ev_trace_*`            | `hermes_hp_mha_trace_bundle_verify`   | Verify trace chunk hashes, recompute Merkle root, classify retention  |
| `ev_attribution_*`      | `hermes_hp_mha_model_harness_attribution` | Compute harness effect, model effect, and interaction (HP-MHA-007) |
| `ev_promotion_*`        | `hermes_hp_mha_promotion_evaluate`    | PASS / FAIL / INCONCLUSIVE with chained `ev_*` reason codes          |
| (read-only, no ledger)  | `hermes_hp_mha_sub_gate`              | Same verdict path, but read-only and used by the release sub-gate    |

HermesProof MUST NOT modify a candidate harness, run its own optimization
loop, or generate synthetic evidence (HP-MHA-009, HP-MHA-010). These tools
are therefore evaluators only — the optimizer lives outside the proof
authority and the final candidate is independently re-evaluated here.

## hermes_hp_mha_harness_card_record

Canonicalizes a seven-layer harness card (Execution, Model & inference,
Tools, Context, Scheduling, Observability, Governance) and writes
`ev_harness_*`. Rejects unknown layers, unknown fields within a layer,
and non-SHA-256 hash fields. The returned `harness_card_sha256` becomes
the candidate identifier downstream tools bind against.

```json
{
  "card_id": "kilocode_v0.7.0",
  "layers": {
    "execution": { "...": "see docs/48-Point Lever.md §4" },
    "model":     { "provider": "anthropic", "model_id": "claude-opus-4-6" },
    "tools":     { "...": "..." },
    "context":   { "...": "..." },
    "scheduling": { "controller": "loop", "retry_count": 2, "...": "..." },
    "observability": { "...": "..." },
    "governance": { "secret_values_returned": false, "...": "..." }
  }
}
```

## hermes_hp_mha_experiment_plan_lock

Locks the experiment design and rejects both bare model comparisons
(HP-MHA-002 requires `locked_harness` / `factorial_2x2` / `factorial_NxN`)
and bare harness improvements (HP-MHA-003 requires all eight
`held_constant` keys: `model`, `inference_settings`, `task_set`,
`environment`, `evaluator`, `permissions`, `budgets`, `stopping_rules`).
Writes `ev_experiment_*`.

```json
{
  "experiment_id": "kilocode_vs_opus_4_6",
  "design": "factorial_2x2",
  "held_constant": {
    "model": true, "inference_settings": true, "task_set": true,
    "environment": true, "evaluator": true, "permissions": true,
    "budgets": true, "stopping_rules": true
  },
  "model_manifest":        { "provider": "anthropic", "model_id": "claude-opus-4-6" },
  "harness_card":          { "card_id": "kilocode_v0.7.0", "layers": { "...": "..." } },
  "task_set_manifest":     { "task_set_id": "ts_v1", "tasks": [{ "id": "t1" }] },
  "evaluator_manifest":    { "evaluator_id": "eval_main", "evaluator_commit": "...", "evaluator_sha256": "..." },
  "environment_manifest":  { "environment_id": "ci", "os": "linux", "arch": "x64", "image_digest": "sha256:..." }
}
```

## hermes_hp_mha_benchmark_run_attest

Binds one completed run to the locked plan. The run MUST carry sha256
bindings for all six manifests (model, harness, task set, evaluator,
environment) plus a trace-root hash, and one of five outcomes:
`passed` / `failed` / `cancelled` / `crashed` / `timed_out`. The tool
also classifies HP-MHA-004 contamination (undeclared fallback, model
substitution, changed reasoning / timeout / tool inventory). Writes
`ev_run_*`.

```json
{
  "run_id": "run_001",
  "experiment_id": "kilocode_vs_opus_4_6",
  "model_manifest_sha256":       "<64 hex>",
  "harness_manifest_sha256":     "<64 hex>",
  "task_set_manifest_sha256":    "<64 hex>",
  "evaluator_manifest_sha256":   "<64 hex>",
  "environment_manifest_sha256": "<64 hex>",
  "trace_root_sha256":           "<64 hex>",
  "outcome": "passed",
  "latency_ms": 1234,
  "tokens": 50000,
  "cost_usd": 0.42
}
```

## hermes_hp_mha_trace_bundle_verify

Verifies a trace bundle. Each `chunks[i].sha256` must be a SHA-256 hex
string; the recomputed left-fold Merkle root must equal `root_sha256`.
`retention` must be one of `release_pinned` (never auto-purged),
`failure_diagnostic` (retained through the active repair cycle),
`routine_run` (short retention), or `duplicate_chunk` (deduplicated by
hash). Writes `ev_trace_*` with the recomputed Merkle root and any
findings.

```json
{
  "bundle_id": "tb_run_001",
  "retention": "release_pinned",
  "chunks": [
    { "sha256": "<64 hex>" },
    { "sha256": "<64 hex>" }
  ],
  "root_sha256": "<64 hex>"
}
```

## hermes_hp_mha_trace_index_record

Ingests a trace bundle (same shape as `hermes_hp_mha_trace_bundle_verify`) and writes one content-addressed index row per chunk to `<workspace>/.hermes3d_orchestrator/evidence/hp_mha_trace_index.ndjson`. Each row carries `bundle_id`, `byte_start`, `byte_end`, `tokens`, `kind_hint`, and any `signal_tags`. The index is keyed on `(bundle_id, byte_start)` so range queries run O(log n) without scanning the main ledger.

```json
{
  "bundle_id": "tb_run_001",
  "retention": "release_pinned",
  "chunks": [
    { "sha256": "<64 hex>", "bytes": 100, "kind": "tool_ok", "signals": ["artifact_path"] },
    { "sha256": "<64 hex>", "bytes": 200, "kind": "test_passed" }
  ],
  "root_sha256": "<64 hex>"
}
```

## hermes_hp_mha_trace_search

Range-searches the trace index for one `bundle_id`. Returns rows whose byte window intersects `[byte_start, byte_end]` (each open-ended if omitted), optionally filtered by `kind` and `signals`. For the millions-of-tokens case this is the only path that does not require scanning `hp_mha.ndjson`. Read-only.

```json
{
  "bundle_id": "tb_run_001",
  "byte_start": 80,
  "byte_end": 250,
  "kind": "tool_ok",
  "signals": ["artifact_path"],
  "limit": 200
}
```

## hermes_hp_mha_trace_metrics

Derives the §6 trace-level metrics from a bundle whose chunks carry
`kind` and (optionally) `signals`. Reports:

- `recovery_rate_at_{1,3,5,10}_steps` — fraction of error chunks that were
  followed by productive work (`tool_ok`, `patch_accepted`, `test_passed`,
  `corrective_action`) within the given step budget. Error chunks are
  `tool_error`, `test_failure`, `patch_rejected`, or `malformed`.
- `avg_control_lag_steps` — mean steps from each error to its
  `corrective_action`, counting the first `instruction_issued` along the
  way. Zero when no error had both an instruction and a correction
  within 5 steps.
- `context_retention` — fraction of `required_signals` still present in
  the last `lookback` chunks (default 5). Tail-only check so a model that
  drops constraints late is caught even when early chunks were correct.

This tool is read-only and emits no evidence. Use the bundle your runner
produced, not a summary exported by the candidate.

```json
{
  "bundle": {
    "chunks": [
      { "kind": "tool_ok", "signals": ["artifact_path"] },
      { "kind": "tool_error" },
      { "kind": "instruction_issued" },
      { "kind": "corrective_action" },
      { "kind": "tool_ok", "signals": ["artifact_path"] }
    ]
  },
  "required_signals": ["artifact_path", "acceptance_tests"],
  "lookback": 5
}
```

## hermes_hp_mha_trace_prune

Walks the HP-MHA evidence ledger at `<workspace>/.hermes3d_orchestrator/evidence/hp_mha.ndjson`,
classifies each `ev_trace` entry by `retention`, and:

- **keeps** `release_pinned` entries forever;
- **keeps** `failure_diagnostic` only when `failures_required=true`;
- **prunes** `routine_run` entries older than `routine_retention_ms`
  (default 7 days; pass `0` to disable the window);
- **dedups** `duplicate_chunk` entries sharing the same `root_sha256`.

The hash chain stays intact — pruning never edits prior entries. The
tool appends a single `ev_prune` summary at the tail describing what
disappeared. Callers must therefore preserve ledger files rather than
mutating them in place.

```json
{
  "routine_retention_ms": 604800000,
  "failures_required": false,
  "now_ms": 1754438400000
}
```

## hermes_hp_mha_model_harness_attribution

Computes the factorial attribution triple from a 2×2 matrix
(`s11` = model 1 + harness 1, …, `s22` = model 2 + harness 2):

```
harness_effect = ((s12 − s11) + (s22 − s21)) / 2
model_effect   = ((s21 − s11) + (s22 − s12)) / 2
interaction    =  s22 − s21 − s12 + s11
```

Results are rounded to 12 decimal places (IEEE-754 noise floor). Writes
`ev_attribution_*`. This is the only way HP-MHA-007 multi-dimensional
reporting is satisfied; reporting only one aggregate success percentage
is rejected.

```json
{
  "experiment_id": "kilocode_vs_opus_4_6",
  "matrix": { "s11": 0.50, "s12": 0.55, "s21": 0.60, "s22": 0.65 },
  "uncertainty": { "ci_95_pp": 0.02 }
}
```

## hermes_hp_mha_promotion_evaluate

Returns the final verdict. Each contract requirement is enforced in
order: HP-MHA-001 binding → HP-MHA-002/003 design → HP-MHA-004
contamination → HP-MHA-005 denominator (failed/cancelled/crashed/
timed_out must be in the denominator; "no failures" with >1 cell is
rejected as impossible-clean) → HP-MHA-006 holdout isolation →
HP-MHA-007 multi-dimensional report → HP-MHA-008 reason codes + chained
`ev_*` evidence → HP-MHA-009 independence from candidate →
HP-MHA-010 real execution (`execution_real: true` required, any fake /
mock / synthetic signal rejected). Writes `ev_promotion_*`.

```json
{
  "kind": "promotion",
  "evidence_ids": ["ev_abcdef12345"],
  "run_attestations": [{ "...": "see benchmark_run_attest shape" }],
  "plan": { "...": "see experiment_plan_lock shape" },
  "attribution": {
    "harness_effect_pp": 0.05,
    "model_effect_pp": 0.10,
    "interaction_pp": 0
  },
  "execution_real": true
}
```

## hermes_hp_mha_sub_gate

Read-only convenience that returns the same verdict path
`HP-HARNESS-ATTRIBUTION` uses from `scripts/truth-gates.mjs`. It does
not write evidence. Use this when you want to dry-run a candidate
experiment before paying for the real evidence append. Always returns
the gate id and the full reason-codes list, never the binary verdict
alone.

```json
{
  "harness_card": { "card_id": "...", "layers": { "...": "..." } },
  "experiment_plan": { "design": "factorial_2x2", "held_constant": { "...": "..." } },
  "run_attestations": [{ "outcome": "passed" }, { "outcome": "failed" }],
  "matrix": { "s11": 0.5, "s12": 0.6, "s21": 0.7, "s22": 0.8 },
  "holdout_visible_to_optimizer": false,
  "execution_real": true,
  "fake_signals": [],
  "evidence_ids": ["ev_abcdef12345"]
}
```
