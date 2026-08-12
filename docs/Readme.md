
this is exactly the kind of thing that should become a Beta 11 improvement, but I would split it into two parts:

1. Immediate/highest-value feature:
   Kilo Progress Pulse / Run Monitor / Watchdog updates

2. Beta 11 intelligence layer:
   Conductor mode, Evolve lane, experiment ledger, smart switching

The progress/update problem you described is more urgent than the external-intelligence bundle itself. If Kilo is working for 45–120 minutes, the user needs proof that it is alive, progressing, and not silently stuck.

Your ecosystem already wants Kilo to be the single user-facing surface, with chat, Run Mode, Speech, Indexing, lane routing, and HermesProof behind it. The architecture also says Kilo chooses the correct lane and HermesProof records what happened. So the right fix is not “make the user watch terminals.” The right fix is Kilo reports its own progress through HermesProof-backed events.

What changes if we include this

Without it, Kilo can still work, but long tasks feel blind:

Kilo may be actively testing.
OpenHands may be booting.
Aider may be repairing.
Goose may be checking.
Smoke tests may be halfway through.
But the user sees silence and cannot tell working vs stuck.

That causes the exact problem you described: the user stops a 90–120 minute smoke test after 45 minutes because it looks frozen, even though it had already written files and was still working.

With it included, Kilo becomes much more usable:

Kilo says what gate is running.
Kilo says what lane is active.
Kilo says what changed since last update.
Kilo says whether it is waiting, testing, retrying, or stuck.
HermesProof records the heartbeat and evidence.
If no heartbeat appears in 15 minutes, the system classifies it as stalled.

That changes the experience from:

“Maybe it died?”

to:

“Gate 8/17 is still running; 24 files written; OpenHands smoke phase is active; next update in 8 minutes.”
I would add this before the fancy Beta 11 intelligence layer

The feature name should be one of these:

Kilo Progress Pulse
Kilo Run Monitor
Kilo Activity Watchdog

Best name:

Kilo Progress Pulse

Because it describes exactly what the user needs: a regular pulse showing the system is alive.

What Kilo should report every 10 minutes

A good progress update should be short, useful, and non-noisy:

Still working — 43m elapsed.
Gate 6/10 running: installed VSIX smoke.
Progress since last update: 3 gates passed, 24 files written, bundled CLI started, OpenHands health passed.
Current lane: OpenHands + Kilo supervisor.
No fatal errors yet.
Next checkpoint expected within 10 minutes.

If it is in a smoke test:

Smoke still running — 71m elapsed.
Passed: 7/10 gates.
Current: OpenHands delegate/sandbox proof.
Last artifact: installed-vsix-smoke.json updated 3m ago.
No stall detected. Continuing.

If it is stuck:

Possible stall detected — no heartbeat for 15m.
Last active phase: Gate 8 OpenHands delegate.
Last known process: Code.exe extension host alive, kilo.exe idle.
Action: capturing logs, preserving workspace, checking fallback route.

If it switches lanes:

Lane switch — local OpenHands sandbox did not become ready in time.
Fallback: Ubuntu VPS OpenHands endpoint selected.
HermesProof recorded the switch. Continuing with VPS sidecar.

This is the difference between “silent automation” and “trustworthy automation.”

How this should work internally

Add a small progress system used by all long-running Kilo tasks:

packages/opencode/src/kilocode/progress/
  progress-reporter.ts
  progress-heartbeat.ts
  progress-watchdog.ts
  progress-event.ts
  progress-summary.ts

Every long task gets a runId:

{
  "runId": "kilo-run-20260707-001",
  "task": "Beta 10 installed VSIX smoke",
  "startedAt": "2026-07-07T10:00:00Z",
  "lastHeartbeatAt": "2026-07-07T10:42:00Z",
  "lane": "openhands",
  "gate": "gate8-installed-vsix-smoke",
  "gateIndex": 8,
  "gateTotal": 17,
  "status": "running",
  "summary": "OpenHands healthy; delegate proof still running",
  "filesChanged": 24,
  "evidenceId": "ev_*"
}

Then Kilo writes:

.kilo/runs/<runId>/progress.json
.kilo/runs/<runId>/events.jsonl
.kilo/runs/<runId>/heartbeat.json
.kilo/runs/<runId>/latest-summary.md

HermesProof should also receive a safe event:

kilo.progress.heartbeat
kilo.progress.gate_started
kilo.progress.gate_passed
kilo.progress.gate_failed
kilo.progress.stall_detected
kilo.progress.recovered

HermesProof already has MCP tools for live status, events, evidence, KiloCode delegation governance, provider routing, agent watchdog recovery, and KiloCode project guardrails. It also has an agent watchdog concept for idle/frozen agents and can emit recovery events or resume tasks. So this fits the existing architecture instead of inventing a separate status system.

Settings/UI placement

This should not be buried only in Lanes.

Add one visible panel:

Run Monitor

or:

Activity

Best UI:

Kilo sidebar
  Chat
  Run Monitor
  Lanes
  Intelligence
  Speech
  Indexing

The Lanes tab stays for:

Kilo
OpenHands
Aider
Goose
HermesProof
Evolve

The Intelligence tab stays for Beta 11 features:

Conductor Mode
Evolve Lane
Smart Switching
Experiment Ledger
Provider/Lane Score Memory
No Paid External Services
HermesProof Required

The Run Monitor tab is for what the user actually needs during long tasks:

Current task
Elapsed time
Current lane
Current gate
Passed gates
Failed gates
Last heartbeat
Last artifact
Next update ETA
Stall/recovery state
Thresholds I would use
0–2 minutes:
  no chat update unless task finishes or fails

2–10 minutes:
  UI-only status updates

10+ minutes:
  send concise chat progress update every 8–10 minutes

15 minutes with no heartbeat:
  mark possible stall
  run watchdog checks
  capture logs
  do not silently continue pretending

30 minutes in same gate:
  require a reason:
    tests still running
    model/tool waiting
    OpenHands booting
    file writes still happening
    artifact still updating

60+ minutes:
  summarize progress and risk:
    continue if active
    recover if stalled
    preserve artifacts

This directly solves your “if no update in 15 minutes, something is wrong” rule.

How it would help smoke tests

Right now a smoke test can look dead because output is quiet while VS Code, OpenHands, Docker, or Bun is doing work.

With Progress Pulse:

Gate started:
  gate8-installed-vsix-smoke

Heartbeat:
  VS Code installed extension
  bundled kilo.exe started
  OpenHands local health passed
  Aider command surface passed
  Goose read-only passed
  HermesProof evidence recorded
  24 files written
  current gate still running

