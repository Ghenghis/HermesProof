# HP-MHA + Serena Release Implementation Plan

> Execute this plan on `release/hp-mha-serena-shippable` in the isolated workspace. Use HermesProof exact-file locks and test-driven changes for every task.

**Goal:** Deliver a current, dual-era HermesProof release with a second lock-safe Serena/HP-MHA MCP server, real attribution proof, high-value daily workflows, and remote/reproducible evidence.

**Architecture:** Preserve the existing coordination server while introducing explicit signed workspace handles and a composite server. Use read-only Serena semantic operations; HermesProof owns all mutations and evidence. Persist workflow state as content-addressed transactions so crashes resume safely. Generate truth docs and gap status from live probes.

**Runtime:** Node.js 22 ESM, MCP TypeScript SDK v2 dual-era support, Zod, node:test, Serena pinned runtime, npm lockfile, Windows local runner, Linux operator runner, GitLab/GitHub.

## Release blocker order

| Priority | Gap | Replacement |
| --- | --- | --- |
| P0 | Global active-workspace drift can lock the wrong repository | Signed explicit workspace handle bound to canonical root, repo fingerprint, principal, branch, expiry, and nonce; every composite mutation rejects mismatch |
| P0 | Legacy MCP 2025-only behavior and stale README | Dual-era 2025/2026 server, `server/discover`, per-request metadata, deterministic tool order, strict output schemas, cache hints, trace context |
| P0 | Direct Serena edits/shell bypass locks | Tracked semantic-only Serena profile; composite server performs bounded mutations after exact locks |
| P0 | HP-MHA can report pass after invalid Merkle verification | Canonical persisted leaves, independent recomputation, tamper test, nonzero fail-closed result |
| P0 | Harness cards/matrix are not installed measured evidence | Executable/package probes, exact versions/hashes, real 2x2 runs, independent evaluator, failure denominators |
| P1 | Long workflows are fragile and non-resumable | Content-addressed workflow transactions with idempotent steps, recovery journal, Tasks extension adapter, cancellation |
| P1 | Tool supply chain is overly broad | Capability firewall, least-privilege profiles, provenance/hash checks, collision detection, schema-drift and poisoning scan |
| P1 | Docs/proof become stale | Live registry generator, proof freshness budget, remote SHA/artifact parity, release capsule |
| P1 | Multi-repo ecosystem has duplicate configuration | Federated workspace catalog and one explicit handle per repo; no hidden global workspace |
| P1 | CI minutes can be wasted | Change-aware runner broker selecting local Windows, operator Linux, or protected manual GitLab jobs |
| P2 | Users must assemble low-level tool sequences | One-command init, deep doctor, safe-edit, harness, release, cleanup audit/apply |
| P2 | Diagnostics explain but do not safely repair | `doctor --heal` produces reversible, exact-scope remediation plans; automatic repair only for policy-approved operations |
| P2 | Users cannot see claim-to-release state | MCP App/dashboard resource driven by evidence/transaction events, with no privileged mutation path |
| P2 | Repeated edits rerun unnecessary tests | Semantic impact graph and evidence-backed test selection with full-suite release fallback |
| P2 | Failures are hard to reproduce | Redacted replay bundle with inputs, versions, hashes, traces, environment inventory, and deterministic rerun command |

## Task 1: Recover and publish the current legitimate source

**Files:** `scripts/recover-source-snapshot.mjs`, `PROOF/source-recovery-manifest.json`, and the legitimate product files selected by the manifest.

1. Add failing tests for path allowlisting, secret/dependency/cache exclusion, tracked-state capture, SHA-256 calculation, destination containment, and deterministic manifest order.
2. Implement a read-only census of the dirty local recovery checkout.
3. Copy only allowlisted product files into the isolated workspace using exact resolved paths.
4. Prove excluded roots include dependency trees, caches, temporary worktrees, generated junk, secrets, and unrelated vendored tools.
5. Run the full suite. Commit as `feat(core): recover current HermesProof product source`.
6. Push the commit to both remotes and verify the branch SHA.

## Task 2: Bind every workflow to an explicit workspace identity

**Files:** `src/core/workspace-binding.mjs`, `src/core/workspace-binding.test.mjs`, `src/server.mjs`.

1. Write failing tests for canonical-root mismatch, repo fingerprint mismatch, branch mismatch, principal mismatch, expiry, tamper, replay nonce, symlink escape, and process-restart fallback.
2. Mint an HMAC/AEAD-protected handle containing a random ID and claims for canonical root, Git common directory, remote identities, branch, issuance/expiry, principal, and policy digest.
3. Verify the handle before manager lookup and before every composite mutation.
4. Replace mutable singleton selection in the new server with a workspace-manager map keyed by verified handle claims.
5. Add a regression E2E: bind workspace A, restart the process with default workspace B, attempt A edit without its handle, and prove rejection before claim.
6. Emit redacted evidence for binding, renewal, and rejection.

## Task 3: Modernize MCP to the 2026-07-28 era without breaking current clients

