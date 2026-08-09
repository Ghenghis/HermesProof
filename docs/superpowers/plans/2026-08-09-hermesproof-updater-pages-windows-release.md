# HermesProof Updater, GitLab Pages, and Windows Release Implementation Plan

> Execute test-first in this session. Each production change begins with a failing focused test, then the smallest implementation, then focused and full verification. Do not modify the dirty checkout at `G:\Github\hermes3d-mcp-lock-orchestrator`.

**Goal:** Deliver a fail-closed managed updater, dual-server Windows installation, current generated documentation, an animated accessible GitLab Pages site, and downloadable GitLab release assets that another Windows 11 PC can install and verify.

**Architecture:** Immutable SHA-addressed releases live under a managed root. A stable launcher reads an atomic active-release pointer and starts either `hermes3d-locks` or `hp-mha-serena`. An update manager resolves an allowlisted channel, stages a candidate, runs injected verification, atomically activates both server/client definitions, and rolls back on post-activation failure. Generated release facts feed the README, docs, website, package manifest, and drift tests.

**Stack:** Node.js 20+ ESM, `node:test`, MCP SDK, static HTML/CSS/JS, Mermaid/SVG documentation, PowerShell Windows packaging, GitLab Pages, Generic Package Registry, and Releases API.

## Task 1: Generated release facts and drift contract

**Files:**

- Create: `config/release-facts.json`
- Create: `src/core/release-facts.mjs`
- Create: `src/core/release-facts.test.mjs`
- Create: `scripts/generate-release-docs.mjs`
- Create: `scripts/release-docs-drift.test.mjs`
- Modify: `package.json`

**Red:**

- Test strict schema validation for version, server names, tool-registry sources, channels, GitLab URLs, Serena version, truth-gate count, and support matrix.
- Test that tool counts are computed from registries rather than accepted from hand-written documentation.
- Test generator check mode fails on stale README/site/doc markers.

**Green:**

- Add a frozen release-facts loader with path-safe resolution and validated URLs/refs.
- Generate compact Markdown/HTML fragments and a JSON site data file.
- Add `docs:generate` and `docs:check` scripts.

**Verify:**

`node --test src/core/release-facts.test.mjs scripts/release-docs-drift.test.mjs`

## Task 2: Managed updater state model

**Files:**

- Create: `src/updater/errors.mjs`
- Create: `src/updater/policy.mjs`
- Create: `src/updater/state-store.mjs`
- Create: `src/updater/state-store.test.mjs`
- Create: `src/updater/path-policy.mjs`
- Create: `src/updater/path-policy.test.mjs`

**Red:**

- Test legal and illegal state transitions, generation compare-and-swap, corrupt pointer recovery, and journal resumption.
- Test rejection of roots, home, repository roots, traversal, symlink/junction escape, invalid SHAs, refs, channels, and remotes.
- Test current/previous protection and quarantine state.

**Green:**

- Implement schema-versioned active pointer, policy, release registry, journal, and single-flight lock records.
- Use sibling temporary writes plus atomic rename and injected filesystem/clock.
- Canonicalize every path and keep all updater state under the managed root.

**Verify:**

`node --test src/updater/state-store.test.mjs src/updater/path-policy.test.mjs`

## Task 3: Exact process and Git source adapters

**Files:**

- Create: `src/updater/process-runner.mjs`
- Create: `src/updater/process-runner.test.mjs`
- Create: `src/updater/git-source.mjs`
- Create: `src/updater/git-source.test.mjs`

**Red:**

- Test exact argv construction, `shell:false`, reduced environment, timeouts, bounded output, and redaction.
- Test allowlisted GitLab URL, stable/preview refs, full SHA validation, ancestry, no redirects to another host, and malicious input rejection.
- Use a temporary local bare repository for real adapter integration without network.

**Green:**

- Implement injected spawn runner and Git source resolver/materializer.
- Never interpolate source/ref/path into a shell command.

**Verify:**

`node --test src/updater/process-runner.test.mjs src/updater/git-source.test.mjs`

## Task 4: Candidate staging, verification, evidence, and quarantine

**Files:**