And if it hangs:

No result file after 15m
No file writes after 15m
No process CPU
No heartbeat
=> stall
=> capture Code logs, kilo logs, Docker logs
=> fail the gate with exact blocker

This would have prevented multiple earlier situations where a run was either killed too early or left running too long without trust.

How it connects to OpenHands, Aider, Goose

Each lane gets a heartbeat adapter.

OpenHands

Reports:

container starting
/alive passed
/ready passed
agent-server started
sandbox starting
delegate running
event count
fallback used: local/vps
last error

If OpenHands health passes but delegate fails, it must say that. Earlier OpenHands failures were confusing because health could pass while delegate/sandbox failed. The release notes already show the OpenHands sidecar disappearing root cause was eventually traced to the wrong image path, missing detached/restart behavior, and container removal during inspection. Progress Pulse would make those lifecycle states visible.

Aider

Reports:

repo map started
files selected
patch generated
lint running
test running
patch accepted/rejected
Goose

Reports:

read-only route started
recipe/tool step running
provider waiting
timeout/retry
verification result
HermesProof

Reports:

policy check started
checkpoint recorded
delegation recorded
claim audit passed/failed
evidence id produced

HermesProof maintenance rules already say evidence and events should be produced on checkpoints, handoff decisions, gate results, and errors. This is exactly the same principle, made visible to the user.

How the external-intelligence bundle changes this

The tools/external-intelligence bundle helps after this progress foundation exists.

Without external intelligence:

Kilo routes mostly through fixed rules:
  small edit -> Kilo
  repo repair -> Aider
  heavy/sandbox -> OpenHands
  proof -> HermesProof
  read-only verification -> Goose

That is already useful.

With external intelligence included in Beta 11:

Kilo can explain why it picked a lane.
Kilo can score lanes based on past outcomes.
Kilo can run measurable improvement loops.
Kilo can keep experiment ledgers.
Kilo can compare candidate fixes instead of guessing.
Kilo can learn which lane/provider works best for a task type.

But the first Beta 11 implementation should not be “giant evolve system.” It should be:

Progress Pulse + Experiment Ledger + Conductor Decision Record

That gives immediate user value and makes the later Evolve lane safer.

Beta 11 order I recommend
Beta 11.1 — Progress Pulse
Add runId to all long tasks.
Add progress.json and events.jsonl.
Add 10-minute chat heartbeat.
Add 15-minute stall detector.
Add HermesProof progress events.
Add smoke harness progress output.
Beta 11.2 — Run Monitor UI
Show current gate/lane/progress.
Show last heartbeat.
Show next expected update.
Show stall/recovery state.
Show latest evidence id.
Beta 11.3 — Conductor Decision Record
Every lane choice records:
  selected lane
  reason
  confidence
  fallback
  required proof
  risk level
Beta 11.4 — Experiment Ledger
Record baseline/candidate/result:
  KEEP
  DISCARD
  CRASH
  BLOCKED
Beta 11.5 — Evolve Lane
Only for measurable tasks.
Must require evaluator.
Must require score improvement.
Must require Aider/Kilo review.
Must require HermesProof evidence.

This keeps Beta 11 from becoming too risky.

What changes for the user

The biggest change is trust.

Instead of:

Kilo went quiet. Is it dead?

The user sees:

Kilo is still running.
Current lane: OpenHands.
Gate: installed VSIX smoke.
Elapsed: 48m.
Passed: 6/10.
Files written: 24.
Last heartbeat: 2m ago.
Next update: within 8m.

Instead of manually stopping tests early, the user can trust:

If Kilo is silent for 15 minutes, it will mark itself stalled and recover/fail with evidence.
If Kilo is active, it will keep giving short progress updates.
One important caution

Do not make progress updates too verbose.

No code dumps.
No raw logs.
No secrets.
No private file contents.
No repeated “still working” spam.

Use concise status:

Still working — Gate 7/10 passed, OpenHands delegate proof running, 51m elapsed, last artifact updated 2m ago. Continuing.
Bottom line

Including tools/external-intelligence later will make Kilo smarter.

But the most important thing you just identified is not Shinka/Fugu/Evolve yet.

It is:

Kilo Progress Pulse + HermesProof Watchdog + Run Monitor

That should be a top Beta 11 feature, and possibly a Beta 10.1/R2 polish patch if it is small enough.

It would make long coding and smoke-test runs feel reliable instead of scary, because the user gets proof of progress every 8–10 minutes and automatic stall detection after 15 minutes.

|====================================================================|

Yes — there are useful pieces, Do not import its code as production logic. Use the idea, but I would not dump these repos directly into KiloCode or HermesProof. The best move is to extract the patterns that help your project and keep them behind optional lanes/gates.

Your Kilo architecture already has the right north star: the user should only need KiloCode, Kilo chooses the correct lane, and HermesProof records what happened. The lane ownership model is also already clear: Kilo owns the user surface/routing, Aider owns scoped repo repair, OpenHands owns sandbox/browser/long-running execution, and HermesProof owns policy/evidence.

What is worth including
1. ShinkaEvolve — high value

This is the most directly useful archive.

ShinkaEvolve is a real framework for program evolution: it keeps a population/archive of candidate programs, has LLMs mutate them, evaluates them, and keeps improvements. Its GitHub README describes it as combining LLMs with evolutionary algorithms for automated exploration and improvement of scientific code, with async evolution, local/Slurm execution, WebUI, local model support, and agentic skills.

For KiloCode, this should become an optional “Evolve/Optimize” lane, not part of the normal edit path.

Best use:

Kilo detects an optimization-style task
→ creates a Shinka task folder
→ writes initial.<ext> + evaluate.py
→ runs shinka_run on VPS or local
→ inspects best candidates
→ Aider reviews the winning patch
→ HermesProof records score, diff, cost, runtime, evidence id

This would be excellent for:

performance optimization
algorithm tuning
prompt/system-prompt evolution
model/provider routing experiments
DaveAI focused improvement loops
smoke-test-driven repairs

HermesProof should record:

{
  "type": "evolution_run",
  "task_id": "...",
  "project_root": "...",
  "evaluator": "evaluate.py",
  "candidate_count": 40,
  "best_score": 0.932,
  "baseline_score": 0.881,
  "accepted": true,
  "diff_path": "...",
  "evidence_id": "ev_*"
}

Include this first.

2. Fugu-main / fugu-user-demo — useful patterns, not vendor code

