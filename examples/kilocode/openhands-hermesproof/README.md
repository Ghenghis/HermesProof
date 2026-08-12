# KiloCode OpenHands HermesProof Example

This folder documents the Kilo-side integration shape. The JSON below is a configuration template, not proof and not a runnable smoke result.

## Flow

1. Configure KiloCode to connect to the HermesProof MCP server.
2. Before sidecar delegation, call `hermes_kilocode_policy_check`.
3. If the policy allows or the user approves, run the OpenHands sidecar adapter.
4. After completion, call `hermes_kilocode_record_delegation`.
5. Preserve the installed-VSIX snapshot, runner result, heartbeat, and real `ev_*` evidence.
6. Evaluate the full versioned artifact with `hermes_kilocode_evaluate_installed_vsix_release_proof`.

The evaluator requires contract version `kilocode.e2e-proof-contract.2026-07-10` and the same required preflight keys as KiloCode's `ci/e2e-gate-proof-policy.json`. This example cannot satisfy or replace those preflights.

## Configuration Template

```jsonc
{
  "openhands": {
    "baseUrl": "${OPENHANDS_BASE_URL}",
    "sessionApiKeyEnv": "OPENHANDS_SESSION_API_KEY",
    "defaultProfile": "kilo-sidecar"
  },
  "hermesProof": {
    "mcpServerName": "hermes3d-locks",
    "taskType": "kilocode_openhands_delegation",
    "owner": "kilocode-agent"
  },
  "delegationPolicy": {
    "askFor": ["ssh", "install", "deploy", "destructive"],
    "denyRawSecrets": true,
    "recordEvidence": true
  }
}
```

Secrets must stay in environment variables or an operator-controlled private store. Do not paste secret values into this file.

OpenHands installation, status, or HTTP reachability alone is not a pass. The release artifact must contain a real completed runner result, exit status, duration, snapshots, installed VSIX hash, and HermesProof evidence. A timeout or transport failure remains blocked and must not produce a completion claim.
