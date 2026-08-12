# Optional GitLab security bootstrap

HermesProof keeps its product truth gates and release proof in the root
`.gitlab-ci.yml`. The security template in
`.gitlab/hermesproof-ultimate.yml` is **not included automatically**.

This preserves the governance work from the earlier
`hermesproof/gitlab-ultimate-governance-2026-07-02` branch without silently
spending shared-runner minutes or weakening the isolated-runner policy.

## Enable deliberately

1. Configure an isolated, compatible Docker or GitLab SaaS runner.
2. Confirm the project's compute-minute budget and protected-variable policy.
3. Review the current GitLab SAST, secret-detection, and dependency-scanning
   templates for the project's GitLab tier.
4. Add an explicit `include: local: .gitlab/hermesproof-ultimate.yml` to the
   root pipeline in a dedicated merge request.
5. Require the CODEOWNERS approval and verify the resulting pipeline before
   merging.

The repository-level `CODEOWNERS` file protects source, scripts, policies,
proof, release configuration, and GitLab configuration for future merge
requests. GitLab evaluates Code Owner rules from the target branch, so merge
this governance baseline before relying on it for later reviews.