Fugu itself is relevant because it is a “multi-agent system delivered as one model,” where the user accesses orchestration through one endpoint/API. The Fugu repo describes dynamic orchestration of frontier models and a Codex wrapper install path. Its technical report frames Fugu as an orchestrator family that dynamically creates agentic scaffolds over a team of LLMs.

For your project, Fugu’s best ideas are:

one front door
role-based internal orchestration
automatic model/lane selection
reasoning/evidence tree
fixed install/update/rollback script
benchmark-style result ledgers

KiloCode already has the better local version of this architecture because it has real lanes: Kilo, OpenHands, Aider, Goose, HermesProof, Speech, Indexing, VPS, and RE YOLO. So do not replace Kilo’s lane supervisor with Fugu. Instead, use Fugu as a reference for:

Kilo “Conductor Mode”
Kilo “Thinker / Worker / Verifier” supervisor roles
multi-model critique/review
private provider profile injection
safe installer/update rollback
results.tsv-style experiment ledger

The most useful code pattern from Fugu is the installer/update-channel discipline:

backup config
use managed config markers
validate after edit
rollback on failure
pin tool versions
hide secrets
support dry-run

That maps directly into your private VSIX release/update channel.

Caution: the uploaded fugu-main archive does not include a visible LICENSE file in the zip I inspected, so I would treat it as reference only unless the upstream license is confirmed. Do not vendor chunks directly into KiloCode without a license review.

3. Fugu demo artifacts — useful for benchmark gates

The demos/autoresearch pattern is very useful for Kilo/HermesProof. It uses a repeatable loop with:

train.py
run.log
results.tsv
KEEP / DISCARD / CRASH
fixed wall-clock budget
metric comparison

That is exactly the kind of thing HermesProof should enforce for DaveAI or code-quality experiments.

Add a Kilo/HermesProof gate like:

EXPERIMENT_LEDGER_REQUIRED

A run should not be allowed to claim improvement unless it has:

baseline metric
candidate metric
status KEEP/DISCARD/CRASH
runtime
memory/cost
diff
repro command
evidence id

This would stop “looks better” claims and force measurable progress.

4. Continuous Thought Machines — interesting, but not immediate

CTM is research-heavy PyTorch code. The repo describes CTM as using an internal temporal axis, neuron-level temporal processing, and neural synchronization, with experiments on ImageNet, mazes, sorting, parity, QA-MNIST, and RL tasks.

For KiloCode, I would not include CTM code in the VSIX. It is too heavy and not directly useful for a coding assistant release.

Useful concepts only:

task replay timeline
internal “thinking over time” traces
stuck-loop detection
confidence/settling signals
sequence-of-state visualization

Kilo already added replay timeline and stuck-loop detection concepts in beta 10. CTM can inspire future research UX, but it should stay in an experimental research lane, probably on the VPS, not in the extension.

5. Sakana-Fugu-main — mostly not useful

This one looks like a tiny conceptual/mock implementation: ThinkerAgent, WorkerAgent, VerifierAgent, and a coordinator loop. It is not production-grade compared with your existing Kilo lane supervisor.

Useful idea:

Thinker / Worker / Verifier naming
recursive verify-and-retry loop
simple reasoning tree object

But do not import this into Kilo. Kilo already has a stronger real implementation path through kilo_team, OpenHands, Aider, Goose, and HermesProof.

Also, the README claims MIT in one place, but the actual LICENSE file in the archive is Apache 2.0, so that archive has a documentation/license mismatch. Treat it as reference only.

Best additions to KiloCode

Add these as optional beta.11 / rc-candidate improvements:

1. Kilo Evolve Lane
   Powered by ShinkaEvolve task folders.
   Use only when there is a measurable evaluator.

2. Experiment Ledger
   results.tsv-style ledger for every candidate:
   KEEP / DISCARD / CRASH.

3. Private Update Channel Hardening
   Borrow Fugu-style backup, managed markers, dry-run,
   rollback, version pinning, and install validation.

4. Conductor Mode
   Kilo supervisor decomposes task into:
   thinker / worker / verifier,
   but maps those roles to real lanes:
   Kilo / OpenHands / Aider / Goose / HermesProof.

5. HermesProof Evolution Evidence
   Record evaluator, score, candidate diff, cost, runtime,
   accepted/rejected status, and evidence id.

6. Model/Lane Bandit Routing
   Use Shinka-style cost-aware provider selection:
   MiniMax vs DeepSeek vs OpenHands vs Aider vs Goose,
   based on historical HermesProof outcomes.
Best additions to HermesProof

HermesProof should get these evidence types:

evolution.run.started
evolution.candidate.evaluated
evolution.candidate.accepted
evolution.candidate.rejected
evolution.run.completed
provider.routing.updated
private.update.verified
experiment.ledger.attached

Minimum schema:

{
  "event": "evolution.candidate.evaluated",
  "project_root": "G:/Github/...",
  "task_id": "kilo-evolve-...",
  "candidate_id": "gen12-candidate4",
  "baseline_score": 0.881,
  "candidate_score": 0.932,
  "score_direction": "higher",
  "correct": true,
  "status": "KEEP",
  "runtime_seconds": 214,
  "cost_usd": 0.43,
  "diff_path": "artifacts/evolve/gen12.diff",
  "repro_command": "python evaluate.py --program_path ...",
  "redaction_ok": true
}

This would fit HermesProof better than adding more generic “agent chat.”

What not to include

Do not include these directly into the stable VSIX:

CTM model code
full ShinkaEvolve package
Fugu demo folders
Fugu install scripts that overwrite Codex configs
mock Sakana-Fugu-main coordinator code
large notebooks/assets
research PDFs
raw benchmark logs
anything needing raw provider keys

Keep them as:

docs/reference/
external-lanes/
optional-vps-workers/
research-integration/
Priority order

For your project, the best order is:

1. Add Fugu-style private VSIX update/rollback script.
2. Add HermesProof experiment ledger schema.
3. Add ShinkaEvolve optional “Evolve Lane” on VPS.
4. Add Kilo Conductor Mode mapping thinker/worker/verifier to real lanes.
5. Add provider/lane score learning from HermesProof outcomes.
6. Keep CTM as future research only.
Bottom line

Yes, there is useful material here.

Most valuable: ShinkaEvolve’s evaluator-driven evolution loop and skills.
Second most valuable: Fugu’s one-front-door orchestration and safe install/update patterns.
Useful for proof: Fugu’s benchmark ledger style.
Interesting but not now: CTM.
Mostly skip: the tiny Sakana-Fugu mock repo.

I would include the concepts into KiloCode/HermesProof, not the raw repos.


For Beta 11, I would use exactly those three from kilocode-other.zip:

