# Update troubleshooting

## npm scripts exit 1 without a child-process error on Windows

Run `hermes_doctor` or `node scripts/doctor.mjs`. If `windows_cmd_path_length` fails, the inherited `PATH` exceeds the 8,191-character `cmd.exe` environment limit. npm uses `cmd.exe` for lifecycle scripts on Windows; the shell can silently drop an overlong `PATH`, making `node` appear unavailable even when PowerShell can run it directly.

Remove duplicate and stale entries from the Windows user/system PATH, restart the terminal and MCP clients, and rerun doctor. Do not permanently replace PATH with a minimal value because installed compilers, Git, PowerShell, and model tools may depend on it. A bounded process-local PATH is acceptable only for a controlled release/test command and must include the exact Node directory, Git, PowerShell, and Windows system directories.

## Candidate is quarantined

Run:

```powershell
hermesproof-update status
hermesproof-update evidence
```

Find the first failed named gate. Do not override it. Common causes are an unclean source tree, lockfile mismatch, unavailable pinned Serena package, a failed live MCP probe, documentation drift, or a security finding.

## A client stopped listing HermesProof

1. Confirm the active release:
   `hermesproof-update status`.
2. Run the stable launcher directly with the relevant server:
   `hermesproof-launch --server hermes3d-locks` or
   `hermesproof-launch --server hp-mha-serena`.
3. Repair client entries with the release installer.
4. Restart the client.

Never point a client at a versioned release directory. The stable launcher is the recovery boundary.

## Serena reports `KeyError: 'languages'`

The project file is stale. The current schema uses:

```yaml
language_servers:
  - typescript
```

It does not use the legacy `languages:` key. Run the deep doctor or reinstall the current release; the shipped schema regression test prevents this failure.

## Rollback refuses to restore a client file

This is intentional when the file’s current hash differs from the snapshot’s recorded after-hash. The user or another tool changed it after HermesProof installation. Compare the current file with `%USERPROFILE%\.hermesproof-managed\backups\clients\<snapshot-id>\manifest.json` and merge the HermesProof entries manually. Do not use `-PurgeManagedData` to bypass this check: purge stops and preserves managed recovery data until restore succeeds.

## Automatic update does not run

Check the per-user task:

```powershell
Get-ScheduledTask -TaskName "HermesProof Automatic Update"
Get-ScheduledTaskInfo -TaskName "HermesProof Automatic Update"
```

Confirm the task uses limited privileges, the stable launcher exists, and its maintenance window is open. Manual `check` remains safe.

## Disk cleanup

Use `hermesproof-update cleanup`; do not recursively delete guessed paths. It retains current/previous known-good releases and refuses unsafe roots, repositories, links, or out-of-scope paths.
