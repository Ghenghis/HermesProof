# ENHANCEMENT_QUEUE.md — HermesProof-side queue

> Subset of enhancements that affect HermesProof (perf, lock-mgr, harness).
> The full list lives in `Hermes3D/handoffs/STREAM/ENHANCEMENT_QUEUE.md`.

---

## P0

### enh-2026-05-03-010 — v0.5.1-perf-companion
- domain: perf
- status: claimed:claude-impl-hp-perf
- estimated-effort: M

Gemini's 4 deferred items from PR #15.

### enh-2026-05-03-011 — registry-hardening-pack
- domain: security
- status: unclaimed
- estimated-effort: M

Tighten owner regex (`^[a-z][a-z0-9-]{1,63}$`), path-traversal hardening
in `fs-utils.mjs` (`..`, abs paths, symlinks, NTFS ADS), hash-chain
evidence ledger (per ADR-013 follow-up).

---

## P1

### enh-2026-05-03-012 — sigstore-signing-of-PROOF
- domain: supply-chain
- status: unclaimed
- estimated-effort: S

Add cosign sign-blob job to truth-gates.yml. SLSA Build L2.

### enh-2026-05-03-013 — mcp-sdk-bump
- domain: dependencies
- status: unclaimed
- estimated-effort: S

Bump @modelcontextprotocol/sdk from ^1.19 → ^1.24. Migrate `server.tool()` →
`server.registerTool(name, config, handler)` for the 15 tools (adds
readOnlyHint, destructiveHint, idempotentHint, openWorldHint annotations).

---

## Bookkeeping

- 2026-05-03 11:35Z — initial mirror
