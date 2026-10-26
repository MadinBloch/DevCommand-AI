# DevCommand AI

Separate GitHub coding-manager MVP scaffold. The current version plans work; it is not yet an autonomous coding agent.

## Included
- GitHub OAuth and repository selection
- Natural-language task creation with a deterministic reviewable plan
- PostgreSQL-backed task history
- Agent registry marks Antigravity/Codex execution unavailable until supported adapters are configured
- No automatic merge to `main`

## Stack
React + Vite + TypeScript; Express + TypeScript; Prisma + PostgreSQL.

## OAuth
Create an OAuth App at https://github.com/settings/developers.
Local callback: `http://localhost:4000/api/auth/github/callback`
Production callback: `https://<backend-host>.onrender.com/api/auth/github/callback`
Set the homepage to the actual deployed frontend URL. Never commit the OAuth client secret.

## Local development
Requires Node.js 20+ and PostgreSQL.
```bash
cp backend/.env.example backend/.env
npm install
npm --prefix backend install
npm --prefix frontend install
npm --prefix backend run prisma:generate
npm --prefix backend run prisma:migrate:dev
npm run dev
```
Frontend: `http://localhost:5173`; API health: `http://localhost:4000/api/health`.

## Render
A `render.yaml` blueprint defines backend, frontend, and PostgreSQL resources. Configure every `sync: false` environment value before applying. After Render assigns public URLs, update `GITHUB_CALLBACK_URL`, `APP_ORIGIN`, and `VITE_API_BASE_URL` to the actual URLs.

## Current limitations
Task creation does not execute code changes, create PRs, review code, or merge changes. No ChatGPT Plus session integration is implemented, and Antigravity/Codex adapters are not connected. Keep `main` protected and require human approval before merging.