1. ShinkaEvolve
2. fugu
3. Sakana-Fugu

But with one hard rule:

Use source/patterns/agentic workflows only.
Do not add any paid Sakana/Fugu service.
Do not require new paid APIs.
Do not vendor a giant external runtime into the stable VSIX.
KiloCode remains the controller.
HermesProof remains the proof/policy gate.

This fits your current architecture: the private KiloCode goal is that the user only needs KiloCode, Kilo chooses the lane, and HermesProof records what happened. It also fits your lane model: Kilo Local owns the user surface/routing, Aider owns scoped repo repair, OpenHands owns sandbox/browser/long-running work, and HermesProof owns policy/evidence.

Beta 10 should stay focused on final stable release integrity. The later state already records Beta 10 final work with all 17 gates closed, 134/134 smokes passing, comprehensive smoke exit 0, harness race fixed, and install support. So this belongs in Beta 11, not inside the Beta 10 stabilization path.

Beta 11 Contract
Release: private-kilo-7.4.1-beta.11-intelligence-layer
Codename: Kilo Conductor + Evolve
Scope: source-only, no new paid services, proof-controlled automation
What each source becomes
Source	Use inside KiloCode/HermesProof	Do not use
ShinkaEvolve	Evolve/Optimize lane, evaluator-driven candidate search, experiment ledger, local/VPS worker patterns	Do not require paid model services, do not ship full runtime inside VSIX
fugu	Conductor/orchestration pattern, one-front-door routing, safe installer/update/rollback, benchmark ledger pattern	Do not call Sakana API, do not install hosted Fugu service, do not overwrite user configs
Sakana-Fugu	Thinker / Worker / Verifier role pattern only	Do not treat mock agents as production agents
Master Rule
External intelligence may suggest, evaluate, rank, and compare.

Only Kilo may route work.
Only HermesProof may bless completion.
Only the user may approve destructive, production, billing, deploy, SSH/VPS provisioning, or raw-secret-sensitive actions.

Kilo’s existing release proof loop already says Kilo checks doctor/runtime readiness, routes to Aider for scoped repair or OpenHands for heavy work, records evidence/provider outcome through HermesProof, and only then gives the user a safe summary. Beta 11 should extend that loop, not bypass it.

1. ShinkaEvolve → Kilo Evolve Lane
Purpose

Add a new optional lane:

Kilo Evolve Lane

It should be used only when there is a measurable goal.

Good tasks:

optimize this function
make this faster
reduce latency
reduce token cost
improve benchmark score
try several repair strategies
improve DaveAI acceptance score
tune prompt/provider routing
fix smoke failures by trying candidates
improve retrieval/indexing parameters

Bad tasks:

simple one-file edit
normal chat answer
secret-sensitive work
production deployment
broad unscoped rewrite
UI preference change without measurable test
“make it better” with no evaluator
Kilo routing rule
If task has measurable evaluator:
  Kilo may propose Evolve Lane.

If no evaluator:
  Kilo must use normal Kilo/Aider/OpenHands flow.

If evaluator exists but task is high-risk:
  Kilo must ask HermesProof policy first.

If candidate improves score:
  Aider reviews patch.
  HermesProof records accepted evidence.

If candidate does not improve:
  candidate is discarded.
New Kilo tool
type KiloEvolveAction =
  | "plan"
  | "prepare"
  | "run"
  | "inspect"
  | "accept"
  | "reject"
  | "cleanup"

interface KiloEvolveRequest {
  action: KiloEvolveAction
  projectRoot: string
  taskId?: string
  goal?: string

  evaluatorPath?: string
  evaluatorCommand?: string
  baselineCommand?: string

  candidateBudget?: number
  maxRuntimeMinutes?: number
  maxCostUsd?: number

  allowedFiles?: string[]
  deniedFiles?: string[]

  worktreeMode?: "required" | "preferred" | "disabled"
  executionTarget?: "local" | "vps" | "openhands"
  proofMode?: "advisory" | "enforced" | "strict"

  dryRun?: boolean
}
Kilo output
interface KiloEvolveResult {
  ok: boolean
  taskId: string

  status:
    | "planned"
    | "prepared"
    | "running"
    | "completed"
    | "accepted"
    | "rejected"
    | "blocked"

  baselineScore?: number
  bestScore?: number
  scoreDirection?: "higher" | "lower"
  candidateCount?: number

  acceptedCandidateId?: string
  rejectedCandidateIds?: string[]

  diffPath?: string
  evaluatorPath?: string
  ledgerPath?: string

  evidenceId?: string
  blockerId?: string

  nextRecommendedLane?:
    | "kilo"
    | "aider"
    | "openhands"
    | "goose"
    | "hermesproof"
}
How it should run without paid services

Do not require Shinka’s paid/provider setup. Use it as source/pattern:

1. Kilo writes task folder.
2. Kilo writes initial candidate.
3. Kilo writes evaluate script.
4. Kilo runs local/VPS candidate loops.
5. Existing user-owned providers or local LM Link may be used if already configured.
6. If no provider is available, run dry-run/evaluator-only mode.
7. No new paid endpoint is required.
Folder layout
packages/opencode/src/kilocode/evolve/
  evolve-tool.ts
  evolve-runner.ts
  evaluator-contract.ts
  candidate-ledger.ts
  shinka-source-adapter.ts
  evolve-policy.ts
  evolve-redaction.ts

packages/opencode/test/kilocode/evolve/
  evolve-tool.test.ts
  evaluator-contract.test.ts
  candidate-ledger.test.ts
  evolve-policy.test.ts
Evolve task folder
.kilo/evolve/<task-id>/
  task.json
  baseline/
  candidates/
    gen-001-candidate-001/
    gen-001-candidate-002/
  evaluate.py
  results.jsonl
  results.tsv
  best.diff
  proof.json
HermesProof event for evolve
{
  "event": "evolution.candidate.evaluated",
  "task_id": "kilo-evolve-202607-beta11-001",
  "project_root_hash": "sha256:...",
  "lane": "evolve",
  "candidate_id": "gen-001-candidate-002",
  "baseline_score": 0.81,
  "candidate_score": 0.89,
  "score_direction": "higher",
  "status": "KEEP",
  "runtime_seconds": 183,
  "cost_usd": 0,
  "diff_path": ".kilo/evolve/.../best.diff",
  "evaluator_command": "python evaluate.py",
  "redaction_ok": true,
  "evidence_id": "ev_*"
}
2. fugu → Kilo Conductor Mode
Purpose

Use fugu’s one-front-door orchestration idea without using the paid hosted Fugu service.

