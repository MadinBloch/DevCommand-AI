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
# fill GITHUB_* and DATABASE_URL; AGENT_MODE=manual is the safe default; simulate is demo-only

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

### Connecting Codex and Antigravity

GitHub OAuth connects **repositories**, not coding agents. DevCommand does **not** automatically connect to the Codex or Antigravity applications. Its existing integrations expect independent, privately hosted **adapter bridge services** with a `POST /run` endpoint. Do **not** paste a ChatGPT login token or a Google account password into environment variables.

| `AGENT_MODE` | Meaning |
|---|---|
| `manual` (default) | Real agent execution is unavailable until you configure adapters. Generated prompts are presented for manual work; completion requires actual branch commits. |
| `simulate` | Demo only; no files, tests or commits are produced. Cannot create an empty PR. |

To enable a real agent:
1. Deploy an adapter service you operate that can invoke the chosen agent in a controlled checkout. It must accept `POST /run` and return `{ "success": true, "available": true, "logs": "...", "summary": "...", "result": {} }` **only after it really performs the task**. The response alone is not proof of code changes: DevCommand compares GitHub branches separately.
2. Configure `CODEX_API_URL` or `ANTIGRAVITY_API_URL` to the trusted **HTTPS adapter base URL** (without `/run`). Set its corresponding `*_API_KEY` only through private server-side environment variables. These endpoints are **DevCommand adapter URLs**, not official default Codex/Antigravity URLs.
3. Set `AGENT_MODE=manual` and restart the backend. The Agents screen shows available providers when endpoints are configured. An optional OpenAI/Anthropic planner key does **not** connect a coding agent.
4. In the feature run, inspect the generated prompt and the agent output; verify that the agent pushed code to `devcommand/<run-id>`. If using manual mode, copy the prompt into your coding tool, push the resulting code, and mark the manual task complete.
5. A PR can be opened only when the feature branch differs from the base branch. Approval requires an existing PR and a non-empty diff. Never treat simulated or unexecuted tasks as successful code changes.

**Security:** Existing adapter calls pass a GitHub access token in the job payload. Use only adapter endpoints you control and trust. Never configure a public third-party webhook as an adapter, log the payload/token, or commit secrets. A future GitHub-App installation token with minimal permissions is recommended.


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
