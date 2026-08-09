# HermesProof Model–Harness Attribution (HP-MHA)

**Document status:** First-class HermesProof protocol specification
**Owner lane:** Documentation / contract
**Related gate:** `HP-HARNESS-ATTRIBUTION`
**MCP evidence family:** `ev_harness_*`, `ev_experiment_*`, `ev_run_*`, `ev_trace_*`, `ev_attribution_*`, `ev_promotion_*`

---

## 1. Purpose and Scope

HermesProof must prove whether a measured performance change came from the **model**, the **harness**, the **runtime configuration**, or an **interaction among them**. This is the Model–Harness Attribution protocol (HP-MHA).

HP-MHA exists so HermesProof can independently establish what actually caused an improvement instead of accepting a leaderboard number, a model name, or an agent claim at face value.

### 1.1 What HP-MHA is not

- Not a hard-coded rule that "the harness is always worth N points."
- Not a self-modifying optimization loop running inside HermesProof.
- Not a certificate that a change is good. HP-MHA measures attribution; it does not grade quality.

### 1.2 Background

Reported benchmark figures motivating this protocol:

- On SWE-bench Pro under a standardized SEAL scaffold, six leading models occupied a range of only 4.9 percentage points.
- Claude Opus 4.5 scored 45.9% with SEAL and 55.4% with Claude Code — a 9.5-point harness difference with the model held fixed.
- Other reported cross-scaffold differences: 34 points for Claude Sonnet 4.5, 34 points for GPT-5 Medium, and nearly 48 points for o4-mini.
- LangChain kept GPT-5.2-Codex fixed and improved its Deep Agents harness from 52.8% to 66.5% on Terminal-Bench 2.0 by changing prompts, tools, middleware, context injection, loop detection, and verification behavior.
- LangChain also reported that running with `xhigh` reasoning scored 53.9% while `high` scored 63.6%, primarily because the higher reasoning setting caused more timeouts. This is directly relevant to timing failures observed around HermesProof/Kilo gates: more reasoning is not automatically more completed work.
- Meta-Harness reported 76.4% with Claude Opus 4.6 vs 58.0% for Claude Code on TerminalBench-2 with the same underlying model.

### 1.3 Important corrections to the popular transcript

- **The 48-point result is not a universal constant.** It was an observed maximum for a particular model, benchmark, and pair of scaffolds. A controlled 3×3 experiment reported harness variance 7.8× model variance on its selected task distribution, but the authors explicitly said the ratio was not universal.
- **Meta-Harness did not inject 10 million tokens into one prompt.** A single evaluation could generate up to 10 million tokens of diagnostic information, but that information was stored on a filesystem and inspected selectively with tools like `grep` and `cat`. The proposer read a median of 82 files per iteration. Comparison methods were estimated to expose roughly 100 to 30,000 tokens — not universally capped at exactly 26,000.

The lesson is not "assume the harness is 10× more important." The lesson is **measure the attribution under our own real task distribution**.

---

## 2. Architecture and Trust Boundary

Heavy benchmark execution stays outside the proof authority. HermesProof remains the independent verifier; it must never modify a candidate harness and then certify its own modification.

```
KiloCode / HermesAgent / HarnessLab
            │
            ▼
GitLab or VPS benchmark runners
            │
            ├── installed-artifact execution
            ├── task results
            ├── raw traces
            └── test and runtime artifacts
            │
            ▼
Existing content-addressed artifact store
            │
            ▼
HermesProof MCP
            ├── verifies experiment plan
            ├── verifies model identity
            ├── verifies harness identity
            ├── verifies trace integrity
            ├── computes attribution
            └── emits immutable ev_* evidence
```

HermesProof is the independent authority. The optimizer (whatever it is) lives outside HermesProof; the candidate it produces is independently evaluated by HermesProof on its way in.

---

## 3. Required MCP Capabilities

These may be new tools or namespaces over the existing HermesProof recorder and evaluator. Every emitted evidence object chains to prior evidence IDs so a downstream reader can prove the full lineage:

```
experiment plan
    → model manifest
    → harness manifest
    → environment manifest
    → individual benchmark runs
    → raw trace roots
    → attribution report
    → promotion decision
```