Kilo already has the right “one front door” idea: the user stays in KiloCode, while Kilo internally selects Kilo/OpenHands/Aider/Goose/HermesProof. The current architecture also shows the private Kilo UI as chat, Run Mode, Speech tab, Indexing tab, and bundled Kilo/OpenCode core.

Beta 11 adds:

Kilo Conductor Mode

This is not a separate app. It is smarter routing inside Kilo.

Role mapping
Thinker
  Kilo planner/classifier/conductor

Worker
  Kilo Local for small edits
  OpenHands for sandbox/browser/VPS/long-running work
  Aider for scoped repo repair
  Evolve for measurable optimization

Verifier
  HermesProof for evidence/policy
  Goose for read-only MCP/recipe/computer-use proof when proven
  Aider for patch review
  Kilo tests/smokes for local validation
New Kilo tool
type KiloConductorAction =
  | "classify"
  | "route"
  | "supervise"
  | "handoff"
  | "verify"
  | "recover"
  | "explain"

interface KiloConductorRequest {
  action: KiloConductorAction
  projectRoot: string
  taskText: string

  runMode: "manual" | "guided" | "overnight"
  proofMode: "advisory" | "enforced" | "strict"

  dirtyWorkspace: boolean
  availableLanes: LaneHealth[]
  previousFailures: FailureSummary[]

  allowEvolve?: boolean
  allowVps?: boolean
  allowGoose?: boolean

  maxRetries?: number
  timeoutMs?: number
}
Output
interface KiloConductorDecision {
  ok: boolean
  taskId: string

  decision:
    | "use_kilo_local"
    | "use_aider"
    | "use_openhands"
    | "use_goose"
    | "use_evolve"
    | "use_hermesproof"
    | "ask_user"
    | "block"

  reason: string
  confidence: number

  selectedLane:
    | "kilo"
    | "aider"
    | "openhands"
    | "goose"
    | "evolve"
    | "hermesproof"

  fallbackLane?: string
  requiredProof: string[]
  requiresUserApproval: boolean
  hermesPolicyCheckRequired: boolean

  evidenceId?: string
}
Smart switching logic
Kilo receives task
→ classify task
→ check doctor/health
→ ask HermesProof policy when needed
→ score available lanes
→ choose lane
→ execute
→ verify
→ record evidence
→ continue or stop only with proof
Smart switching matrix
Trigger	Automatic route	User approval?	HermesProof required?
Small edit/search/explain	Kilo Local	No	Advisory record
Scoped repo repair	Aider	No if safe files	Yes for outcome
Missing tool/browser/install/long run	OpenHands	Sometimes	Yes
Local Windows/OpenHands failure	VPS OpenHands fallback	No if endpoint already configured	Yes
Optimization with evaluator	Evolve	No for dry-run, yes for write apply	Yes
Patch review	Aider	No	Yes
Read-only external verification	Goose	No if read-only and proven	Yes
SSH/VPS provisioning	OpenHands/VPS	Yes	Yes
Deploy/production/billing/destructive	Ask user	Yes	Yes
Raw secret request	Block	N/A	Yes

The existing auto-mode contract already says Kilo may hand off OpenHands output to Aider, Goose, or HermesProof, but must stop and ask for destructive, production, deploy, secret, broad filesystem, or billing actions. Beta 11 should reuse that rule.

3. Sakana-Fugu → Thinker / Worker / Verifier Pattern
Purpose

Use the role pattern only.

The mock source has:

ThinkerAgent
WorkerAgent
VerifierAgent
Coordinator
reasoning_tree
max_retries
recursive self-correction

Useful for Kilo, but only as a design pattern.

Kilo implementation
Thinker = Kilo conductor
Worker = selected execution lane
Verifier = HermesProof + Aider/Goose/test runner
Kilo trace object
interface KiloReasoningTree {
  taskId: string
  steps: Array<{
    role: "thinker" | "worker" | "verifier"
    lane: "kilo" | "openhands" | "aider" | "goose" | "evolve" | "hermesproof"
    summary: string
    artifactPath?: string
    evidenceId?: string
    status: "ok" | "failed" | "blocked" | "needs_retry"
  }>
  finalStatus: "completed" | "blocked" | "failed"
}
Rule
The reasoning tree is not chain-of-thought.
It is a safe operational trace:
  what lane was selected,
  why,
  what artifact was produced,
  what proof id exists,
  what happened next.
HermesProof Additions

HermesProof already has Kilo-facing tools for status, guardrails, policy checks, progress checkpoints, delegation records, agent-bus events, infrastructure proof, provider outcomes, appending evidence, and verifying evidence. Beta 11 should add evidence types, not a separate proof system.

New HermesProof event families
evolution.run.started
evolution.baseline.measured
evolution.candidate.generated
evolution.candidate.evaluated
evolution.candidate.accepted
evolution.candidate.rejected
evolution.run.completed

conductor.decision.made
conductor.switch.executed
conductor.switch.rejected
conductor.recovery.started
conductor.recovery.completed

experiment.ledger.attached
experiment.baseline.measured
experiment.result.compared

provider.score.updated
lane.score.updated

private.update.plan.created
private.update.backup.created
private.update.verified
private.update.rollback.started
private.update.rollback.completed
HermesProof policy checks

Add these policy IDs:

evolution.requires_evaluator
evolution.requires_baseline
evolution.accept_requires_score_improvement
evolution.accept_requires_diff
evolution.accept_requires_review
evolution.accept_requires_redaction

conductor.switch_requires_reason
conductor.switch_requires_lane_health
conductor.switch_requires_fallback
conductor.switch_blocks_unhealthy_lane
conductor.switch_blocks_unproven_goose_write

update.requires_backup
update.requires_hash
update.requires_install_verification
update.requires_rollback_plan

completion.requires_evidence_id
completion.blocks_fake_done
HermesProof acceptance rules
A Kilo Evolve candidate may be accepted only if:
  evaluator exists
  baseline score exists
  candidate score exists
  candidate beats baseline in the declared direction
  candidate has diff/artifact
  candidate is scoped to allowed files
  redaction passed
  Aider or Kilo review passed
  HermesProof evidence id exists
A Conductor lane switch may be automatic only if:
  selected lane is healthy
  task fits lane ownership
  risk is low or medium
  fallback is known
  no destructive/production/secret/deploy action is required
  reason is recorded
  HermesProof event is recorded
A release/completion claim may be made only if:
  all required gates passed
  release-truth is current
  ci-blockers has no release blockers
  final VSIX/source/hash/tag match
  evidence id exists

