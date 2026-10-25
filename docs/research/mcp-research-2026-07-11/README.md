# HermesProof Agentic Toolkit — Curated MCP Servers & Agent Skills

> **Scope:** HermesProof, HermesAgent, ZeroClaw and the DaveAI stack (Windows 11, WSL2, Hostinger VPS, Docker, SSH, RE/modding, 3D farm, IPTV/Jellyfin). KiloCode references removed as requested.

---

## 1. Core Non-Negotiable Rules

1. **Chrome Canary only** for every test, debug, scrape, network inspection, or UI automation proof until RC quality.
   - Dedicated profile: `C:\ChromeCanary_KiloProof`
   - Launch: `--remote-debugging-port=9222 --user-data-dir="C:\ChromeCanary_KiloProof"`
   - HermesProof gate: `canary_only_testing` blocks release if not proven.
2. **Bun pinned to `1.13.x`** in every script, doc, and installer.
3. **Safe MCP registry** — never overwrite existing custom configs without explicit user + evidence approval.
4. **Everything is opt-in** by default in the JSON registry. Only `recommended` items are marked; you enable the rest.

---

## 2. Quick-Start Layout

| Location | Purpose |
|----------|---------|
| `.hermesproof/mcp-registry/` | Safe registry root (JSON, backups, custom config hashes) |
| `.hermesproof/skills/` | Agent Skills directory (`SKILL.md` folders) |
| `.hermesproof/mcp-registry/mcp-registry.json` | Master selectable list of every MCP server and skill |
| `G:\Github\HermesProof-MCP-Research\mcp-registry.json` | Deliverable copy of the registry |

---

## 3. How to Use This Toolkit

- **Enable/disable** in `mcp-registry.json` by flipping `"enabled": true/false`.
- **Combine** items by following the **Lanes** (Section 6) — they show which MCP servers + skills work together for each workflow.
- **Most impactful = starred in the `Recommended` column.**
- All entries are free, open-source, or free-for-personal/educational use unless explicitly flagged.

---

## 4. MCP Servers (Most Impactful)

### 4.1 Windows Control & Local Shell

| Name | Link | Description | Use Case | Recommended |
|------|------|-------------|----------|-------------|
| **DesktopCommanderMCP** | https://github.com/wonderwhy-er/DesktopCommanderMCP | Terminal, long-running commands, advanced file search, edit with diffs, process control. | Daily local agent work on Windows 11 without fighting WSL for every command. | **Yes** |
| **PowerShell.MCP** | https://github.com/yotsuda/PowerShell.MCP | Exposes 10,000+ PowerShell modules and any CLI tool to the agent. | Windows system admin, registry, services, VM/Hyper-V, IIS. | Yes |
| **powershell-mcp** | https://github.com/gunjanjp/powershell-mcp | Comprehensive PowerShell execution server. | Alternative/backup to PowerShell.MCP; run scripts and system ops. | Optional |
| **WinRemote MCP** | https://github.com/dddabtc/winremote-mcp | Windows remote control / automation primitives. | Remote desktop automation, VM control, session management. | Optional |

### 4.2 Browser Automation & Debug

| Name | Link | Description | Use Case | Recommended |
|------|------|-------------|----------|-------------|
| **Chrome DevTools MCP** | https://github.com/ChromeDevTools/chrome-devtools-mcp | Official MCP server for Chrome DevTools Protocol. | DOM/network/performance inspection, Canary-only proofs. | **Yes** |
| **Playwright MCP** | https://github.com/microsoft/playwright-mcp | Microsoft Playwright as MCP. | Structured cross-browser automation, E2E tests, screenshots. | **Yes** |
| **anythingmcp** | https://github.com/HelpCode-ai/anythingmcp | Broad API and database gateway via MCP. | Glue web APIs, internal DBs, microservices without writing a server. | Optional |
| **browserbase** | (paid) | Browser automation in the cloud. | **Excluded** — not free/OSS. | No |

### 4.3 Code, Shell & Remote

| Name | Link | Description | Use Case | Recommended |
|------|------|-------------|----------|-------------|
| **wcgw** | https://github.com/rusiaaman/wcgw | Shell + coding agent MCP server with read-only, code-writer, and full modes. | Safe, auditable shell and file editing in the current workspace. | **Yes** |
| **mcp-ssh (xiongjiwei)** | https://github.com/xiongjiwei/mcp-ssh | Persistent SSH sessions with command approval and audit logging. | Manage the Hostinger VPS, run remote commands, state persists across calls. | **Yes** |
| **ssh-mcp (slepp)** | https://github.com/slepp/ssh-mcp | SSH, `scp`, `rsync`, port forwards using your local OpenSSH config. | File sync, remote exec, port forwarding for VPS work. | Optional |
| **ssh-mcp (tufantunc)** | https://github.com/tufantunc/ssh-mcp | TypeScript SSH control server with timeout protection. | Cross-platform SSH command execution. | Optional |

