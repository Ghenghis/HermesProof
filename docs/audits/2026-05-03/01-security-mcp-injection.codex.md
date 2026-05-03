# Security and MCP Injection Surface - Codex Audit

## Executive Summary

This independent pass found good baseline hardening around path normalization for file locks, stderr-only diagnostics in the MCP server, static tool-description scanning, and allowlisted gate commands. The largest security risks are authorization and state integrity. `hermes_user_grant_session` lets any MCP caller mint an AS_USER session labelled `human`, `ci`, or `hermes-agent`; if the caller omits `scope`, the session becomes globally authorized for every checked action. Several state-changing v0.7 tools also trust caller-supplied actor IDs, so reputation and skill history can be poisoned without trusted CI or review attribution. Integrity controls are uneven: `appendChainedJsonLine` reads the previous evidence hash and appends without a mutex, while reputation, skill rotation, and anonymous orchestration use whole-file JSON read-modify-write without A2A's mutation queue. A temp-directory concurrency probe hit `ENOENT` rename failures because `writeJsonAtomic` uses `process.pid` plus `Date.now()` for temp names. DoS exposure remains through arbitrary JSON payloads, regex owner patterns, unbounded ledgers, large A2A inputs/outputs, and whole-directory state summaries. I found no source-grounded stdout contamination in the MCP server; logs go to stderr.

## Summary

| ID | Severity | Type | Location | Confidence | Finding |
| --- | --- | --- | --- | --- | --- |
| SEC-01 | High | Authorization bypass | `src/server.mjs:723`, `src/core/anonymous-orchestrator.mjs:156` | 0.98 | Any MCP caller can self-grant AS_USER authority. |
| SEC-02 | High | Path traversal | `src/core/lock-manager.mjs:162`, `src/core/lock-manager.mjs:767` | 0.90 | Legacy task and handoff IDs are used as path components with only length checks. |
| SEC-03 | High | Secret leakage | `src/core/gate-runner.mjs:107`, `src/core/gate-runner.mjs:122`, `src/core/lock-manager.mjs:468` | 0.92 | Gates inherit full environment and persist output tails; evidence accepts arbitrary data without redaction. |
| SEC-04 | High | Race and evidence integrity | `src/core/fs-utils.mjs:54`, `src/core/fs-utils.mjs:87` | 0.96 | Concurrent atomic writes and evidence appends can fail, lose updates, or fork the hash chain. |
| SEC-05 | Medium | State poisoning | `src/server.mjs:650`, `src/core/reputation.mjs:67`, `src/core/skill-rotation.mjs:49` | 0.95 | Any MCP caller can alter another actor's reputation and skill history. |
| SEC-06 | Medium | MCP/LLM injection | `src/core/hermes-agent-bridge.mjs:249`, `src/core/hermes-agent-bridge.mjs:315`, `src/core/hermes-agent-bridge.mjs:375` | 0.78 | Hermes Agent authorization relies on model output over caller-controlled scope/thread text. |
| SEC-07 | Medium | DoS and unbounded growth | `src/server.mjs:360`, `src/server.mjs:773`, `src/server.mjs:842`, `src/core/lock-manager.mjs:579` | 0.88 | Several tools accept unbounded payloads or perform whole-store scans. |

## Findings

### SEC-01 - Direct AS_USER Session Grant Is Unauthenticated

Severity: High

Type: Authorization bypass

Location: `src/server.mjs:723`, `src/core/anonymous-orchestrator.mjs:156`, `src/core/anonymous-orchestrator.mjs:204`

Confidence: 0.98

Finding: `hermes_user_grant_session` is a normal MCP tool. It accepts `granted_by` as `human`, `hermes-agent`, or `ci`, then calls `grantUserSession` directly. The core grant path checks only enum, session-id length, and existing-session state; if `scope` is omitted, it stores `scope: null`, and `checkUserAuthorization` treats that as all actions allowed.

Evidence: `server.mjs:723-736` exposes the grant tool, `anonymous-orchestrator.mjs:156-181` creates the session, and `anonymous-orchestrator.mjs:217-224` allows any action unless an array scope exists and excludes the action.

Suggested remediation: Remove direct MCP self-granting or gate it behind a signed local human challenge / CI token. Make unscoped sessions impossible from MCP, bind grants to caller identity, and keep `hermes_agent_request_user_session` separate from privileged human grant paths.

### SEC-02 - File-Derived IDs Can Escape Legacy State Directories

Severity: High

Type: Path traversal

Location: `src/core/lock-manager.mjs:162`, `src/core/lock-manager.mjs:400`, `src/core/lock-manager.mjs:767`

Confidence: 0.90

Finding: The legacy task and handoff paths interpolate caller-provided IDs into `path.join(...)` after only checking that the ID is a non-empty string. Unlike file lock paths, these IDs do not pass through `normalizeWorkspacePath` or a basename regex. A string containing `../` can target sibling files under the state directory or, with enough traversal, outside the intended task/handoff subdirectory.

Evidence: `claimTask` uses `const id = taskId || ...` and `path.join(this.paths.tasksDir, `${id}.json`)`. `approveHandoff` builds `path.join(this.paths.handoffsDir, `${requestId}.json`)`. `assertId` at line 767 checks only type and length.

Suggested remediation: Reuse a strict `TaskId`/`EventId` basename regex everywhere an ID becomes a filename. Reject slashes, backslashes, `..`, nulls, colons, and absolute paths; assert the resolved target remains under the intended directory before every read/write.

### SEC-03 - Gate and Evidence Outputs Can Persist Secrets

Severity: High

Type: Secret leakage

