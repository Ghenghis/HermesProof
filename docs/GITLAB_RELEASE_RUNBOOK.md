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
$env:HERMESPROOF_RELEASE_SIGNING_KEY_FILE = 'C:\private\HermesProof-release-ed25519-private.pem'
npm run build:windows-release
npm run release:verify -- --artifact .\dist\HermesProof-v0.9.0-rc.1-windows-x64.zip --public-key .\config\hermesproof-release-ed25519-public.pem
node .\scripts\release-checksum.mjs --verify-sha256
Remove-Item Env:HERMESPROOF_RELEASE_SIGNING_KEY_FILE
```

The official build fails before staging if `HERMESPROOF_RELEASE_SIGNING_KEY_FILE` is absent. It also fails if the external private key does not match `config/hermesproof-release-ed25519-public.pem`. Review the generated checksums, Ed25519 signature, key fingerprint, manifest, SBOM, both MCP probe evidence, and Windows install smoke result. The expected current key fingerprint is `sha256:9b1fb58db81fd4dceaef5b78a4aa83db6c57d70dbabddf2b4c1b12abcf1a92da`.

Create reviewed commits with the configured author email, then push with GitLab’s `ci.skip` push option until the final tagged release. Never use `build:windows-release:unsigned-development` for a tag or release asset.

## Pipeline policy

All GitLab jobs use the project-owned `hermesproof-local` runner tag. No untagged shared runner job is allowed. Pages and release validation run only for the approved release branch, main, or a tag. A final pipeline is started only after the local suite passes.

## Publish

1. Push `release/hp-mha-serena-shippable` to GitLab.
2. Update draft merge request 3.
3. Run the final local-runner pipeline.
4. Tag `v0.9.0-rc.1`.
5. Upload the complete asset set:
   - `HermesProof-v0.9.0-rc.1-windows-x64.zip`
   - `HermesProof-v0.9.0-rc.1-windows-x64.zip.sha256`
   - `HermesProof-v0.9.0-rc.1-windows-x64.zip.sig`
   - `hermesproof-release-ed25519-public.pem`
   - `verify-hermesproof-release.mjs`
   - `SHA256SUMS.txt`
   - release manifest, SBOM, `PROOF/latest.json`, and `PROOF_E2E_REPORT.md`
6. Record the archive SHA-256 and key fingerprint in the release notes.
7. Download every asset into a new empty directory. Run:

   ```powershell
   node .\verify-hermesproof-release.mjs --artifact .\HermesProof-v0.9.0-rc.1-windows-x64.zip --public-key .\hermesproof-release-ed25519-public.pem
   ```

8. Extract only after verification passes, then run the isolated two-server MCP smoke from the downloaded archive.
9. Verify the GitLab Pages site and its reduced-motion behavior.

## Key handling and rotation

The private key remains at `C:\private\HermesProof-release-ed25519-private.pem` with inheritance removed and access limited to the current Windows user. The build may receive its path through the ephemeral environment variable, but the key content and environment value must never enter logs, proof, a ZIP, Git, or GitLab variables.

To rotate, generate a new pair outside the repository, commit the new public PEM in a reviewed change, publish a transition note containing both fingerprints, and preserve the old public PEM under a versioned name for historical verification. The key generator refuses to overwrite either output.

Never print or commit the token from `C:\private`. Prefer the existing Git credential for Git operations and provide secrets to a release API process only through an ephemeral environment variable.
