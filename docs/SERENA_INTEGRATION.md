# Serena 1.6.2.dev0 integration

HermesProof pins Serena 1.6.2.dev0 and treats it as semantic intelligence behind the Hermes coordination boundary, not as an unrestricted editor.

## Current schema

The tracked project file is `.serena/project.yml` and uses the pinned commit's current `language_servers` key with TypeScript enabled. The older `languages` form is rejected by HermesProof's regression gate because Serena 1.6.2.dev0 migrates it on load. The immutable Serena commit is the schema source of truth; this avoids both the original stale-package `KeyError: languages` failure and later schema drift.

## Tool-count explanation

Serena dashboard counts depend on context and mode. These numbers describe different surfaces, not contradictory versions:

- 52 catalogued tools in Serena 1.6.2.dev0;
- 29 active tools in the desktop-app context shown by the dashboard;
- 15 semantic/LSP tools exposed by hp-mha-serena through Hermes policy;
- 0 raw Serena mutation tools exposed without a claim and lock.

The composite MCP server itself has 34 tools because it combines the governed Serena subset with HP-MHA, capability, automation, backend, and updater operations.

## Governed workflow

    activate project → claim task → inspect symbols/references/diagnostics
    → acquire exact operation/file lock → mutate with idempotency key
    → diagnostics → tests → evidence → release lock

Read-only semantic discovery can be used while planning. Rename, replacement, insertion, deletion, file creation, or shell-like actions cannot bypass Hermes. Identical retried mutation requests collapse; an idempotency key reused with a different payload is rejected.

## Onboarding and health

The installer and deep doctor validate the pinned version and commit, current `language_servers` schema, project activation, symbol extraction for JavaScript/TypeScript modules, governed catalog, zero unrestricted mutations, and real composite MCP startup.

The desktop dashboard may still show 29 active tools when no project is active. That is expected for the desktop context and is not the composite server total.
