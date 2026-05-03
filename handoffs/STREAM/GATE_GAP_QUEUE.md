# GATE_GAP_QUEUE.md — HermesProof-side gates (mirror subset)

> Subset of the Hermes3D queue that's implementable on the HermesProof
> side (because they touch the harness or policy files). The full list
> lives in `Hermes3D/handoffs/STREAM/GATE_GAP_QUEUE.md`.

---

## P0 mirrored items

### gap-2026-05-03-001 — license-coverage-gate
- domain: supply-chain
- status: claimed:claude-impl-hp-licenses
- impl-side: HermesProof (this repo)
- estimated-effort: M

### gap-2026-05-03-002 — sbom-generation-gate
- domain: supply-chain
- status: unclaimed
- impl-side: HermesProof (this repo)
- estimated-effort: M

### gap-2026-05-03-003 — dep-fresh-gate
- domain: supply-chain
- status: unclaimed
- impl-side: HermesProof (this repo)
- estimated-effort: S

### gap-2026-05-03-004 — workflow-pinning-gate
- domain: security
- status: unclaimed
- impl-side: HermesProof (this repo, but applies to both repos' workflows)
- estimated-effort: S

### gap-2026-05-03-006 — mcp-scan-static-gate
- domain: security
- status: unclaimed
- impl-side: HermesProof (this repo, scans src/server.mjs)
- estimated-effort: M

---

## Bookkeeping

- 2026-05-03 11:35Z — initial mirror
