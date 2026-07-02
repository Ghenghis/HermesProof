# External Agent Connectors

HermesProof can coordinate any agent host that can call MCP tools. That includes Codex, KiloCode, Windsurf, Cursor, Devin-like workers, and a Cheat Engine Chat session running MiniMax M3.

The important boundary is simple:

- The agent host provides actual computer access: filesystem, shell, git, browser, or app automation.
- HermesProof provides coordination: workspace switching, locks, presence, inbox, skills, gates, evidence, and completion.
- Credentials stay outside the repo. GitHub, GitLab, shell, and OS access are inherited from the user-owned process that launches the agent.

HermesProof does not create hidden privileges, bypass an operating system policy, or make an untrusted model safe by itself. It makes powerful work visible and auditable.

## Recommended model for Cheat Engine Chat + MiniMax M3

Treat Cheat Engine Chat as the model host and MiniMax M3 as another workspace agent.

Use a stable owner id:

```text
minimax-m3-cechat-01
```

At session start, MiniMax should call:

```json
{
  "tool": "hermes_update_presence",
  "arguments": {
    "owner": "minimax-m3-cechat-01",
    "role": "builder",
    "status": "idle",
    "skills": ["ce-chat", "minimax-m3", "code", "docs", "testing", "release", "gitlab"],
    "taskTypes": ["build", "review", "repair", "test", "docs", "release"],
    "note": "Ready for coordinated HermesProof work.",
    "ttlSeconds": 300,
    "canInterrupt": true
  }
}
```

Before edits, it should claim and lock:

```json
{
  "tool": "hermes_claim_task",
  "arguments": {
    "owner": "minimax-m3-cechat-01",
    "taskId": "cechat-minimax-current-task",
    "title": "Implement coordinated repair",
    "files": ["src/example.mjs"]
  }
}
```

```json
{
  "tool": "hermes_lock_files",
  "arguments": {
    "owner": "minimax-m3-cechat-01",
    "taskId": "cechat-minimax-current-task",
    "files": ["src/example.mjs"],
    "reason": "Coordinated edit from Cheat Engine Chat MiniMax M3"
  }
}
```

If blocked, it must not edit. It should call:

```json
{
  "tool": "hermes_request_unlock",
  "arguments": {
    "requester": "minimax-m3-cechat-01",
    "taskId": "cechat-minimax-current-task",
    "files": ["src/example.mjs"],
    "reason": "Need ownership to finish the requested repair.",
    "priority": "high",
    "deadlineMinutes": 15
  }
}
```

Then wait:

```json
{
  "tool": "hermes_wait_for_unlock",
  "arguments": {
    "requester": "minimax-m3-cechat-01",
    "files": ["src/example.mjs"],
    "timeoutMs": 30000,
    "pollMs": 1000
  }
}
```

If `status` is `ready`, continue. If `status` is `stale_available`, recover with evidence using `hermes_recover_stale_locks`. If `status` is `denied`, pick another task or message the owner.

After work, one call should finish the loop:

```json
{
  "tool": "hermes_complete_work",
  "arguments": {
    "owner": "minimax-m3-cechat-01",
    "taskId": "cechat-minimax-current-task",
    "files": ["src/example.mjs"],
    "summary": "Implemented repair, ran gates, and released owned files.",
    "status": "completed",
    "data": {
      "gates": ["npm test", "node scripts/truth-gates.mjs --ci"]
    },
    "notifyRecipients": ["codex-impl-01", "kilocode-lead"]
  }
}
```

## High-trust automation modes

Use one of these modes in the agent profile.

| Mode | Agent can do | Recommended for |
| --- | --- | --- |
| `observe` | Read status, locks, inbox, gates, and evidence | Review-only assistants |
| `coordinated-dev` | Claim tasks, lock files, edit via host tools, run gates, complete work | Daily multi-agent implementation |
| `release-operator` | Coordinated-dev plus commit, push, tag, and release gates when credentials exist | Trusted release agents |
| `emergency-recovery` | Recover stale locks after TTL and append evidence | Owner abandoned work or machine slept |

The user can grant the host broad OS access, but the agent should still route workspace work through HermesProof so other agents can see what is happening.

## GitLab and GitHub

HermesProof can prove the workflow around Git, but it does not store GitLab credentials.

For GitLab push/create-repo work, the host must provide one of:

- `glab auth login`
- `GITLAB_TOKEN` or `GLAB_TOKEN` in the process environment
- an existing Git credential helper entry with create/push permission

Recommended release flow:

1. `hermes_update_presence` with `status: "testing"`.
2. Run project gates through the host or `hermes_run_gate` when the command is allowlisted.
3. Append evidence or use `hermes_complete_work` with gate summaries.
4. Commit from the host shell.
5. Push to GitHub or GitLab using user-owned credentials.
6. Record the commit SHA and remote URL in HermesProof evidence.

If credentials are missing, the truthful result is "blocked by GitLab auth", not "complete".

## Skills in HermesProof

Skills are lightweight routing tags, not executable plugins.

Good examples:

```text
code
docs
testing
review
release
gitlab
windows
powershell
cheat-engine-chat
minimax-m3
```

Bad examples:

```text
all-access
no-limits
ignore-locks
secret-admin
```

Use `hermes_find_agents` to route work to the best available agent:

```json
{
  "tool": "hermes_find_agents",
  "arguments": {
    "requiredSkills": ["gitlab", "release"],
    "taskType": "release",
    "includeBusy": false,
    "limit": 5
  }
}
```

## What should not be hidden

High-trust agents are useful when their work is observable. The following should always be visible through HermesProof evidence, git history, or gate output:

- What workspace is active.
- What files the agent owns.
- What task it is doing.
- What gates it ran and whether they passed.
- What commit SHA it produced.
- Why it recovered a stale lock.
- Why it could not push or create a remote repo.

## Minimal connector checklist

For any new agent host:

1. Wire HermesProof as an MCP stdio server, preferably through `scripts/mcp-supervisor.mjs`.
2. Launch the host from an environment that has the needed workspace and git credentials.
3. Give the agent a stable owner id.
4. Give the agent the standing prompt in `prompts/MINIMAX_M3_CHEAT_ENGINE_CHAT_PROMPT.md` or an equivalent project prompt.
5. At session start, call `hermes_doctor`, `hermes_get_workspace`, and `hermes_update_presence`.
6. Before edits, claim and lock.
7. If blocked, request unlock and wait.
8. Run gates and record proof.
9. Finish with `hermes_complete_work`.

## Future connector improvements

These are good next milestones for HermesProof:

- `hermes_register_agent_profile`: persist a structured capability profile per agent owner.
- `hermes_get_agent_profile`: let agents inspect another agent's advertised host access and preferred workflow.
- Connector wizard targets for "generic external agent" and "Cheat Engine Chat".
- An inbox watcher adapter that prints `unlock_request` and `completion` messages to a host-specific notification channel.
- A Git remote proof gate that reports GitHub/GitLab auth availability without leaking tokens.
- A release-session lease that requires explicit USER authorization before tags, main-branch pushes, or release publication.
