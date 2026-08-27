# HermesProof — Agent Secret Architecture

> Canonical reference for how AI agents (Claude, Codex, ChatGPT, MCP servers,
> HermesProof-controlled agents, and any future agentic application) must
> obtain, route, and use provider credentials.
>
> Read this **before** handling any API key, token, PAT, or secret for a
> project that wires HermesProof.

## Decision (TL;DR)

We are moving away from distributing raw `.env` API keys/tokens to agents
wherever practical. The preferred model is:

```
Agent / App
   │  OIDC or machine identity
   ▼
Credential Broker (e.g. Infisical Agent Vault)
   │  inserts the real provider credential server-side
   ▼
Secret Vault (Infisical or OpenBao)
   │  never returned to the agent
   ▼
External API (OpenAI, Anthropic, MiniMax, GitHub, GitLab, Cloudflare, ...)
```

The agent never receives — and never sees — the real provider credential.

## Why

There is no cryptographic transformation that takes
`sk-real-openai-key` and produces a "safe-converted-key" that an untrusted
agent can use exactly like the original while being mathematically unable
to abuse it. **If something can authenticate directly as you, possession of
that thing is authority.** The solution is to change the architecture so
the agent possesses a *capability*, not the *credential*.

Decrypted SOPS / Dotenvx / Vault-injected env vars still place the plaintext
key into the agent's environment, where a sufficiently capable agent can
inspect process state, logs, files, or arguments and exfiltrate the secret.

## Reference stack (subject to upstream verification before implementation)

| Layer | Preferred choice | Fallback |
| --- | --- | --- |
| Workload identity | OIDC ID tokens (GitHub Actions, GitLab CI, SPIFFE) | SPIFFE / mTLS |
| Agent credential broker | **Infisical Agent Vault** | Custom proxy with strict egress |
| Central secret store | **Infisical** | **OpenBao** (MPL-2.0, OpenSSF/Linux Foundation) |
| Encrypted portable config / backup / Git-safe files | **SOPS + age** | Dotenvx |
| Secret avoidance in agents | Strict destination allowlist + audit log + per-agent identity | — |

OpenAI's own guidance aligns with this: keep API keys away from client-side
environments, route requests through your backend, use a key-management
service, apply permissions, monitor usage, rotate keys, and use IP
allowlisting where applicable.

## Required security invariants

These are non-negotiable for any change touching secrets:

1. **No plaintext secrets committed** to GitHub / GitLab / any VCS.
2. **No plaintext secrets included** in screenshots, proof bundles, logs,
   test artifacts, generated reports, telemetry, or chat output.
3. **No agent is instructed to output a real credential value.**
4. **Secret values are redacted from telemetry, evidence, and chat.**
6. **Ephemeral credentials only** — short-lived tokens over long-lived keys.
7. **Least privilege** — per-agent identity, scoped to the secrets it needs.
8. **Separation of trust boundaries** — production / development / test
   credentials are distinct identities.
9. **Secret scanning on every commit/push** — gitleaks + provider-native
   push protection. Fail closed when the scanner is absent.
10. **Rotation / revocation procedure exists and is exercised.**
11. **Strong isolation** — credential broker and vault are deployed outside
    the execution boundary of unrestricted agents. An agent with admin/root
    on its own machine still cannot read the master provider credentials.

## Components in detail

### 1. OIDC / workload identity

Use OIDC wherever GitHub, GitLab, cloud services, or Vault supports it.
Prefer short-lived identity tokens over long-lived credentials. GitHub Actions
and GitLab CI should use OIDC rather than permanent cloud/service
credentials wherever possible. GitLab already supports OIDC → AWS, Azure,
GCP, and HashiCorp Vault with default token TTLs as short as 5 minutes.

### 2. Agent credential broker

Investigate and integrate **Infisical Agent Vault** as the preferred
agent-facing credential proxy.

- Agents make approved requests through the broker.
- The broker inserts the real API credential server-side.
- The agent must never see the real OpenAI / Anthropic / MiniMax / GitHub /
  GitLab / Cloudflare / DB token.
- Strict destination / egress allowlists where practical.
- Audit every request.
- Rate-limit and scope access.
- Run in **strict mode** that denies unmatched destinations instead of
  silently proxying — this prevents an agent from exfiltrating data to an
  arbitrary domain.

Example per-agent policy:

