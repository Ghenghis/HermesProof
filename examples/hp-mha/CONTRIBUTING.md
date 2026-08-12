# Contributing a real harness card (HP-MHA)

When you bring a new harness into HermesProof HP-MHA (OpenHands, Aider, Goose, your own, etc.), three things have to be true before its card can pass the provenance contract. A card is not assigned attribution from an unrelated benchmark.

## 1. Compute the four content-addressed manifests

Every card under `examples/hp-mha/harness-cards/` must carry four real SHAs. Run:

```bash
# Working copy of the new harness, in its real install path
HARNESS_DIR="/path/to/installed/harness"
cd "$HARNESS_DIR"

INSTALLED=$(git rev-parse HEAD)
PACKAGE_SHA=$(cat package.json | sha256sum 2>/dev/null \
              || npm pack 2>/dev/null | sha256sum \
              || pip wheel 2>/dev/null | head -c 1G | sha256sum)
LOCK_SHA=$(sha256sum package-lock.json poetry.lock uv.lock Cargo.lock \
              2>/dev/null | head -1 | awk '{print $1}')

echo "installed_commit=$INSTALLED"
echo "package_sha256=$PACKAGE_SHA"
echo "dependency_lock_sha256=$LOCK_SHA"
```

If the harness is not packaged, hash the source archive you would `tar -czf` to back it up. If you cannot compute a content-addressed identity for the harness, you cannot pass HP-MHA-001; do not ship a card without one.

## 2. Materialize installed evidence

The files under `harness-cards/templates/` are retained installed-reference declarations, not placeholder/FIXME manifests. HermesProof schema-checks them but does not re-probe those external packages on every release. Copy the closest reference to `harness-cards/<name>.json`, assign a unique card id, then replace its package binding and SHA-256 fields with values from the actual installed runtime. Never reuse the reference hashes for a different installation.

The 7 layers (Execution, Model & inference, Tools, Context, Scheduling, Observability, Governance) come from `docs/48-Point Lever.md` §4. Each layer's required field list is enforced by `validateHarnessCard(card)` in `src/core/hp-mha.mjs`. Cards that omit a required field, add an unknown field, or skip a layer will be rejected by the sub-gate.

## 3. Verify the contract

```bash
npm run hp-mha:load-all                              # schema-checks all cards; fully verifies local Hermes cards
node --test src/core/hp-mha-benchmark.test.mjs       # verifies evidence digest + tamper rejection
node scripts/truth-gates.mjs --ci
```

Both must `PASS` at `required` level. If your card fails `validateTaskSetTagUniqueness` or `assembleManifestSha256`, see `docs/audits/2026-08-06-hp-mha-phase3.codex.md` for the precise contract requirements.

## 4. Rules you cannot break

| Rule | Where enforced |
|---|---|
| HP-MHA-001: six-manifest binding + trace-root hash | `validateRunBinding` |
| HP-MHA-002: locked harness OR factorial design for any model comparison | `validateModelComparison` |
| HP-MHA-003: eight-key held-constant for any harness claim | `validateHarnessImprovementClaim` |
| HP-MHA-006: public MCP callers cannot claim reserved holdout paths or tags by supplying a different role | `assertLockFilesRespectHoldoutIsolation`, `hermes_lock_files` handler |
| HP-MHA-009: HermesProof never certifies a change it performed | the candidate harness lives in a separate repo |
| HP-MHA-010: real installed runtime + real tools, no mocks | every entry must reference real SHAs, not `mock://` |

## 5. Adding a holdout or optimization task set

Copy `examples/hp-mha/task-sets/holdout.json` or `examples/hp-mha/task-sets/optimization.json` and adjust the `tags` array. **Do not** put both `hp_mha.holdout` and `hp_mha.optimization` on the same task set — `validateTaskSetTagUniqueness` will reject it.

## 6. Running the release evaluation

The checked-in real matrix is `{s11:0.2, s12:0.2, s21:0.1, s22:0.8}` from the exact Kilo backend safety benchmark in `measured-matrix.json` (seed 260809). It retains raw responses, binds each cell to the expected model and harness contract, binds the scorer source, and re-scores at verification time. It yields harness effect `0.35`, model effect `0.25`, and interaction `0.70`. Override `--matrix` only when explicitly evaluating another retained measurement; do not apply it to an unrelated harness card.

The sub-gate runs at `required` level on every release. A new card that fails will block the release.

---

# Contributing a real 2×2 attribution matrix

Run `npm run hp-mha:measure-2x2` to produce a new real local measurement. The runner fixes temperature and seed, retains each raw response, records response/scorer/task/harness hashes and durations, and prints a digest-bound evidence object. Each cell is the deterministic safety score for one model/harness combination. The subtraction rules:

```
harness_effect = ((s12 - s11) + (s22 - s21)) / 2
model_effect   = ((s21 - s11) + (s22 - s12)) / 2
interaction    =  s22 - s21 - s12 + s11
```

A run is "passed" only if (a) `passed` outcome in `ev_run`, AND (b) the trace bundle verifies AND (c) the promotion verdict is PASS. A run is "failed" / "cancelled" / "crashed" / "timed_out" if the runner reported any non-pass outcome; never omit from the denominator (HP-MHA-005).
