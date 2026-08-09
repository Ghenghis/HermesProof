# Kilo Code RC25 governed backend kit

HermesProof ships a Kilo-focused backend safety net inside the `hp-mha-serena` MCP server. It does not globally enable every tool. It discovers working local capabilities, selects minimal pinned replacements for real gaps, and keeps every runtime and scheduled job disabled until a workspace/owner/task/time-bounded lease authorizes it.

## Verified local RC25 result

The August 9, 2026 live doctor proved this PC has a shippable backend path with no release blockers:

- Extension target: `7.10.0-rc.25`
- Bundled CLI build: `0.0.0-codex-gate11-strong-model-repair-202608050735`
- Bundled CLI SHA-256: `f666f1ce9a55d3fdaf620781e34bed680c850a45f6ac85eb8bdc94c435335ab1`
- Kilo MCP management and loopback-default `kilo serve`: proven
- Node, Git, GitHub CLI, Ollama, vector indexing, HermesProof, Serena, MCP configuration, and browser runner: proven
- Ollama: 30 local models at verification time
- Docker client with stopped engine, LM Studio, GitLab CLI, and Bun: optional because working fallbacks exist

The extension version and bundled CLI build version are intentionally reported separately. Treating them as the same version would hide local RC build provenance.

## Run it now

From the HermesProof repository:

```powershell
node scripts/kilo-backend-doctor.mjs --kilo-root G:\Github\kilocode-2026-openhands
```

Use `--compact` for CI or agent consumption. Use `--bundled-kilo <path>` when the CLI is stored outside a Kilo repository. The command exits nonzero only for release blockers.

## MCP operations

The second server now has 34 tools. In addition to governed Serena coordination, it provides:

- Runtime manager: task-gated hash-bound registration, status, bounded lease, enable, cycle, revoke, and automatic disable-unused.
- Capability manager: resolve, isolated plan, and task-gated install.
- Automation manager: status, Windows Task Scheduler or Linux systemd plan, enable, cycle, and global kill switch.
- Kilo backend: live doctor and minimal gap-replacement plan.

Capability installs are workspace-local and content-addressed. They never perform a global package install, never auto-enable after installation, verify the pinned package integrity, generate executable, package-lock, and SPDX SBOM hashes, run the pack health probe, and quarantine drift.

The production server now wires real adapters rather than plan-only stubs:

- The npm adapter installs with `--ignore-scripts --save-exact` inside the versioned pack sandbox and verifies the registry integrity from `package-lock.json`.
- The process adapter accepts absolute executables only, verifies the declared SHA-256 before spawn, strips secret-bearing environment variables, and stops the exact owned child on lease expiry or revocation.
- The live server reaps expired or unused runtimes every 60 seconds.
- The Windows adapter uses `schtasks.exe` without a shell; the VPS adapter writes user-level systemd service/timer units and calls `systemctl --user`.
- Scheduled jobs invoke the allowlisted `scripts/automation-runner.mjs`; no arbitrary command string or secret can be stored in a job.

Run an allowlisted recipe directly before scheduling it:

```powershell
npm run automation:run -- --workspace . --job completion-pulse
npm run automation:run -- --workspace . --job deep-doctor
```

## Kilo usage rules

1. Prefer the verified RC25 bundled CLI before downloading a fallback.
2. Keep unused MCP servers disabled; enable only the server needed for the current acceptance gap.
3. Require an active HermesProof task before issuing a runtime lease or applying a capability pack.
4. Keep Serena mutations behind exact Hermes locks and semantic receipts.
5. Prefer Ollama before LM Studio when Ollama is healthy.
6. Start Docker Desktop only when a workload actually needs containers.
7. Never put tokens or passwords in schedules, manifests, evidence, or MCP arguments.

These rules align with Kilo's current MCP configuration model and CLI-owned server lifecycle. See the official [MCP overview](https://kilo.ai/docs/automate/mcp/overview), [using MCP in Kilo Code](https://kilo.ai/docs/automate/mcp/using-in-kilo-code), [CLI documentation](https://kilo.ai/docs/code-with-ai/platforms/cli), and [codebase indexing guide](https://kilo.ai/docs/customize/context/codebase-indexing).