The action plan already says done-level proof such as smoke_passed, e2e_passed, and release_ready cannot be claimed without a HermesProof ev_* id.

KiloCode Additions
New internal modules
packages/opencode/src/kilocode/conductor/
  conductor.ts
  conductor-types.ts
  lane-score.ts
  switch-policy.ts
  task-classifier.ts
  decision-explainer.ts
  thinker-worker-verifier.ts

packages/opencode/src/kilocode/evolve/
  evolve-tool.ts
  evolve-runner.ts
  evaluator-contract.ts
  candidate-ledger.ts
  shinka-source-adapter.ts
  evolve-policy.ts

packages/opencode/src/kilocode/experiment/
  experiment-ledger.ts
  result-comparator.ts
  provider-score-memory.ts
  lane-score-memory.ts

packages/opencode/src/kilocode/update/
  private-update-plan.ts
  private-update-rollback.ts
  release-manifest.ts
New Kilo tools
kilo_conductor
kilo_evolve
kilo_experiment
kilo_lane_score
kilo_private_update
Tool registry entries
{
  name: "kilo_conductor",
  description: "Classify a task, select a lane, explain the decision, and record HermesProof routing evidence."
}
{
  name: "kilo_evolve",
  description: "Run evaluator-driven candidate improvement in an isolated worktree or VPS worker. Requires measurable evaluator."
}
{
  name: "kilo_experiment",
  description: "Create, append, inspect, and verify experiment ledger records with KEEP/DISCARD/CRASH outcomes."
}
{
  name: "kilo_lane_score",
  description: "Show lane health, task-fit score, recent success, cost, latency, and proof strength."
}
{
  name: "kilo_private_update",
  description: "Plan, install, verify, and roll back private VSIX updates with HermesProof evidence."
}
Smart Lane Score
Score object
interface LaneScore {
  lane: "kilo" | "openhands" | "aider" | "goose" | "evolve" | "hermesproof"

  health: number
  taskFit: number
  recentSuccessRate: number
  recentFailurePenalty: number
  averageLatencyMs: number
  averageCostUsd: number
  proofStrength: number
  isolationScore: number
  riskPenalty: number

  finalScore: number
  reasons: string[]
}
First formula
finalScore =
  taskFit * 0.30
+ health * 0.20
+ recentSuccessRate * 0.15
+ proofStrength * 0.15
+ isolationScore * 0.10
- riskPenalty * 0.15
- recentFailurePenalty * 0.10
- normalizedLatency * 0.05
- normalizedCost * 0.05
Default lane fit
Kilo Local:
  high fit for local edits, explanations, search, small refactors

Aider:
  high fit for repo-local patch, lint/test repair, diff review

OpenHands:
  high fit for browser, sandbox, terminal, install, long-running, missing tool, VPS

Goose:
  high fit for read-only proof, MCP/recipe verification, computer-use only after repeated proof

Evolve:
  high fit only if evaluator exists and measurable improvement is requested

HermesProof:
  always required for policy, evidence, release truth, blockers
Automation Modes
Manual
Kilo recommends lane.
User approves.
HermesProof records.
Guided
Kilo can automatically use safe lanes:
  Kilo Local
  Aider scoped repair
  HermesProof
  read-only Goose if proven
  local OpenHands non-destructive sandbox

Kilo asks before:
  VPS provisioning
  SSH repair
  install
  deploy
  destructive changes
  production changes
  billing-affecting actions
Overnight
Kilo can keep lanes busy under bounded rules:
  Kilo Local
  Aider
  OpenHands local/VPS sidecar
  Evolve dry-run/isolated run
  Goose read-only
  HermesProof

But it must stop for:
  raw secrets
  production deploy
  destructive actions
  billing actions
  unknown high-risk actions

The existing lane scheduler already aims to keep lanes busy through isolated worker slots, block risky write work without isolation, serialize overlapping edits through Kilo, and clean up disposable workers only after proof. Beta 11 should plug Evolve/Conductor into that scheduler.

No-Paid-Service Rule
Must not add
SAKANA_API_KEY requirement
hosted Fugu API requirement
paid Fugu endpoint
new Codex subscription requirement
new Claude subscription requirement
new OpenAI-only dependency
new cloud runner dependency
new non-user-owned service
Allowed
source patterns
local scripts
local/VPS Python code
user-owned VPS runner
existing Kilo providers already configured
LM Studio LM Link
existing MiniMax/DeepSeek/etc if already part of user's environment
dry-run mode
local evaluator mode
benchmark ledger mode
If source references paid APIs

Adapt the pattern, not the dependency.

Example:

Shinka source says: use model strings / hosted APIs.
Kilo Beta 11 does: use existing Kilo provider router or local LM Link.

Fugu source says: install config for Fugu API.
Kilo Beta 11 does: use backup/rollback/config markers pattern only.
Source Placement Contract
Put raw reference bundle here
external-research/kilocode-other/
  Readme.md
  ShinkaEvolve/
  fugu/
  Sakana-Fugu/
Add manifest
{
  "bundle": "kilocode-other",
  "status": "reference-only",
  "beta_target": "beta.11-intelligence-layer",
  "paid_services_allowed": false,
  "ship_raw_code_in_vsix": false,
  "accepted_patterns": [
    "evolve-lane",
    "conductor-mode",
    "experiment-ledger",
    "thinker-worker-verifier",
    "safe-update-rollback",
    "candidate-score-memory"
  ],
  "blocked_patterns": [
    "hosted-fugu-api",
    "sakana-api-key-required",
    "raw-provider-secrets",
    "unreviewed-installer-overwrites",
    "direct-production-deploy",
    "raw-code-vendoring-into-vsix"
  ]
}
Add docs
docs/beta11-external-intelligence-contract.md
docs/beta11-kilo-evolve-lane.md
docs/beta11-conductor-mode.md
docs/beta11-experiment-ledger.md
docs/beta11-smart-switching.md
docs/reference/shinka-evolve-patterns.md
docs/reference/fugu-source-patterns.md
docs/reference/sakana-fugu-role-patterns.md
Private Update / Rollback Pattern From fugu

This is one of the most useful non-agentic parts.

Add Kilo private update contract
private update must:
  hash current VSIX
  back up current VSIX
  install new VSIX
  verify extension id/version
  verify command surface
  run smoke
  rollback if smoke fails
  record HermesProof evidence
New command
bin\install-private-vsix-safe.ps1 `
  -Vsix "path\to\private-kilo.vsix" `
  -ExpectedSha256 "..." `
  -RollbackOnFail `
  -RecordHermesProof
