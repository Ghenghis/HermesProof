# Hybrid Helper Runtime

This contract joins HermesAgent and ZeroClaw without allowing either helper to self-certify project success.

## Roles

| Component | Owns | Cannot do alone |
|---|---|---|
| HermesAgent | Redacted diagnosis, official-source research, repair plans, review, and task coordination | Pass a gate, create completion evidence, access unredacted private data, or bypass a locked scope |
| ZeroClaw local | Windows/VS Code UI, installed-VSIX, audio, private-loader health, and local focused tasks | Replace a required VPS result or declare a release pass |
| ZeroClaw VPS | GitLab, containers, browser/backend, long-running, and soak tasks | Replace Windows/VS Code evidence or use private PC secrets |
| HermesProof | Contract validation, locks, policy, artifact lineage, evidence, and gate acceptance | Execute unallowlisted shell work or infer success from agent prose |

## Provider Policy

HermesAgent uses MiniMax M3 first and DeepSeek only after the MiniMax request fails or reaches its bounded timeout. The provider sequence is deterministic, recorded in redacted evidence, and never changed by provider-performance scoring. Other providers are explicit opt-ins through `HERMES_AGENT_FAILOVER`.

## Worker Envelope

Each helper terminal result is evaluated with `hermes_helper_runtime_evaluate` before anyone acts on it:

```json
{
  "schema": "hermesproof.helper-runtime.v1",
  "contractVersion": "hermesproof.helper-runtime.2026-07-10",
  "runId": "run-example-001",
  "taskId": "task-example-health",
  "worker": { "id": "zeroclaw-local-01", "runtime": "zeroclaw", "location": "local" },
  "workspace": { "commit": "<git-object-id>", "vsixSha256": "<sha256>" },
  "scope": ["health"],
  "startedAtUtc": "2026-07-10T00:00:00.000Z",
  "finishedAtUtc": "2026-07-10T00:00:01.000Z",
  "status": "completed",
  "runner": { "statusOk": true, "timedOut": false, "exitCode": 0 },
  "artifacts": [{ "id": "status-proof", "sha256": "<sha256>" }],
  "hermesProof": { "evidenceId": "ev_example12345678" },
  "secretValuesReturned": false,
  "summary": "Redacted terminal summary."
}
```

The validator accepts a real Git SHA-1 or SHA-256 object id for `workspace.commit`; every VSIX and artifact digest remains SHA-256. It rejects a missing worker identity, mismatched contract, invalid binding, timeout, nonzero exit, fake/mock/stub/skip metadata, secret signal, private path signal, missing artifact, or missing `ev_*` for a completed result. A blocked or failed result remains a blocked or failed result.

## Staleness Control

`hermes_staleness_evaluate` is required before a current proof record can be reused. Its report binds every current document, runner, artifact, installed-VSIX proof, config result, and evidence record to the active commit, VSIX SHA-256, and contract version. It rejects old artifacts after a rebuild, stale heartbeats, future clocks, superseded records marked current, missing evidence, fake metadata, private-data signals, and contradictory records sharing one run id.

The output is an explicit fact verdict, never an inferred quality score:

| Verdict | Meaning | Promotion rule |
|---|---|---|
| `pass` / `proven` | A current passed record has valid lineage, timestamp, hashes, and required evidence. | May satisfy a matching required kind. |
| `fail` / `rejected` | A current result failed, or a record is stale, malformed, unsafe, simulated, mixed-lineage, or contradicted. | Cannot be promoted; repair the named finding. |
| `blocked` / `insufficient` | Current proof is missing, active, blocked, historical-only, or otherwise incomplete. | Cannot be promoted; collect the required current evidence. |

Historical failed and superseded records stay visible as lineage. They never become current proof and never get rewritten into a pass.

## Dirty To Clean Recovery

`hermes_workspace_hygiene` is the preservation-first companion to staleness evaluation. It performs only Git and manifest inspection. It never resets, cleans, stashes, checks out, deletes, moves, stages, commits, or overwrites files.

