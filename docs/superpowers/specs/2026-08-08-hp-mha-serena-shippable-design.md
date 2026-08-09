# HP-MHA + Serena Shippable Release Design

Date: 2026-08-08
Branch: `release/hp-mha-serena-shippable`
Target: HermesProof monorepo, with `hp-mha-serena` as its second MCP server.

## Outcome

HermesProof ships two installable stdio MCP executables:

- `hermesproof`: the general coordination, lock, evidence, and release server.
- `hp-mha-serena`: a strict composite server for semantic analysis, lock-safe edits, measured multi-harness attribution, gap auditing, and verified release workflows.

The release is accepted only when live registries, generated documentation, client configuration, Windows and Linux evidence, remote commit SHAs, checksums, and attestations agree.

## Safety invariants

1. Every mutation requires a HermesProof task claim and exact-file lock owned by the caller.
2. Direct Serena use is semantic read-only. Its tracked project profile uses the TypeScript language server for JavaScript and `.mjs`, disables shell execution, and disables editing.
3. Composite edits never expose an unrestricted command string. Diagnostics and tests use allowlisted gates.
4. Failed semantic indexing, diagnostics, tests, evidence verification, Merkle verification, sidecar validation, or remote parity fails closed.
5. Partial failures retain locks and write a recovery journal; they never silently roll back or report success.
6. Secrets and private file content are redacted from logs, evidence, and release artifacts.
7. Optimization and holdout task sets are isolated before claim or scheduler dispatch.
8. Failed, crashed, timed-out, and cancelled harness runs remain in attribution denominators.
9. Release-facing claims cannot be satisfied by warnings, omissions, simulated results, templates, or prose-only evidence.
10. Cleanup is a separate read-only audit followed by an exact-path, hash-reverified operation. Tracked, dirty, unique, secret, referenced, or unknown data is protected.

## Composite server tools

The second server exposes six primary workflows:

- `hps_init`: initialize HermesProof state, verify Serena runtime/config, run onboarding checks, and plan or apply supported client wiring.
- `hps_doctor_deep`: inspect locks, evidence chain, Serena symbols/references, clients, Git remotes, GitLab/GitHub parity, harness packages, runner readiness, and release artifacts.
- `hps_gap_audit`: create a machine-readable ledger whose terminal states are `PROVEN`, `REPLACED`, or `NOT_SHIPPED`. Advertised release features may not end as `NOT_SHIPPED`.
- `hps_safe_edit`: claim, semantic analysis, exact lock, bounded patch, diagnostics, targeted tests, evidence, and release. Negative paths verify unlocked and wrong-owner edits are rejected.
- `hps_harness_run`: execute the measured HP-MHA matrix with real traces, independent evaluation, scheduler isolation, failure denominators, and a verified Merkle root.
- `hps_release_verify`: require a clean tracked tree, full E2E proof, security artifacts, remote SHA parity, reproducibility, and an attestation before permitting release readiness.

Cleanup remains explicitly split into `hps_cleanup_audit` and `hps_cleanup_apply`. The audit records exact paths, byte counts, age, tracked state, reason, regeneration command, content hash, and recovery method. Apply revalidates the manifest and only accepts exact literal paths.

## Serena adapter

The adapter is a bounded child-process MCP client with correlation IDs, redacted structured logs, startup timeout, per-call timeout, and one restart attempt. It validates the pinned Serena package/version and tracked project profile before use.

Read-only semantic capabilities include symbol overview, symbol lookup, references, pattern search, diagnostics, index status, restart, and stale-index recovery. The server performs mutations itself only after HermesProof authorizes ownership. Evidence binds before/after file hashes, symbol context, diagnostic output, gate results, owner, task, and commit.

## HP-MHA measurement

Harness cards are generated from installed packages and executable probes for HermesProof, Hermes Agent, Serena, OpenHands 1.16.0, Aider 0.86.2, and Goose 1.27.2. Each card contains the package source, resolved executable, exact version, package/archive hash, capability probe, and observation time.

The attribution experiment is a real 2x2 matrix:

| Model | Baseline harness | Serena-assisted harness |
| --- | --- | --- |
| MiniMax M3 | measured | measured |
| Exact-digest healthy local Ollama model | measured | measured |

The task corpus has separately hashed optimization and holdout sets, four representative code tasks, and three repetitions per cell. The scheduler rejects holdout work for optimization roles before task claim. An independent evaluator scores persisted outputs. Every run has an outcome and trace; no outcome disappears from denominators.

Merkle leaves are canonical hashes of run records. The root is recomputed from persisted leaves and verified independently. Any missing leaf, altered trace, invalid root, or evaluator inconsistency exits nonzero and cannot print a pass result.

