# Local models and authorized reverse engineering

HermesProof prefers LM Studio with LM Link because it can route requests to the user’s separate GPU PC with low latency. Ollama is the local fallback. Both routes remain private/local by default and are health-checked before selection.

## Model route

1. Check `lms link status --json`.
2. Use the configured LM Studio OpenAI-compatible endpoint when healthy.
3. Check Ollama `/api/tags` and use it when LM Studio is unavailable.
4. Fail clearly when neither route is healthy; do not silently send source code to a cloud model.

The route stores endpoint metadata, not API secrets. Model choice remains editable per project.

## Reverse-engineering profile

The `reverse-engineering-local` capability profile is intended only for software, firmware, devices, and data the operator owns or has explicit authorization to analyze. It can inventory locally installed tools such as Ghidra, Cutter/rizin, x64dbg, dnSpyEx, JADX, apktool, binwalk, strings, and object-file utilities.

These capabilities are:

- disabled until a task explicitly requires them;
- workspace/task/time scoped;
- read-only first where the tool permits;
- launched without unrestricted shell delegation;
- pinned and hashed with an SBOM or package inventory;
- covered by Hermes locks, evidence, diagnostics, and quarantine;
- blocked from credential extraction, unauthorized access, persistence, or unrelated targets.

Uncensored or “abliterated” local models can assist with analysis, but model style never changes authorization boundaries or bypasses locks and release gates.