- Create: `src/updater/release-stager.mjs`
- Create: `src/updater/release-verifier.mjs`
- Create: `src/updater/evidence-writer.mjs`
- Create: `src/updater/staging.test.mjs`
- Create: `scripts/updater-candidate-probe.mjs`

**Red:**

- Test clean exact-SHA staging, locked dependency preparation, Serena validation, generated-reference drift, SBOM/hash manifest, two MCP handshakes, and evidence digests.
- Inject failures for dependency install, Serena schema, tests, registry drift, Merkle verification, docs, and MCP handshakes; every failure must quarantine and leave active state unchanged.
- Test secret redaction and incomplete/skip result rejection.

**Green:**

- Implement the verifier as named required gates returning structured results.
- Keep staging non-executable by the launcher until the complete evidence bundle passes.
- Record source/lockfile/packages/SBOM/Serena/tests/HP-MHA/MCP/docs digests.

**Verify:**

`node --test src/updater/staging.test.mjs`

## Task 5: Stable launcher, activation, recovery, rollback, and retention

**Files:**

- Create: `scripts/hermesproof-launch.mjs`
- Create: `src/updater/activation-manager.mjs`
- Create: `src/updater/retention-manager.mjs`
- Create: `src/updater/activation-manager.test.mjs`
- Create: `scripts/hermesproof-launch.test.mjs`

**Red:**

- Test server allowlist, active pointer validation, known-good manifest validation, and release-path containment.
- Test pointer/client transaction boundaries, simulated process interruption at each journal step, post-activation rollback, and idempotent recovery.
- Test current/previous protection and cleanup path containment.

**Green:**

- Implement stable launcher and journaled activation.
- Switch new processes without killing an existing old-release process.
- Protect current and previous releases and quarantine failed candidates.

**Verify:**

`node --test src/updater/activation-manager.test.mjs scripts/hermesproof-launch.test.mjs`

## Task 6: Dual-server client installer

**Files:**

- Modify: `scripts/install-clients.mjs`
- Create: `scripts/install-clients.test.mjs`
- Modify: `scripts/wizard.mjs`
- Modify: `scripts/print-configs.mjs`

**Red:**

- Test both server entries for Claude Desktop, Claude Code, Codex, Windsurf, Kilo Code, Cursor, VS Code/Copilot, and supported hooks/SDK targets.
- Test stable-launcher paths, unrelated-config preservation, legacy duplicate migration, timestamped backup, dry-run redaction, parse-before-replace, rollback, and Windows escaping.

**Green:**

- Add managed-install and legacy-repo modes.
- Render `hermes3d-locks` and `hp-mha-serena` atomically for each native MCP target.
- Keep Serena mutation behind Hermes governance.

**Verify:**

`node --test scripts/install-clients.test.mjs scripts/serena-integration-e2e.test.mjs`

## Task 7: Scheduler and automatic refresh

**Files:**

- Create: `src/updater/scheduler.mjs`
- Create: `src/updater/scheduler.test.mjs`
- Create: `src/updater/windows-task-scheduler.mjs`
- Create: `src/updater/systemd-user-timer.mjs`

**Red:**

- Test six-hour cadence, deterministic jitter, maintenance window, preview opt-in, missed-run behavior, backoff, and single-flight lock.
- Test exact per-user Windows task and Linux systemd-user timer commands, inspection, idempotent update, and removal.

**Green:**

- Implement adapters with dry-run and injected command runner.
- Never install a system-wide/root service or unbounded schedule.

**Verify:**

`node --test src/updater/scheduler.test.mjs`

## Task 8: Update manager and CLI

**Files:**

- Create: `src/updater/update-manager.mjs`
- Create: `src/updater/update-manager.test.mjs`
- Create: `scripts/hermesproof-update.mjs`
- Create: `scripts/hermesproof-update.test.mjs`
- Modify: `package.json`

**Red:**

- Test `status`, `check`, `apply`, `rollback`, `channel`, `auto`, `doctor --deep`, and `cleanup`.
- Test already-current no-op, offline check, concurrent apply, preview acknowledgement, quarantine retry, activation failure, and recovery output.

**Green:**

- Orchestrate source, staging, verification, client preparation, activation, post-probe, rollback, evidence, retention, and scheduler.
- Return stable JSON plus concise human output; never emit secrets.

