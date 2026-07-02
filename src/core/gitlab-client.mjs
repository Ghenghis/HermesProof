const DEFAULT_GITLAB_BASE_URL = "https://gitlab.com";
const HERMESPROOF_CI_INCLUDE_PATH = ".gitlab/hermesproof-ultimate.yml";

export class GitLabHttpError extends Error {
  constructor(message, { status = 0, code = "gitlab_http_error", body = null } = {}) {
    super(message);
    this.name = "GitLabHttpError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export function resolveGitLabConfig({ env = process.env } = {}) {
  const tokenSource = env.GITLAB_TOKEN ? "GITLAB_TOKEN" : env.GLAB_TOKEN ? "GLAB_TOKEN" : null;
  const baseUrl = (env.GITLAB_BASE_URL || env.GITLAB_URL || DEFAULT_GITLAB_BASE_URL).replace(/\/+$/, "");
  return {
    ok: Boolean(tokenSource),
    base_url: baseUrl,
    token_source: tokenSource,
    token: tokenSource ? env[tokenSource] : null
  };
}

function encodePath(value) {
  return encodeURIComponent(String(value || "").replace(/^\/+|\/+$/g, ""));
}

function sanitizeErrorMessage(error) {
  return String(error?.message || error || "unknown GitLab error").replace(/PRIVATE-TOKEN=[^&\s]+/gi, "PRIVATE-TOKEN=<redacted>");
}

function projectSummary(project) {
  if (!project) return null;
  const summary = {
    id: project.id,
    path: project.path,
    path_with_namespace: project.path_with_namespace,
    visibility: project.visibility,
    web_url: project.web_url,
    http_url_to_repo: project.http_url_to_repo,
    ssh_url_to_repo: project.ssh_url_to_repo,
    default_branch: project.default_branch || null
  };
  const settingsKeys = [
    "only_allow_merge_if_pipeline_succeeds",
    "allow_merge_on_skipped_pipeline",
    "only_allow_merge_if_all_discussions_are_resolved",
    "only_allow_merge_if_all_status_checks_passed",
    "remove_source_branch_after_merge",
    "merge_method",
    "squash_option",
    "merge_pipelines_enabled",
    "merge_trains_enabled",
    "merge_trains_skip_train_allowed",
    "max_pipelines_per_merge_train",
    "security_and_compliance_access_level",
    "builds_access_level",
    "merge_requests_access_level",
    "ci_config_path",
    "protect_merge_request_pipelines",
    "ci_pipeline_variables_minimum_override_role",
    "reviewer_assignment_strategy",
    "secret_push_protection_enabled",
    "pre_receive_secret_detection_enabled"
  ];
  const settings = {};
  for (const key of settingsKeys) {
    if (Object.prototype.hasOwnProperty.call(project, key)) settings[key] = project[key];
  }
  if (Object.keys(settings).length) summary.settings = settings;
  return summary;
}

function mergeRequestSummary(mr) {
  if (!mr) return null;
  return {
    id: mr.id,
    iid: mr.iid,
    project_id: mr.project_id,
    title: mr.title,
    state: mr.state,
    draft: Boolean(mr.draft || mr.work_in_progress),
    source_branch: mr.source_branch,
    target_branch: mr.target_branch,
    web_url: mr.web_url,
    merge_status: mr.merge_status || null,
    detailed_merge_status: mr.detailed_merge_status || null,
    pipeline: mr.pipeline
      ? {
          id: mr.pipeline.id,
          status: mr.pipeline.status,
          web_url: mr.pipeline.web_url || null
        }
      : null
  };
}

function protectedBranchSummary(branch) {
  if (!branch) return null;
  return {
    id: branch.id,
    name: branch.name,
    allow_force_push: Boolean(branch.allow_force_push),
    code_owner_approval_required: Boolean(branch.code_owner_approval_required),
    push_access_levels: branch.push_access_levels || [],
    merge_access_levels: branch.merge_access_levels || [],
    unprotect_access_levels: branch.unprotect_access_levels || []
  };
}

function approvalRuleSummary(rule) {
  if (!rule) return null;
  return {
    id: rule.id,
    name: rule.name,
    rule_type: rule.rule_type || null,
    approvals_required: rule.approvals_required,
    applies_to_all_protected_branches: Boolean(rule.applies_to_all_protected_branches),
    protected_branches: Array.isArray(rule.protected_branches)
      ? rule.protected_branches.map((branch) => ({ id: branch.id, name: branch.name }))
      : [],
    eligible_approver_count: Array.isArray(rule.eligible_approvers) ? rule.eligible_approvers.length : 0,
    contains_hidden_groups: Boolean(rule.contains_hidden_groups)
  };
}

function approvalConfigSummary(config) {
  if (!config) return null;
  return {
    reset_approvals_on_push: Boolean(config.reset_approvals_on_push),
    selective_code_owner_removals: Boolean(config.selective_code_owner_removals),
    disable_overriding_approvers_per_merge_request: Boolean(config.disable_overriding_approvers_per_merge_request),
    merge_requests_author_approval: Boolean(config.merge_requests_author_approval),
    merge_requests_disable_committers_approval: Boolean(config.merge_requests_disable_committers_approval),
    require_reauthentication_to_approve: Boolean(config.require_reauthentication_to_approve || config.require_password_to_approve)
  };
}

function commitSummary(commit) {
  if (!commit) return null;
  return {
    id: commit.id,
    short_id: commit.short_id,
    title: commit.title,
    web_url: commit.web_url || null,
    committed_date: commit.committed_date || null
  };
}

function uniqueList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function defaultCodeOwnersContent(codeOwnerRefs = []) {
  const owners = uniqueList(codeOwnerRefs).length ? uniqueList(codeOwnerRefs).join(" ") : "@Ghenghis";
  return [
    "# CODEOWNERS managed by HermesProof",
    "# Keep this file on the default branch before opening release merge requests.",
    "",
    `* ${owners}`,
    `/src/ ${owners}`,
    `/scripts/ ${owners}`,
    `/docs/ ${owners}`,
    `/.gitlab-ci.yml ${owners}`,
    `/CODEOWNERS ${owners}`,
    `/PROOF/ ${owners}`,
    ""
  ].join("\n");
}

function defaultGitLabCiIncludeContent() {
  return [
    "# GitLab CI include managed by HermesProof",
    "# Include this file from .gitlab-ci.yml after reviewing project-specific pipeline stages.",
    "include:",
    "  - template: Jobs/SAST.gitlab-ci.yml",
    "  - template: Jobs/Secret-Detection.gitlab-ci.yml",
    "  - template: Jobs/Dependency-Scanning.gitlab-ci.yml",
    "",
    "stages:",
    "  - test",
    "  - security",
    "",
    "variables:",
    "  GITLAB_ADVANCED_SAST_ENABLED: \"true\"",
    "  AST_ENABLE_MR_PIPELINES: \"true\"",
    "",
    "truth_gates:",
    "  stage: test",
    "  image: node:22-bookworm",
    "  rules:",
    "    - if: '$CI_PIPELINE_SOURCE == \"merge_request_event\"'",
    "    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'",
    "  before_script:",
    "    - npm ci || npm install",
    "  script:",
    "    - node scripts/truth-gates.mjs --ci",
    "  artifacts:",
    "    when: always",
    "    expire_in: 30 days",
    "    paths:",
    "      - PROOF/latest.json",
    "      - PROOF_E2E_REPORT.md",
    "      - PROOF/sbom.json",
    "    reports:",
    "      cyclonedx: PROOF/sbom.json",
    ""
  ].join("\n");
}

function defaultGitLabCiRootContent() {
  return [
    "# GitLab CI managed by HermesProof",
    "include:",
    `  - local: ${HERMESPROOF_CI_INCLUDE_PATH}`,
    ""
  ].join("\n");
}

function defaultUltimateBootstrapDocsContent({ projectFullPath = "", rootCiCreated = false } = {}) {
  return [
    "# HermesProof GitLab Ultimate Bootstrap",
    "",
    "HermesProof generated this governance branch to capture high-value GitLab Ultimate controls before the license window closes.",
    "",
    "## Included",
    "",
    "- `CODEOWNERS` for code-owner review coverage.",
    `- \`${HERMESPROOF_CI_INCLUDE_PATH}\` with SAST, secret detection, dependency scanning, and HermesProof truth-gate jobs.`,
    "- `docs/gitlab/security-policy-template.yml` as a reusable security policy template.",
    rootCiCreated
      ? "- `.gitlab-ci.yml` was created because the project did not already have a root GitLab CI file."
      : "- Existing `.gitlab-ci.yml` content was left untouched. Review the include file and wire it into the project pipeline deliberately.",
    "",
    "## Next Review",
    "",
    "1. Confirm CODEOWNER refs are correct for this project.",
    "2. Confirm the truth-gate job matches the repo runtime before merging.",
    "3. Link or copy the security policy template into a GitLab Security Policy Project while Ultimate is active.",
    projectFullPath ? `4. Target project: \`${projectFullPath}\`.` : "",
    ""
  ].filter((line) => line !== "").join("\n");
}

function defaultSecurityPolicyTemplate(projectFullPath = "") {
  return [
    "# GitLab security policy template captured by HermesProof",
    "# Link this file from a GitLab Security Policy Project while Ultimate is active.",
    "scan_execution_policy:",
    "  - name: HermesProof required MR scans",
    "    description: Run SAST, secret detection, and dependency scanning on merge requests.",
    "    enabled: true",
    "    rules:",
    "      - type: pipeline",
    "        branches:",
    "          - main",
    "    actions:",
    "      - scan: sast",
    "      - scan: secret_detection",
    "      - scan: dependency_scanning",
    "approval_policy:",
    "  - name: HermesProof block critical security findings",
    "    description: Require approval before merging critical/high new security findings.",
    "    enabled: true",
    "    rules:",
    "      - type: scan_finding",
    "        scanners: []",
    "        vulnerabilities_allowed: 0",
    "        severity_levels:",
    "          - critical",
    "          - high",
    "        vulnerability_states:",
    "          - newly_detected",
    "    actions:",
    "      - type: require_approval",
    "        approvals_required: 1",
    "        role_approvers:",
    "          - maintainer",
    "    approval_settings:",
    "      block_branch_modification: true",
    projectFullPath ? `# Target project: ${projectFullPath}` : "",
    ""
  ].filter((line) => line !== "").join("\n");
}

function ultimateProjectSettings({ mergeMethod = "rebase_merge" } = {}) {
  return {
    only_allow_merge_if_pipeline_succeeds: true,
    allow_merge_on_skipped_pipeline: false,
    only_allow_merge_if_all_discussions_are_resolved: true,
    only_allow_merge_if_all_status_checks_passed: true,
    remove_source_branch_after_merge: true,
    merge_method: mergeMethod,
    squash_option: "default_on",
    merge_pipelines_enabled: true,
    merge_trains_enabled: true,
    merge_trains_skip_train_allowed: false,
    max_pipelines_per_merge_train: 5,
    security_and_compliance_access_level: "enabled",
    builds_access_level: "enabled",
    merge_requests_access_level: "enabled",
    ci_config_path: ".gitlab-ci.yml",
    protect_merge_request_pipelines: true,
    ci_pipeline_variables_minimum_override_role: "maintainer",
    reviewer_assignment_strategy: "code_owners"
  };
}

export function createGitLabClient({
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const config = resolveGitLabConfig({ env });
  if (typeof fetchImpl !== "function") {
    throw new Error("GitLab client requires fetch support");
  }

  async function request(method, apiPath, { query = {}, body = null, allowNotFound = false } = {}) {
    if (!config.token) {
      throw new GitLabHttpError("GitLab token is not configured", { status: 0, code: "missing_token" });
    }
    const url = new URL(`${config.base_url}/api/v4${apiPath}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    }
    const response = await fetchImpl(url, {
      method,
      headers: {
        "PRIVATE-TOKEN": config.token,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let parsed = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = { message: text.slice(0, 500) }; }
    }
    if (response.status === 404 && allowNotFound) return null;
    if (!response.ok) {
      const message =
        typeof parsed?.message === "string"
          ? parsed.message
          : Array.isArray(parsed?.message)
            ? parsed.message.join("; ")
            : `GitLab API returned HTTP ${response.status}`;
      throw new GitLabHttpError(message, { status: response.status, body: parsed });
    }
    return parsed;
  }

  async function status({ probe = true, includeIdentity = false } = {}) {
    if (!config.token) {
      return {
        ok: true,
        status: "missing_token",
        configured: false,
        base_url: config.base_url,
        token_source: null,
        authenticated: false,
        identity_returned: false,
        message: "Set GITLAB_TOKEN or GLAB_TOKEN in the launching environment."
      };
    }
    if (!probe) {
      return {
        ok: true,
        status: "configured",
        configured: true,
        base_url: config.base_url,
        token_source: config.token_source,
        authenticated: null,
        identity_returned: false
      };
    }
    try {
      const user = await request("GET", "/user");
      return {
        ok: true,
        status: "authenticated",
        configured: true,
        base_url: config.base_url,
        token_source: config.token_source,
        authenticated: true,
        identity_returned: includeIdentity === true,
        user: includeIdentity === true
          ? { id: user.id, username: user.username, name: user.name, web_url: user.web_url }
          : undefined
      };
    } catch (error) {
      return {
        ok: false,
        status: "auth_failed",
        configured: true,
        base_url: config.base_url,
        token_source: config.token_source,
        authenticated: false,
        identity_returned: false,
        error: sanitizeErrorMessage(error),
        http_status: error?.status || 0
      };
    }
  }

  async function getProject(fullPath) {
    const project = await request("GET", `/projects/${encodePath(fullPath)}`, { allowNotFound: true });
    return projectSummary(project);
  }

  async function updateProjectSettings({ projectFullPath, settings = {} } = {}) {
    const updated = await request("PUT", `/projects/${encodePath(projectFullPath)}`, { body: settings });
    return {
      ok: true,
      status: "updated",
      base_url: config.base_url,
      token_source: config.token_source,
      project: projectSummary(updated)
    };
  }

  async function getApprovalConfiguration(projectFullPath) {
    const approval = await request("GET", `/projects/${encodePath(projectFullPath)}/approvals`);
    return approvalConfigSummary(approval);
  }

  async function updateApprovalConfiguration({
    projectFullPath,
    resetApprovalsOnPush = true,
    disableOverrides = true,
    authorApproval = false,
    committerApproval = false,
    requireReauthentication = true
  } = {}) {
    const updated = await request("POST", `/projects/${encodePath(projectFullPath)}/approvals`, {
      body: {
        reset_approvals_on_push: resetApprovalsOnPush === true,
        disable_overriding_approvers_per_merge_request: disableOverrides === true,
        merge_requests_author_approval: authorApproval === true,
        merge_requests_disable_committers_approval: committerApproval !== false,
        require_reauthentication_to_approve: requireReauthentication === true
      }
    });
    return {
      ok: true,
      status: "updated",
      approval_configuration: approvalConfigSummary(updated)
    };
  }

  async function getProtectedBranch({ projectFullPath, branch }) {
    const protectedBranch = await request(
      "GET",
      `/projects/${encodePath(projectFullPath)}/protected_branches/${encodePath(branch)}`,
      { allowNotFound: true }
    );
    return protectedBranchSummary(protectedBranch);
  }

  async function listProtectedBranches(projectFullPath) {
    const branches = await request("GET", `/projects/${encodePath(projectFullPath)}/protected_branches`, {
      query: { per_page: 100 }
    });
    return Array.isArray(branches) ? branches.map(protectedBranchSummary) : [];
  }

  async function ensureProtectedBranch({
    projectFullPath,
    branch = "main",
    pushAccessLevel = 0,
    mergeAccessLevel = 40,
    unprotectAccessLevel = 40,
    allowForcePush = false,
    codeOwnerApprovalRequired = true
  } = {}) {
    const existing = await getProtectedBranch({ projectFullPath, branch });
    const body = {
      allow_force_push: allowForcePush === true,
      code_owner_approval_required: codeOwnerApprovalRequired === true,
      allowed_to_push: [{ access_level: pushAccessLevel }],
      allowed_to_merge: [{ access_level: mergeAccessLevel }],
      allowed_to_unprotect: [{ access_level: unprotectAccessLevel }]
    };
    const raw = existing
      ? await request("PATCH", `/projects/${encodePath(projectFullPath)}/protected_branches/${encodePath(branch)}`, { body })
      : await request("POST", `/projects/${encodePath(projectFullPath)}/protected_branches`, { body: { name: branch, ...body } });
    return {
      ok: true,
      status: existing ? "updated" : "created",
      protected_branch: protectedBranchSummary(raw)
    };
  }

  async function listApprovalRules(projectFullPath) {
    const rules = await request("GET", `/projects/${encodePath(projectFullPath)}/approval_rules`, {
      query: { per_page: 100 }
    });
    return Array.isArray(rules) ? rules.map(approvalRuleSummary) : [];
  }

  async function ensureApprovalRule({
    projectFullPath,
    name = "HermesProof release approval",
    approvalsRequired = 1,
    usernames = [],
    groupIds = [],
    userIds = [],
    appliesToAllProtectedBranches = true
  } = {}) {
    const existingRules = await request("GET", `/projects/${encodePath(projectFullPath)}/approval_rules`, {
      query: { per_page: 100 }
    });
    const existing = Array.isArray(existingRules)
      ? existingRules.find((rule) => String(rule.name).toLowerCase() === String(name).toLowerCase())
      : null;
    const body = {
      name,
      approvals_required: Math.max(1, Math.min(100, Number(approvalsRequired) || 1)),
      applies_to_all_protected_branches: appliesToAllProtectedBranches === true,
      usernames: uniqueList(usernames),
      group_ids: Array.isArray(groupIds) ? groupIds : [],
      user_ids: Array.isArray(userIds) ? userIds : [],
      rule_type: "regular"
    };
    const raw = existing
      ? await request("PUT", `/projects/${encodePath(projectFullPath)}/approval_rules/${existing.id}`, { body })
      : await request("POST", `/projects/${encodePath(projectFullPath)}/approval_rules`, { body });
    return {
      ok: true,
      status: existing ? "updated" : "created",
      approval_rule: approvalRuleSummary(raw)
    };
  }

  async function repositoryFileExists({ projectFullPath, filePath, ref }) {
    const file = await request(
      "GET",
      `/projects/${encodePath(projectFullPath)}/repository/files/${encodePath(filePath)}`,
      { query: { ref }, allowNotFound: true }
    );
    return Boolean(file);
  }

  async function getRepositoryBranch({ projectFullPath, branch }) {
    const raw = await request(
      "GET",
      `/projects/${encodePath(projectFullPath)}/repository/branches/${encodePath(branch)}`,
      { allowNotFound: true }
    );
    return raw ? { name: raw.name, web_url: raw.web_url || null, commit: commitSummary(raw.commit) } : null;
  }

  async function createCommit({
    projectFullPath,
    branch,
    startBranch = "",
    commitMessage,
    actions = []
  } = {}) {
    const created = await request("POST", `/projects/${encodePath(projectFullPath)}/repository/commits`, {
      body: {
        branch,
        start_branch: startBranch || undefined,
        commit_message: commitMessage,
        actions
      }
    });
    return {
      ok: true,
      status: "created",
      commit: commitSummary(created)
    };
  }

  async function commitUltimateReleaseFiles({
    projectFullPath,
    branch,
    startBranch = "main",
    codeOwnerRefs = [],
    includePolicyTemplate = true
  } = {}) {
    const targetBranch = await getRepositoryBranch({ projectFullPath, branch });
    const lookupRef = targetBranch ? branch : startBranch;
    const rootCiExists = await repositoryFileExists({ projectFullPath, filePath: ".gitlab-ci.yml", ref: lookupRef });
    const fileSpecs = [
      { file_path: "CODEOWNERS", content: defaultCodeOwnersContent(codeOwnerRefs) },
      { file_path: HERMESPROOF_CI_INCLUDE_PATH, content: defaultGitLabCiIncludeContent() }
    ];
    if (includePolicyTemplate === true) {
      fileSpecs.push({
        file_path: "docs/gitlab/security-policy-template.yml",
        content: defaultSecurityPolicyTemplate(projectFullPath)
      });
    }
    fileSpecs.push({
      file_path: "docs/gitlab/hermesproof-ultimate-bootstrap.md",
      content: defaultUltimateBootstrapDocsContent({ projectFullPath, rootCiCreated: !rootCiExists })
    });
    if (!rootCiExists) {
      fileSpecs.push({ file_path: ".gitlab-ci.yml", content: defaultGitLabCiRootContent() });
    }
    const actions = [];
    for (const file of fileSpecs) {
      const exists = await repositoryFileExists({ projectFullPath, filePath: file.file_path, ref: lookupRef });
      actions.push({
        action: exists ? "update" : "create",
        file_path: file.file_path,
        content: file.content
      });
    }
    const commit = await createCommit({
      projectFullPath,
      branch,
      startBranch: targetBranch || branch === startBranch ? "" : startBranch,
      commitMessage: "chore: capture GitLab Ultimate governance",
      actions
    });
    return {
      ...commit,
      branch,
      start_branch: startBranch,
      branch_preexisting: Boolean(targetBranch),
      files: actions.map((action) => ({ file_path: action.file_path, action: action.action }))
    };
  }

  async function ultimateGovernanceStatus({ projectFullPath, defaultBranch = "main" } = {}) {
    const [project, approvalConfiguration, protectedBranch, approvalRules] = await Promise.all([
      getProject(projectFullPath),
      getApprovalConfiguration(projectFullPath).catch((error) => ({ error: sanitizeErrorMessage(error), http_status: error?.status || 0 })),
      getProtectedBranch({ projectFullPath, branch: defaultBranch }).catch((error) => ({ error: sanitizeErrorMessage(error), http_status: error?.status || 0 })),
      listApprovalRules(projectFullPath).catch((error) => ({ error: sanitizeErrorMessage(error), http_status: error?.status || 0 }))
    ]);
    const settings = project?.settings || {};
    const checks = {
      project_found: Boolean(project),
      pipeline_must_succeed: settings.only_allow_merge_if_pipeline_succeeds === true,
      discussions_must_resolve: settings.only_allow_merge_if_all_discussions_are_resolved === true,
      status_checks_required: settings.only_allow_merge_if_all_status_checks_passed === true,
      merge_trains_enabled: settings.merge_trains_enabled === true,
      merge_pipelines_enabled: settings.merge_pipelines_enabled === true,
      protected_default_branch: Boolean(protectedBranch && !protectedBranch.error),
      code_owner_approval_required: protectedBranch?.code_owner_approval_required === true,
      approval_overrides_disabled: approvalConfiguration?.disable_overriding_approvers_per_merge_request === true,
      approvals_reset_on_push: approvalConfiguration?.reset_approvals_on_push === true,
      approval_rules_present: Array.isArray(approvalRules) && approvalRules.some((rule) => Number(rule.approvals_required) > 0)
    };
    const missing = Object.entries(checks)
      .filter(([, ok]) => ok !== true)
      .map(([id]) => id);
    return {
      ok: true,
      status: missing.length ? "needs_bootstrap" : "ready",
      base_url: config.base_url,
      token_source: config.token_source,
      project,
      default_branch: defaultBranch,
      approval_configuration: approvalConfiguration,
      protected_branch: protectedBranch,
      approval_rules: approvalRules,
      checks,
      missing
    };
  }

  async function bootstrapUltimateGovernance({
    projectFullPath,
    defaultBranch = "main",
    governanceBranch = "",
    dryRun = true,
    bestEffort = true,
    codeOwnerRefs = ["@Ghenghis"],
    approverUsernames = [],
    approverUserIds = [],
    approverGroupIds = [],
    approvalRuleName = "HermesProof release approval",
    approvalsRequired = 1,
    commitReleaseFiles = true,
    createGovernanceMergeRequest = true,
    mergeMethod = "rebase_merge"
  } = {}) {
    const branch = governanceBranch || `hermesproof/gitlab-ultimate-governance-${new Date().toISOString().slice(0, 10)}`;
    const plannedOperations = [
      "update_project_merge_and_security_settings",
      "update_project_approval_configuration",
      `protect_${defaultBranch}_with_code_owner_approval`,
      "ensure_release_approval_rule_when_approvers_supplied"
    ];
    if (commitReleaseFiles) plannedOperations.push("commit_CODEOWNERS_gitlab_ci_and_policy_template");
    if (commitReleaseFiles && createGovernanceMergeRequest) plannedOperations.push("create_governance_merge_request");
    if (dryRun === true) {
      return {
        ok: true,
        status: "planned",
        base_url: config.base_url,
        token_source: config.token_source,
        project_full_path: projectFullPath,
        default_branch: defaultBranch,
        governance_branch: branch,
        planned_operations: plannedOperations
      };
    }

    const steps = [];
    async function runStep(name, fn, required = true) {
      try {
        const result = await fn();
        steps.push({ name, ok: true, result });
        return result;
      } catch (error) {
        const failure = { name, ok: false, error: sanitizeErrorMessage(error), http_status: error?.status || 0, required };
        steps.push(failure);
        if (required && bestEffort !== true) throw error;
        return failure;
      }
    }

    await runStep("update_project_merge_and_security_settings", () => updateProjectSettings({
      projectFullPath,
      settings: ultimateProjectSettings({ mergeMethod })
    }));
    await runStep("update_project_approval_configuration", () => updateApprovalConfiguration({
      projectFullPath,
      resetApprovalsOnPush: true,
      disableOverrides: true,
      authorApproval: false,
      committerApproval: false,
      requireReauthentication: true
    }));
    await runStep(`protect_${defaultBranch}_with_code_owner_approval`, () => ensureProtectedBranch({
      projectFullPath,
      branch: defaultBranch,
      pushAccessLevel: 0,
      mergeAccessLevel: 40,
      unprotectAccessLevel: 40,
      allowForcePush: false,
      codeOwnerApprovalRequired: true
    }));
    if (uniqueList(approverUsernames).length || approverUserIds.length || approverGroupIds.length) {
      await runStep("ensure_release_approval_rule", () => ensureApprovalRule({
        projectFullPath,
        name: approvalRuleName,
        approvalsRequired,
        usernames: approverUsernames,
        userIds: approverUserIds,
        groupIds: approverGroupIds,
        appliesToAllProtectedBranches: true
      }));
    } else {
      steps.push({
        name: "ensure_release_approval_rule",
        ok: true,
        skipped: true,
        reason: "no approver usernames/user IDs/group IDs supplied; CODEOWNERS remains the approval source"
      });
    }
    let commitResult = null;
    if (commitReleaseFiles === true) {
      commitResult = await runStep("commit_CODEOWNERS_gitlab_ci_and_policy_template", () => commitUltimateReleaseFiles({
        projectFullPath,
        branch,
        startBranch: defaultBranch,
        codeOwnerRefs
      }));
    }
    if (commitReleaseFiles === true && createGovernanceMergeRequest === true && commitResult?.ok !== false) {
      await runStep("create_governance_merge_request", () => createMergeRequest({
        projectFullPath,
        sourceBranch: branch,
        targetBranch: defaultBranch,
        title: "Capture GitLab Ultimate governance",
        description: [
          "HermesProof generated this MR to preserve GitLab Ultimate governance before the license window closes.",
          "",
          "Includes CODEOWNERS, GitLab CI security/proof jobs, and a security policy template.",
          "",
          "Proof source: HermesProof GitLab Ultimate bootstrap evidence."
        ].join("\n"),
        draft: false,
        removeSourceBranch: false,
        labels: ["hermesproof", "gitlab-ultimate", "governance"]
      }));
    }
    const failedRequired = steps.filter((step) => step.ok === false && step.required !== false);
    return {
      ok: failedRequired.length === 0,
      status: failedRequired.length ? "partial" : "bootstrapped",
      base_url: config.base_url,
      token_source: config.token_source,
      project_full_path: projectFullPath,
      default_branch: defaultBranch,
      governance_branch: branch,
      steps
    };
  }

  async function findNamespace(namespacePath) {
    const normalized = String(namespacePath || "").replace(/^\/+|\/+$/g, "");
    if (!normalized) return null;
    const lastSegment = normalized.split("/").pop();
    const matches = await request("GET", "/namespaces", { query: { search: lastSegment } });
    const exact = Array.isArray(matches)
      ? matches.find((item) => item?.full_path?.toLowerCase() === normalized.toLowerCase())
      : null;
    return exact ? { id: exact.id, full_path: exact.full_path, kind: exact.kind } : null;
  }

  async function ensureProject({
    namespacePath = "",
    projectPath,
    name = "",
    visibility = "private",
    description = "",
    initializeWithReadme = false
  } = {}) {
    const normalizedNamespace = String(namespacePath || "").replace(/^\/+|\/+$/g, "");
    const fullPath = normalizedNamespace ? `${normalizedNamespace}/${projectPath}` : projectPath;
    const existing = await getProject(fullPath);
    if (existing) {
      return {
        ok: true,
        status: "exists",
        created: false,
        base_url: config.base_url,
        token_source: config.token_source,
        project: existing
      };
    }

    const payload = {
      path: projectPath,
      name: name || projectPath,
      visibility,
      description,
      initialize_with_readme: initializeWithReadme === true
    };
    let namespace = null;
    if (normalizedNamespace) {
      namespace = await findNamespace(normalizedNamespace);
      if (!namespace) {
        return {
          ok: false,
          status: "namespace_missing",
          created: false,
          base_url: config.base_url,
          token_source: config.token_source,
          namespace_path: normalizedNamespace,
          message: "GitLab namespace was not found or token cannot access it."
        };
      }
      payload.namespace_id = namespace.id;
    }

    const created = await request("POST", "/projects", { body: payload });
    return {
      ok: true,
      status: "created",
      created: true,
      base_url: config.base_url,
      token_source: config.token_source,
      namespace: namespace ? { id: namespace.id, full_path: namespace.full_path, kind: namespace.kind } : null,
      project: projectSummary(created)
    };
  }

  async function listMergeRequests({
    projectFullPath,
    state = "opened",
    sourceBranch = "",
    targetBranch = "",
    search = "",
    limit = 20
  } = {}) {
    const query = {
      state,
      source_branch: sourceBranch || undefined,
      target_branch: targetBranch || undefined,
      search: search || undefined,
      per_page: Math.max(1, Math.min(100, Number(limit) || 20))
    };
    const list = await request("GET", `/projects/${encodePath(projectFullPath)}/merge_requests`, { query });
    return {
      ok: true,
      status: "listed",
      base_url: config.base_url,
      token_source: config.token_source,
      project_full_path: projectFullPath,
      count: Array.isArray(list) ? list.length : 0,
      merge_requests: Array.isArray(list) ? list.map(mergeRequestSummary) : []
    };
  }

  async function createMergeRequest({
    projectFullPath,
    sourceBranch,
    targetBranch = "main",
    title,
    description = "",
    draft = false,
    removeSourceBranch = false,
    labels = []
  } = {}) {
    const existing = await listMergeRequests({
      projectFullPath,
      state: "opened",
      sourceBranch,
      targetBranch,
      limit: 100
    });
    if (existing.merge_requests.length > 0) {
      return {
        ok: true,
        status: "exists",
        created: false,
        base_url: config.base_url,
        token_source: config.token_source,
        project_full_path: projectFullPath,
        merge_request: existing.merge_requests[0]
      };
    }
    const mrTitle = draft && !/^(\s*draft\s*:|\s*wip\s*:)/i.test(title) ? `Draft: ${title}` : title;
    const created = await request("POST", `/projects/${encodePath(projectFullPath)}/merge_requests`, {
      body: {
        source_branch: sourceBranch,
        target_branch: targetBranch,
        title: mrTitle,
        description,
        remove_source_branch: removeSourceBranch === true,
        labels: Array.isArray(labels) && labels.length ? labels.join(",") : undefined
      }
    });
    return {
      ok: true,
      status: "created",
      created: true,
      base_url: config.base_url,
      token_source: config.token_source,
      project_full_path: projectFullPath,
      merge_request: mergeRequestSummary(created)
    };
  }

  return {
    config: {
      ok: config.ok,
      base_url: config.base_url,
      token_source: config.token_source
    },
    status,
    getProject,
    ensureProject,
    updateProjectSettings,
    ultimateGovernanceStatus,
    bootstrapUltimateGovernance,
    listMergeRequests,
    createMergeRequest
  };
}
