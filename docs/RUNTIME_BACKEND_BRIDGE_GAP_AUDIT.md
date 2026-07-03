# Runtime Backend And Bridge Gap Audit

Date: 2026-07-02

This audit separates implemented HermesProof capability from future connector work. It is intentionally conservative: if there is no executable adapter or passing proof, it is listed as a gap.

## Current implemented state

| Area | Current status | Proof source |
| --- | --- | --- |
| MCP tool surface | 91 tools, exact `tools/list` membership enforced | `scripts/truth-gates.mjs` `server.stdio_handshake`; `scripts/v07-stdio-roundtrip-smoke-test.mjs` |
| Truth gates | 37 gates, with required/warn/skipped levels | `scripts/truth-gates.mjs`; `README.md`; `docs/ARCHITECTURE.md` |
| Memory/database | File-backed state database under `.hermes3d_orchestrator/`; no external SQL/document/vector DB required | `src/core/fs-utils.mjs`; `README.md`; `docs/ARCHITECTURE.md` |
| Agent profiles | Runtime profile register/get/list/update plus `join_project` | `src/server.mjs`; stdio round-trip test |
| Realtime agent interaction | Presence, learned skill routing, durable inbox, inbox long-polling, assistance requests, assistance acceptance waiting, unlock handoffs, live events | `hermes_update_presence`, `hermes_request_assistance`, `hermes_wait_for_assistance`, `hermes_wait_for_inbox`, `hermes_request_unlock`, `hermes_wait_for_events` |
| GitLab | Redacted status, project ensure, MR list/create, Ultimate governance status/bootstrap, GitLab auth probe gate | `src/core/gitlab-client.mjs`; `src/server.mjs`; `gitlab.auth_probe` |
| Backend API visibility | Env/CLI inventory records names and booleans only, never values | `backend.api_config_presence`; `hermes_backend_status` |
| MiniMax / Cheat Engine Chat connector | Prompt and profile example; no host UI/API adapter | `prompts/MINIMAX_M3_CHEAT_ENGINE_CHAT_PROMPT.md`; `examples/minimax_m3_cheat_engine_chat.agent-profile.example.json` |

## What is intentionally not secret-exposing

- Env files may be loaded from the operator private default or explicit env vars, but tools and proof only return source labels such as `default.win32` or `HERMES3D_ENV_FILE`.
- GitLab tools use supported GitLab token env vars or the dedicated private GitLab env file, but never return token values or private file contents.
- Backend inventory reports env var names, CLI booleans, and readiness booleans only.
- Secret-rotation evidence checks file metadata only; it does not read secret file contents.

## Known gaps

| Gap | Truthful status | Why it matters |
| --- | --- | --- |
| Cheat Engine Chat executable adapter | Not shipped | The prompt/profile can guide MiniMax M3, but HermesProof does not yet automate Cheat Engine Chat UI/API notifications. |
| KiloCode provider mapping CSV | Stub / not applicable until CSV ships | `kilocode.provider.mapping.validate` is honest N/A, not a complete mapping proof. |
| Full A2A HTTP bridge | Not shipped | `A2AStub` is a durable MCP task lifecycle, not a remote HTTP A2A gateway. |
| GitLab Ultimate live application | Requires token/project access | HermesProof can now bootstrap project settings, protected branches, approval settings, CODEOWNERS, CI security/proof jobs, and governance MRs, but live application still requires a supported GitLab token with sufficient project permissions. |
| GitHub parity for project/MR helpers | Partial | GitHub auth can exist through host tools, but first-class HermesProof project/PR helpers currently focus on GitLab. |
| External DB/vector memory | Not included | Current durable memory is local file-backed state; external DB/vector mirrors would be optional integrations, not required for correctness. |
| Host-specific notifications | Not shipped | Agents can long-poll inbox/events; native popups or Cheat Engine Chat panes require a host adapter. |

## Recommended next milestones

1. Add a generic inbox watcher adapter that can print or forward `assistance_request`, `unlock_request`, `handoff`, and `completion` messages to host-specific UIs.
2. Add a Cheat Engine Chat adapter if the host exposes a stable local API or automation surface.
3. Ship a KiloCode provider mapping CSV and replace the not-applicable stub with a full validator.
4. Run `hermes_gitlab_bootstrap_ultimate` across AICE/AI-CE, HermesProof, and any reachable related GitLab projects while Ultimate is active.
5. Add GitHub project/PR parity tools if GitHub release flow needs the same first-class treatment as GitLab.
6. Consider an optional SQLite/vector mirror only if query volume or semantic recall exceeds what the file-backed state database should handle.

## Completion judgement

HermesProof is now strong for same-workspace multi-agent coordination: agents can join late, see active peers, request help by skill, wait for accept/decline/timeout, transfer locked files, and create GitLab project/MR evidence without leaking credentials.

It is not a universal host automation layer yet. The remaining work is mostly connector-specific, not core lock/proof correctness.
