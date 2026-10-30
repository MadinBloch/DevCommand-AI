# DevCommand AI

Multi-agent GitHub coding orchestrator: one feature goal → scan repo → dependency-aware plan → parallel AI coding agents in isolated worktrees (optional Docker) → verify → PR → human approve / merge.

## What it does
1. **GitHub OAuth** — persisted encrypted tokens for worker recovery
2. **Repo scan** — stack, frameworks, relevant files, test commands
3. **Planner** — heuristic by default; optional OpenAI / Anthropic for smarter plans
4. **Multi-agent assign** — Codex / Claude Code / Gemini CLI / Antigravity / testing / human
5. **pg-boss queue** — persistent, dependency-aware parallel sub-task scheduling on PostgreSQL
6. **Isolated execution** — git worktrees by default; set `DOCKER_WORKER=1` for containers
7. **Verification** — test / lint / typecheck / build worker + CI status gate before merge
8. **PR + approve gate** — PR opens only with real diffs; never auto-merges failing CI

## Stack
React + Vite + TypeScript · Express + TypeScript · Prisma + PostgreSQL · pg-boss

## Local development
Requires Node.js 20+ and PostgreSQL.

```bash
cp backend/.env.example backend/.env
# fill GITHUB_* and DATABASE_URL

npm install
npm --prefix backend install
npm --prefix frontend install
npm --prefix backend run prisma:generate
npm --prefix backend run prisma:migrate
npm run dev
```

- Frontend: http://localhost:5173  
- API health: http://localhost:4000/api/health  

### OAuth
Create an OAuth App at https://github.com/settings/developers.  
Local callback: `http://localhost:4000/api/auth/github/callback`  
Never commit the OAuth client secret.

### Real coding agents (CLIs on the worker PATH)

| Agent | Binary | Notes |
|---|---|---|
| OpenAI Codex | `codex` (+ `@openai/codex-sdk`) | API key alone is **not** Codex |
| Claude Code | `claude` | Anthropic API key alone is **not** Claude Code |
| Gemini CLI | `gemini` | Headless `-p` mode |
| Antigravity | `agy` | If missing → labeled **manual/external-worker** mode |
| LLM patch coder | — | OpenAI/Anthropic chat patches (legacy fallback) |
| Testing worker | — | Runs project verify commands in a worktree |

Live connection status: **AI Agents** tab / `GET /api/agents`. Simulated demo mode is never shown as a connected coding agent.

### Isolation & queue
- Default: local clones under `WORKSPACE_ROOT` / `.workspaces` with per-task git worktrees
- Optional: `DOCKER_WORKER=1` + Docker engine
- Queue: **pg-boss** schema `pgboss` (same Postgres as Prisma)
- Concurrency: `WORKER_CONCURRENCY`, `MAX_PARALLEL_SUBTASKS`

### How commits & PRs work

| Setup | Behavior |
|---|---|
| Codex/Claude/Gemini/`agy` CLI connected | Agent edits in worktree; DevCommand commits & pushes |
| OpenAI / Anthropic key | Built-in LLM patch coder (not a coding CLI) |
| `AGENT_MODE=simulate` | Demo commits under `.devcommand/` only |
| HTTP `CODEX_API_URL` / `ANTIGRAVITY_API_URL` | Trusted adapter; GitHub token forwarded only if `ADAPTER_FORWARD_GITHUB_TOKEN=1` |

Flow:
1. Create a feature run with a plain-language goal  
2. Supervisor scans → plans → enqueues ready sub-tasks (parallel when independent)  
3. Workers execute agents; verification runs tests  
4. When diffs exist vs default branch, a PR is opened  
5. Approve (optional merge) — merge blocked if CI is red  

**Security:** Never commit secrets. Agent CLIs do not receive GitHub tokens. Logs redact secrets. Prefer **Approve (no merge)** until CI is green.

## API surface (auth cookie required unless noted)
- `GET /api/health` · `GET /api/agents` · `GET /api/overview` · `GET /api/activity`
- `GET /api/auth/github` · callback · `GET /api/auth/me` · `POST /api/auth/logout`
- `GET /api/github/repos` · `PUT /api/settings` · `PUT /api/agents/:provider`
- `POST /api/runs` · `GET /api/runs` · `GET /api/runs/:id` · `GET /api/runs/:id/ci`
- `POST /api/runs/:id/start` · `POST /api/runs/:id/approve`
- `POST /api/subtasks/:id/retry` · `POST /api/subtasks/:id/complete-manual`

## Credentials you must provide
- GitHub OAuth app (Client ID/Secret)
- PostgreSQL `DATABASE_URL`
- At least one real coding path: install CLIs **or** OpenAI/Anthropic keys **or** trusted HTTP adapters
- Optional: `GEMINI_API_KEY`, `SECRETS_KEY`, Docker for `DOCKER_WORKER=1`

## Render
`render.yaml` defines API, static frontend, and Postgres. Set every `sync: false` value, then update `GITHUB_CALLBACK_URL`, `APP_ORIGIN`, and `VITE_API_BASE_URL` after URLs are assigned. Install coding CLIs on the worker host if you want CLI agents in production.

## Safety
Prefer **Approve (no merge)** until CI is green. Automatic merge is opt-in from the UI and blocked on failing/pending CI (unless `ALLOW_MERGE_PENDING_CI=1`).
