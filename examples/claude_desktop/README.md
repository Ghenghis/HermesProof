# Claude Desktop — HermesProof setup

Wires the `hermes3d-locks` MCP server into Claude Desktop and binds a Project Prompt that gives every session the coordination protocol upfront.

## What's in this folder

- **`PROJECT_PROMPT_TEMPLATE.md`** — paste into the Project's instructions field in Claude Desktop. One per Project bound to a HermesProof-governed workspace.

The MCP server config lives in **Claude Desktop's user config**:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

A template is at [`examples/claude_desktop_config.example.json`](../claude_desktop_config.example.json) at the repo root. `npm run install-clients -- --workspace <path> --targets claude-desktop` writes it for you (with a timestamped backup of any prior config).

## Quick install

```powershell
# Wire the MCP server
npm run install-clients -- --workspace "G:\Github\Hermes3D" --targets claude-desktop

# Restart Claude Desktop so it picks up hermes3d-locks.
# Confirm in any conversation: 20 hermes_* tools should appear.
```

Then create a **Project** bound to your workspace, paste `PROJECT_PROMPT_TEMPLATE.md` into the Project instructions, and every conversation in that Project starts with the coordination protocol active.

## Owner-string convention

Sessions in this Project use `claude-desktop-<your-handle>` for the `owner` field. Pick a handle once (e.g. `claude-desktop-dave`) and reuse it across every conversation in the Project — that way HermesProof state is consistent across session boundaries.

## What this gets you

- Every conversation auto-runs `hermes_doctor` + `hermes_get_state` at the start
- Sessions resume in-flight tasks via owner-prefix match (no re-claim from scratch)
- Edits go through claim → lock → edit → evidence → release
- Lock conflicts use `hermes_request_handoff` instead of overwrites
- Session boundaries are bridged via the Project's "Where I left off" pattern (see template §"Session continuity")

## Cross-reference

- Full cross-client coordination doc: [`../QUEUE_DISCIPLINE.md`](../QUEUE_DISCIPLINE.md)
- HermesProof roadmap: [`../../docs/MULTI_AGENT_LOOP_ROADMAP.md`](../../docs/MULTI_AGENT_LOOP_ROADMAP.md)
