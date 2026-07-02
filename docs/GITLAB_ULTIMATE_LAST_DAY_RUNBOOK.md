# GitLab Ultimate Last-Day Runbook

Date: 2026-07-02

Purpose: capture the highest-value GitLab Ultimate controls for AICE/AI-CE, HermesProof, and related reachable projects before the Ultimate license window closes.

## Priority order

1. Prove GitLab auth without leaking secrets:

```json
{
  "tool": "hermes_gitlab_status",
  "arguments": { "probe": true, "includeIdentity": false }
}
```

2. For each project, inspect current governance:

```json
{
  "tool": "hermes_gitlab_ultimate_status",
  "arguments": {
    "projectFullPath": "Ghenghis/HermesProof",
    "defaultBranch": "main"
  }
}
```

3. Bootstrap Ultimate governance while the license is active:

```json
{
  "tool": "hermes_gitlab_bootstrap_ultimate",
  "arguments": {
    "owner": "codex-impl-01",
    "projectFullPath": "Ghenghis/HermesProof",
    "defaultBranch": "main",
    "codeOwnerRefs": ["@Ghenghis"],
    "commitReleaseFiles": true,
    "createGovernanceMergeRequest": true,
    "dryRun": false
  }
}
```

Repeat for likely project paths:

```text
Ghenghis/HermesProof
Ghenghis/AI-CE
Ghenghis/AICE
```

If one path returns missing project/not found, try the next known namespace/project spelling. Do not invent success; record the exact missing path as blocked.

## What the bootstrap attempts

- Require successful pipelines before merge.
- Require all discussions resolved before merge.
- Require all status checks when the GitLab tier supports it.
- Enable merge pipelines and merge trains when the GitLab tier supports them.
- Protect the default branch.
- Disable direct pushes to the protected branch.
- Require CODEOWNER approval on the protected branch.
- Reset approvals on push.
- Disable per-MR approval-rule overrides.
- Prevent author/committer self-approval where supported.
- Commit `CODEOWNERS`.
- Commit `.gitlab/hermesproof-ultimate.yml` with SAST, secret detection, dependency scanning, Advanced SAST, and HermesProof truth-gate artifacts.
- Create `.gitlab-ci.yml` only when the project does not already have one; existing root CI files are preserved and must be wired to the include file by review.
- Commit a security policy template under `docs/gitlab/security-policy-template.yml`.
- Open a governance merge request.

## Proof to save

For each project, save:

- `hermes_gitlab_status` result: authenticated or exact blocker.
- `hermes_gitlab_ultimate_status` before and after.
- `hermes_gitlab_bootstrap_ultimate` evidence id.
- Governance MR URL if created.
- GitLab pipeline URL if a pipeline starts.
- Any GitLab API step that failed because the license, permissions, or project path blocked it.

## If auth is missing

Do not continue pretending. The correct state is:

```text
blocked: GitLab token not available in launching environment
needed: GITLAB_TOKEN or GLAB_TOKEN with Maintainer/Owner access to target projects
```

HermesProof must not print token values, private env-file paths, or private file contents.
