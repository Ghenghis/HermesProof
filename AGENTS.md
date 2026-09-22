# HermesProof — Agent Rules

When using the HermesProof MCP server (deployed name `hermes3d-locks`) you **must** follow these rules. They prevent Claude, Codex, Windsurf, and review agents from editing the same files at the same time. The rules are project-agnostic — they apply to any repository that wires the orchestrator into its MCP clients.

## Secrets & credentials

Before handling any API key, token, PAT, or secret, **read**
[`docs/security/AGENT_SECRET_ARCHITECTURE.md`](docs/security/AGENT_SECRET_ARCHITECTURE.md)
and [`docs/security/OIDC_INTEGRATION.md`](docs/security/OIDC_INTEGRATION.md).
Those documents are the canonical reference for how agents obtain and use
provider credentials — agents must never request, display, copy, log,
commit, or persist plaintext credentials when a brokered, OIDC,
vault-backed, or encrypted alternative is available.

## Repository locations

Before opening a PR, claiming work, or merging, read
[`docs/REPO_MANIFEST.md`](docs/REPO_MANIFEST.md) to confirm you are
editing the canonical main repo (`G:\Github\HermesProof`) and not a
working copy or frozen snapshot.

## Mandatory before every edit

1. Call `hermes_get_state`.
2. (optional, once per session) Call `hermes_doctor` to verify the workspace and `hermes_read_policy` to confirm orchestrator wiring.
3. Call `hermes_claim_task` with a unique owner.
4. Call `hermes_lock_files` with the exact files you will edit.
5. If blocked, do not edit. Call `hermes_request_handoff`.
6. Edit only files you own.
7. Run allowlisted gates through `hermes_run_gate`.
8. Call `hermes_append_evidence`.
9. Call `hermes_release_files` and `hermes_release_task`.

## Owner names

Use stable, specific owner names:

- `claude-lead`
- `claude-reviewer-ux`
- `claude-reviewer-tests`
- `codex-impl-01`
- `codex-fix-01`
- `kilocode-lead`
- `minimax-m3-cechat-01`
- `windsurf-cascade`

## Never

- Never edit a locked file without approved ownership.
- Never use raw shell execution through MCP; use the allowlisted gate runner.
- Never commit directly to main/master.
- Never hide lock conflicts. Add evidence.
- Never request, display, copy, log, commit, or persist a plaintext provider credential when a brokered, OIDC, vault-backed, or encrypted alternative is available. See `docs/security/AGENT_SECRET_ARCHITECTURE.md`.