**Verify:**

`node --test src/updater/update-manager.test.mjs scripts/hermesproof-update.test.mjs`

## Task 9: Lock-aware MCP updater controls

**Files:**

- Modify: `src/hp-mha-serena/service.mjs`
- Modify: `src/hp-mha-serena/server.mjs`
- Modify: `src/hp-mha-serena/service.test.mjs`
- Modify: `scripts/hp-mha-serena-stdio.test.mjs`

**Red:**

- Test read-only status/check/evidence and guarded apply/rollback/channel/auto/cleanup.
- Test workspace binding, exact operation lock, idempotency key, concurrent call behavior, and error redaction.
- Test real MCP initialize/list-tools/call flow through the composite server.

**Green:**

- Inject `UpdateManager` into the composite service.
- Register generated schemas and accurate annotations.
- Regenerate expected composite count from the registry.

**Verify:**

`npm run hp-mha-serena:test`

## Task 10: Self-hosting updater E2E and doctor

**Files:**

- Create: `scripts/hermesproof-updater-e2e.test.mjs`
- Modify: `scripts/doctor.mjs`
- Modify: `scripts/truth-gates.mjs`
- Modify: `package.json`

**Red:**

- Build local releases A/B/tampered-C and exercise bootstrap, dual-server handshake, MCP-driven apply, evidence observation, old-process drain, quarantine, rollback, and interrupted recovery.
- Test deep doctor reports managed root, state, scheduler, both server handshakes, Serena symbols, clients, harness, and updater evidence.
- Require fail-closed truth-gate rows for updater and documentation.

**Green:**

- Add deterministic temp-repo fixture and self-hosting runner.
- Add updater truth-gate and doctor sections without optional-service absence masking product failures.

**Verify:**

`node --test scripts/hermesproof-updater-e2e.test.mjs`

`npm run doctor -- --deep`

## Task 11: Windows 11 managed installer and reproducible release bundle

**Files:**

- Create: `scripts/build-windows-release.mjs`
- Create: `scripts/build-windows-release.test.mjs`
- Create: `install-hermesproof.ps1`
- Create: `uninstall-hermesproof.ps1`
- Create: `docs/WINDOWS_INSTALL.md`
- Modify: `scripts/release-checksum.mjs`

**Red:**

- Test deterministic file selection, exclusion of secrets/caches/worktrees, manifest, SHA-256 checksums, version/SHA binding, archive traversal defense, and PowerShell syntax.
- Test clean install, upgrade, dual-server client wiring, auto-update opt-in, rollback, and uninstall dry-run against a temporary managed root.

**Green:**

- Build `HermesProof-<version>-windows-x64.zip`, `SHA256SUMS.txt`, SBOM, and release manifest.
- Installer validates checksums, Node >=20, managed-root safety, both MCP handshakes, and client-config backups.
- Package includes no token and downloads future versions through authenticated/public GitLab release links.

**Verify:**

`node --test scripts/build-windows-release.test.mjs`

`node scripts/build-windows-release.mjs --verify`

## Task 12: SOTA README and related documentation

**Files:**

