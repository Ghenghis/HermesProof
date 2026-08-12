# HermesProof Offline Release Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a fail-closed, offline-verifiable Ed25519-signed Windows release and publish its complete verification assets to GitLab.

**Architecture:** A focused core module owns canonical payloads, fingerprints, signing, and verification. The Windows builder requires a matching external private key for official output and self-verifies the resulting ZIP sidecars. The checksum gate and standalone CLI reuse the same verifier so release proof cannot pass on sidecar presence alone.

**Tech Stack:** Node.js 20+ ESM, built-in `node:crypto`, `node:test`, PowerShell ZIP/install lifecycle, GitLab releases.

## Global Constraints

- GitLab is the only publication target: `https://gitlab.com/Ghenghis/HermesProof`.
- Official builds fail closed without `HERMESPROOF_RELEASE_SIGNING_KEY_FILE`.
- Private key material remains outside Git, logs, proof, manifests, and release archives.
- Signature schema is exactly `hermesproof.release-signature.v1` with Ed25519.
- No new runtime dependency or GitLab compute is required for signing.
- Existing dirty developer repositories are never modified.

## File map

- Create `src/core/release-signing.mjs`: strict signing and verification primitives.
- Create `src/core/release-signing.test.mjs`: key, envelope, checksum, and tamper tests.
- Create `scripts/generate-release-key.mjs`: non-overwriting external key generator.
- Create `scripts/verify-hermesproof-release.mjs`: user and automation CLI.
- Create `config/hermesproof-release-ed25519-public.pem`: pinned trust anchor.
- Modify `scripts/build-windows-release.mjs` and its test: official signing and self-verification.
- Modify `scripts/release-checksum.mjs` and its test: cryptographic gate enforcement.
- Modify `package.json`: exact build, verify, keygen, and test commands.
- Modify release/readme/security/Windows docs and add `docs/diagrams/release-signing-flow.svg`.

---

### Task 1: Release signing primitives

**Files:**
- Create: `src/core/release-signing.mjs`
- Create: `src/core/release-signing.test.mjs`

**Interfaces:**
- Produces: `publicKeyFingerprint(publicKey): string`
- Produces: `canonicalSignaturePayload(fields): Buffer`
- Produces: `signReleaseArtifact(options): Promise<ReleaseSignatureResult>`
- Produces: `verifyReleaseArtifact(options): Promise<ReleaseVerificationResult>`

- [ ] **Step 1: Write failing tests for canonical fingerprints and valid signing**

Generate a temporary Ed25519 pair with `generateKeyPairSync("ed25519")`, write an artifact and PEM keys, call `signReleaseArtifact`, then assert the checksum filename, strict envelope, fingerprint, and `verifyReleaseArtifact(...).ok === true`.

- [ ] **Step 2: Run the focused tests and verify the missing-module failure**

Run: `node --test src/core/release-signing.test.mjs`

Expected: FAIL because `release-signing.mjs` does not exist.

- [ ] **Step 3: Implement strict minimal signing and verification**

Use `createPrivateKey`, `createPublicKey`, `sign(null, payload, key)`, and `verify(null, payload, key, signature)`. Hash artifact bytes incrementally. Validate exact envelope keys, lowercase SHA-256, canonical base64, exact artifact basename, and Ed25519 key type. Compare private-derived and pinned public SPKI DER with `timingSafeEqual`.

- [ ] **Step 4: Add tamper and malformed-input tests**

Independently alter archive bytes, checksum digest/name, signature, schema, algorithm, artifact, fingerprint, extra field, public key, and private-key type. Assert every case rejects or returns `ok: false` with a stable reason code.

- [ ] **Step 5: Run focused tests**

Run: `node --test src/core/release-signing.test.mjs`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```text
git add src/core/release-signing.mjs src/core/release-signing.test.mjs
git commit -m "feat(release): add strict Ed25519 artifact verification"
```

### Task 2: Key generation and pinned trust anchor