**Files:** `package.json`, `package-lock.json`, `src/server.mjs`, `src/hp-mha-serena-server.mjs`, `scripts/mcp-dual-era-smoke-test.mjs`.

1. Pin the stable v2 split SDK packages supporting `2026-07-28`.
2. Write dual-era tests: legacy initialize/list-tools and modern discover/self-describing calls.
3. Serve stdio through the SDK dual-era entry and use deterministic tool order.
4. Add strict JSON Schema 2020-12 input/output contracts and validate `structuredContent`.
5. Propagate W3C trace context and emit correlation IDs without exposing baggage secrets.
6. Add cache hints and stable registry digests.
7. Implement MRTR confirmation responses for destructive or scope-expanding operations.
8. Use explicit state handles; do not depend on transport sessions.
9. Add Tasks extension support for long harness/release workflows and bounded cancellation.
10. Generate a compatibility report showing current clients and negotiated era.

## Task 4: Ship tracked, pinned, semantic-only Serena

**Files:** `.serena/project.yml`, `.serena/.gitignore`, `.serena/memories/*.md`, `policies/serena-runtime-lock.json`, `scripts/serena-doctor.mjs`, `scripts/serena-integration.test.mjs`.

1. Test TypeScript symbol extraction from `src/server.mjs`, references, diagnostics, restart, and stale-index recovery.
2. Test that direct Serena mutation and shell operations are unavailable.
3. Generate a runtime lock from the installed Serena executable, version, package source, and hashes.
4. Verify onboarding memories and project configuration.
5. Add clean-install and client-wiring checks.
6. Commit as `feat(serena): ship pinned semantic-only integration`.

## Task 5: Build the `hp-mha-serena` composite MCP server

**Files:** `src/hp-mha-serena-server.mjs`, `src/core/serena-adapter.mjs`, `src/core/safe-edit-transaction.mjs`, adjacent tests, `package.json`.

1. Write failing stdio handshake and registry tests.
2. Implement a bounded Serena child-process adapter with startup/call timeouts, one restart, correlation IDs, redaction, and capability probes.
3. Implement `hps_init`, `hps_doctor_deep`, `hps_gap_audit`, `hps_safe_edit`, `hps_harness_run`, and `hps_release_verify`.
4. Implement safe edit as persisted states: bound -> claimed -> analyzed -> locked -> patched -> diagnosed -> tested -> evidenced -> released.
5. Reject unlocked, wrong-owner, wrong-workspace, stale-index, diagnostic-failing, and unallowlisted-test paths.
6. Preserve locks plus recovery journal after partial failure.
7. Add `hp-mha-serena` to the package bin registry and client installers.

## Task 6: Make HP-MHA a real fail-closed measurement harness

**Files:** `src/core/hp-mha.mjs`, HP-MHA tests, `scripts/hp-mha-*.mjs`, `policies/hp-mha/**`.

1. Add failing canonical Merkle tests, including altered leaf, reordered leaf, missing trace, wrong root, and persisted-root mismatch.
2. Generate real installed harness cards for HermesProof, Hermes Agent, Serena, OpenHands 1.16.0, Aider 0.86.2, and Goose 1.27.2.
3. Create separately hashed optimization and holdout corpora.
4. Enforce scheduler rejection of holdout tasks for optimization roles before task claim.
5. Execute four representative code tasks with three repetitions per cell for MiniMax M3 and an exact-digest healthy local Ollama model, baseline and Serena-assisted.
6. Persist crashes, failures, timeouts, and cancellations in denominators.
7. Evaluate outputs independently and store real traces.
8. Recompute and verify the Merkle root in a separate process.
9. Commit as `feat(hp-mha): add measured fail-closed attribution harness`.

## Task 7: Add high-value daily automation

**Files:** `src/core/workflows/**`, `scripts/hps-*.mjs`, workflow tests, `package.json`.

1. Init: initialize state, bind workspace, verify Serena, onboard, and wire supported clients.
2. Deep doctor: locks, workspace binding, evidence, symbols, clients, sidecars, remotes, runners, harness, security artifacts.
3. Safe edit: semantic impact, conflict forecast, exact locks, patch, diagnostics, selected tests, evidence, release.
4. Release: clean-tree check, full E2E, remote SHA parity, release capsule, attestation.
5. Doctor heal: produce a reversible plan; apply only approved low-risk repairs.
6. Replay: build a redacted content-addressed failure capsule and verify deterministic rerun.
7. Test selector: derive affected tests from Serena references and previous evidence; always run the complete release suite at the final gate.

## Task 8: Add the MCP capability firewall and ecosystem profiles

**Files:** `src/core/capability-firewall.mjs`, tests, `policies/provider-registry/**`, `policies/profiles/**`.

1. Normalize every server/tool identity by source, version, schema digest, executable hash, and declared blast radius.
2. Detect name collisions, duplicate filesystem/shell authority, schema drift, untrusted annotations, prompt/tool poisoning markers, token passthrough, and missing output schemas.
3. Compile small profiles such as semantic-read, coordinated-edit, test, release, and admin-recovery.
4. Convert the 71-entry research registry into least-privilege recommendations with no unrestricted provider enabled by default.
5. Expose a dry-run policy explanation for every denied tool.