Update event
{
  "event": "private.update.verified",
  "old_vsix_sha": "sha256:...",
  "new_vsix_sha": "sha256:...",
  "extension_id": "privatekilocode.kilo-code-private",
  "version": "7.4.1",
  "install_exit_code": 0,
  "smoke_ok": true,
  "rollback_available": true,
  "evidence_id": "ev_*"
}

This maps to your existing need to keep the Marketplace extension from replacing or confusing the private build.

Experiment Ledger
Why

This is how Kilo stops guessing.

Every optimization, model comparison, provider switch, lane switch, repair loop, or DaveAI improvement should produce:

baseline
candidate
metric
status
artifact
evidence
Ledger row
interface ExperimentLedgerRow {
  runId: string
  taskId: string
  projectRootHash: string

  lane: "kilo" | "openhands" | "aider" | "goose" | "evolve"
  provider?: string
  model?: string

  baselineCommand?: string
  candidateCommand?: string

  baselineScore?: number
  candidateScore?: number
  scoreDirection?: "higher" | "lower"

  status: "KEEP" | "DISCARD" | "CRASH" | "BLOCKED"

  runtimeSeconds: number
  costUsd: number

  diffPath?: string
  artifactPath?: string
  logPath?: string

  evidenceId: string
  redactionOk: boolean
}
File outputs
.kilo/experiments/<project>/<task-id>/
  ledger.jsonl
  ledger.tsv
  baseline.json
  best.json
  blockers.json
  proof.json
Beta 11 UI Additions

Do not add fake buttons. Add UI only where there is a real path.

Kilo UI
Conductor panel
  current lane
  reason
  confidence
  fallback lane
  required proof

Evolve panel
  baseline score
  best score
  candidate count
  status KEEP/DISCARD/CRASH
  accepted diff

Experiment ledger
  searchable table
  filter by project/lane/status/evidence

Lane score panel
  why Kilo chose OpenHands/Aider/Goose/Evolve

Proof timeline
  HermesProof evidence ids per lane

Smart switch toggle
  Manual / Guided / Overnight

The existing lane UI design already expects compact lane controls, Auto depth, Proof mode, Worktree mode, Transcript, and Voice lane, while preserving project root/dirty-workspace/edit capability visibility. Beta 11 can extend that surface.

Beta 11 Acceptance Gates
Gate 11.1 — Reference Import Gate

Pass condition:

kilocode-other bundle recorded as reference-only
no raw external code in VSIX
license notes recorded
paid services disabled
accepted patterns listed
Gate 11.2 — HermesProof Schema Gate

Pass condition:

new event types validate
invalid evolution claim rejected
candidate without evaluator rejected
lane switch without reason rejected
completion without ev_* rejected
Gate 11.3 — Experiment Ledger Gate

Pass condition:

baseline measured
candidate measured
KEEP/DISCARD/CRASH recorded
ledger.jsonl written
HermesProof evidence emitted
Gate 11.4 — Evolve Dry-Run Gate

Pass condition:

Kilo creates evolve task
evaluator required
no evaluator = blocked
fake improvement = rejected
no files changed outside isolated task folder
Gate 11.5 — Evolve Real Fixture Gate

Pass condition:

tiny fixture has measurable target
candidate improves metric
Aider reviews patch
HermesProof accepts evidence
diff is scoped
Gate 11.6 — Conductor Gate

Pass condition:

Kilo explains lane choice
decision includes reason/confidence/fallback
high-risk action asks user
HermesProof records conductor.decision.made
Gate 11.7 — Smart Switch Gate

Pass condition:

OpenHands local failure triggers VPS fallback if configured
Aider receives patch review after OpenHands work
Goose remains read-only unless proven
HermesProof records each switch
Gate 11.8 — Provider/Lane Score Memory Gate

Pass condition:

lane outcome updates score
future decision can cite prior score
no secret/provider key in memory
cost/latency/success stored safely
Gate 11.9 — DaveAI Measured Improvement Gate

Pass condition:

DaveAI task has baseline
candidate improves 14-row acceptance table or equivalent metric
build/test/browser proof exists
HermesProof evidence exists
no useful sections deleted
Gate 11.10 — Private Update Rollback Gate

Pass condition:

backup created
new VSIX installed
hash verified
smoke run
rollback works if smoke fails
HermesProof records update/rollback evidence
Release Blockers For Beta 11

Beta 11 must fail if:

1. Evolve accepts candidate without evaluator.
2. Candidate improves nothing but is marked KEEP.
3. Kilo switches lanes without reason.
4. HermesProof does not record the switch.
5. Raw external paid-service API is required.
6. Any secret/private path leaks into logs, speech, docs, or evidence.
7. Any raw external repo code ships in VSIX without review.
8. Fugu installer overwrites user config.
9. Smart switching routes to Goose write-mode automatically.
10. Destructive/production/VPS provisioning happens without user approval.
11. “Done” is claimed without ev_* evidence.
12. Dirty worktree is called release-ready without expected-diff manifest.
What is possible after this

If Beta 11 implements this contract, KiloCode becomes much smarter in these ways:

1. It stops guessing

Instead of:

try random fixes until something works

Kilo can do:

classify → choose lane → run candidate → measure → record → accept/reject
2. It can optimize, not just edit

Kilo can improve:

performance
latency
prompt quality
provider routing
smoke pass rate
DaveAI acceptance score
indexing settings
tool selection
3. It can keep lanes busy safely

Kilo can run:

OpenHands = execution
Aider = review/repair
Goose = read-only verification
Evolve = candidate search
HermesProof = policy/evidence

without letting them overwrite each other.

4. It can learn what works

Provider/lane score memory can track:

which lane solved this type of task
which provider was fastest
which provider failed
which lane produced evidence
which path cost too much
which fallback worked
5. It can self-recover better

If OpenHands local fails:

try local healthy sidecar
try configured VPS sidecar
classify blocker
record evidence
do not hide behind Goose

If Aider fails:

record repo-map/lint/test failure
try Kilo local or OpenHands depending on blocker

If Goose times out:

demote Goose for that task type
record provider/lane failure
avoid automatic Goose routing until proof improves
6. It can safely improve DaveAI

For DaveAI:

baseline site
identify duplicate/unfinished sections
index source
run candidate improvements
test/build/browser verify
compare acceptance score
record proof
apply only accepted patch
Immediate Beta 11 Implementation Order

Do this after Beta 10/R2 is finalized:

