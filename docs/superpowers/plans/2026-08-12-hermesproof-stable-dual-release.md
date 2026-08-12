# HermesProof v0.9.0 Stable Dual-Remote Release Plan

> Execution owner: `codex-impl-01` under HermesProof task `HP-STABLE-RELEASE-20260812`.

**Goal:** Reconcile the current audited release branch with both stale default branches, publish a locally verified HermesProof v0.9.0 stable Windows release, and leave GitLab and GitHub with the same source, tag, documentation, and assets.

**Release constraints:** No GitLab runner minutes. All gates, MCP round trips, packaging, signature verification, and clean-install checks run locally. No force-pushes. Secrets and the private signing key never enter Git history or release assets.

## Task 1: Preserve divergent remote history

1. Fetch `gitlab` and `github` without mutating the working tree.
2. Confirm `gitlab/main` is an ancestor of the release branch.
3. Audit every GitHub-only commit and file.
4. Merge `github/main` into `release/hp-mha-serena-shippable` with a normal merge commit.
5. Preserve the newer release branch implementations on conflicts; preserve GitHub-only historical handoffs.
6. Verify the merge has no unmerged paths and the expected history is reachable.

## Task 2: Promote release-candidate metadata to v0.9.0

1. Change current release metadata from `0.9.0-rc.1` / `v0.9.0-rc.1` to `0.9.0` / `v0.9.0`.
2. Update package lock metadata, installer manifest guard, current README/install/security/architecture/runbook/site text, and release-fact tests.
3. Add a dated `0.9.0` changelog section by moving the current accumulated release content out of `Unreleased` without rewriting historical releases.
4. Run `npm run docs:generate` and require `npm run docs:check` to pass.
5. Assert no current-release file still advertises the release candidate; historical plans/specifications may continue to describe the prior RC.

## Task 3: Verify code, servers, and documentation locally

1. Run `npm test` and require zero failures.
2. Run `npm run docs:check` and `npm run test:windows-release`.
3. Run the real stdio HP-MHA smoke and both live MCP tool-list probes.
4. Confirm the core server reports 121 tools and `hp-mha-serena` reports 34 tools.
5. Run the release truth gates locally and retain their generated proof only when the gate exits successfully.
6. Run secret/static hygiene checks and confirm the tracked tree contains no private signing key or environment file.

## Task 4: Commit the stable source release

1. Review the full diff and generated files.
2. Commit the version/docs/proof promotion on the release branch with the configured user identity.
3. Require a clean tracked worktree after the commit.
4. Push the release branch to GitLab and GitHub using fast-forward updates only.

## Task 5: Build and verify official Windows assets

1. Locate the private signing key without printing its value or content.
2. Run `npm run build:windows-release` with only the signing-key file path supplied through the environment.
3. Verify the ZIP checksum and Ed25519 signature with the tracked public key.
4. Extract to a temporary directory, run the bundled verifier there, and run a non-destructive installer/client configuration smoke when supported.
5. Record artifact names, sizes, hashes, source SHA, manifest file count, and signing-key fingerprint.

## Task 6: Update default branches without rewriting history

1. Fast-forward GitLab `main` from its stale ancestor to the verified release commit and close/merge the existing release MR consistently.
2. Reconcile GitHub through the release branch ancestry already containing GitHub `main`; open or update a PR into `main`, then merge it without squash so both histories remain reachable.
3. Fetch both remotes and prove their default branches and release branches resolve to the expected stable source commit or its history-preserving merge commit.

## Task 7: Publish matching v0.9.0 releases

1. Create one annotated `v0.9.0` tag at the verified stable source commit and push it to both remotes.
2. Create GitLab and GitHub releases for the same tag and release notes.
3. Upload the signed Windows ZIP, `.sha256`, `.sig`, `SHA256SUMS.txt`, public key, verifier, manifest/SBOM, and current proof report/bundle as applicable.
4. Re-read both release APIs and verify tag identity, published state, asset names, and download URLs.

## Task 8: Independent remote and install verification

1. Clone each remote/tag into separate temporary directories.
2. Compare tracked-tree manifests while excluding provider-specific metadata.
3. Verify both clones report version `0.9.0`, pass `npm run docs:check`, and expose the expected two server entry points.
4. Download at least one published Windows artifact through each release page/API and verify it against the published checksum/signature.
5. Append HermesProof evidence, release all locks, and release the task only after every assertion above is true.
