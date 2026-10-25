# HermesProof Windows OTA Patch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make HermesProof's signed Windows OTA updater execute npm-backed candidate gates without `spawn EINVAL`, then publish and install a verified v0.9.1 patch.

**Architecture:** Keep `shell:false` and exact argv handling in the updater process boundary. On Windows only, translate the trusted `npm.cmd`/`npx.cmd` shims to the matching JavaScript CLI under the active Node runtime and execute that CLI with `process.execPath`; every other command remains unchanged.

**Tech Stack:** Node.js 22, built-in `node:test`, PowerShell release installer, Ed25519 release signing, GitLab and GitHub release APIs.

## Global Constraints

- Use zero GitLab compute minutes; all verification runs locally and GitLab pushes use `ci.skip`.
- Do not execute npm through a command shell and do not interpolate user input into command text.
- Preserve fail-closed candidate quarantine, signature verification, rollback, and configuration backups.
- Keep tool counts exact: `hermes3d-locks` 121, `hp-mha-serena` 34, combined HermesProof surface 155; Serena catalog 52 is separate.
- Never commit private keys, tokens, environment files, caches, or generated installation state.

---

### Task 1: Reproduce and protect the Windows process boundary

**Files:**
- Modify: `src/updater/process-runner.test.mjs`
- Modify: `src/updater/process-runner.mjs`

**Interfaces:**
- Consumes: `runProcess({ command, args, cwd, ... })`.
- Produces: unchanged `runProcess` result/error contract with Windows npm/npx shim normalization before `spawn`.

- [ ] **Step 1: Add the failing Windows regression test**

Add a Windows-only test that calls the real process runner with `command: "npm.cmd"`, `args: ["--version"]`, and asserts exit code zero plus a semantic-version-shaped stdout value. The production mutation it catches is removing the shim translation, which restores `spawn EINVAL` on Windows.

- [ ] **Step 2: Prove RED**

Run `node --test src/updater/process-runner.test.mjs`. On Windows, require the new test to fail with `spawn EINVAL`; on other platforms it is skipped.

- [ ] **Step 3: Implement the minimal shell-free translation**

In `src/updater/process-runner.mjs`, import `node:path`, recognize only case-insensitive basename values `npm.cmd`, `npm`, `npx.cmd`, and `npx` on Windows, build `<dirname(process.execPath)>/node_modules/npm/bin/npm-cli.js` or `npx-cli.js`, and return `process.execPath` plus `[cli, ...args]`. Feed the translated command and argv to the existing `spawn(..., { shell: false })` call.

- [ ] **Step 4: Prove GREEN and no process-runner regressions**

Run `node --test src/updater/process-runner.test.mjs src/updater/production-gates.test.mjs`. Require all tests to pass without warnings.

- [ ] **Step 5: Commit the focused repair**

Commit only the plan, regression test, and process-runner implementation as `fix(updater): run Windows npm gates without cmd shell`.

### Task 2: Promote and attest v0.9.1

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `config/release-facts.json`
- Modify: `CHANGELOG.md`
- Modify generated documentation and proof artifacts selected by the existing release scripts.

**Interfaces:**
- Consumes: current v0.9.0 release facts and documentation generators.
- Produces: consistent v0.9.1 package metadata, docs, site facts, changelog, SBOM, and truth proof.

- [ ] **Step 1: Set all current release facts to 0.9.1 / v0.9.1**

Update package metadata, lock metadata, release facts, and the changelog patch section. Do not rewrite historical release entries.

- [ ] **Step 2: Regenerate derived documentation**

Run `npm run docs:generate`, inspect the diff, then run `npm run docs:check` and require success.

- [ ] **Step 3: Run the focused and full product gates**

Run updater tests, `npm test`, Windows release hardening tests, direct core/composite MCP probes, and strict release truth. Require 121 core tools, 34 composite tools, and zero failing truth gates.

- [ ] **Step 4: Commit v0.9.1 release source and proof**

Commit metadata/docs separately from generated proof when practical, review `git diff --check`, and require a clean tracked tree.

### Task 3: Publish, install, and exercise the real OTA path

**Files:**
- No additional source files unless a failing release verification produces a new independently tested defect.

**Interfaces:**
- Consumes: v0.9.1 source commit, private local Ed25519 signing key, both remotes, installed v0.9.0 managed root.
- Produces: matching signed releases, v0.9.1 managed installation, enabled healthy updater task, and evidence ledger entries.

- [ ] **Step 1: Build and verify the signed Windows archive locally**

Run the official release builder with only the signing-key path supplied, verify checksum/signature/SBOM, extract to a temporary directory, and run clean install/probe/uninstall smoke tests.

- [ ] **Step 2: Publish reviewable source without GitLab compute**

Push the release branch to GitLab and GitHub, open fresh v0.9.1 merge requests, merge normally through each platform, and restore any temporarily adjusted GitLab merge policy in a `finally` path.

- [ ] **Step 3: Publish matching v0.9.1 release assets**

Create the annotated tag at the attested source commit and publish the same six signed Windows assets to both platforms. Verify fresh downloads byte-for-byte against the local archive.

- [ ] **Step 4: Repair-install v0.9.1 and run a real OTA apply**

Use the signed v0.9.1 installer because v0.9.0 cannot cross its broken npm gate. Then run updater `check` and `apply` against the merged stable candidate; require all production gates, atomic activation, health probes, and configuration preservation to pass.

- [ ] **Step 5: Verify clients, scheduler, counts, and cleanup**

Verify managed status, scheduled task enabled state, KiloCode/VS Code/Codex/Windsurf/LM Studio/Ollama/Claude/Cursor/Devin configuration, core 121 and composite 34 live tools, no stale candidate/quarantine residue except retained diagnostic metadata, and a clean source tree.

- [ ] **Step 6: Record evidence and release coordination locks**

Append test/release/install hashes and outcomes to HermesProof evidence, release every owned file lock, and release task `HP-OTA-WINDOWS-20260812` only after all mandatory verification succeeds.