Location: `src/core/gate-runner.mjs:107`, `src/core/gate-runner.mjs:122`, `src/core/lock-manager.mjs:468`, `src/server.mjs:481`

Confidence: 0.92

Finding: Gate runs inherit the full `process.env`, merge optional caller env, then persist `stdout_tail` and `stderr_tail`. Separately, `hermes_append_evidence` stores arbitrary caller-provided `data` in the hash-chained ledger without redaction. If a tool, test, or malicious caller prints tokens or passes secrets in evidence data, they become durable repo/workspace artifacts.

Evidence: `gate-runner.mjs:107` passes `{ ...process.env, ...stringEnv(env) }`; lines 122-123 store up to 6000 characters from stdout/stderr; `lock-manager.mjs:468-480` writes arbitrary `data`.

Suggested remediation: Run gates with a minimal allowlisted environment, redact known secret patterns before writing reports/evidence, cap evidence size, and reject evidence keys or values matching private-key/API-token patterns.

### SEC-04 - Evidence and v0.7 State Writes Are Not Serialized

Severity: High

Type: Race and integrity

Location: `src/core/fs-utils.mjs:54`, `src/core/fs-utils.mjs:87`, `src/core/reputation.mjs:67`, `src/core/skill-rotation.mjs:49`, `src/core/anonymous-orchestrator.mjs:98`

Confidence: 0.96

Finding: `writeJsonAtomic` uses a temp path built from file, PID, and millisecond timestamp. Concurrent writes to the same file in the same process can collide. Evidence chaining also reads the previous hash, computes the new entry, and appends without a queue, so concurrent appenders can share the same parent hash and fork the chain.

Evidence: A temp-directory probe firing 50 concurrent `recordOutcome` / `recordTask` / `claimRole` calls produced `ENOENT` on `rename ... .tmp -> ...json`. A2A avoids this with `_mutateQueue`; reputation, skill rotation, and anonymous orchestration do not.

Suggested remediation: Add a shared per-file mutation queue or file lock around read-modify-write and evidence append operations. Add random/crypto suffixes to temp filenames and retry evidence append if the tail hash changes.

### SEC-05 - Reputation and Skill State Can Be Poisoned by Any Caller

Severity: Medium

Type: State poisoning

Location: `src/server.mjs:650`, `src/server.mjs:666`, `src/core/reputation.mjs:67`, `src/core/skill-rotation.mjs:49`

Confidence: 0.95

Finding: `hermes_record_outcome` accepts any valid actor ID and outcome, then records the outcome and an `outcome_*` task. There is no evidence check, CI identity check, or merge/review source validation. A malicious or confused MCP caller can boost itself with `merge`, penalize another actor with `reject`, or distort dispatch load balancing.

Evidence: `server.mjs:650-668` validates shape but not authority; `reputation.mjs:81-89` updates score; `skill-rotation.mjs:59-72` updates task counts.

Suggested remediation: Restrict outcome writes to trusted CI/review principals, require a linked evidence ID or signed attestation, and preserve immutable attribution for who recorded the outcome.

### SEC-06 - Hermes Agent Authorization Is Model-Mediated Over Untrusted Text

Severity: Medium

Type: MCP/LLM injection

Location: `src/core/hermes-agent-bridge.mjs:249`, `src/core/hermes-agent-bridge.mjs:315`, `src/core/hermes-agent-bridge.mjs:375`, `src/server.mjs:899`

Confidence: 0.78

Finding: `hermes_agent_request_user_session` sends caller-controlled `requested_scope` into an LLM decision prompt and grants a session when the model returns `verdict: approve`. `resolveBlocked` also sends caller-controlled thread text. The bridge has a strong system prompt, but the authorization boundary still depends on model output.

Evidence: `_askAgent` sends `JSON.stringify(payload)` as the user message; `_systemPrompt` instructs the model to approve/decline/defer; `requestUserSession` grants the final scope after `decision.verdict === "approve"`.

Suggested remediation: Enforce deterministic scope allowlists before the model call, cap scope string lengths/counts, quote thread text as untrusted evidence, and require human/signed approval for destructive or privilege-expanding scopes.

### SEC-07 - Multiple Tool Inputs Can Drive Unbounded Growth or Expensive Scans

Severity: Medium

Type: DoS and unbounded growth

Location: `src/server.mjs:360`, `src/server.mjs:773`, `src/server.mjs:842`, `src/server.mjs:917`, `src/core/lock-manager.mjs:579`

Confidence: 0.88

Finding: Several MCP inputs accept arbitrary JSON records or large strings, and some state reads scan whole stores. A2A input/output records, event payloads, evidence data, and blocked-thread text can grow the workspace state quickly. `getStateSummary` reads locks, tasks, handoffs, and queue state together, increasing the cost of routine inspection as ledgers grow.

Evidence: `z.record(z.unknown())` is used for event payloads and A2A input/output. `full_thread` allows 20000 characters. `getStateSummary` reads task and handoff directories and pending/claimed/blocked/done queue state.

Suggested remediation: Add byte/depth/item limits to arbitrary JSON, paginate state summaries, add pruning/indexing for old A2A tasks and events, and add per-tool rate limits for high-growth surfaces.

## Coverage notes

I scanned `src/**/*.mjs`, targeted MCP scripts, `package.json`, and v0.7 tool registrations. I did not read Claude's audit docs or any non-Codex audit reports. I ran live `tools/list` probes and temp-directory concurrency probes but did not run exploit fixes. Tool-title/description scan found no source-grounded OWASP tool-poisoning strings in `src/server.mjs`; MCP server diagnostics use `console.error` / stderr, so I found no stdout contamination finding.