**Files:**
- Create: `scripts/generate-release-key.mjs`
- Create: `scripts/generate-release-key.test.mjs`
- Create: `config/hermesproof-release-ed25519-public.pem`

**Interfaces:**
- Produces: `generateReleaseKeyPair({ privateKeyFile, publicKeyFile }): Promise<{ fingerprint }>`
- Consumes: `publicKeyFingerprint` from Task 1.

- [ ] **Step 1: Write failing tests for key creation and overwrite refusal**

Assert PKCS#8/SPKI PEM output, Ed25519 type, matching fingerprint, no private PEM in the returned object, and refusal when either output exists.

- [ ] **Step 2: Run tests to prove failure**

Run: `node --test scripts/generate-release-key.test.mjs`

Expected: FAIL because the generator does not exist.

- [ ] **Step 3: Implement the generator**

Use `generateKeyPairSync("ed25519")`, exclusive file creation, restrictive POSIX mode, and Windows `icacls` hardening through `execFile` argument arrays. Never print private contents.

- [ ] **Step 4: Run tests and create the official external key**

Generate `C:\private\HermesProof-release-ed25519-private.pem` only if absent, then patch only its public PEM into `config/hermesproof-release-ed25519-public.pem`. Confirm Git does not report the private path.

- [ ] **Step 5: Commit**

```text
git add scripts/generate-release-key.mjs scripts/generate-release-key.test.mjs config/hermesproof-release-ed25519-public.pem
git commit -m "feat(release): pin offline release trust anchor"
```

### Task 3: Signed builder and verifier CLI

**Files:**
- Modify: `scripts/build-windows-release.mjs`
- Modify: `scripts/build-windows-release.test.mjs`
- Create: `scripts/verify-hermesproof-release.mjs`
- Create: `scripts/verify-hermesproof-release.test.mjs`
- Modify: `package.json`

**Interfaces:**
- `buildWindowsRelease({ root, outputRoot, signingKeyFile, publicKeyFile, unsignedDevelopment }): Promise<BuildResult>`
- CLI: `node scripts/verify-hermesproof-release.mjs --artifact <zip> [--public-key <pem>] [--json]`

- [ ] **Step 1: Write failing builder/CLI tests**