| MCP capability              | Purpose                                                                                 | Evidence output      |
| --------------------------- | --------------------------------------------------------------------------------------- | -------------------- |
| `harness_card_record`       | Canonicalize and hash the complete harness configuration                                | `ev_harness_*`       |
| `experiment_plan_lock`      | Lock the task set, model cells, harness cells, budgets and evaluator before execution   | `ev_experiment_*`    |
| `benchmark_run_attest`      | Bind each completed run to the locked plan and its artifacts                             | `ev_run_*`           |
| `trace_bundle_verify`       | Verify trace chunk hashes, root hash, redaction and retention status                    | `ev_trace_*`         |
| `model_harness_attribution` | Calculate model effect, harness effect, interaction and uncertainty                    | `ev_attribution_*`   |
| `promotion_evaluate`        | Return PASS, FAIL, or INCONCLUSIVE under the configured release policy                  | `ev_promotion_*`     |

---

## 4. The Harness Card

HermesProof records the full harness configuration across seven layers: **Execution, Model & inference, Tools, Context, Scheduling & control, Observability & verification, Governance**.

A minimum 2×2 model-by-harness comparison is the floor when attributing model vs harness performance.

### 4.1 Layer 1 — Execution

Record:

- Installed application or extension commit
- VSIX / package / archive SHA-256
- Container image digest
- Runner identity
- Operating system and architecture
- Dependency-lock hash
- Repository commit and dirty-state flag
- Per-step timeout
- Overall task timeout
- Maximum steps
- Token, cost, and wall-clock budgets
- Network policy
- Sandbox and filesystem permissions

**Proof requirement.** The evaluator must run the installed artifact, live MCP child, and real tools. Synthetic JSON generation or checking whether expected words appear in a file is **not** acceptable proof of harness performance.

### 4.2 Layer 2 — Model and inference configuration

Recorded **separately from the harness**:

- Provider and endpoint route
- Exact model ID
- Provider revision, where available
- API request IDs
- Context-window setting
- Temperature, `top_p`, seed, and tool mode
- Reasoning level
- Maximum output tokens
- Quantization and model-file hash for local models
- Runtime version
- GPU placement and offload configuration
- Whether prompt caching was active
- Fallback policy and whether fallback actually occurred

**Local models.** For LM Studio or Ollama, the displayed model name alone is insufficient. HermesProof binds the run to the model file or manifest hash, quantization, runtime version, context setting, and confirmed served model ID.

**Cloud models.** For cloud models whose weights cannot be hashed, capture the exact API model identifier, provider response metadata, request ID, and execution date.

**Failover rule.** A run beginning on one model and falling back to another cannot be reported as a clean result for either model. It must either:

- invalidate that experimental cell, or
- be classified as a separate composite routing harness.

This applies to LM Studio → local fallback and cloud → local routes alike. The fallback controller itself is part of the harness.

### 4.3 Layer 3 — Tools

Record:

- Complete tool inventory
- Tool-schema hashes
- MCP server inventory and versions
- Allowlist and denylist hashes
- Tool descriptions exposed to the model
- Tool-result format
- Error-response contract
- Shell restrictions
- Write boundaries
- Destructive-operation approval policy

**Changing a tool description, error shape, search tool, or patch format counts as a harness change even when the executable implementation remains the same.**

### 4.4 Layer 4 — Context

Record:

- System-prompt hash
- Project-contract hash
- Context construction rules
- File-discovery behavior
- Retrieval policy
- Summarization and compression policy
- Persistent-memory policy
- Maximum retained history
- Constraint-reminder behavior
- Whether failed outputs remain visible
- How test output is injected back into the model

### 4.5 Layer 5 — Scheduling and control

Record:

- Loop, graph, or hybrid controller
- Planning stage behavior
- Retry count and backoff
- Escalation rules
- Subagent delegation
- Model-selection policy
- Stop conditions
- Checkpoint and rollback behavior
- Doom-loop detection thresholds
- Per-file edit limits
- Pre-completion checklist behavior

