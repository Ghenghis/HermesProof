# Fail-closed updater runbook

HermesProof updates are immutable deployments, not in-place file overwrites.

![Updater lifecycle](diagrams/updater-lifecycle-animated.svg)

## Commands

```powershell
hermesproof-update status
hermesproof-update check
hermesproof-update apply --channel stable
hermesproof-update rollback
hermesproof-update channel stable
hermesproof-update auto enable
hermesproof-update auto disable
hermesproof-update cleanup
hermesproof-update evidence
```

The `preview` channel tracks `release/hp-mha-serena-shippable` and requires explicit acknowledgement before activation. The `stable` channel tracks `main`.

## Production gate contract

All nine named groups must pass without skips:

1. source integrity and approved GitLab origin;
2. dependency and lockfile parity;
3. current Serena project schema and pinned version;
4. complete Node test suite;
5. generated documentation drift;
6. real HP-MHA/Merkle proof;
7. real MCP initialization and tool-list probes for both servers;
8. CycloneDX SBOM;
9. secret, dependency, and static security scans.

A failing candidate is quarantined. The active pointer and client files are restored. Evidence records the source ref, exact SHA, every command/result digest, activation, and any rollback without storing credentials.

## Automatic scheduling

Windows uses a limited, per-user Task Scheduler entry. The cadence is six hours with deterministic jitter, exponential backoff, missed-run recovery, and an optional maintenance window. The task never requests highest privileges.

Linux uses a persistent non-root systemd user timer. Servers remain disabled outside an update invocation.

## Retention

HermesProof preserves current and previous known-good releases plus quarantined evidence. `cleanup` removes only unreferenced immutable releases beneath the validated managed root. Filesystems roots, the user home, Git repositories, nested repositories, traversal paths, and links/junctions are never eligible cleanup targets.

## Operational rule

Do not delete `state/active.json`, `state/registry.json`, snapshots, or evidence to “fix” an update. Run `status`, inspect `evidence`, and use `rollback`. Follow [update troubleshooting](TROUBLESHOOTING_UPDATES.md) if recovery does not converge.
