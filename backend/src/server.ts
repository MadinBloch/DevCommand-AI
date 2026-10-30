import "dotenv/config";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cors from "cors";
import helmet from "helmet";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "./db.js";
import { gh } from "./github.js";
import { createPlan } from "./services/planner.js";
import { executionCapability, listAgentsDetailed } from "./agents/registry.js";
import {
  approveRun,
  clearUserToken,
  retrySubTask,
  setUserToken,
  startFeatureRun,
  startSupervisorLoop,
  scheduleReadySubTasks,
} from "./services/supervisor.js";
import { getUserLlmKeys, persistGithubToken } from "./services/userKeys.js";
import { encryptSecret, looksLikeOpenAiKey, maskKey } from "./services/secrets.js";
import { startWorkers } from "./services/worker.js";
import { probeCli } from "./services/cliProbe.js";
import { runCli } from "./services/cliRunner.js";
import { dockerWorkerEnabled } from "./services/workspace.js";
import { getPrCiStatus } from "./services/ciStatus.js";
import { writeAudit } from "./services/audit.js";

declare module "express-session" {
  interface SessionData {
    githubAccessToken?: string;
    githubUser?: { id: number; login: string; avatar_url?: string; name?: string; email?: string };
    oauthState?: string;
  }
}

const app = express();
const port = Number(process.env.PORT || 4000);
const prod = process.env.NODE_ENV === "production";
const PgSession = connectPgSimple(session);

app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin: process.env.APP_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "200kb" }));
app.use(
  session({
    store: process.env.DATABASE_URL
      ? new PgSession({ conString: process.env.DATABASE_URL, createTableIfMissing: true })
      : undefined,
    name: "devcommand.sid",
    secret: process.env.SESSION_SECRET || "dev-only-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: prod, sameSite: "lax", maxAge: 43200000 },
  })
);

const needAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.session.githubAccessToken || !req.session.githubUser) {
    res.status(401).json({ error: "Sign in with GitHub first." });
    return;
  }
  setUserToken(String(req.session.githubUser.id), req.session.githubAccessToken);
  next();
};

async function upsertUser(ghUser: {
  id: number;
  login: string;
  avatar_url?: string;
  name?: string;
  email?: string;
}) {
  return prisma.user.upsert({
    where: { id: String(ghUser.id) },
    create: {
      id: String(ghUser.id),
      githubId: ghUser.id,
      login: ghUser.login,
      name: ghUser.name || null,
      avatarUrl: ghUser.avatar_url || null,
      email: ghUser.email || null,
    },
    update: {
      login: ghUser.login,
      name: ghUser.name || null,
      avatarUrl: ghUser.avatar_url || null,
      email: ghUser.email || null,
    },
  });
}

app.get("/api/health", (_q, s) =>
  s.json({
    ok: true,
    app: "DevCommand AI",
    agentMode: process.env.AGENT_MODE || "manual",
    canCommit: executionCapability().canCommit,
    dockerWorker: dockerWorkerEnabled(),
    queue: "pg-boss",
    phases: ["scan", "plan", "assign", "commit", "validate", "pr", "approve", "deploy"],
  })
);

app.get("/api/agents", async (req, res) => {
  let userKeys: {
    openaiApiKey?: string | null;
    anthropicApiKey?: string | null;
    geminiApiKey?: string | null;
  } = {};
  if (req.session.githubUser) {
    userKeys = await getUserLlmKeys(String(req.session.githubUser.id));
  }
  const agents = await listAgentsDetailed(userKeys);
  const configs = req.session.githubUser ? await prisma.agentConfig.findMany({ where: { userId: String(req.session.githubUser.id) } }) : [];
  const configsByProvider = new Map(configs.map((config) => [config.provider, config]));
  const cap = executionCapability(userKeys);
  const anyCli = agents.some(
    (a) => ["codex", "claude", "gemini", "antigravity"].includes(a.name) && a.connected
  );
  res.json({
    agents: agents.map((a) => ({
      name: a.name,
      displayName: a.displayName,
      available: a.connected || a.available,
      connected: a.connected,
      enabled: configsByProvider.get(a.name)?.enabled ?? a.enabled,
      selectedModel: ((configsByProvider.get(a.name)?.configJson as Record<string, unknown> | null)?.model as string | undefined) || "default",
      mode: a.mode,
      reason: a.reason,
      version: a.version,
      requires: a.requires,
      executionState: a.executionState,
    })),
    mode: cap.mode,
    llmPlanner: Boolean(
      userKeys.openaiApiKey ||
        userKeys.anthropicApiKey ||
        process.env.OPENAI_API_KEY ||
        process.env.ANTHROPIC_API_KEY
    ),
    llmCoder: cap.llmCoder,
    canCommit: cap.canCommit || anyCli,
    hasUserOpenAiKey: Boolean(userKeys.openaiApiKey),
    dockerWorker: cap.dockerWorker,
  });
});