Loop vs graph is one harness variable. HermesProof measures it; it does not declare either architecture inherently superior.

### 4.6 Layer 6 — Observability and verification

Record:

- Full tool-call sequence
- Test commands and unabridged outcomes
- Failed validation attempts
- Patch hashes
- Changed-file inventory
- Timeout and cancellation events
- Verification commands run before completion
- Whether the final result was checked against the original contract
- Whether the agent merely reread its own code
- Trace completeness
- Missing-event count

### 4.7 Layer 7 — Governance

Record:

- Workspace scope
- Side-effect boundaries
- Secret-access policy
- Human-approval points
- Destructive-action restrictions
- Redaction policy
- `secretValuesReturned=false`
- Whether the agent attempted a denied action
- Whether any proof input came from the candidate agent without independent verification

---

## 5. Controlled Benchmark Protocol

A claim such as "Model B is better" or "Harness 2 improved performance" requires a locked comparison.

### 5.1 Factorial design

```
S11 = Model 1 + Harness 1
S12 = Model 1 + Harness 2
S21 = Model 2 + Harness 1
S22 = Model 2 + Harness 2
```

HermesProof computes:

```
Harness effect = average of:
    S12 − S11
    S22 − S21

Model effect = average of:
    S21 − S11
    S22 − S12

Interaction  = S22 − S21 − S12 + S11
```

The interaction matters because a harness can work extremely well with one model and poorly with another. A single "best model" or "best harness" number may hide that relationship.

### 5.2 Held-constant matrix

Every cell in the matrix must use the same:

- Tasks and task order
- Repository starting state
- Evaluator
- Sandbox image
- Tool permissions
- Timeouts
- Step budget
- Network conditions
- Output validation
- Sampling configuration
- Failure accounting

Use at least two independent repetitions per cell; **three repetitions** should be the normal release-policy target. Every failure and timeout remains in the denominator.

### 5.3 Required report outputs

- Verified pass rate
- Harness-effect percentage points
- Model-effect percentage points
- Model–harness interaction
- Ranking reversals
- Run-to-run variance
- Paired confidence intervals
- Timeout rate
- Median completion time
- Tokens per verified completion
- Cost per verified completion
- Critical-task regression count

When evidence is insufficient, HermesProof returns `INCONCLUSIVE`. It does not manufacture a winner.

---

## 6. Trace-Level Metrics

Beyond aggregate scores, HP-MHA records trace-level metrics that explain *why* one configuration outperformed another rather than merely showing that it scored higher.

### 6.1 Recovery rate

After a tool error, test failure, rejected patch, or malformed output, did the agent return to productive work within 1, 3, 5, and 10 steps?

### 6.2 Control lag

How many steps elapsed between:
- problem detected
- corrective instruction delivered
- corrective action executed

### 6.3 Context retention

Did the model still retain the important original requirements near the end of the task, including:
- Required artifact path
- Acceptance tests
- Security restrictions
- User constraints
- No-mock / no-synthetic-proof requirements
- Required deployment target

### 6.4 Additional Hermes-specific metrics

- Doom-loop escape rate
- Repeated-edit rate
- Productive action ratio
- Tool-schema compliance
- Verification coverage
- Premature-completion attempts
- Hidden fallback occurrence
- Proof rejection recovery
- Stale-evidence use
- Critical-gate preservation

These metrics expose the difference between a model failing because it lacks capability and a model failing because the harness let it spend 15 minutes repeating the same edit.

---

## 7. Contract Requirements

These are normative requirements on HermesProof itself. They are referenced from `HP-HARNESS-ATTRIBUTION` and from any external system that consumes HP-MHA evidence.

### HP-MHA-001 — Manifest binding

HermesProof SHALL bind every agent-performance result to an immutable model manifest, harness manifest, task-set manifest, evaluator manifest, environment manifest, and trace-root hash.

### HP-MHA-002 — No bare model comparison

HermesProof SHALL reject a model-comparison claim unless the compared runs use a locked harness or a declared factorial model-by-harness design.

### HP-MHA-003 — No bare harness claim

HermesProof SHALL reject a harness-improvement claim unless the model, inference settings, task set, environment, evaluator, permissions, budgets, and stopping rules are held constant.

