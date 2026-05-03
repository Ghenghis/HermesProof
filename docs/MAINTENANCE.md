# HermesProof — Maintenance & Best Practices

<div align="center">
<img src="./diagrams/truth-gates-animated.svg" alt="Truth-gate pipeline running fourteen gates sequentially" width="100%"/>
</div>

This guide covers day-2 operations: repair procedures, code-quality conventions, debugging, and how to extend HermesProof without weakening its safety guarantees.

The single best diagnostic is `npm run truth-gates` — it surfaces fourteen independent attestations and writes a structured report (`PROOF/latest.json` + `PROOF_E2E_REPORT.md`). If you only run one thing after a change, run that.

## Code-quality conventions

- **No arbitrary shell.** All process execution must go through `GateRunner` with an entry in `DEFAULT_GATES`. Reviewers should reject PRs that introduce `child_process` calls outside the gate runner.
- **Atomic file ops.** Use `writeJsonAtomic` (write tmp + rename) and `mkdir { recursive: false }` for lock acquisition. Avoid `fs.writeFile` directly for state files.
- **Path-relative inputs.** Tools that accept file paths must funnel through `normalizeWorkspacePath`. The function rejects path traversal, null bytes, and the workspace root itself.
- **Owner string discipline.** Use `claude-lead`, `claude-reviewer-ux`, `codex-impl-01`, `windsurf-cascade`, etc. Reject vague names like `agent`, `me`, `bot`.
- **Evidence and events on every checkpoint.** Lock acquire/release, gate result, handoff decision, and error must each produce evidence. Coordination state changes should also emit `event_schema_version: 1` files unless they are internal event-manager bookkeeping rows.

## Repair procedures

### Stuck locks (owner left without releasing)

1. `hermes_list_locks` to find the file and current owner.
2. If TTL is in the past, call `hermes_recover_stale_locks` with a `note` documenting why.
3. If TTL is still in the future but the owner is genuinely gone, the correct path is **handoff**:
   - Another agent calls `hermes_request_handoff` and the user (or a co-owner) approves with `hermes_approve_handoff`.
4. Never delete `<workspace>/.hermes3d_orchestrator/locks/*` by hand on a live system; you will lose the audit trail.

### Corrupted state dir

If JSON files in the state dir are unreadable:

1. Snapshot `<workspace>/.hermes3d_orchestrator` to a backup folder for forensics.
2. Run `npm run reset-demo-state` (this script removes the state dir).
3. Re-run `npm run init-project -- --workspace "<your workspace>"`.
4. Note the recovery in your evidence ledger: `hermes_append_evidence kind=recovery summary="state reset on YYYY-MM-DD"`.

### Doctor reports `workspace_writable: false`

The orchestrator cannot create a probe file under the workspace root. Likely causes:

- The workspace path is read-only (e.g., a mounted share).
- The MCP client launched the server as a different user than expected.
- Antivirus or file-protection software is blocking writes.

Fix the underlying permission issue, then re-run `npm run doctor -- --workspace "<path>"`.

### Doctor reports `env_workspace_set: false`

Neither `MCP_LOCK_WORKSPACE` nor `HERMES3D_WORKSPACE` is set. The server is falling back to `process.cwd()`, which may differ between MCP clients. Set the env var in your client config (`claude_desktop_config.json`, `mcp_config.json`, or `~/.codex/config.toml`).

## Debugging recipes

### "Why was my lock blocked?"

```text
hermes_list_locks
```

Look at the conflict's `current_owner`, `current_role`, `current_task_id`, `expires_utc`, and `is_stale`. The next move is either:

- `hermes_request_handoff` if the owner is still active,
- `hermes_recover_stale_locks` if `is_stale: true`.

### "Why does my gate keep failing?"

Inspect the latest gate report:

```text
ls .hermes3d_orchestrator/gates
cat .hermes3d_orchestrator/gates/<latest>.json
```

Each report includes `command`, `args`, `cwd`, `stdout_tail`, `stderr_tail`, `exit_code`, and `timed_out`. ENOENT spawn failures now include a hint pointing at PATH issues.

### "Why is the server not seeing my workspace?"

```text
hermes_read_policy
```

Confirm `workspace_root` matches the directory you opened in your IDE. If not, fix the env var in the client config.

### Watch trigger-bridge events

