# README coverage matrix

This matrix maps the current v0.9.0-rc.1 README claims to executable evidence. Generated numbers come from config/release-facts.json and scripts/generate-release-docs.mjs.

| Current claim | Implementation | Required evidence |
| --- | --- | --- |
| 121 core MCP tools | src/server.mjs | real core stdio initialize + tools/list; release-facts test |
| 34 composite MCP tools | src/hp-mha-serena/server.mjs | real composite stdio initialize + tools/list |
| Serena 1.6.2.dev0 uses languages schema | .serena/project.yml | serena-project-config.test.mjs |
| 52 catalogued / 29 desktop / 15 governed / 0 raw mutations | serena-catalog.mjs and runtime policy generator | catalog, adapter, and service tests |
| Task/owner/file locking | lock-manager.mjs | concurrency, handoff, stale recovery, and service tests |
| HP-MHA fails closed on invalid Merkle proof | hp-mha.mjs and smoke-e2e.mjs | hp-mha-smoke-failclosed plus measured 2x2 output |
| Capability packs default disabled and need leases | capability-packs.mjs | capability-packs and runtime lifecycle tests |
| Kilo backend fallback | kilo-backend-kit.mjs | kilo-backend-kit tests and deep doctor |
| Authorized reverse-engineering pack | reverse-engineering-kit.mjs | pack validation, inventory, and resolver tests |
| LM Studio LM Link with Ollama fallback | wizard-writers.mjs | client installer test reads local-models.json |
| Kilo, VS Code, Codex, Windsurf, LM Studio, Claude, Cursor, Devin | wizard-detectors.mjs / wizard-writers.mjs | installer matrix and snapshot tests |
| Client rollback protects later user changes | client-config-snapshot.mjs | after-hash and manifest-digest tamper tests |
| Immutable updater with quarantine and rollback | managed-updater.mjs | updater activation, probe failure, crash journal, stale lock, cleanup tests |
| Only allowlisted GitLab sources and refs | git-source.mjs / path-policy.mjs | real local bare-repository integration and rejection tests |
| Nine production update groups, no skips | release-verifier.mjs / production-gates.mjs | verifier and production gate tests |
| Windows release ZIP and checksums | build-windows-release.mjs | manifest tamper test, PowerShell parse test, install smoke |
| GitLab-only local-runner CI and Pages | .gitlab-ci.yml | gitlab-ci-policy.test.mjs |
| Animated diagrams respect reduced motion | docs/diagrams and site/styles.css | release-docs-drift and site quality checks |

No production-ready claim is accepted solely from documentation. The final release must include a clean-tree local suite, both live MCP probes, truth-gate evidence, Windows install/repair/rollback smoke, checksums, GitLab asset re-download verification, and a successful project-owned runner pipeline.