```yaml
claude-pc3:
  allowed:
    - api.openai.com
    - api.anthropic.com
    - api.github.com/repos/Ghenghis/PC3...
  denied:
    - "*"

codex-hermesproof:
  allowed:
    - github.com
    - gitlab.com
    - api.minimax.chat
  denied:
    - "*"
```

Give every application / agent its **own machine identity and least-privilege
policy**. Do not use one master identity for every project — that maximizes
blast radius when an application is compromised.

### 3. Central secret vault

- **Preferred:** Infisical.
- **Open-source equivalent:** OpenBao (MPL-2.0, OpenSSF / Linux Foundation).
- Organize secrets by `project / environment / service / path`.
- Use **dynamic secrets** and **leases** where supported.
- Support automatic rotation.

### 4. SOPS + age (different role)

Use SOPS + age for **portable encrypted configuration, Git-safe encrypted
files, recovery/export, and backups.** It is excellent for those.

It is **not** the primary method for giving secrets to agents, because
decrypting the file into an agent environment exposes the plaintext
credential. Reserve SOPS for the cases where an operator (not an agent)
needs to handle the file.

### 5. Existing `.env` migration

Inventory every existing `.env`, `.env.*`, credential JSON, token, PAT,
API key, and private configuration across every project.

Do **not** print secret values into logs, reports, or chat during inventory.

Classify each secret into exactly one bucket:

| Bucket | Action |
| --- | --- |
| **Replaceable by OIDC** | Remove from project; rely on OIDC token. |
| **Broker-only secret** | Move into the vault; agent calls broker. |
| **Vault-injected application secret** | Move into vault; inject at app startup on a trusted host. |
| **SOPS-encrypted portable secret** | Encrypt with SOPS+age; reserve for ops/backup. |
| **Obsolete / revocable** | Revoke at the provider. Delete. |

After classification, move secrets into the central vault and replace
project `.env` contents with references / configuration where possible.
Keep `.env` compatibility only where an application absolutely requires
environment variables (and even then, prefer vault-injected env over
checked-in files).

### 6. HermesProof's role

HermesProof should become the single security / control-plane integration
point for agent credentials where practical.

- Claude, Codex, ChatGPT, MCP servers, and other agents should talk to
  HermesProof / approved MCP tooling rather than independently receiving
  the same provider secrets.
- Dave's Tools / MCP fleet can consume the same identity / credential
  architecture.
- **New projects should inherit this security architecture by default.**
- HermesProof's own `SECURITY_POLICY.md` continues to govern the MCP
  surface (locks, gates, evidence, signing) — this document governs
  the *outer* secret-handling layer above it.

## Implementation outcome

HermesProof should eventually provide something conceptually like:

```
request capability
   → authenticate agent (OIDC / machine identity)
   → evaluate policy (per-agent, least privilege)
   → broker authorized request
   → inject provider credential privately
   → return API result
```

rather than:

```
read OPENAI_API_KEY from .env
   → give it to agent
   → agent calls provider
```

## Implementation order

Do **not** attempt a giant rewrite. Make HermesProof *capable* of
supporting this architecture now, then migrate applications progressively.

1. **Audit** current secret handling in HermesProof and every project that
   wires it.
2. **Identify the smallest useful integration point** in HermesProof for
   credential brokering.
3. **Add the security abstraction / interfaces** (identity, broker,
   provider, redaction, policy modules under `security/`).
4. **Protect existing behavior** — keep `.env` compatibility while the
   new path is wired in.
5. **Incrementally migrate credentials** project by project.
6. **Verify against current upstream documentation** for Infisical Agent
   Vault, Infisical / OpenBao, GitHub Actions OIDC, and GitLab CI OIDC
   before implementation. Architectures evolve.

## Agent instruction (add to every agent contract)

> Agents must never request, display, copy, log, commit, or persist plaintext
> credentials when a brokered, OIDC, vault-backed, or encrypted alternative
> is available.

## References

- Infisical Agent Vault — open-source agent credential proxy with strict
  egress, audit logging, and machine identities.
- OpenBao — MPL-2.0 community fork of Vault (OpenSSF / Linux Foundation).
- SOPS + age — Mozilla SOPS with age encryption for portable encrypted
  config.
- GitHub Actions OIDC — short-lived tokens for cloud deployments.
- GitLab CI OIDC — ID tokens for AWS, Azure, GCP, Vault.
- OpenAI API key guidance — keep keys server-side; route through your
  backend; monitor usage; rotate.

---

*This document is the source of truth. Future Claude, Codex, ChatGPT, or
other agent sessions read this file — they do not depend on conversation
memory.*