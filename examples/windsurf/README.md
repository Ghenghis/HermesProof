# Windsurf / Cascade — HermesProof setup

This bundle wires the `hermes3d-locks` MCP server into Windsurf and gives Cascade a coordination protocol so it doesn't clobber edits made by Claude or Codex working on the same repository.

## What's in this folder

- **`.windsurfrules`** — drop-in coordination protocol. Copy to the **workspace root** (`<your-repo>/.windsurfrules`) of any project where HermesProof is active.

The MCP server config itself lives in **Windsurf's user config** at `~/.codeium/windsurf/mcp_config.json`. A template is at the repo root in [`examples/windsurf_mcp_config.example.json`](../windsurf_mcp_config.example.json), and `npm run install-clients -- --workspace <path> --targets windsurf` writes it for you.

## Quick install

```powershell
# Wire the MCP server (writes ~/.codeium/windsurf/mcp_config.json)
npm run install-clients -- --workspace "G:\Github\Hermes3D" --targets windsurf

# Copy the rules into your workspace root
cp examples/windsurf/.windsurfrules <your-workspace>/.windsurfrules

# Restart Windsurf so Cascade picks up the new MCP server + rules.
```

After restart, Cascade has 20 HermesProof tools (`hermes_doctor`, `hermes_lock_files`, `hermes_run_gate`, `hermes_emit_event`, …) available alongside its native filesystem tools.

## Owner-string convention

Cascade uses `windsurf-cascade-<your-handle>` for the `owner` field on every HermesProof call. The handle is your local short identifier — `windsurf-cascade-dave`, `windsurf-cascade-alex`. The server-side regex is `^[a-z][a-z0-9-]{1,63}$`; lowercase, digits, hyphens only.

## What `.windsurfrules` does

It tells Cascade to: doctor → state-check → claim/pick task → lock files → edit → heartbeat → evidence → release. It refuses to edit any file Cascade doesn't hold a HermesProof lock on. It rejects bypasses (`--no-verify`, parallel `*-v2.md` files, raw shell that escapes the gate runner).

If a lock conflict appears, Cascade requests a handoff and waits for approval. It never overwrites another agent's work.

## When you don't need this bundle

If your workspace is **not** governed by HermesProof — i.e. you're working solo, or the project doesn't have `.hermes3d_orchestrator/` — leave `.windsurfrules` out. The protocol only makes sense when multiple agents share the workspace.

## Cross-reference

- Full cross-client coordination doc: [`examples/QUEUE_DISCIPLINE.md`](../QUEUE_DISCIPLINE.md)
- HermesProof roadmap: [`docs/MULTI_AGENT_LOOP_ROADMAP.md`](../../docs/MULTI_AGENT_LOOP_ROADMAP.md)
