# GitLab release runbook

GitLab is the only publishing origin for this release. Shared compute minutes must not be consumed by ordinary branch pushes.

## Local proof first

```powershell
npm ci
npm run docs:generate
npm run docs:check
npm run test:updater
npm test
npm run truth-gates
npm run build:windows-release
```

Review the generated checksums, manifest, SBOM, both MCP probe evidence, and Windows install smoke result. Create reviewed commits with the configured author email, then push with GitLab’s `ci.skip` push option until the final tagged release.

## Pipeline policy

All GitLab jobs use the project-owned `hermesproof-local` runner tag. No untagged shared runner job is allowed. Pages and release validation run only for the approved release branch, main, or a tag. A final pipeline is started only after the local suite passes.

## Publish

1. Push `release/hp-mha-serena-shippable` to GitLab.
2. Update draft merge request 3.
3. Run the final local-runner pipeline.
4. Tag `v0.9.0-rc.1`.
5. Upload the Windows ZIP, `SHA256SUMS.txt`, manifest, SBOM, and proof bundle to the GitLab release.
6. Download every asset again and verify its SHA-256.
7. Verify the GitLab Pages site and its reduced-motion behavior.

Never print or commit the token from `C:\private`. Prefer the existing Git credential for Git operations and provide secrets to a release API process only through an ephemeral environment variable.
