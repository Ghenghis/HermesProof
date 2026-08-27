# Contributing a real harness card (HP-MHA)

When you bring a new harness into the HermesProof HP-MHA comparison (OpenHands, Aider, Goose, your own, etc.), three things have to be true before the card can answer `harness_attribution.contract` against real measurements:

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

## 2. Fill in the template

Copy `examples/hp-mha/harness-cards/templates/<name>.json` to `examples/hp-mha/harness-cards/<name>.json` and replace every `FIXME` token with the values from step 1.

The 7 layers (Execution, Model & inference, Tools, Context, Scheduling, Observability, Governance) come from `docs/48-Point Lever.md` §4. Each layer's required field list is enforced by `validateHarnessCard(card)` in `src/core/hp-mha.mjs`. Cards that omit a required field, add an unknown field, or skip a layer will be rejected by the sub-gate.

## 3. Verify the contract

```bash
npm run hp-mha:load-all -- --matrix 0.5,0.6,0.7,0.8   # placeholder until real 2x2 lands
scripts/truth-gates.mjs --ci   # cards=2 → cards=3 once submitted
```

Both must `PASS` at `required` level. If your card fails `validateTaskSetTagUniqueness` or `assembleManifestSha256`, see `docs/audits/2026-08-06-hp-mha-phase3.codex.md` for the precise contract requirements.

## 4. Rules you cannot break

| Rule | Where enforced |
|---|---|
| HP-MHA-001: six-manifest binding + trace-root hash | `validateRunBinding` |
| HP-MHA-002: locked harness OR factorial design for any model comparison | `validateModelComparison` |
| HP-MHA-003: eight-key held-constant for any harness claim | `validateHarnessImprovementClaim` |
| HP-MHA-006: optimizer role cannot claim `hp_mha.holdout` files | `assertLockFilesRespectHoldoutIsolation`, `hermes_lock_files` handler |
| HP-MHA-009: HermesProof never certifies a change it performed | the candidate harness lives in a separate repo |
| HP-MHA-010: real installed runtime + real tools, no mocks | every entry must reference real SHAs, not `mock://` |

## 5. Adding a holdout or optimization task set

Copy `examples/hp-mha/task-sets/holdout.json` or `examples/hp-mha/task-sets/optimization.json` and adjust the `tags` array. **Do not** put both `hp_mha.holdout` and `hp_mha.optimization` on the same task set — `validateTaskSetTagUniqueness` will reject it.

## 6. Running the release evaluation

The placeholder attribution matrix `{s11:0.5, s12:0.6, s21:0.7, s22:0.8}` is intentional until measured data lands. Once your benchmark pipeline produces a real 2×2 matrix, override with `--matrix s11,s12,s21,s22` to the actual numbers.

The sub-gate runs at `required` level on every release. A new card that fails will block the release.

---

# Contributing a real 2×2 attribution matrix

Once a benchmark pipeline exists, the matrix replaces `SMOKE_MATRIX` in `src/core/hp-mha.mjs`. Each cell is `verified_pass_rate` for the four model/harness pair combinations. The subtraction rules:

```
harness_effect = ((s12 - s11) + (s22 - s21)) / 2
model_effect   = ((s21 - s11) + (s22 - s12)) / 2
interaction    =  s22 - s21 - s12 + s11
```

A run is "passed" only if (a) `passed` outcome in `ev_run`, AND (b) the trace bundle verifies AND (c) the promotion verdict is PASS. A run is "failed" / "cancelled" / "crashed" / "timed_out" if the runner reported any non-pass outcome; never omit from the denominator (HP-MHA-005).