```powershell
node scripts\watch-events.mjs --workspace G:\Github\Hermes3D --once
node scripts\watch-events.mjs --workspace G:\Github\Hermes3D --write-review-packets
```

The watcher is passive. By default it prints pending events. With `--write-review-packets`, it writes deterministic Markdown packets under `.hermes3d_orchestrator/review_packets/` and leaves the source event in `events/outbox/`. If `HERMESPROOF_WEBHOOK_URL` is set, the watcher may POST event JSON to that URL; HermesProof itself still does not call a model or wake a chat session.

v0.4.1 hardens the trigger bridge for larger workspaces: task-bound evidence ids are resolved with a streaming ledger read, event listing sorts timestamp-prefixed filenames before reading only the requested page, and webhook delivery uses a 10 second timeout by default (`HERMESPROOF_WEBHOOK_TIMEOUT_MS` can override it). `hermes_list_events` now reports `count` as the total matching event files, not just the number returned under the requested limit.

### Prune handled events

Handled events can be pruned once operators no longer need them for routine audit lookups. A conservative default is 30 days:

```powershell
$cutoff = (Get-Date).ToUniversalTime().AddDays(-30).ToString("o")
node scripts\prune-events.mjs --workspace G:\Github\Hermes3D --before $cutoff --dry-run
node scripts\prune-events.mjs --workspace G:\Github\Hermes3D --before $cutoff
```

The prune script only deletes `events/handled/*.json` older than the cutoff. It must never delete `events/outbox/` or `events/failed/`; failed events require manual inspection because they usually mean a consumer rejected the schema, failed a webhook, or found a malformed payload.

### Generate a review packet manually

```powershell
node scripts\generate-review-packet.mjs --workspace G:\Github\Hermes3D --event-id evt_20260503T000000000Z_a1b2c3
```

Packets include the event details, task id, owner, branch, changed files when available, evidence ids, PR context, gate status, and a ready-to-paste review prompt.

## Extending the orchestrator

### Adding a new gate

1. Edit `src/core/gate-runner.mjs`. Add an entry to `DEFAULT_GATES` with a stable id, the literal `command` and `args`, and a sensible `timeout_ms`.
2. The command must be **read-only or workspace-scoped**. Anything that mutates remote state (push, deploy, db migration) must not be a gate.
3. Add a one-line description in `docs/SECURITY_POLICY.md`.
4. Add a test in `scripts/hardening-smoke-test.mjs` that proves the gate runner accepts the new id and rejects an adjacent unknown id.

### Adding a new MCP tool

1. Add the implementation as a method on `HermesLockManager` (or a new module under `src/core`).
2. Wire it in `src/server.mjs` with a strict `zod` schema. Avoid `z.any()` for free-form input — use `z.record(z.any())` only for opaque metadata.
3. Add a reference entry in `docs/TOOL_REFERENCE.md`.
4. Add a test that proves both the happy path and at least one rejection path.

### Adding or changing event types

1. Update `docs/EVENT_SCHEMA.md` first so consumers know the versioned contract.
2. Keep `event_schema_version: 1` unless the envelope shape or required semantics change incompatibly.
3. Resolve `evidence_ids` at emit time for task-bound events, ordered by the evidence `prev_hash` chain.
4. Preserve atomic file transitions: tmp file to `outbox/`, then `fs.rename` to `handled/` or `failed/`.

### Adding new tests

Tests live in `scripts/*-smoke-test.mjs` and are executed by `node --test`. Each test should:

- Use `fs.mkdtemp` to create an isolated temp workspace.
- Avoid wall-clock dependencies (`setTimeout` for actual sleeping); use `Date` arithmetic to simulate expiry.
- Assert on stable shape, not on volatile fields like ids and timestamps.

Run individual suites:

```powershell
npm run smoke              # coordination flow only
npm run smoke:hardening    # safety guarantees only
npm test                   # both
```

## Release checklist

Before shipping a change:

1. `npm test` passes locally.
2. `npm run doctor` against a real workspace returns `ok: true`.
3. `npm run print-configs` output still parses as valid JSON / TOML.
4. Public docs reference the same env-var names as the code (`MCP_LOCK_WORKSPACE`, `HERMES3D_WORKSPACE` legacy alias, `MCP_LOCK_STATE_DIR`).
5. `CHANGELOG`-style note in the PR explaining the user-visible impact.