app.get("/api/agents/account-login-status", needAuth, async (_req, res) => {
  const binaries = [
    { provider: "codex", binary: "codex" },
    { provider: "claude", binary: "claude" },
    { provider: "gemini", binary: "gemini" },
  ] as const;
  const statuses = await Promise.all(binaries.map(async ({ provider, binary }) => {
    const probe = await probeCli(binary);
    if (!probe.installed) return { provider, installed: false, authenticated: false, message: "CLI not installed on worker." };
    if (provider === "claude") {
      const result = await runCli({ command: "claude", args: ["auth", "status"], cwd: process.cwd(), timeoutMs: 10000 });
      if (result.code !== 0 || result.timedOut) return { provider, installed: true, authenticated: false, message: "Claude Code CLI authentication not verified." };
      try {
        const status = JSON.parse(result.stdout) as { loggedIn?: boolean };
        return { provider, installed: true, authenticated: status.loggedIn === true, message: status.loggedIn === true ? "Claude Code CLI reports authenticated worker account." : "Claude Code CLI is not signed in." };
      } catch {
        return { provider, installed: true, authenticated: null, message: "Claude CLI status returned an unrecognized response; cannot verify authentication." };
      }
    }
    if (provider === "gemini") {
      return { provider, installed: true, authenticated: null, message: "Gemini CLI is installed; browser login cannot be verified reliably by version check. Test a saved Gemini API key in Settings instead, or use an isolated CLI smoke test." };
    }
    const result = await runCli({ command: "codex", args: ["login", "status"], cwd: process.cwd(), timeoutMs: 10000 });
    return { provider, installed: true, authenticated: result.code === 0 && !result.timedOut,
      message: result.code === 0 && !result.timedOut
        ? "Codex worker account is signed in. This is a host-level identity, not a per-user login."
        : "Codex worker account not authenticated or login status could not be checked." };
  }));
  res.json({ statuses, scope: "worker-host", accountLoginInBrowser: false });
});

app.get("/api/overview", needAuth, async (req, res) => {
  const userId = String(req.session.githubUser!.id);
  const [runs, agents] = await Promise.all([
    prisma.featureRun.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { subTasks: { select: { status: true, agent: true } } },
    }),
    listAgentsDetailed(await getUserLlmKeys(userId)),
  ]);
  const active = runs.filter((r) =>
    ["queued", "scanning", "planning", "running", "testing", "reviewing"].includes(r.status)
  ).length;
  const awaiting = runs.filter((r) => r.status === "awaiting_approval").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  res.json({
    stats: {
      runs: runs.length,
      active,
      awaitingApproval: awaiting,
      failed,
      agentsConnected: agents.filter((a) => a.connected).length,
    },
    recentRuns: runs.slice(0, 8),
    agents,
  });
});

app.get("/api/activity", needAuth, async (req, res) => {
  const userId = String(req.session.githubUser!.id);
  const logs = await prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ logs });
});

app.get("/api/settings", needAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: String(req.session.githubUser!.id) } });
  const keys = await getUserLlmKeys(String(req.session.githubUser!.id));
  const configs = await prisma.agentConfig.findMany({
    where: { userId: String(req.session.githubUser!.id) },
  });
  res.json({
    openaiApiKeyMasked: maskKey(keys.openaiApiKey),
    hasOpenAiKey: Boolean(keys.openaiApiKey),
    anthropicApiKeyMasked: maskKey(keys.anthropicApiKey),
    hasAnthropicKey: Boolean(keys.anthropicApiKey),
    geminiApiKeyMasked: maskKey(keys.geminiApiKey),
    hasGeminiKey: Boolean(keys.geminiApiKey),
    serverHasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
    dockerWorker: dockerWorkerEnabled(),
    agentConfigs: configs,
    login: user?.login || req.session.githubUser!.login,
  });
});

