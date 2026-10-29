# DevCommand AI

GitHub coding orchestrator: give one feature goal → scan repo → split into agent tasks with prompts → agents edit & **commit** → validate diffs → open PR → human approve / merge.

## What it does
1. **GitHub OAuth** — signed-in users with persisted profiles
2. **Repo scan** — stack, frameworks, relevant files, test commands
3. **Planner** — heuristic by default; optional OpenAI / Anthropic for smarter plans
4. **Multi-agent assign** — Codex / Antigravity / human steps with generated prompts
5. **Commit engine** — built-in LLM coder or external adapters write files to `devcommand/…`
6. **PR + approve gate** — PR opens only when the branch has real commits; human approval before merge

## Stack
React + Vite + TypeScript · Express + TypeScript · Prisma + PostgreSQL

## Local development
Requires Node.js 20+ and PostgreSQL.

```bash
cp backend/.env.example backend/.env
# fill GITHUB_* and DATABASE_URL
# recommended: AGENT_MODE=simulate  OR  set OPENAI_API_KEY / ANTHROPIC_API_KEY

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

### How commits & PRs work

| Setup | Behavior |
|---|---|
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | Built-in **LLM coder** reads relevant files, proposes edits, commits via GitHub Git API |
| `AGENT_MODE=simulate` | Demo commits under `.devcommand/` so PRs can open without an LLM key |
| `CODEX_API_URL` / `ANTIGRAVITY_API_URL` | External adapter `POST /run`; if it returns file patches, DevCommand commits them |
| None of the above | Prompts only — no commits → no PR (GitHub rejects empty branches) |

Flow:
1. Create a feature run with a plain-language goal  
2. Supervisor scans → plans → runs each sub-task agent  
3. Successful coding steps commit to `devcommand/<run-id>`  
4. When diffs exist vs default branch, a PR is opened  
5. Approve (optional merge) in the UI  

**Security:** Never commit secrets. Adapter payloads may include a GitHub token — only point adapters at services you control. Keep `main` protected.

## API surface (auth cookie required unless noted)
- `GET /api/health` · `GET /api/agents` (`canCommit`, `llmCoder`)
- `GET /api/auth/github` · callback · `GET /api/auth/me` · `POST /api/auth/logout`
- `GET /api/github/repos`
- `POST /api/runs` · `GET /api/runs` · `GET /api/runs/:id`
- `POST /api/runs/:id/start` · `POST /api/runs/:id/approve`
- `POST /api/subtasks/:id/retry` · `POST /api/subtasks/:id/complete-manual`
- Legacy: `POST/GET /api/tasks` (plan-only)

## Render
`render.yaml` defines API, static frontend, and Postgres. Set every `sync: false` value, then update `GITHUB_CALLBACK_URL`, `APP_ORIGIN`, and `VITE_API_BASE_URL` after URLs are assigned.

## Safety
Prefer **Approve (no merge)** until CI is green. Automatic merge is opt-in from the UI.
