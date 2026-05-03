# Changelog

All notable changes to HermesProof.

## [0.6.0] — 2026-05-03

### Added
- **Anonymous role rotation** — new `AnonymousOrchestrator` (`src/core/anonymous-orchestrator.mjs`) implements 6 anonymous coordination roles (BUILDER, CRITIC, SCRIBE, GATE-SMITH, DOC-KEEPER, WATCHDOG) plus a reserved USER role. Roles are claimed at message-write time, not session start, and rotate freely between Claude / Codex / KiloCode / Cursor / Windsurf / VSCode+Copilot.
- **Hermes-Agent-as-USER bridge** — new `HermesAgentBridge` (`src/core/hermes-agent-bridge.mjs`) connects HermesProof to a configured Hermes Agent reasoning loop. When enabled (`HERMES_AGENT_ENABLED=1`), the agent reasons about USER-scope decisions and grants AS_USER sessions on the user's behalf within bounded scope.
- **Provider failover** for the Hermes Agent: DeepSeek → MiniMax → SiliconFlow (cloud, preferred order) → LM Studio → Ollama → Hipfire (local fallbacks). All API keys read from env (`G:\private\.env` per the user's secret-store convention); never hardcoded, never logged.
- **10 new MCP tools**:
  - `hermes_anonymous_claim` / `hermes_anonymous_release` / `hermes_anonymous_state`
  - `hermes_user_grant_session` / `hermes_user_revoke_session` / `hermes_user_check_authorization`
  - `hermes_agent_health` / `hermes_agent_request_user_session` / `hermes_agent_resolve_blocked` / `hermes_agent_revoke_session`
- **STREAM/ handoff protocol** (`handoffs/STREAM/PROTOCOL.md` + mirror in Hermes3D) — markdown-based pub/sub for real-time anonymous coordination between AI clients. Includes WATCHDOG.md (heartbeat + auto-reassign), CLIENT_ADAPTERS.md (Claude/Codex/KiloCode/Cursor/Windsurf/VSCode+Copilot drop-ins).
- **STREAM scripts** in `scripts/`: `stream-validate.mjs`, `stream-watchdog.mjs`, `stream-backup.mjs`, `stream-archive.mjs`. Zero deps, foolproof (idempotent, schema-validated, auto-archive after 6h, snapshots every 30min with 7d retention).
- **`.env.example`** — names-only template documenting every env var. Hardened `.gitleaks.toml` patterns added: `ghp_*`, `ghs_*`, `cr-*`, `cp-*`, Azure Speech keys.
- **ADR-016** — design rationale for Hermes-Agent-as-Anonymous-USER, including provider failover, capability scoping, and security model.

### Changed
- `package.json` version bump 0.5.0 → 0.6.0.
- `package.json` test target now includes `anonymous-orchestrator-smoke-test.mjs` (15 tests, all green).
- `.gitignore` adds `handoffs/STREAM/backups/` and a paranoid blocklist for accidental Notepad-saved-as variants.

### Security
- Hermes Agent bridge is **disabled by default**; explicit opt-in via env.
- USER sessions are bounded by capability scope + TTL (default 8h, max 48h).
- Session hash redacted from public state reads.
- `granted_by` validated against enum (`human` / `hermes-agent` / `ci`); rejects spoofed values.
- All grant/revoke events written to evidence ledger with hash + provider + model used.
- Provider responses parsed strictly as JSON; markdown fences salvaged but malformed responses fail closed.
- Per-provider timeout (25s) + overall decision timeout (60s); all 6 failures → defer to human.

## [0.5.0] — earlier
- See git history for v0.5.0 release notes.