### 4.4 Containers & DevOps

| Name | Link | Description | Use Case | Recommended |
|------|------|-------------|----------|-------------|
| **docker-mcp** | https://github.com/QuantGeekDev/docker-mcp | Docker and Docker Compose stack management through MCP. | Start/stop/inspect containers, manage compose stacks on Windows/WSL/VPS. | **Yes** |
| **Docker MCP Registry** | https://github.com/docker/mcp-registry | Official Docker MCP registry metadata. | Discover Docker-packaged MCP servers. | Optional |
| **Docker MCP Gateway** | https://github.com/docker/mcp-gateway | Unified MCP gateway with auth and secrets management. | Single entrypoint for multiple MCP servers in Docker environments. | Optional |

### 4.5 Repositories, Code & Documentation

| Name | Link | Description | Use Case | Recommended |
|------|------|-------------|----------|-------------|
| **GitHub MCP** | https://github.com/github/github-mcp-server | GitHub API as MCP tools. | Issues, PRs, releases, code search, repo management. | **Yes** |
| **GitLab MCP (yoda-digital)** | https://github.com/yoda-digital/mcp-gitlab-server | 86+ typed GitLab REST tools. | Self-hosted or GitLab.com project management, CI, MRs. | **Yes** |
| **GitLab MCP (jmrplens)** | https://github.com/jmrplens/gitlab-mcp-server | Full REST + GraphQL GitLab MCP server. | Alternative GitLab integration (binary or container). | Optional |
| **Context7** | https://github.com/upstash/context7 | Up-to-date documentation and code examples for agents. | Stop hallucinated APIs; fetch current docs for libraries. | **Yes** |
| **Context7 MCP Server (truefoundry)** | https://github.com/truefoundry/context7-mcp-server | MCP server wrapper for Context7. | Use Context7 as an MCP tool. | Optional |

### 4.6 Official Model Context Protocol Reference Servers

| Name | Link | Description | Use Case | Recommended |
|------|------|-------------|----------|-------------|
| **server-filesystem** | https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem | Secure filesystem operations with configurable roots. | Safe read/write in allowed project paths. | **Yes** |
| **server-git** | https://github.com/modelcontextprotocol/servers/tree/main/src/git | Git repository tools. | Status, log, diff, branch, commit operations. | **Yes** |
| **server-memory** | https://github.com/modelcontextprotocol/servers/tree/main/src/memory | Knowledge graph persistent memory. | Cross-session entity/relationship memory for agents. | **Yes** |
| **server-fetch** | https://github.com/modelcontextprotocol/servers/tree/main/src/fetch | Web content fetching and conversion. | Fetch docs, convert HTML to Markdown for LLM context. | **Yes** |
| **server-sequentialthinking** | https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking | Dynamic reflective thinking chain. | Break complex problems into reasoning steps. | Optional |
| **server-time** | https://github.com/modelcontextprotocol/servers/tree/main/src/time | Time and timezone utilities. | Scheduling, timezone-aware prompts. | Optional |
| **server-everything** | https://github.com/modelcontextprotocol/servers/tree/main/src/everything | Reference test server. | Test MCP client setup and tooling. | No |

### 4.7 Reverse Engineering, Media & Domain-Specific

| Name | Link | Description | Use Case | Recommended |
|------|------|-------------|----------|-------------|
| **Ghidra MCP (bethington)** | https://github.com/bethington/ghidra-mcp | 200+ MCP tools for Ghidra reverse engineering. | RE/disassembly/decompilation via AI agent. | **Yes** |
| **GhidraMCP (LaurieWired)** | https://github.com/LaurieWired/GhidraMCP | Lightweight MCP server for Ghidra. | Alternative if bethington's is too heavy. | Optional |
| **FFmpeg MCP (dubnium0)** | https://github.com/dubnium0/ffmpeg-mcp | 40+ advanced FFmpeg tools for video/audio. | Transcode, probe, stream, edit media for IPTV/3D captures. | **Yes** |
| **ffmpeg-mcp (windsornguyen)** | https://github.com/windsornguyen/ffmpeg-mcp | Stateless portable FFmpeg MCP with auto-install binaries. | Quick `npx` FFmpeg automation without manual install. | Optional |
| **Jellyfin MCP (lidless-labs)** | https://github.com/lidless-labs/jellyfin-mcp | 56 tools for Jellyfin control and library management. | IPTV/Jellyfin admin: playback, scan, users, sessions. | **Yes** |
| **Jellyfin MCP (jaredtrent)** | https://github.com/jaredtrent/jellyfin-mcp | Jellyfin MCP with workflows and live resources. | Alternative Jellyfin integration. | Optional |

