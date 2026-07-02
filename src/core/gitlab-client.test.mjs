import { test } from "node:test";
import assert from "node:assert/strict";
import { createGitLabClient } from "./gitlab-client.mjs";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body === undefined ? "" : JSON.stringify(body);
    }
  };
}

test("GitLab Ultimate bootstrap dry-run produces a safe plan without API calls", async () => {
  const client = createGitLabClient({
    env: { GITLAB_TOKEN: "token-for-test", GITLAB_BASE_URL: "https://gitlab.example.test" },
    fetchImpl: async () => {
      throw new Error("dry-run should not call GitLab");
    }
  });

  const result = await client.bootstrapUltimateGovernance({
    projectFullPath: "Ghenghis/HermesProof",
    defaultBranch: "main",
    dryRun: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "planned");
  assert.equal(result.token_source, "GITLAB_TOKEN");
  assert.equal(result.project_full_path, "Ghenghis/HermesProof");
  assert.ok(result.planned_operations.includes("update_project_merge_and_security_settings"));
  assert.ok(result.planned_operations.includes("commit_CODEOWNERS_gitlab_ci_and_policy_template"));
  assert.ok(!JSON.stringify(result).includes("token-for-test"));
});

test("GitLab Ultimate status returns ready when governance controls are present", async () => {
  const requests = [];
  const client = createGitLabClient({
    env: { GLAB_TOKEN: "token-for-test", GITLAB_BASE_URL: "https://gitlab.example.test" },
    fetchImpl: async (url, init) => {
      requests.push({ method: init.method, path: url.pathname });
      if (init.method === "GET" && url.pathname.endsWith("/projects/Ghenghis%2FHermesProof")) {
        return jsonResponse(200, {
          id: 1,
          path: "HermesProof",
          path_with_namespace: "Ghenghis/HermesProof",
          visibility: "private",
          web_url: "https://gitlab.example.test/Ghenghis/HermesProof",
          http_url_to_repo: "https://gitlab.example.test/Ghenghis/HermesProof.git",
          ssh_url_to_repo: "git@gitlab.example.test:Ghenghis/HermesProof.git",
          default_branch: "main",
          only_allow_merge_if_pipeline_succeeds: true,
          only_allow_merge_if_all_discussions_are_resolved: true,
          only_allow_merge_if_all_status_checks_passed: true,
          merge_trains_enabled: true,
          merge_pipelines_enabled: true
        });
      }
      if (init.method === "GET" && url.pathname.endsWith("/projects/Ghenghis%2FHermesProof/approvals")) {
        return jsonResponse(200, {
          reset_approvals_on_push: true,
          disable_overriding_approvers_per_merge_request: true
        });
      }
      if (init.method === "GET" && url.pathname.endsWith("/projects/Ghenghis%2FHermesProof/protected_branches/main")) {
        return jsonResponse(200, {
          id: 7,
          name: "main",
          allow_force_push: false,
          code_owner_approval_required: true,
          push_access_levels: [{ access_level: 0 }],
          merge_access_levels: [{ access_level: 40 }],
          unprotect_access_levels: [{ access_level: 40 }]
        });
      }
      if (init.method === "GET" && url.pathname.endsWith("/projects/Ghenghis%2FHermesProof/approval_rules")) {
        return jsonResponse(200, [{
          id: 9,
          name: "HermesProof release approval",
          rule_type: "regular",
          approvals_required: 1,
          applies_to_all_protected_branches: true,
          eligible_approvers: [{ id: 1, username: "ghenghis" }]
        }]);
      }
      return jsonResponse(404, { message: `unexpected ${init.method} ${url.pathname}` });
    }
  });

  const status = await client.ultimateGovernanceStatus({
    projectFullPath: "Ghenghis/HermesProof",
    defaultBranch: "main"
  });

  assert.equal(status.ok, true);
  assert.equal(status.status, "ready");
  assert.deepEqual(status.missing, []);
  assert.equal(status.checks.code_owner_approval_required, true);
  assert.equal(status.checks.approval_rules_present, true);
  assert.equal(requests.length, 4);
  assert.ok(!JSON.stringify(status).includes("token-for-test"));
});

test("GitLab Ultimate bootstrap preserves an existing root GitLab CI file", async () => {
  const commitBodies = [];
  const client = createGitLabClient({
    env: { GITLAB_TOKEN: "token-for-test", GITLAB_BASE_URL: "https://gitlab.example.test" },
    fetchImpl: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : null;
      if (init.method === "PUT" && url.pathname.endsWith("/projects/Ghenghis%2FHermesProof")) {
        return jsonResponse(200, {
          id: 1,
          path: "HermesProof",
          path_with_namespace: "Ghenghis/HermesProof",
          default_branch: "main",
          ...body
        });
      }
      if (init.method === "POST" && url.pathname.endsWith("/projects/Ghenghis%2FHermesProof/approvals")) {
        return jsonResponse(200, body);
      }
      if (init.method === "GET" && url.pathname.endsWith("/projects/Ghenghis%2FHermesProof/protected_branches/main")) {
        return jsonResponse(404, { message: "404 Protected branch not found" });
      }
      if (init.method === "POST" && url.pathname.endsWith("/projects/Ghenghis%2FHermesProof/protected_branches")) {
        return jsonResponse(201, {
          id: 7,
          name: "main",
          allow_force_push: false,
          code_owner_approval_required: true
        });
      }
      if (init.method === "GET" && url.pathname.endsWith("/projects/Ghenghis%2FHermesProof/repository/branches/hermesproof%2Fgovernance")) {
        return jsonResponse(200, {
          name: "hermesproof/governance",
          web_url: "https://gitlab.example.test/Ghenghis/HermesProof/-/tree/hermesproof/governance",
          commit: { id: "abc123", short_id: "abc123", title: "existing branch" }
        });
      }
      if (init.method === "GET" && url.pathname.endsWith("/repository/files/.gitlab-ci.yml")) {
        return jsonResponse(200, { file_path: ".gitlab-ci.yml" });
      }
      if (init.method === "GET" && url.pathname.includes("/repository/files/")) {
        return jsonResponse(404, { message: "404 File Not Found" });
      }
      if (init.method === "POST" && url.pathname.endsWith("/projects/Ghenghis%2FHermesProof/repository/commits")) {
        commitBodies.push(body);
        return jsonResponse(201, {
          id: "def456",
          short_id: "def456",
          title: body.commit_message,
          web_url: "https://gitlab.example.test/Ghenghis/HermesProof/-/commit/def456"
        });
      }
      return jsonResponse(404, { message: `unexpected ${init.method} ${url.pathname}` });
    }
  });

  const result = await client.bootstrapUltimateGovernance({
    projectFullPath: "Ghenghis/HermesProof",
    defaultBranch: "main",
    governanceBranch: "hermesproof/governance",
    dryRun: false,
    bestEffort: false,
    createGovernanceMergeRequest: false
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "bootstrapped");
  assert.equal(commitBodies.length, 1);
  assert.equal(commitBodies[0].start_branch, undefined);
  const paths = commitBodies[0].actions.map((action) => action.file_path);
  assert.ok(paths.includes("CODEOWNERS"));
  assert.ok(paths.includes(".gitlab/hermesproof-ultimate.yml"));
  assert.ok(paths.includes("docs/gitlab/security-policy-template.yml"));
  assert.ok(paths.includes("docs/gitlab/hermesproof-ultimate-bootstrap.md"));
  assert.ok(!paths.includes(".gitlab-ci.yml"));
  assert.ok(!JSON.stringify(result).includes("token-for-test"));
});