const settingsSchema = z.object({
  openaiApiKey: z.string().trim().max(200).optional().nullable(),
  anthropicApiKey: z.string().trim().max(200).optional().nullable(),
  geminiApiKey: z.string().trim().max(200).optional().nullable(),
  clearOpenAiKey: z.boolean().optional(),
  clearAnthropicKey: z.boolean().optional(),
  clearGeminiKey: z.boolean().optional(),
});

app.put("/api/settings", needAuth, async (req, res) => {
  const p = settingsSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "Invalid settings", details: p.error.flatten() });
    return;
  }
  const userId = String(req.session.githubUser!.id);
  await upsertUser(req.session.githubUser as any);

  const data: {
    openaiApiKeyEnc?: string | null;
    anthropicApiKeyEnc?: string | null;
    geminiApiKeyEnc?: string | null;
  } = {};

  if (p.data.clearOpenAiKey) data.openaiApiKeyEnc = null;
  else if (typeof p.data.openaiApiKey === "string" && p.data.openaiApiKey.length > 0) {
    if (!looksLikeOpenAiKey(p.data.openaiApiKey) && !p.data.openaiApiKey.startsWith("sk-")) {
      res.status(400).json({ error: "OpenAI key should look like sk-…" });
      return;
    }
    data.openaiApiKeyEnc = encryptSecret(p.data.openaiApiKey.trim());
  }

  if (p.data.clearAnthropicKey) data.anthropicApiKeyEnc = null;
  else if (typeof p.data.anthropicApiKey === "string" && p.data.anthropicApiKey.length > 0) {
    data.anthropicApiKeyEnc = encryptSecret(p.data.anthropicApiKey.trim());
  }

  if (p.data.clearGeminiKey) data.geminiApiKeyEnc = null;
  else if (typeof p.data.geminiApiKey === "string" && p.data.geminiApiKey.length > 0) {
    data.geminiApiKeyEnc = encryptSecret(p.data.geminiApiKey.trim());
  }

  if (!Object.keys(data).length) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  await prisma.user.update({ where: { id: userId }, data });
  const keys = await getUserLlmKeys(userId);
  res.json({
    ok: true,
    openaiApiKeyMasked: maskKey(keys.openaiApiKey),
    hasOpenAiKey: Boolean(keys.openaiApiKey),
    anthropicApiKeyMasked: maskKey(keys.anthropicApiKey),
    hasAnthropicKey: Boolean(keys.anthropicApiKey),
    geminiApiKeyMasked: maskKey(keys.geminiApiKey),
    hasGeminiKey: Boolean(keys.geminiApiKey),
  });
});

const providerTestSchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini"]),
});

app.post("/api/settings/test-connection", needAuth, async (req, res) => {
  const parsed = providerTestSchema.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Invalid provider" });
  const provider = parsed.data.provider;
  const keys = await getUserLlmKeys(String(req.session.githubUser!.id));
  const key = provider === "openai" ? keys.openaiApiKey : provider === "anthropic" ? keys.anthropicApiKey : keys.geminiApiKey;
  if (!key) return void res.status(400).json({ error: "Save this provider's API key before testing." });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const url = provider === "openai"
      ? "https://api.openai.com/v1/models"
      : provider === "anthropic"
        ? "https://api.anthropic.com/v1/models?limit=1"
        : "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1";
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: provider === "openai"
        ? { Authorization: `Bearer ${key}` }
        : provider === "anthropic"
          ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
          : { "x-goog-api-key": key },
    });
    if (!response.ok) {
      return void res.status(200).json({ connected: false, provider, message: response.status === 401 || response.status === 403 ? "Credentials rejected or insufficient permissions." : `Provider returned HTTP ${response.status}. Check service access.` });
    }
    return void res.json({ connected: true, provider, message: "API credential verified. Coding CLI/worker availability is separate." });
  } catch {
    return void res.status(200).json({ connected: false, provider, message: "Connection test failed or timed out." });
  } finally {
    clearTimeout(timeout);
  }
});