## User workflows

One-command workflows are available as npm commands and MCP calls:

- init: HermesProof state, Serena verification/onboarding, and client wiring.
- doctor --deep: locks, evidence, Serena symbols, remotes, clients, harness packages, runners, and artifacts.
- safe-edit: claim -> semantic analysis -> lock -> patch -> diagnostics -> tests -> evidence -> release.
- release: clean tree -> full E2E -> remote pipeline/proof parity -> attestation.

## Capability packs and completion compiler

HermesProof converts the user outcome into an acceptance graph, compares it with available skills and tools, and identifies the smallest missing capability set. Missing capabilities may be resolved from the official MCP Registry or a pinned private catalog, but are never globally enabled by discovery alone.

A capability pack is content-addressed and includes source identity, verified publisher namespace, version, executable/package hashes, SBOM, tool schema digest, required filesystem/network/process permissions, health probe, conformance proof, rollback, and quarantine policy. Packs install into isolated storage and become usable only through workspace/owner/task/time-limited leases. Tool names are namespaced by verified server identity and collisions fail closed.

The pack manager can adapt MCP servers, CLIs, LSPs, REST APIs, local models, and runners behind a uniform capability manifest. Routing prefers local/private/zero-cost options, then uses health, latency, and measured HP-MHA completion quality. Binary, schema, permission, or capability drift quarantines the pack. Successful evidenced workflows become versioned project recipes, allowing HermesProof to streamline future work without granting broader authority.

## Gap closure and automation

The gap ledger is generated from live executable probes rather than a static checklist. Each entry names the requirement, observed evidence, replacement when needed, terminal state, and release impact. The release gate rejects:

- an advertised item with `NOT_SHIPPED`;
- unresolved or unknown states;
- registry/documentation count drift;
- missing client or sidecar proof;
- inactive least-privilege provider profiles;
- duplicate unrestricted filesystem or shell providers;
- stale generated proof.

The 71-entry research registry is converted into small least-privilege profiles. No duplicate unrestricted shell/filesystem server is enabled by default.

## CI and compute budget

Routine tests run on the local Windows machine. Linux parity runs on an operator-controlled VPS or user-owned GitLab runner. GitLab shared compute is protected by change-filtered merge-request jobs and a manual protected release job. Pipelines avoid schedules, duplicate branch/MR runs, and documentation-only full tests; jobs are interruptible with auto-cancel, caches, bounded artifacts, and a release resource group.

## Source consolidation and commits

The dirty local recovery checkout is never edited. A hash manifest copies only legitimate product paths into the isolated release workspace, excluding secrets, dependency trees, caches, temporary worktrees, generated junk, and unrelated vendored tools.

Reviewable commits are:

1. Current core/helper-runtime recovery snapshot.
2. Real fail-closed HP-MHA.
3. Lock-aware Serena composite MCP server.
4. User workflows, gap audit, and cleanup planner.
5. CI, runners, and GitLab/GitHub governance.
6. Generated docs, proof, SBOM, checksums, and release metadata.

Each green commit is pushed to both `Ghenghis/HermesProof` remotes. A draft GitLab merge request targets `main`; merging remains a final user approval action.

## Required E2E evidence

Release readiness requires fresh success for:

1. Syntax and manifest validation.
2. Full unit/smoke suite.
3. Both MCP initialize/list-tools handshakes.
4. Live tool registry and generated docs parity.
5. Serena symbol and reference extraction for `.mjs`.
6. Unlocked and wrong-owner edit rejection.
7. Locked edit with before/after hash evidence.
8. Diagnostic failure recovery without lock loss.
9. Serena child restart and stale-index recovery.
10. Real measured 2x2 attribution matrix.
11. Trace/Merkle tamper rejection with nonzero exit.
12. Scheduler-level holdout isolation.
13. Failure denominator preservation.
14. Installed sidecar cards with real versions and hashes.
15. Zero unresolved advertised gaps.
16. Init, deep doctor, safe-edit, harness, and release through MCP.
17. Clean-room Windows install.
18. Linux parity on an operator-controlled runner.
19. Supported client configuration and live connection probes.
20. Secret scan, SBOM, checksums, evidence-chain verification, and attestation.
21. GitLab/GitHub branch SHA and artifact parity.
22. Reproducible tag candidate from the recorded commit.

## Completion boundary

The branch is complete only when it is clean, pushed to both remotes, the draft GitLab merge request exists, both servers are installable, Serena is lock-safe, HP-MHA has a valid measured matrix and Merkle root, all advertised clients/sidecars are proven, the gap ledger is clean, Windows/Linux/remote evidence agrees, and release artifacts are reproducible and checksummed.
