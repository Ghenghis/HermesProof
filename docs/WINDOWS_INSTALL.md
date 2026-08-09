# Windows 11 install, repair, and recovery

The supported distribution is the GitLab release ZIP for `v0.9.0-rc.1`. Installation is per-user by default and requires Node.js 20 or newer. Administrator privileges are not required.

## Fresh install

1. Download the ZIP and `SHA256SUMS.txt` from the [GitLab release](https://gitlab.com/Ghenghis/HermesProof/-/releases).
2. Verify the ZIP:

   ```powershell
   Get-FileHash .\HermesProof-v0.9.0-rc.1-windows-x64.zip -Algorithm SHA256
   ```

3. Extract it, open PowerShell inside the folder, and run:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\install-hermesproof.ps1 -Workspace "G:\Github\your-project" -AutoUpdate
   ```

The installer validates its manifest, creates `%USERPROFILE%\.hermesproof-managed`, stages an immutable release, performs real MCP handshakes against both servers, snapshots supported client files, installs stable-launcher entries, and enables the optional six-hour Windows task. Client snapshots use an immutable SHA-bound manifest under `%USERPROFILE%\.hermesproof-managed\backups\clients\<snapshot-id>`.

![Windows installation flow](diagrams/windows-install-flow.svg)

## Default client coverage

Kilo Code/VS Code, Codex, Windsurf, Cursor, Claude Desktop, Claude Code, LM Studio, and a Devin template receive both `hermes3d-locks` and `hp-mha-serena`. Claude Code's user MCP store is `~/.claude.json` and is included in rollback coverage. LM Studio also receives the LM Link route. Ollama is configured as a model fallback, not falsely advertised as a native MCP host.

Restart an open client after installation. Run `hermesproof-update status` and then use the client’s MCP tools list to confirm both servers.

## Repair or reinstall

Re-running the same installer is safe. It creates a new immutable release directory, preserves the previous known-good release, snapshots client configuration again, and activates only after all probes pass.

```powershell
.\install-hermesproof.ps1 -Workspace "G:\Github\your-project" -Repair
```

If a client file was changed after HermesProof wrote it, automatic restore refuses to overwrite that newer user change. Compare the current file with the immutable manifest and backup under `%USERPROFILE%\.hermesproof-managed\backups\clients`, then merge intentionally.

For an isolated portable smoke test, `-SkipUserPath` keeps the user and process PATH unchanged:

```powershell
.\install-hermesproof.ps1 -Workspace "C:\test\workspace" -ManagedRoot "C:\test\managed" -SkipUserPath
```

This switch is intended for testing or deliberately portable operation; ordinary per-user installs should retain the default PATH wiring.

## Rollback

```powershell
hermesproof-update rollback
hermesproof-update evidence
```

Rollback atomically switches the active pointer to the previous known-good release and restores only snapshots whose after-hash still matches the installed configuration.

## Uninstall

```powershell
.\uninstall-hermesproof.ps1
```

The first uninstall removes the scheduled task and restores every snapshotted client file to its pre-install state only when its recorded after-hash still matches. The successful restore is recorded, so repeating uninstall is idempotent. Releases, evidence, and backups remain available.

Permanent managed-data deletion is a separate explicit operation:

```powershell
.\uninstall-hermesproof.ps1 -PurgeManagedData
```

Purge is fail-closed: if a client changed after install, the snapshot is invalid, or the verified restore helper is unavailable, the command exits nonzero and all managed recovery data is preserved.

For an isolated executable test, `-SkipSystemChanges` prevents Task Scheduler and user PATH changes:

```powershell
.\uninstall-hermesproof.ps1 -ManagedRoot "C:\test\managed" -SkipSystemChanges
```

Do not use `-SkipSystemChanges` for a normal uninstall because it intentionally leaves system integration untouched.

## Moving the setup to another PC

Use the same release ZIP and installer on the second Windows 11 PC. Do not copy client configuration files blindly: paths differ. The installer detects the other PC’s clients and writes its own stable launcher paths. LM Link can still connect to the user’s separate VRAM PC; only the loopback or configured private endpoint should change.