## Task 8A: Add the Capability Pack Manager and Completion Compiler

**Files:** `src/core/capability-packs.mjs`, `src/core/completion-compiler.mjs`, adjacent tests, `policies/capability-packs/**`, `server.json`.

1. Compile each user outcome into requirements, acceptance claims, required evidence, and a capability graph.
2. Compare that graph with installed MCP tools, Serena/LSP abilities, CLIs, HTTP APIs, local models, runners, and reusable skills.
3. Resolve missing capabilities from the official MCP Registry plus pinned private catalogs; cache metadata but revalidate package identity and version before install.
4. Generate an install plan containing source, version, namespace, executable, package hash, publisher verification, requested permissions, conflicts, disk/network cost, and rollback.
5. Install into a content-addressed sandbox; never add a package to the operator-global environment by default.
6. Run conformance, poisoning, secret, filesystem-diff, network-scope, schema, startup, shutdown, and uninstall probes.
7. Keep packs disabled until a workspace/owner/task/time-limited capability lease is issued.
8. Namespace proxied tools by verified server identity, reject collisions, and keep deterministic registry ordering.
9. Route by privacy, locality, cost, health, latency, and HP-MHA proven completion quality; record why a provider was selected.
10. Quarantine packs on binary/schema/capability drift and retain the last known-good content-addressed version.
11. Convert successful evidenced workflows into versioned project recipes and Serena memories, never into unverified broad permissions.
12. Add MCP tools `hps_capability_resolve`, `hps_pack_plan`, `hps_pack_verify`, `hps_pack_lease`, `hps_pack_revoke`, and `hps_completion_status`.
13. Add official package metadata (`mcpName` and `server.json`) for both HermesProof servers and a dry-run registry publication gate.
14. Prove E2E: start with a missing capability, resolve and sandbox a signed pack, issue a minimal lease, complete the task, revoke the lease, and reproduce the evidence without leaving global changes.

## Task 9: Generate a zero-unresolved gap ledger and release capsule

**Files:** `src/core/gap-audit.mjs`, tests, `PROOF/gaps.json`, `scripts/release-capsule.mjs`.

1. Generate states only from live probes: `PROVEN`, `REPLACED`, or `NOT_SHIPPED`.
2. Reject advertised release features in `NOT_SHIPPED` and all unknown states.
3. Include proof freshness, tool registry digest, protocol-era report, Serena runtime hash, harness card hashes, matrix root, client probes, runner parity, remote SHAs, SBOM, checksums, and evidence-chain head.
4. Produce a deterministic release capsule and verify it from a clean extraction.
5. Sign/attest when credentials and supported runner identity are present; otherwise release readiness remains false.

## Task 10: Make CI useful without consuming the shared-minute budget

**Files:** `.gitlab-ci.yml`, `.github/workflows/**`, `scripts/runner-broker.mjs`, CI tests.

1. Add workflow rules preventing duplicate branch/MR pipelines and scheduled runs.
2. Use path changes to select syntax/unit/integration jobs.
3. Mark routine jobs interruptible with auto-cancel and bounded artifacts/caches.
4. Prefer tagged user-owned Windows/Linux runners.
5. Keep the full release job protected and manual with a resource group.
6. Add a local/VPS runner broker that emits portable attestations.
7. Prove documentation-only changes do not run the expensive matrix.

## Task 11: Documentation, client UX, and optional MCP App

**Files:** generated README/tool reference, installer/wizard files, `site/**`, MCP App resources if supported.

1. Generate counts and tool tables from both live registries.
2. Document dual protocol eras, explicit workspace handles, recovery, profiles, and the six primary workflows.
3. Add deterministic installers for Codex, Claude, KiloCode/OpenHands, Windsurf, Goose, and Aider where supported.
4. Expose a read-only dashboard showing workflow state, locks, evidence freshness, matrix results, gaps, and runner parity.
5. Prove installed client connection rather than configuration presence alone.

## Task 12: Final E2E, review, and remote publication

1. Run all targeted tests and `npm test`.
2. Run both legacy and modern MCP handshakes for both servers.
3. Run negative lock/workspace/Serena/Merkle/security cases.
4. Run real HP-MHA matrix and verify persisted Merkle root independently.
5. Run clean-room Windows install and operator Linux parity.
6. Generate SBOM, checksums, gap ledger, evidence verification, release capsule, and attestation.
7. Confirm local, GitLab, and GitHub branch SHAs match.
8. Push six reviewable implementation commits to both remotes.
9. Open a draft GitLab merge request into `main`, with expensive shared-runner release job left manual.
10. Run a final anti-slop/code review and resolve findings.
11. Stop before merge for the user’s final release approval.

## Cleanup phase

Run a read-only census across the named repositories. Produce an exact manifest with path, bytes, age, tracked state, content hash, reason, regeneration command, and recovery. Protect all tracked, dirty, unique, secret, referenced, or unknown data. Deletion remains a distinct action after exact-target approval and hash revalidation; after cleanup, rerun dependency install and release E2E.