### 4.8 Installers, Registries & Discovery

| Name | Link | Description | Use Case | Recommended |
|------|------|-------------|----------|-------------|
| **mcp-installer** | https://github.com/anaisbetts/mcp-installer | Install MCP servers from a URL/package. | One-line installer helper for new MCP servers. | Optional |
| **mcp-marketplace** | https://github.com/cline/mcp-marketplace | Marketplace metadata and server index. | Browse/search community MCP servers. | Optional |
| **awesome-mcp-servers** | https://github.com/punkpeye/awesome-mcp-servers | Curated community MCP server list. | Discover new servers by category. | **Yes** |
| **MCP Directory** | https://mcp.directory/ | Searchable directory of 3000+ MCP servers. | Quick discovery and filtering. | **Yes** |
| **MCP Server Registry** | https://registry.modelcontextprotocol.io/ | Official MCP registry. | Canonical source for official/registered servers. | **Yes** |
| **PulseMCP** | https://www.pulsemcp.com/servers | Large, updated MCP server directory. | Alternative discovery with stats. | Optional |

---

## 5. Agent Skills (Most Impactful)

### 5.1 Development Workflow (obra/superpowers)

| Name | Source | Description | Use Case | Recommended |
|------|--------|-------------|----------|-------------|
| **brainstorming** | https://github.com/obra/superpowers/tree/main/skills/brainstorming | Socratic design refinement before creative work. | Refine rough ideas and requirements before coding. | **Yes** |
| **writing-plans** | https://github.com/obra/superpowers/tree/main/skills/writing-plans | Break multi-step tasks into 2-5 minute chunks with exact file paths and verification. | Plan features before touching code. | **Yes** |
| **executing-plans** | https://github.com/obra/superpowers/tree/main/skills/executing-plans | Execute a written plan with review checkpoints. | Run a plan in a fresh session with gates. | **Yes** |
| **subagent-driven-development** | https://github.com/obra/superpowers/tree/main/skills/subagent-driven-development | Dispatch fresh subagents per task with two-stage review. | Parallel/independent implementation. | **Yes** |
| **dispatching-parallel-agents** | https://github.com/obra/superpowers/tree/main/skills/dispatching-parallel-agents | Work on 2+ independent tasks in parallel. | When tasks do not share state. | **Yes** |
| **test-driven-development** | https://github.com/obra/superpowers/tree/main/skills/test-driven-development | RED-GREEN-REFACTOR with evidence. | Enforce TDD before implementation code. | **Yes** |
| **systematic-debugging** | https://github.com/obra/superpowers/tree/main/skills/systematic-debugging | 4-phase root-cause debugging. | Debug before proposing fixes. | **Yes** |
| **verification-before-completion** | https://github.com/obra/superpowers/tree/main/skills/verification-before-completion | Run verification commands before claiming success. | Evidence-before-assertions gate. | **Yes** |
| **requesting-code-review** | https://github.com/obra/superpowers/tree/main/skills/requesting-code-review | Pre-merge review checklist. | Before merging or finishing a branch. | **Yes** |
| **receiving-code-review** | https://github.com/obra/superpowers/tree/main/skills/receiving-code-review | Handle review feedback with rigor, not blind acceptance. | Respond to PR feedback. | **Yes** |
| **using-git-worktrees** | https://github.com/obra/superpowers/tree/main/skills/using-git-worktrees | Isolated feature workspace with worktree fallback. | Keep main workspace clean. | **Yes** |
| **finishing-a-development-branch** | https://github.com/obra/superpowers/tree/main/skills/finishing-a-development-branch | Verify, merge/PR, or clean up a finished branch. | Branch completion workflow. | **Yes** |
| **writing-skills** | https://github.com/obra/superpowers/tree/main/skills/writing-skills | Create and test new skills. | Build custom HermesAgent skills. | **Yes** |
| **using-superpowers** | https://github.com/obra/superpowers/tree/main/skills/using-superpowers | Bootstrap for finding and invoking skills. | Session start skill. | **Yes** |

### 5.2 Specialized Agent Skills (anthropics/skills)

