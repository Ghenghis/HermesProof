"""Cplus-docker wrapper with patched _run_update_checks (Phase 4 patch).

Applied amendments after Agent 5 review:
- workers_env == "0" uses -n 0 (in-process xdist) not -p no:xdist
"""
from __future__ import annotations
import os, subprocess, sys
from pathlib import Path
from typing import Any

HCODEX_SRC = "/mnt/g/Github/h3d-gui-wiring-codex/03_implementation/src"
if HCODEX_SRC not in sys.path:
    sys.path.insert(0, HCODEX_SRC)

import hermes3d.db.init as _db_init  # noqa: E402
_db_init.DB_PATH = Path("/tmp/h3d-docker-hermes3d.db")
_db_init.DB_PATH.parent.mkdir(parents=True, exist_ok=True)

from hermes3d.api.routes import agent_updates as _au  # noqa: E402

# === Phase 4 patch: align _run_update_checks pytest gate with upstream tests.yml ===
# Upstream excludes tests/integration and tests/e2e BY PATH; our endpoint used a
# marker-only filter (-m "not integration") that did not exclude tests/e2e/, whose
# conftest installs a bare MagicMock for `discord` that contaminates downstream
# tests/gateway/test_discord_*. Aligning with upstream removes the contaminator
# from collection without skipping any failing tests; failures are tests/gateway/*,
# which we keep collecting.
import shutil  # noqa: E402

_BACKUP_RUN_UPDATE_CHECKS = _au._run_update_checks


def _patched_run_update_checks(repo: Path) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    checks.append(_au._check_command(repo, "git status", ["status", "--short"], expect_returncode=0))
    if shutil.which("npm") and (repo / "package.json").exists():
        checks.append(_au._check_external(repo, "npm package metadata", ["npm", "pkg", "get", "name"]))
    if shutil.which("python") and (repo / "pyproject.toml").exists():
        checks.append(_au._check_external(repo, "python pyproject metadata", ["python", "-m", "pip", "--version"]))
        compile_targets = [str(p) for p in [repo / "run_agent.py", repo / "hermes_cli", repo / "gateway", repo / "agent"] if p.exists()]
        if compile_targets:
            checks.append(_au._check_external(repo, "python compile gate", ["python", "-m", "compileall", "-q", *compile_targets], timeout=180))
        tests_dir = repo / "tests"
        if os.environ.get("HERMES_AGENT_RUN_PYTEST") == "1" and tests_dir.exists():
            workers_env = os.environ.get("HERMES_AGENT_PYTEST_WORKERS", "4").strip()
            xdist_args: list[str] = []
            if workers_env:
                # -n 0 = in-process (xdist accepts it); -n N = N workers; default 4 mirrors upstream GHA.
                xdist_args = ["-n", workers_env]
            pytest_args = ["python", "-m", "pytest", str(tests_dir), "-m", "not integration",
                           "--ignore=tests/integration", "--ignore=tests/e2e",
                           "--maxfail=5", "-q", *xdist_args]
            checks.append(_au._check_external(repo, "python pytest non-integration", pytest_args, timeout=600))
        elif tests_dir.exists():
            checks.append({"name": "python pytest non-integration", "status": "skipped",
                           "output": "Set HERMES_AGENT_RUN_PYTEST=1 to run the full Hermes Agent pytest gate in this environment."})
    return checks


_au._run_update_checks = _patched_run_update_checks
# === end Phase 4 patch ===


def _patched_remote_release_tags(repo: Path) -> list[str]:
    result = subprocess.run(["git", "tag", "-l", "v*"], cwd=repo, text=True, capture_output=True, timeout=30, check=False)
    tags = [t.strip() for t in result.stdout.splitlines() if t.strip()]
    matching = [t for t in tags if _au.TAG_RE.match(t)]
    matching = [t for t in matching if t != "v2026.5.7"]
    return sorted(matching, key=_au._tag_key)


def _patched_latest_release(tags: list[str]) -> dict[str, object]:
    if not tags:
        return {"tag": None, "name": None, "source": "local_git_tags"}
    latest = tags[-1]
    return {"tag": latest, "name": latest, "source": "local_git_tags", "html_url": None, "published_at": None}


_au._remote_release_tags = _patched_remote_release_tags
_au._latest_release = _patched_latest_release

from fastapi import FastAPI  # noqa: E402
app = FastAPI(title="Hermes Agent Cplus-docker wrapper", version="0.0.2")
app.include_router(_au.router)


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "service": "h3d-cplus-docker-wrapper",
            "checkout": os.environ.get("HERMES_AGENT_CHECKOUT", "<unset>"),
            "pytest_enabled": os.environ.get("HERMES_AGENT_RUN_PYTEST") == "1",
            "pytest_workers": os.environ.get("HERMES_AGENT_PYTEST_WORKERS", "4 (default)"),
            "platform": sys.platform, "python": sys.version.split()[0],
            "db": str(_db_init.DB_PATH), "tag_source": "local_git_tags (patched)",
            "phase4_patch_applied": True, "in_docker": True}
