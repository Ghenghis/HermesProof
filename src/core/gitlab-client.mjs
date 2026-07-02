const DEFAULT_GITLAB_BASE_URL = "https://gitlab.com";

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
  return {
    id: project.id,
    path: project.path,
    path_with_namespace: project.path_with_namespace,
    visibility: project.visibility,
    web_url: project.web_url,
    http_url_to_repo: project.http_url_to_repo,
    ssh_url_to_repo: project.ssh_url_to_repo,
    default_branch: project.default_branch || null
  };
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
    listMergeRequests,
    createMergeRequest
  };
}