Assert missing-key rejection, signed sidecar names, immediate self-verification, wrong-key rejection, verifier exit 0 for valid assets, and non-zero for tampering. Assert unsigned development output contains `UNSIGNED-DEVELOPMENT` and cannot use the official filename.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test scripts/build-windows-release.test.mjs scripts/verify-hermesproof-release.test.mjs`

- [ ] **Step 3: Integrate the core signer**

After ZIP creation, call `signReleaseArtifact`, write both checksum files, self-verify, and return signature/fingerprint paths without any private-key value. Parse `--unsigned-development` explicitly; normal CLI builds require the environment key.

- [ ] **Step 4: Add package scripts and rerun**

Add `release:keygen`, `release:verify`, and signing tests to `test:release-hardening`.

- [ ] **Step 5: Commit**

```text
git add scripts/build-windows-release.mjs scripts/build-windows-release.test.mjs scripts/verify-hermesproof-release.mjs scripts/verify-hermesproof-release.test.mjs package.json
git commit -m "feat(release): build self-verified signed Windows archives"
```

### Task 4: Cryptographic release checksum gate

**Files:**
- Modify: `scripts/release-checksum.mjs`
- Modify: `scripts/release-checksum-test.mjs`

**Interfaces:**
- `runReleaseChecksumGate({ root, scanDirs, verifySha256, verifySignatures, publicKeyFile })`
- Consumes: `verifyReleaseArtifact` from Task 1.

- [ ] **Step 1: Replace fake-signature success with a failing cryptographic fixture**

Generate a temporary key and real signature. Assert `verifySignatures: true` passes valid assets and records fingerprint, while fake/tampered signatures fail in `signature_mismatches`.

- [ ] **Step 2: Run the focused gate tests and confirm failure**

Run: `node --test scripts/release-checksum-test.mjs`

- [ ] **Step 3: Implement strict signature verification**

For `.sig` assets, call the shared verifier. Preserve explicit cosign/PGP classification but report those formats as unsupported by the local Ed25519 verifier unless their own verifier is configured. The direct release CLI and truth gate enable both digest and signature verification.

- [ ] **Step 4: Run focused and hardening tests**

Run: `node --test scripts/release-checksum-test.mjs src/core/release-signing.test.mjs`

Run: `npm run test:release-hardening`

- [ ] **Step 5: Commit**

```text
git add scripts/release-checksum.mjs scripts/release-checksum-test.mjs
git commit -m "fix(release): verify artifact signatures cryptographically"
```

### Task 5: Documentation, diagrams, and drift coverage

**Files:**
- Modify: `README.md`
- Modify: `docs/WINDOWS_INSTALL.md`
- Modify: `docs/GITLAB_RELEASE_RUNBOOK.md`
- Modify: `docs/SECURITY_POLICY.md`
- Modify: `docs/README_COVERAGE_MATRIX.md`
- Create: `docs/diagrams/release-signing-flow.svg`
- Modify: relevant docs drift tests if required.

- [ ] **Step 1: Add a failing docs assertion**

Require links to the signing diagram, exact verification command, all release assets, fail-closed behavior, key rotation, and GitLab-only publication.

- [ ] **Step 2: Update the user and operator docs**

Add the pre-extraction verification workflow, architecture flow, failure recovery, private-key boundary, release upload checklist, fingerprint recording, and historical key rotation.

- [ ] **Step 3: Add the repository-native SVG diagram**

Show source plus external key to builder, ZIP/checksum/signature to verifier, pass to installer, and fail to stop/quarantine. Include accessible title/description.

- [ ] **Step 4: Run documentation validation**

Run: `npm run docs:check`

Run: `node --test scripts/docs-changes-reflected-test.mjs scripts/release-docs-drift.test.mjs`

- [ ] **Step 5: Commit**

```text
git add README.md docs scripts/docs-changes-reflected-test.mjs scripts/release-docs-drift.test.mjs
git commit -m "docs(release): explain signed Windows distribution"
```

### Task 6: Exact release proof and GitLab publication

**Files:**
- Modify generated proof files under `PROOF/` and `PROOF_E2E_REPORT.md`.
- Generate ignored artifacts under `dist/`.

- [ ] **Step 1: Run complete local verification**

Run: `npm test`

Run: `npm run docs:check`

Run strict truth gates with `TRUTH_GATE_HERMES3D_WORKSPACE` set to this clean release worktree. Any product-gate failure blocks release.

- [ ] **Step 2: Commit final proof**

Review proof for zero required failures, secrets, stale SHA, placeholders, and false PASS output. Commit only the generated proof files.

- [ ] **Step 3: Build and verify the exact HEAD artifact**

Build with the external key. Verify the ZIP using the standalone CLI and checksum gate. Confirm the internal manifest source SHA equals `git rev-parse HEAD`.

- [ ] **Step 4: Run exact Windows lifecycle E2E**

Use an isolated test home and managed root. Verify, install, probe both MCP servers, repair, simulate rollback, uninstall, restore client backups, and purge. Fail if any recovery operation reports success after an error.

- [ ] **Step 5: Publish only to GitLab**

Push `release/hp-mha-serena-shippable`, update draft MR 3, create/push `v0.9.0-rc.1` only if absent, and publish ZIP, checksum, signature, public key, verifier, manifest, SBOM, and proof assets. Use local evidence and reserve GitLab compute for the final pipeline.

- [ ] **Step 6: Verify remote usability**

Fetch GitLab branch/tag/release metadata, download the release assets into a new temporary directory, verify the signature and digest, and run a read-only MCP initialize/list-tools/health smoke from the downloaded archive.
