# GitLab-only release runbook

GitLab is the authoritative source, release host, and OTA origin for v0.9.2. GitHub is intentionally excluded from this publication. GitLab shared compute minutes are not used: all release gates run locally and branch/tag pushes use the GitLab `ci.skip` push option.

## Local proof first

```powershell
npm ci
npm run docs:generate
npm run docs:check
npm run test:updater
npm test
node .\scripts\truth-gates.mjs --workspace .
$env:HERMESPROOF_RELEASE_SIGNING_KEY_FILE = 'C:\private\HermesProof-release-ed25519-private.pem'
npm run build:windows-release
npm run release:verify
node .\scripts\release-checksum.mjs --verify-sha256
Remove-Item Env:HERMESPROOF_RELEASE_SIGNING_KEY_FILE
```

The official build fails before staging if `HERMESPROOF_RELEASE_SIGNING_KEY_FILE` is absent. It also fails if the external private key does not match `config/hermesproof-release-ed25519-public.pem`. Review the generated checksums, Ed25519 signature, key fingerprint, manifest, SBOM, both MCP probe evidence, and Windows install smoke result. The expected current key fingerprint is `sha256:9b1fb58db81fd4dceaef5b78a4aa83db6c57d70dbabddf2b4c1b12abcf1a92da`.

Create reviewed commits with the configured author email, then push every GitLab branch and tag with the `ci.skip` push option. Never use `build:windows-release:unsigned-development` for a tag or release asset.

## Pipeline policy

The v0.9.2 publication does not start a GitLab pipeline. If a project-owned runner is restored later, its jobs must retain the `hermesproof-local` tag and no untagged shared-runner job may be enabled. Locally verified proof inside the offline Ed25519-signed release archive is the release gate while the project has no usable GitLab compute allowance. Never publish a Sigstore bundle unless its embedded digest matches the exact proof file.

## Publish

1. Push `release/hp-mha-serena-shippable` to GitLab without force and with `ci.skip`.
2. Review and merge the v0.9.2 GitLab merge request without squashing the audited history.
3. Fetch GitLab and require `main` to contain the verified stable source commit.
4. Create one annotated `v0.9.2` tag at that verified source commit and push it to GitLab with `ci.skip`.
5. Create the GitLab release and upload the complete asset set:
   - `HermesProof-v0.9.2-windows-x64.zip`
   - `HermesProof-v0.9.2-windows-x64.zip.sha256`
   - `HermesProof-v0.9.2-windows-x64.zip.sig`
   - `hermesproof-release-ed25519-public.pem`
   - `verify-hermesproof-release.mjs`
   - `SHA256SUMS.txt`
   - release manifest, SBOM, `PROOF/latest.json`, and `PROOF_E2E_REPORT.md`
6. Record the source commit, archive SHA-256, and key fingerprint in the GitLab release notes.
7. Download every GitLab asset into a separate empty directory. Run:

   ```powershell
   node .\verify-hermesproof-release.mjs --artifact .\HermesProof-v0.9.2-windows-x64.zip --public-key .\hermesproof-release-ed25519-public.pem
   ```

8. Extract only after verification passes, then run the isolated two-server MCP smoke from the downloaded archive.
9. Verify the GitLab Pages site, repository README, all release links, and reduced-motion behavior.

## Key handling and rotation

The private key remains at `C:\private\HermesProof-release-ed25519-private.pem` with inheritance removed and access limited to the current Windows user. The build may receive its path through the ephemeral environment variable, but the key content and environment value must never enter logs, proof, a ZIP, Git, or GitLab variables.

To rotate, generate a new pair outside the repository, commit the new public PEM in a reviewed change, publish a transition note containing both fingerprints, and preserve the old public PEM under a versioned name for historical verification. The key generator refuses to overwrite either output.

Never print or commit the token from `C:\private`. Prefer the existing Git credential for Git operations and provide secrets to a release API process only through an ephemeral environment variable.