const agentConfigSchema = z.object({
  provider: z.enum(["codex", "claude", "gemini", "antigravity", "llm", "testing"]),
  enabled: z.boolean(),
  mode: z.string().max(40).optional(),
  configJson: z.record(z.unknown()).optional(),
});

app.put("/api/agents/:provider", needAuth, async (req, res) => {
  const provider = req.params.provider;
  const p = agentConfigSchema.safeParse({ ...req.body, provider });
  if (!p.success) {
    res.status(400).json({ error: "Invalid agent config", details: p.error.flatten() });
    return;
  }
  const userId = String(req.session.githubUser!.id);
  const row = await prisma.agentConfig.upsert({
    where: { userId_provider: { userId, provider: p.data.provider } },
    create: {
      userId,
      provider: p.data.provider,
      enabled: p.data.enabled,
      mode: p.data.mode || "auto",
      configJson: (p.data.configJson || {}) as object,
    },
    update: {
      enabled: p.data.enabled,
      mode: p.data.mode || "auto",
      configJson: (p.data.configJson || {}) as object,
    },
  });
  await writeAudit({ userId, action: "agent.config", detail: `${provider} enabled=${p.data.enabled}` });
  res.json({ config: row });
});

app.get("/api/auth/github", (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CALLBACK_URL) {
    res.status(503).json({ error: "GitHub OAuth is not configured." });
    return;
  }
  const state = randomBytes(24).toString("hex");
  req.session.oauthState = state;
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID);
  u.searchParams.set("redirect_uri", process.env.GITHUB_CALLBACK_URL);
  u.searchParams.set("scope", "read:user user:email repo");
  u.searchParams.set("state", state);
  res.redirect(u.toString());
});

app.get("/api/auth/github/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const expected = req.session.oauthState || "";
  delete req.session.oauthState;
  if (
    !code ||
    !state ||
    !expected ||
    state.length !== expected.length ||
    !timingSafeEqual(Buffer.from(state), Buffer.from(expected))
  ) {
    res.status(400).send("Invalid OAuth state. Restart sign-in.");
    return;
  }
  try {
    const tr = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const td = (await tr.json()) as { access_token?: string };
    if (!tr.ok || !td.access_token) throw new Error("OAuth exchange failed");
    const ghUser = (await gh("/user", td.access_token)) as {
      id: number;
      login: string;
      avatar_url?: string;
      name?: string;
      email?: string;
    };
    let email = ghUser.email;
    if (!email) {
      try {
        const emails = (await gh("/user/emails", td.access_token)) as Array<{
          email: string;
          primary?: boolean;
          verified?: boolean;
        }>;
        email = emails.find((e) => e.primary && e.verified)?.email || emails[0]?.email;
      } catch {
        /* optional */
      }
    }
    const user = { ...ghUser, email: email || undefined };
    await upsertUser(user);
    req.session.githubAccessToken = td.access_token;
    req.session.githubUser = user;
    setUserToken(String(user.id), td.access_token);
    await persistGithubToken(String(user.id), td.access_token).catch(() => undefined);
    await writeAudit({ userId: String(user.id), action: "auth.login", detail: user.login });
    req.session.save((e) => {
      if (e) {
        res.status(500).send("Could not create session.");
        return;
      }
      res.redirect(process.env.APP_ORIGIN || "http://localhost:5173");
    });
  } catch {
    res.status(502).send("GitHub sign-in failed. Please retry.");
  }
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.session.githubUser) {
    res.json({ user: null });
    return;
  }
  const dbUser = await prisma.user.findUnique({ where: { id: String(req.session.githubUser.id) } });
  if (req.session.githubAccessToken) setUserToken(String(req.session.githubUser.id), req.session.githubAccessToken);
  res.json({
    user: {
      id: req.session.githubUser.id,
      login: req.session.githubUser.login,
      name: dbUser?.name || req.session.githubUser.name || null,
      avatarUrl: dbUser?.avatarUrl || req.session.githubUser.avatar_url || null,
      email: dbUser?.email || req.session.githubUser.email || null,
    },
  });
});

