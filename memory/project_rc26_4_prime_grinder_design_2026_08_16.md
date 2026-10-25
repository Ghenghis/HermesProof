# RC26.4 Prime Agent Integration Design

## Overview

HermesProof v0.9.1 integration design for Prime Agent v0.7.2. The goal is to add a long-running, daemon-backed subagent worker without giving Prime Agent direct write access to the core HermesProof source tree.

## Verdict

Ship a 10-day focused integration spike for RC26.4, gated by two green end-to-end proofs (research and repair). Defer hard, always-on control-plane coupling to RC26.5.

## Key Links

- Design doc: `docs/audit/rc26.4-prime-agent-integration-design-2026-08-16.md`
- Prime Agent upstream: https://github.com/PrimeIntellect-ai/prime-agent
- Prime Agent v0.7.2 release: https://github.com/PrimeIntellect-ai/prime-agent/releases/tag/v0.7.2
- Ghenghis fork: https://github.com/Ghenghis/prime-agent

## Recommended Pattern

Task-queue subagent bridge: a dedicated `hermes-prime-agent-bridge` worker picks `prime-agent` tasks from the HermesProof task queue, launches `prime-agent --mode rpc`, consumes the JSONL event stream, and writes `ev_prime_agent_*` evidence before releasing the lock.

## Security Boundary

- Prime Agent runs inside a scratch worktree created by the bridge.
- The bridge holds both the HermesProof lock and the Prime Agent session lease.
- Model-generated Python/bash cannot write outside the scratch root.
- No direct Prime Agent access to `src/`, `.hermes3d_orchestrator/`, or git remotes outside the locked artifacts.

## Open Questions

1. Prime Agent provider/API-key authorization for the workspace.
2. Bridge runtime model (Windows service, PM2, or one-shot `npx`).
3. Scratch directory location and git-pollution policy.
4. HP-MHA trace retention classification for `ev_prime_agent_*`.
5. Which `hermes_run_gate` wraps the `prime-agent-e2e` proof.

## Status

Design complete. Implementation spike planned; no code changes committed yet. Ready for RC26.4 cut Step 1.