- Rewrite: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/MAINTENANCE.md`
- Modify: `docs/TOOL_REFERENCE.md`
- Modify: `docs/SECURITY_POLICY.md`
- Modify: `docs/SERENA_INTEGRATION.md`
- Create: `docs/UPDATER_RUNBOOK.md`
- Create: `docs/TROUBLESHOOTING_UPDATES.md`
- Create: `docs/diagrams/ecosystem-e2e.svg`
- Create: `docs/diagrams/updater-lifecycle-animated.svg`
- Create: `docs/diagrams/capability-pack-flow.svg`
- Create: `docs/diagrams/windows-install-flow.svg`

**Red:**

- Expand drift tests to reject old counts, GitHub-primary links, old one-server setup, missing updater recovery, missing Serena count definitions, unlinked diagrams, broken anchors, invalid SVG, and undocumented CLI tools.

**Green:**

- Make README outcome-first with GitLab badges/links, truthful generated counts, two-server architecture, HP-MHA, Serena, Kilo backend kit, capability packs, automation/schedulers, updater, Windows installer, security, proof, and troubleshooting.
- Link every deep guide and diagram; provide accessible alt text and reduced-motion-safe SVG animation.
- Correct all related stale docs and remove claims dependent on GitHub Actions.

**Verify:**

`npm run docs:check`

`node --test scripts/docs-changes-reflected-test.mjs scripts/release-docs-drift.test.mjs`

## Task 13: Animated accessible GitLab Pages site

**Files:**

- Rewrite: `site/index.html`
- Rewrite: `site/styles.css`
- Rewrite: `site/app.js`
- Create: `site/404.html`
- Create: `site/release-facts.json` (generated)
- Sync: `site/diagrams/*.svg`
- Create: `scripts/site-quality.test.mjs`
- Modify: `.gitlab-ci.yml`

**Red:**

- Test generated version/counts/links, all sections and diagrams, semantic landmarks, keyboard navigation, contrast policy, reduced motion, no external runtime dependency, CSP-safe code, responsive behavior markers, and release download URL.
- Test GitLab Pages config uses current `pages.publish`, deploy stage, local static assets, and branch rules.

**Green:**

- Build an animated product narrative: hero proof pulse, flowing ecosystem map, interactive lifecycle rail, dual-server topology, updater state machine, live evidence counters, feature matrix, Windows install path, and release CTA.
- Use CSS/SVG/IntersectionObserver only; disable nonessential motion under `prefers-reduced-motion`.
- Keep site fully functional without JavaScript and avoid autoplay audio/video.

**Verify:**

`node --test scripts/site-quality.test.mjs scripts/accessibility-wcag-gate.test.mjs scripts/perf-budget-test.mjs`

## Task 14: GitLab Pages and release publishing scripts

**Files:**

- Create: `scripts/publish-gitlab-release.mjs`
- Create: `scripts/publish-gitlab-release.test.mjs`
- Create: `docs/GITLAB_RELEASE_RUNBOOK.md`
- Modify: `.gitlab-ci.yml`

**Red:**

- Test API endpoints, token redaction, project encoding, generic-package upload, duplicate protection, release asset links, tag/commit binding, response validation, and dry-run.
- Test Pages job can run on a project-specific local runner tag and does not request shared-runner compute.

**Green:**

- Publish ZIP/checksums/SBOM/manifest to GitLab Generic Package Registry and create a release with permanent asset links.
- Read authentication only from environment or an explicitly selected file under `C:\private`; never print token/path/content.
- Add a Pages deploy job using `pages: { publish: public }`, limited to main/tags and a project runner tag.

**Verify:**

`node --test scripts/publish-gitlab-release.test.mjs`

`node scripts/publish-gitlab-release.mjs --dry-run`

## Task 15: Full verification, gap sweeps, and publication

**Files:**

- Update generated proof, release notes, changelog, and checksums.
- Commit each coherent slice with `fnice1971@gmail.com`.

**Verification order:**

1. Syntax checks for all new JS/MJS and PowerShell.
2. Focused updater, installer, MCP, packaging, site, and publishing suites.
3. `npm test`.
4. `npm run hp-mha-serena:test`.
5. `npm run docs:check`.
6. `npm run truth-gates` without integrity/client/live/harness skips.
7. Self-hosting updater E2E through MCP controls.
8. Windows installer E2E in a temporary managed root.
9. Downloaded-archive checksum and clean-PC install simulation.
10. Accessibility, keyboard, reduced-motion, responsive, performance, security, dependency, secret, broken-link, stale-count, unfinished-marker, and success-after-failure sweeps.
11. Review diffs and confirm dirty `G:\Github` checkout remains unchanged.
12. Push GitLab branch with `ci.skip` until one final local-runner Pages/release pipeline is intentionally invoked.
13. Publish prerelease tag and assets, download them back, verify hashes, and confirm public/private access behavior.
14. Confirm GitLab Pages URL, release URL, MR, branch SHA, package SHA, and local SHA all agree.

**Completion rule:** Do not describe the updater, webpage, installer, or release as complete until the exact published assets are downloaded and independently reverified, both MCP servers handshake from the installed package, all required gates pass, and no release blocker remains.
