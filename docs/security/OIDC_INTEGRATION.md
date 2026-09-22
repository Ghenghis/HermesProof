# HermesProof — OIDC Integration

> How OpenID Connect (OIDC) workload identity fits into the HermesProof
> credential broker, lock orchestrator, and downstream agent workflows.
> Read alongside [`AGENT_SECRET_ARCHITECTURE.md`](AGENT_SECRET_ARCHITECTURE.md).

## What OIDC does here

OIDC replaces long-lived provider credentials with **short-lived identity
tokens**. A workload proves *who it is* (a GitHub Actions job, a GitLab
CI pipeline, a Kubernetes pod, an external CI runner) and receives a
token that is:

- valid for a few minutes (GitLab default: 5 minutes when no job timeout is set)
- tied to a specific workflow / pipeline / repository / ref
- verifiable by the relying party (Vault, AWS, Azure, GCP, the credential
  broker) against the issuer's public JWKS
- revocable by the issuer at any time

HermesProof's credential broker will accept OIDC ID tokens in place of
API keys, then exchange them — server-side, never exposing the result to
the agent — for the real provider credential (OpenAI / Anthropic / MiniMax
/ GitHub / GitLab / Cloudflare).

## Workload identities supported

| Issuer | Token shape | Use case |
| --- | --- | --- |
| GitHub Actions | `ACTIONS_ID_TOKEN_REQUEST_TOKEN` + `ACTIONS_ID_TOKEN_REQUEST_URL` | Repo-scoped ephemeral identity for CI |
| GitLab CI | `CI_JOB_JWT` / `CI_JOB_JWT_V2` (OIDC) | Pipeline-scoped ephemeral identity for CI |
| SPIFFE / SPIRE | SVID (X.509 or JWT) | Generic workload identity for VMs / k8s |
| HashiCorp Vault | OIDC ID token via `vault write -field=token auth/oidc/...` | Vault → broker handoff |

## Components

```
GitHub Actions / GitLab CI / SPIFFE
   │  OIDC ID token (JWT, ~5 min TTL, audience-pinned)
   ▼
HermesProof credential broker (this is what we are building)
   │  validates issuer + audience + claims
   │  looks up policy for the calling workflow
   │  exchanges OIDC token for a short-lived provider credential
   │  injects the credential into the authorized outbound request
   ▼
External API (OpenAI / Anthropic / GitHub / GitLab / etc.)
   ↑
   │  real API key never returned to the agent
```

## Why this matters for HermesProof

The existing lock orchestrator (`hermes3d-locks`) already issues short-lived
identity signals inside a workspace (task claims, file locks with TTL and
heartbeat). The credential broker extends the same model to **external**
provider credentials:

- **Same evidence ledger.** Every OIDC-validated request is appended to the
  hash-chained evidence ledger so a release claim can be tied to the exact
  CI job that produced it.
- **Same gate runner.** A new gate `oidc-token-verify` checks that a token
  is fresh, signed by the expected issuer, and has the required claims.
- **Same machine-identity model.** The `hermes_join_project` /
  `hermes_register_agent_profile` flow already lets an agent declare a
  scoped identity; the broker uses that identity to look up its policy.
- **Same HermesProof lock discipline.** If the OIDC flow needs to touch
  files inside the workspace, it goes through `hermes_lock_files` first.

## Implementation status

| Layer | State |
| --- | --- |
| Token validation library | use [`jose`](https://github.com/panva/jose) (Node-native, JWKS-aware) |
| Issuer allowlist | configured per workspace in `config/oidc-issuers.json` |
| Policy lookup | `security/policy/oidc-policy.mjs` (per-workflow → provider scopes) |
| Secret exchange | broker-only; never returns the exchanged credential to the agent |
| Egress allowlist | `security/policy/egress-allowlist.mjs` (already used by HP-MHA proof gates) |
| Audit / evidence | `hermes_append_evidence` on every validated + exchanged request |
| Release gate | `oidc-token-verify` added to the gate allowlist |

The HP-MHA / helper-runtime / staleness modules cherry-picked into main
provide the surrounding scaffolding: capability packs (`capability-packs.mjs`),
local capability installer (`local-capability-installer.mjs`), reverse
engineering kit (`reverse-engineering-kit.mjs`), release signing
(`release-signing.mjs`), workspace binding (`workspace-binding.mjs`).
The broker sits on top of those as the `identity/` layer.

## GitHub Actions wiring (sketch)

```yaml
# .github/workflows/release.yml
permissions:
  id-token: write   # enables OIDC
  contents: read
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: token
        uses: actions/github-script@v7
        with:
          script: |
            const token = await core.getIDToken('hermesproof-broker');
            core.setOutput('token', token);
      - name: HermesProof release
        env:
          HP_OIDC_TOKEN: ${{ steps.token.outputs.token }}
          HP_OIDC_AUDIENCE: hermesproof-broker
        run: node scripts/release-with-oidc.mjs
```

`scripts/release-with-oidc.mjs` calls into the broker, which validates the
token against the configured `https://token.actions.githubusercontent.com`
issuer, checks the repository / ref / job claims, and issues the real
provider credential for the release step only.

## GitLab CI wiring (sketch)

```yaml
# .gitlab-ci.yml
release:
  id_tokens:
    HP_OIDC_TOKEN:
      aud: hermesproof-broker
  script:
    - node scripts/release-with-oidc.mjs
```

`CI_JOB_JWT_V2` (or the explicit `HP_OIDC_TOKEN` file) is presented to the
broker, validated against the GitLab OIDC issuer, and exchanged for the
required provider credentials.

## Operational invariants

1. **No long-lived provider credentials in CI variables.** When OIDC is
   available, replace the variable with `id_tokens:` (GitLab) or
   `permissions: id-token: write` (GitHub).
2. **Tokens are single-use.** The broker invalidates the exchanged
   credential after the workflow completes; the next workflow gets a new
   exchange.
3. **Audience pinning.** Each workflow declares its intended audience;
   the broker rejects tokens with a different `aud`.
4. **Egress filter.** Even with a valid OIDC token, the broker only
   proxies requests to allowlisted destinations.
5. **Evidence trail.** Every OIDC exchange is appended to the evidence
   ledger so a release can be tied back to the exact CI job that built it.

## Related canonical documents

- [`AGENT_SECRET_ARCHITECTURE.md`](AGENT_SECRET_ARCHITECTURE.md) — the
  broader credential broker / vault architecture OIDC plugs into.
- [`SECURITY_POLICY.md`](../SECURITY_POLICY.md) — HermesProof's own narrow
  MCP threat model (locks, gates, evidence, signing).
- `docs/HP_MHA_V4_RELEASE_NOTES.md` — release notes for the harness
  attribution modules this OIDC layer builds on.
- `docs/KILOCODE_OPENHANDS_INTEGRATION.md` — example provider integration
  that follows the same pattern.
- [`docs/REPO_MANIFEST.md`](../REPO_MANIFEST.md) — canonical locations
  for every HermesProof-related repo and working copy.