| Name | Source | Description | Use Case | Recommended |
|------|--------|-------------|----------|-------------|
| **mcp-builder** | https://github.com/anthropics/skills/tree/main/skills/mcp-builder | Build high-quality MCP servers in Python/Node. | When extending HermesAgent with new MCP servers. | **Yes** |
| **skill-creator** | https://github.com/anthropics/skills/tree/main/skills/skill-creator | Create, edit, and benchmark new skills. | Author custom Agent Skills for the stack. | **Yes** |
| **webapp-testing** | https://github.com/anthropics/skills/tree/main/skills/webapp-testing | Playwright-based local webapp testing and debugging. | Verify Hermes web UI, capture screenshots. | **Yes** |
| **doc-coauthoring** | https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring | Structured documentation/spec co-authoring workflow. | Write runbooks, specs, decision docs. | **Yes** |
| **frontend-design** | https://github.com/anthropics/skills/tree/main/skills/frontend-design | Distinctive visual design guidance for UI work. | Avoid templated UI defaults. | Optional |
| **web-artifacts-builder** | https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder | Complex React + Tailwind + shadcn/ui artifacts. | Build rich web UI artifacts for proofs. | Optional |
| **theme-factory** | https://github.com/anthropics/skills/tree/main/skills/theme-factory | Apply/generate themes for slides/docs/HTML. | Consistent styling for documentation/proofs. | Optional |
| **claude-api** | https://github.com/anthropics/skills/tree/main/skills/claude-api | Reference for Claude API / Anthropic SDK, model IDs, pricing, tool use, MCP. | When building with Anthropic APIs. | Optional |
| **docx** | https://github.com/anthropics/skills/tree/main/skills/docx | Create, read, edit Word `.docx` files. | Generate professional documents. | Optional |
| **pptx** | https://github.com/anthropics/skills/tree/main/skills/pptx | Create and edit PowerPoint `.pptx` files. | Decks, presentations, pitch docs. | Optional |
| **xlsx** | https://github.com/anthropics/skills/tree/main/skills/xlsx | Create, read, edit spreadsheets. | Data tables, budgets, inventories. | Optional |
| **pdf** | https://github.com/anthropics/skills/tree/main/skills/pdf | Extract, merge, split, create, OCR PDFs. | Document processing. | Optional |
| **canvas-design** | https://github.com/anthropics/skills/tree/main/skills/canvas-design | Create visual art in PNG/PDF. | Marketing/art assets. | Optional |
| **algorithmic-art** | https://github.com/anthropics/skills/tree/main/skills/algorithmic-art | p5.js generative art. | Generative art, visual experiments. | Optional |
| **internal-comms** | https://github.com/anthropics/skills/tree/main/skills/internal-comms | Internal communications formats. | Status reports, incident updates. | Optional |
| **slack-gif-creator** | https://github.com/anthropics/skills/tree/main/skills/slack-gif-creator | Animated GIFs optimized for Slack. | Team comms assets. | Optional |
| **brand-guidelines** | https://github.com/anthropics/skills/tree/main/skills/brand-guidelines | Apply brand colors/typography. | Company style consistency. | Optional |

---

## 6. Combined Lanes — How to Merge Skills + MCP Servers

### 6.1 HermesProof Agentic Coding Lane

Use this lane for every code task in the DaveAI stack.

| Role | Items |
|------|-------|
| Planning | `brainstorming`, `writing-plans` |
| Execution | `subagent-driven-development`, `executing-plans`, `wcgw`, `DesktopCommanderMCP` |
| Quality | `test-driven-development`, `requesting-code-review`, `receiving-code-review` |
| Verification | `verification-before-completion`, `systematic-debugging` |
| Version control | `server-git`, `GitHub MCP`, `GitLab MCP`, `using-git-worktrees` |
| Environment | `server-filesystem`, `PowerShell.MCP`, `docker-mcp` |

### 6.2 Web UI / Proof / Debug Lane

Use this for Hermes web UI and Chrome Canary proofs.

| Role | Items |
|------|-------|
| Browser | `Chrome DevTools MCP`, `Playwright MCP` |
| Web test | `webapp-testing` skill |
| Artifacts | `web-artifacts-builder`, `frontend-design`, `theme-factory` |
| Evidence | `canary_only_testing` gate, `Chrome DevTools MCP` network/perf |

### 6.3 VPS / Docker / SSH Admin Lane

Use this for managing the Hostinger VPS and Docker stacks.

| Role | Items |
|------|-------|
| Remote shell | `mcp-ssh (xiongjiwei)`, `ssh-mcp (slepp)` |
| Container | `docker-mcp` |
| System | `PowerShell.MCP` (Windows side), `server-filesystem` |
| Docs | `doc-coauthoring` |

