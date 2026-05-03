# KiloCode STREAM Adapter

Drop this folder into a KiloCode-governed workspace when HermesProof owns
coordination for the repository.

## Files

- `rules.toml` - polling cadence, inbox path, and owner-string convention.
- `system-prompt-snippet.md` - prompt text for KiloCode's system/context rules.

## Install

```powershell
node scripts/install-clients.mjs --workspace "<ABSOLUTE_WORKSPACE_PATH>" --target kilocode
```

The installer writes workspace-local files under `.kilocode/` and does not
touch private environment files.
If you copy `rules.toml` manually, replace private-directory placeholders
with the paths your local policy should deny.
