# HermesProof core

- Node.js ESM MCP monorepo. Main server: `src/server.mjs`; coordination/state logic: `src/core/`; executable workflows and gates: `scripts/`.
- Workspace state is file-backed under `.hermes3d_orchestrator/`; never commit runtime state.
- Mandatory mutation invariant: claim task -> lock exact files -> edit -> allowlisted gates -> evidence -> release locks/task. See `AGENTS.md`.
- Never commit directly to main/master. Release work uses review branches and proof artifacts.
- Evidence is append-only and hash-chained; failed verification must fail closed.
- Read `mem:tech_stack` for runtime pins, `mem:conventions` for implementation rules, and `mem:task_completion` before declaring work complete.