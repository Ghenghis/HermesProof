# Update troubleshooting

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
   `hermesproof-launch core` or `hermesproof-launch composite`.
3. Repair client entries with the release installer.
4. Restart the client.

Never point a client at a versioned release directory. The stable launcher is the recovery boundary.

## Serena reports `KeyError: 'languages'`

The project file is stale. The current schema uses:

```yaml
languages:
  - typescript
```

It does not use the old `language_servers:` key. Run the deep doctor or reinstall the current release; the shipped schema regression test prevents this failure.

## Rollback refuses to restore a client file

This is intentional when the file’s current hash differs from the snapshot’s recorded after-hash. The user or another tool changed it after HermesProof installation. Compare the current file with the snapshot and merge the HermesProof entries manually.

## Automatic update does not run

Check the per-user task:

```powershell
Get-ScheduledTask -TaskName "HermesProof Update"
Get-ScheduledTaskInfo -TaskName "HermesProof Update"
```

Confirm the task uses limited privileges, the stable launcher exists, and its maintenance window is open. Manual `check` remains safe.

## Disk cleanup

Use `hermesproof-update cleanup`; do not recursively delete guessed paths. It retains current/previous known-good releases and refuses unsafe roots, repositories, links, or out-of-scope paths.