### 6.4 Reverse Engineering Lane

Use this for ArchonRE and binary analysis work.

| Role | Items |
|------|-------|
| RE | `Ghidra MCP (bethington)`, `GhidraMCP (LaurieWired)` |
| Shell | `wcgw`, `PowerShell.MCP` |
| Context | `Context7`, `server-memory` |
| Plan | `writing-plans`, `systematic-debugging` |

### 6.5 Media / IPTV / 3D Farm Lane

Use this for Jellyfin, IPTV restream, and 3D farm media work.

| Role | Items |
|------|-------|
| Media server | `Jellyfin MCP (lidless-labs)` |
| Transcode | `FFmpeg MCP (dubnium0)`, `ffmpeg-mcp (windsornguyen)` |
| Web/API glue | `anythingmcp`, `server-fetch` |
| 3D farm logs | `mcp-ssh`, `docker-mcp`, `server-sequentialthinking` |

### 6.6 Documentation & Office Lane

| Role | Items |
|------|-------|
| Documents | `docx`, `pptx`, `xlsx`, `pdf` |
| Coauthor | `doc-coauthoring` |
| Brand | `brand-guidelines`, `theme-factory` |
| Context | `Context7` |

---

## 7. Safe MCP Registry Rules

1. **Registry root:** `.hermesproof/mcp-registry/`.
2. **Backup existing custom configs before any change.** Store SHA256 hash in `mcp-registry.json`.
3. **Never overwrite** an existing `mcp.json` / `.mcp/` / `.hermesproof/skills/` entry without explicit user approval.
4. **Pin versions** in `mcp-registry.json` (no `latest` except in discovery).
5. **Bun `1.13.x` only** for any Node-based MCP server install.
6. **Chrome Canary only** for browser MCP proofs.
7. **Add HermesProof gate** `canary_only_testing` before release claims.

---

## 8. Next Steps

1. Copy `mcp-registry.json` from `G:\Github\HermesProof-MCP-Research\` to `.hermesproof\mcp-registry\`.
2. Set `enabled: true` for the **bold/recommended** items in the registry.
3. Start with the **HermesProof Agentic Coding Lane** and **Web UI / Proof / Debug Lane**.
4. Install Chrome Canary and create the dedicated `C:\ChromeCanary_KiloProof` profile.
5. Add `DesktopCommanderMCP`, `Chrome DevTools MCP`, and `wcgw` first.
6. Add the `obra/superpowers` skills to `.hermesproof/skills/`.
7. Run the `canary_only_testing` gate before any release claim.

---

## 9. VS Code Environment Tooling

`mkhl.direnv` is the only non-MCP tool intentionally included. It is the cleanest way to manage per-project environment variables in VS Code and is fully compatible with the safe MCP registry pattern.

| Name | Link | Description | Use Case | Recommended |
|------|------|-------------|----------|-------------|
| **direnv CLI** | https://direnv.net/ | Per-directory environment loader for shells. | Keep `BUN_VERSION`, `API_KEY`, `NODE_PATH`, etc. scoped to a project without polluting the global shell. | **Yes** |
| **mkhl.direnv** | VS Code marketplace `mkhl.direnv` | VS Code extension that pushes `.envrc` values into the extension host, integrated terminals, and shell tasks. | VS Code picks up `direnv` automatically, reloads when `.envrc` changes, and shows environment deltas in the status bar. | **Yes** |

### Why this fits HermesProof

- **No secret leaks in global environment.** `API_KEY`, `JELLYFIN_API_KEY`, `DIRENV_WATCHES` live inside the project.
- **Bun pinning enforcement.** Put `export BUN_VERSION=1.13.x` in a repo `.envrc` and the integrated terminal picks it up.
- **MCP server configs become portable.** `mcp-registry.json` can reference `${env:VAR}` style variables and `direnv` loads them per project.
- **Windows friendly.** Install via `winget install --id=Direnv.Direnv` and set `direnv.path.executable` to the absolute path in VS Code settings.

### Quick start

```powershell
winget install --id=Direnv.Direnv -e --accept-package-agreements --accept-source-agreements
# In VS Code extension: install mkhl.direnv
# Add to .envrc in a project root:
echo "export BUN_VERSION=1.13.x" > .envrc
```

---

## 10. License & Cost Notes

- All entries are free for personal, educational, or non-profit use unless the table explicitly notes a paid/cloud requirement.
- Always verify the repository license before commercial use.
- No paid-only or SaaS-required MCP servers are marked as recommended.