| Workspace verdict | Fact | Allowed next step |
|---|---|---|
| `pass` / `clean` | Git reports no visible dirty work, no leaked probe file, and no outstanding recovery batch. | May continue to release-specific proof checks. |
| `blocked` / `reviewed_recovery_dirty` | Every active change belongs to a current, hash-bound recovery manifest. | May run focused recovery checks only; cannot make a release claim. |
| `fail` / `dirty_blocked` | Unknown changes, leaked probes, an invalid/stale manifest, a hash mismatch, or quarantined artifacts exist. | Preserve the tree and classify or isolate the named paths before broader work. |

The legacy KiloCode path-classified manifest is useful for preservation, but it is not hash-bound and therefore remains blocked. The next KiloCode integration writes the stronger `hermesproof.expected-diff-manifest.v2` form: current commit and branch, review timestamp, `releaseClaimAllowed:false`, class, status, and SHA-256 for each current file. A zero-dirty worktree is the only `clean` result.

## Storage Lineage

`hermes_storage_census` is the non-destructive response to large temporary, build, test-result, and cache accumulation. It scans only approved roots and reports aggregate bytes, age bands, metadata-based classifications, and retention class. It reads no file content and never treats an incomplete scan, an unapproved root, or an unknown group as disposable.

Set `HERMESPROOF_STORAGE_ROOTS` to a semicolon-separated list of explicitly approved user-owned locations when a project needs census coverage outside its workspace. The output classes are `proof`, `protected`, `dependency`, `temporary`, `quarantine`, and `unknown`; only `retain`, `quarantine`, or `review` retention recommendations are emitted. No `delete` recommendation exists in the tool.

KiloCode is the first mandatory corpus for this check. The recovery ledger, installed-VSIX output, per-gate snapshots, runner health, and local/VPS evidence must produce a fresh, agreeing staleness report before a wider gate run can rely on them. Historical documents remain readable lineage only; they cannot satisfy `requiredKinds` for the current candidate.

## Archive Planning And Monitoring

`hermes_archive_plan` is the only archive-planning primitive. It requires a current `hermesproof.expected-diff-manifest.v2` entry for every proposed file, rehashes each source file, and assigns a separate archive-relative destination. It returns a plan only when every source hash agrees.

The plan is intentionally not an archive operation: `movePerformed` is always `false`, `deleteSourceAllowed` is always `false`, and an explicit human approval plus a fresh hash recheck are required before any future mover may act. HermesAgent and ZeroClaw can collect census, staleness, and archive-plan facts, but cannot purge, move, or self-approve a retention decision.

Set `HERMESPROOF_ARCHIVE_ROOTS` only to explicit, user-approved archive directories. The archive root must be separate from the active source root so a recursive scan cannot mistake retained evidence for disposable build output.

## Consensus

When a gate needs local and VPS proof, call `hermes_helper_runtime_evaluate_consensus` with both envelopes and `required_locations: ["local", "vps"]`. It passes only when they:

1. Have distinct worker identities.
2. Share the same run id, commit, and VSIX SHA-256.
3. Have completed terminal runners with exit code `0` and `timedOut: false`.
4. Contain independent hashed artifacts and real HermesProof evidence.

## First Activation Sequence

1. Verify the installed ZeroClaw runtime without printing its config or credentials.
2. Verify HermesAgent with `hermes_agent_health`; this requires MiniMax M3 and may fail over to DeepSeek.
3. Register stable identities: `zeroclaw-local-01`, `zeroclaw-vps-01`, and `hermes-agent-local-01` or `hermes-agent-vps-01` as appropriate.
4. Run a non-mutating health task in a clean project worktree and evaluate its envelope.
5. Run one VPS-only non-mutating health task.
6. Run one dual-location gate using the consensus evaluator.
7. Only then allow task-specific runners. KiloCode UI gates remain local; GitLab/containers/soak gates remain VPS.

No task may receive a release, stable, or all-gates claim from this contract alone. KiloCode still requires its strict installed release proof.