app.post("/api/auth/logout", (req, res) => {
  if (req.session.githubUser) clearUserToken(String(req.session.githubUser.id));
  req.session.destroy(() => {
    res.clearCookie("devcommand.sid");
    res.status(204).end();
  });
});

app.get("/api/github/repos", needAuth, async (req, res) => {
  try {
    const rs = (await gh(
      "/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member",
      req.session.githubAccessToken!
    )) as any[];
    res.json(
      rs.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        name: r.name,
        private: r.private,
        defaultBranch: r.default_branch,
        description: r.description,
        htmlUrl: r.html_url,
        language: r.language,
        permissions: { push: !!r.permissions?.push, admin: !!r.permissions?.admin },
      }))
    );
  } catch (e) {
    const x = e as any;
    res.status(x.status || 502).json({ error: x.message || "Could not load repositories" });
  }
});

const taskSchema = z.object({
  repoFullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  title: z.string().trim().min(3).max(120),
  prompt: z.string().trim().min(10).max(12000),
});

app.post("/api/tasks", needAuth, async (req, res) => {
  const p = taskSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "Invalid task input", details: p.error.flatten() });
    return;
  }
  try {
    const r = (await gh("/repos/" + p.data.repoFullName, req.session.githubAccessToken!)) as any;
    if (!r.permissions?.push && !r.permissions?.admin) {
      res.status(403).json({ error: "Write access required for this repository." });
      return;
    }
    await upsertUser(req.session.githubUser as any);
    const task = await prisma.task.create({
      data: {
        userId: String(req.session.githubUser!.id),
        repoFullName: p.data.repoFullName,
        title: p.data.title,
        prompt: p.data.prompt,
        planJson: createPlan(p.data.prompt) as any,
      },
    });
    res.status(201).json({ task });
  } catch (e) {
    const x = e as any;
    res.status(x.status || 500).json({ error: x.message || "Task creation failed" });
  }
});

