# HermesProof GitLab Ultimate Bootstrap
HermesProof generated this governance branch to capture high-value GitLab Ultimate controls before the license window closes.
## Included
- `CODEOWNERS` for code-owner review coverage.
- `.gitlab/hermesproof-ultimate.yml` with SAST, secret detection, dependency scanning, and HermesProof truth-gate jobs.
- `docs/gitlab/security-policy-template.yml` as a reusable security policy template.
- Existing `.gitlab-ci.yml` content was left untouched. Review the include file and wire it into the project pipeline deliberately.
## Next Review
1. Confirm CODEOWNER refs are correct for this project.
2. Confirm the truth-gate job matches the repo runtime before merging.
3. Link or copy the security policy template into a GitLab Security Policy Project while Ultimate is active.
4. Target project: `Ghenghis/HermesProof`.