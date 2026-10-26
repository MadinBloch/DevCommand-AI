# DevCommand AI

GitHub coding orchestrator: give one feature goal, and DevCommand scans the repo, splits work into sub-tasks, generates agent prompts, assigns Codex / Antigravity / human steps, supervises progress, then waits for your approval before merge/deploy.

## What it does
1. **GitHub OAuth** — signed-in users with persisted profiles
2. **Repo scan** — stack, frameworks, relevant files, test commands
3. **Planner** — heuristic by default; optional OpenAI / Anthropic for smarter plans
4. **Auto prompts** — per-agent prompts ready to copy or send to adapters
5. **Supervisor** — dependency-aware queue, retries / follow-ups
6. **Deploy gate** — opens a PR, human approve, optional merge

## Stack
React + Vite + TypeScript · Express + TypeScript · Prisma + PostgreSQL

## Local development
Requires Node.js 20+ and PostgreSQL.

```bash
cp backend/.env.example backend/.env
# fill GITHUB_* and DATABASE_URL; AGENT_MODE=simulate is fine for demos

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

### Agent modes
| `AGENT_MODE` | Behavior |
|---|---|
| `simulate` (default in example) | Advances Codex / Antigravity steps locally for demos |
| `manual` / unset | Marks coding steps complete with prompts ready to paste into real agents |

Optional real adapters:
- `ANTIGRAVITY_API_URL` (+ optional `ANTIGRAVITY_API_KEY`)
- `CODEX_API_URL` (+ optional `CODEX_API_KEY`)

Optional LLM planner:
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`

## API surface (auth cookie required unless noted)
- `GET /api/health` · `GET /api/agents`
- `GET /api/auth/github` · callback · `GET /api/auth/me` · `POST /api/auth/logout`
- `GET /api/github/repos`
- `POST /api/runs` · `GET /api/runs` · `GET /api/runs/:id`
- `POST /api/runs/:id/start` · `POST /api/runs/:id/approve`
- `POST /api/subtasks/:id/retry` · `POST /api/subtasks/:id/complete-manual`
- Legacy: `POST/GET /api/tasks` (plan-only)

## Render
`render.yaml` defines API, static frontend, and Postgres. Set every `sync: false` value, then update `GITHUB_CALLBACK_URL`, `APP_ORIGIN`, and `VITE_API_BASE_URL` after URLs are assigned.

## Safety
Keep `main` protected. Prefer **Approve (no merge)** until CI is green. Automatic merge is opt-in from the UI.