### HP-MHA-004 — Contamination classification

HermesProof SHALL classify an undeclared provider fallback, model substitution, changed reasoning setting, changed timeout, or changed tool inventory as experiment contamination.

### HP-MHA-005 — No silent failure omission

HermesProof SHALL include failed, cancelled, crashed, and timed-out runs in the final result. A runner or agent SHALL NOT omit unsuccessful cells.

### HP-MHA-006 — Holdout isolation

HermesProof SHALL separate optimization tasks from hidden holdout tasks. The candidate optimizer SHALL NOT receive holdout results before the candidate harness is frozen.

### HP-MHA-007 — Multi-dimensional reporting

HermesProof SHALL report model effect, harness effect, interaction, timeouts, cost, latency, regression count, and uncertainty. It SHALL NOT report only one aggregate success percentage.

### HP-MHA-008 — Machine-readable verdict

HermesProof SHALL return PASS, FAIL, or INCONCLUSIVE with machine-readable reason codes and chained `ev_*` evidence.

### HP-MHA-009 — Independence from candidate

HermesProof SHALL NOT modify a candidate harness, select its own preferred candidate, or certify a change it performed. Harness optimization SHALL remain outside the independent proof authority.

### HP-MHA-010 — Real execution

HermesProof SHALL execute and evaluate the installed runtime and real tool chain. Synthetic records, mocked provider responses, and string-count checks SHALL NOT constitute release proof.

---

## 8. Raw-Trace Handling

Do not place millions of tokens inside an MCP response. Use:

- Compressed trace chunks
- Content-addressed filenames
- Per-chunk SHA-256
- A root hash or Merkle root
- A searchable trace index
- Redaction reports
- Retention classification
- Artifact existence checks
- Immutable release-pinned trace bundles

HermesProof returns references, hashes, summaries, and selected supporting ranges. The optimizer can selectively inspect the underlying trace store.

### 8.1 Retention classes

Because VPS runners must purge old material, classify traces as:

| Class               | Retention                                                              |
| ------------------- | --------------------------------------------------------------------- |
| `release_pinned`    | Never automatically purge                                            |
| `failure_diagnostic`| Retain through the active repair cycle                                |
| `routine_run`       | Short retention                                                       |
| `duplicate_chunk`   | Deduplicate by hash                                                   |

When raw evidence has been purged, HermesProof reports that the historical result still has a signed manifest but is no longer fully re-auditable. It does not pretend the missing evidence remains available.

---

## 9. Gate Integration

Do not renumber or destabilize the existing gates. Add a release sub-gate named `HP-HARNESS-ATTRIBUTION`.

| Change type                                                          | Required evaluation                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------- |
| Ordinary code edit with unchanged harness/model                      | Record manifests and normal proof only                        |
| Prompt, tool, middleware, memory, or retry change                    | Fixed-model old-harness/new-harness A/B                       |
| Model or provider change                                             | Fixed-harness old-model/new-model A/B                         |
| Claim about model vs harness importance                              | Full 2×2 factorial                                            |
| Major Kilo / HermesProof release                                     | Project holdout suite plus attribution report                 |
| Automatic harness optimization                                       | Optimizer outside HermesProof; final candidate independently evaluated |

The "48-Point Lever" framing remains valuable as a dashboard heading and motivation, but the value HermesProof stores is the **measured** harness leverage for our exact KiloCode / OpenHands / Aider / Goose environment, with the model, runtime, artifacts, failures, and traces all independently proven.

---

## 10. Cross-References

- `docs/ARCHITECTURE.md` — overall HermesProof authority boundary
- `docs/TOOL_REFERENCE.md` — MCP tool surface, gate catalog
- `docs/MAINTENANCE.md` — gate evolution policy
- `docs/audits/` — independent reviews of prior attribution claims
- `examples/hp-mha/harness-cards/` — real harness cards consumed by the `HP-HARNESS-ATTRIBUTION` sub-gate
- `examples/hp-mha/load-card.mjs [--all]` — reproducible loader that prints per-card PASS / FAIL / INCONCLUSIVE verdicts