1. Add docs/reference for kilocode-other.
2. Add HermesProof evidence schemas.
3. Add experiment ledger library.
4. Add conductor decision object and policy tests.
5. Add Evolve dry-run adapter.
6. Add Evolve fixture smoke.
7. Add Kilo UI status panels only after backend proof.
8. Add smart switching in advisory mode only.
9. Move to enforced mode after smokes pass.
10. Run DaveAI measured improvement gate.
First safe commit
docs(beta11): add external intelligence contract and source-only rules
Second safe commit
feat(hermesproof): add evolution/conductor evidence schemas
Third safe commit
feat(kilo): add experiment ledger and conductor decision dry-run
Fourth safe commit
feat(kilo): add evolve lane dry-run with evaluator requirement
Fifth safe commit
test(beta11): prove smart switching stays HermesProof-controlled
Bottom line

Yes — use the three-source bundle for Beta 11.

ShinkaEvolve = Evolve / Optimize Lane
fugu = Conductor / update / experiment-ledger reference
Sakana-Fugu = Thinker / Worker / Verifier role pattern

Use source and patterns only, with no new paid services. The automation should be real, but controlled:

Kilo decides.
HermesProof verifies.
External patterns assist.
No lane bypasses proof.
No “done” without evidence.
No paid-service dependency.
No raw secrets.
No raw external repo dumping into the VSIX.

This can make KiloCode much more powerful in Beta 11: smarter routing, measurable optimization, proof-backed experiments, safe automatic switching, and better long-running problem solving without losing the single-tool user experience.

Yes — the combined kilocode-other.zip is the right reduced bundle from the research zips.

I would use the three included references, but not all in the same way:

1. ShinkaEvolve
   Use as the real future “Evolve / Optimize” lane pattern.

2. Fugu
   Use as orchestration / conductor / update-channel / experiment-ledger reference.

3. Sakana-Fugu
   Use only as a lightweight conceptual reference for Thinker / Worker / Verifier style coordination.

I would not directly vendor these into the stable VSIX. They should become a reference/integration package for KiloCode and HermesProof.

Your Kilo architecture already has the correct base: the user should only need KiloCode, Kilo chooses the lane, and HermesProof records what happened. The lane model is already clear: Kilo Local owns the user surface, Aider owns scoped repo repair, OpenHands owns sandbox/browser/long-running work, and HermesProof owns policy/evidence.

How I would include them
1. ShinkaEvolve → Kilo Evolve Lane

This is the most useful one.

Use it for:

performance optimization
algorithm tuning
prompt evolution
provider/lane routing experiments
DaveAI improvement loops
smoke-test-driven repair attempts

Kilo flow:

Kilo detects “optimize / improve score / tune / benchmark”
→ creates an evolve task
→ writes baseline + evaluator
→ runs candidates locally or on VPS
→ keeps best candidate only if score improves
→ Aider reviews the patch
→ HermesProof records score/diff/evidence

HermesProof event:

{
  "event": "evolution.candidate.accepted",
  "lane": "shinka-evolve",
  "baseline_score": 0.81,
  "candidate_score": 0.89,
  "status": "KEEP",
  "diff_path": "artifacts/evolve/best.diff",
  "evidence_id": "ev_*"
}

This should be added after Beta 10/R2 is clean, not before.

2. Fugu → Conductor / Experiment Ledger / Update Discipline

Use Fugu as a design reference, not as replacement for Kilo’s lane supervisor.

Kilo already has the better architecture for your system because it has real tools:

Kilo
OpenHands
Aider
Goose
HermesProof
Speech
Indexing
VPS runner
RE YOLO

But Fugu’s useful patterns are:

one front door
internal role orchestration
model/lane selection
result comparison
experiment ledgers
safe config install/update/rollback

This maps nicely to:

Kilo Conductor Mode
private VSIX update channel
HermesProof experiment ledger
provider-routing score history

Best concrete addition:

docs/research/external-orchestration/fugu-patterns.md

Then later:

packages/opencode/src/kilocode/evidence/experiment-ledger.ts
packages/opencode/src/kilocode/lane-conductor.ts
3. Sakana-Fugu → Thinker / Worker / Verifier pattern only

Use this lightly.

Do not import its code as production logic. Use the idea:

Thinker = Kilo planner / classifier
Worker = OpenHands or Aider
Verifier = Goose or HermesProof

That can become a Kilo supervisor mode:

kilo_team action=supervise mode=conductor

But it must still map to your real lanes. It should never become a separate magic agent that bypasses HermesProof.

Where this should live

Put the combined bundle under a research/reference area, not inside the shipped extension:

docs/research/external-systems/kilocode-other.md
docs/research/external-systems/shinka-evolve.md
docs/research/external-systems/fugu-patterns.md
docs/research/external-systems/sakana-fugu-notes.md
external-research/kilocode-other/

Then add a small manifest:

{
  "bundle": "kilocode-other",
  "status": "reference-only",
  "use_in_stable_vsix": false,
  "accepted_patterns": [
    "evolve-lane",
    "experiment-ledger",
    "conductor-mode",
    "safe-update-rollback",
    "thinker-worker-verifier"
  ],
  "blocked_from_vendor_import": [
    "raw Fugu scripts",
    "CTM model code",
    "desktop/client claims",
    "unlicensed or conflicting code"
  ]
}
What not to include now

Do not include these in the Beta 10 final artifact:

CTM model code
full Fugu codebase
full ShinkaEvolve runtime
desktop Fugu mock/client code
large benchmark artifacts
research PDFs
raw demos
provider configs
anything that writes over user configs

Those would make Kilo bigger, riskier, and harder to stabilize.

Best use inside HermesProof

HermesProof should get an experiment/evolution proof schema:

experiment.started
experiment.candidate.evaluated
experiment.candidate.accepted
experiment.candidate.rejected
experiment.completed
evolution.run.completed
provider.route.updated
private.update.verified

This would make future optimization work evidence-based instead of vibes-based.

Best use inside KiloCode

Add later as optional Beta 11 / post-R2 capabilities:

Kilo Evolve Lane
Kilo Conductor Mode
Experiment Ledger
Private Update Rollback
Provider/Lane Score Memory

But for Beta 10 R2/final, keep focus on:

VSIX/source match
deep verifier pass
clean tree
OpenHands/Aider/Goose visible commands present
private GUI features present
release-truth regenerated against final commit
Bottom line

Yes — use the three-reference bundle:

ShinkaEvolve = real future Evolve/Optimize lane
Fugu = orchestration/update/ledger reference
Sakana-Fugu = lightweight Thinker/Worker/Verifier concept

But keep them as research-backed patterns, not shipped code. The immediate stable KiloCode release should stay clean, small, and proven.