app.get("/api/tasks", needAuth, async (req, res) => {
  const tasks = await prisma.task.findMany({
    where: { userId: String(req.session.githubUser!.id) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(tasks);
});

const runSchema = z.object({
  repoFullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  title: z.string().trim().min(3).max(120),
  goal: z.string().trim().min(10).max(12000),
  autoStart: z.boolean().optional().default(true),
});

app.post("/api/runs", needAuth, async (req, res) => {
  const p = runSchema.safeParse(req.body);
  if (!p.success) {
    res.status(400).json({ error: "Invalid feature run input", details: p.error.flatten() });
    return;
  }
  try {
    const r = (await gh("/repos/" + p.data.repoFullName, req.session.githubAccessToken!)) as any;
    if (!r.permissions?.push && !r.permissions?.admin) {
      res.status(403).json({ error: "Write access required for this repository." });
      return;
    }
    await upsertUser(req.session.githubUser as any);
    const userKeys = await getUserLlmKeys(String(req.session.githubUser!.id));
    const agents = await listAgentsDetailed(userKeys);
    const cap = executionCapability(userKeys);
    const anyCli = agents.some(
      (a) => ["codex", "claude", "gemini", "antigravity", "llm"].includes(a.name) && a.connected
    );
    if (!cap.canCommit && !anyCli) {
      res.status(400).json({
        error:
          "No coding engine connected. Install Codex/Claude/Gemini/Antigravity CLI on the worker, add an OpenAI key in Settings, or set AGENT_MODE=simulate for demo-only commits.",
      });
      return;
    }
    const run = await prisma.featureRun.create({
      data: {
        userId: String(req.session.githubUser!.id),
        repoFullName: p.data.repoFullName,
        title: p.data.title,
        goal: p.data.goal,
        status: "queued",
      },
    });
    if (p.data.autoStart) {
      const started = await startFeatureRun(run.id);
      res.status(201).json({ run: started });
      return;
    }
    res.status(201).json({
      run: await prisma.featureRun.findUnique({
        where: { id: run.id },
        include: { subTasks: { orderBy: { orderIndex: "asc" } } },
      }),
    });
  } catch (e) {
    const x = e as any;
    res.status(x.status || 500).json({ error: x.message || "Feature run creation failed" });
  }
});

app.get("/api/runs", needAuth, async (req, res) => {
  const runs = await prisma.featureRun.findMany({
    where: { userId: String(req.session.githubUser!.id) },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: {
      subTasks: { orderBy: { orderIndex: "asc" }, select: { id: true, status: true, agent: true, title: true } },
    },
  });
  res.json(runs);
});

app.get("/api/runs/:id", needAuth, async (req, res) => {
  const run = await prisma.featureRun.findFirst({
    where: { id: req.params.id, userId: String(req.session.githubUser!.id) },
    include: { subTasks: { orderBy: { orderIndex: "asc" } } },
  });
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(run);
});

app.post("/api/runs/:id/start", needAuth, async (req, res) => {
  const owned = await prisma.featureRun.findFirst({
    where: { id: req.params.id, userId: String(req.session.githubUser!.id) },
  });
  if (!owned) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  try {
    const run = await startFeatureRun(owned.id);
    res.json({ run });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Could not start run" });
  }
});

app.post("/api/runs/:id/approve", needAuth, async (req, res) => {
  const owned = await prisma.featureRun.findFirst({
    where: { id: req.params.id, userId: String(req.session.githubUser!.id) },
  });
  if (!owned) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const merge = Boolean(req.body?.merge);
  try {
    const run = await approveRun(owned.id, req.session.githubUser!.login, merge);
    res.json({ run });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || "Approval failed" });
  }
});

app.post("/api/subtasks/:id/retry", needAuth, async (req, res) => {
  const st = await prisma.subTask.findUnique({
    where: { id: req.params.id },
    include: { featureRun: true },
  });
  if (!st || st.featureRun.userId !== String(req.session.githubUser!.id)) {
    res.status(404).json({ error: "Sub-task not found" });
    return;
  }
  await retrySubTask(st.id);
  const run = await prisma.featureRun.findUnique({
    where: { id: st.featureRunId },
    include: { subTasks: { orderBy: { orderIndex: "asc" } } },
  });
  res.json({ run });
});

app.post("/api/subtasks/:id/complete-manual", needAuth, async (req, res) => {
  const st = await prisma.subTask.findUnique({
    where: { id: req.params.id },
    include: { featureRun: true },
  });
  if (!st || st.featureRun.userId !== String(req.session.githubUser!.id)) {
    res.status(404).json({ error: "Sub-task not found" });
    return;
  }
  await prisma.subTask.update({
    where: { id: st.id },
    data: {
      status: "done",
      completedAt: new Date(),
      logs: [st.logs, `Marked complete manually by ${req.session.githubUser!.login}`]
        .filter(Boolean)
        .join("\n"),
    },
  });
  await writeAudit({
    userId: String(req.session.githubUser!.id),
    featureRunId: st.featureRunId,
    action: "subtask.manual_complete",
    detail: st.title,
  });
  if (!(st.featureRun.status === "awaiting_approval" && st.agent === "human")) {
    await scheduleReadySubTasks(st.featureRunId);
  }
  const run = await prisma.featureRun.findUnique({
    where: { id: st.featureRunId },
    include: { subTasks: { orderBy: { orderIndex: "asc" } } },
  });
  res.json({ run });
});

app.get("/api/runs/:id/ci", needAuth, async (req, res) => {
  const run = await prisma.featureRun.findFirst({
    where: { id: req.params.id, userId: String(req.session.githubUser!.id) },
  });
  if (!run?.branchName) {
    res.status(404).json({ error: "Run or branch not found" });
    return;
  }
  const token = req.session.githubAccessToken!;
  const ci = await getPrCiStatus(token, run.repoFullName, run.branchName);
  res.json({ ci, prUrl: run.prUrl, branchName: run.branchName });
});

startSupervisorLoop(Number(process.env.SUPERVISOR_INTERVAL_MS || 8000));

app.listen(port, "0.0.0.0", async () => {
  console.log(`DevCommand API listening on ${port}`);
  console.log(`Agent mode: ${process.env.AGENT_MODE || "manual"}`);
  console.log(`Docker worker: ${dockerWorkerEnabled() ? "enabled" : "worktree (default)"}`);
  try {
    await startWorkers();
  } catch (e: any) {
    console.error("[worker] failed to start pg-boss:", e?.message || e);
  }
});
