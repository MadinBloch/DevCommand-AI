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
import { listAgents } from "./agents/registry.js";
import {
  approveRun,
  clearUserToken,
  retrySubTask,
  setUserToken,
  startFeatureRun,
  startSupervisorLoop,
} from "./services/supervisor.js";

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
    phases: ["scan", "plan", "assign", "supervise", "test", "approve", "deploy"],
  })
);

app.get("/api/agents", (_q, res) => {
  res.json({
    agents: listAgents(),
    mode: process.env.AGENT_MODE || "manual",
    llmPlanner: Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY),
  });
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
  if (!(st.featureRun.status === "awaiting_approval" && st.agent === "human")) {
    await startFeatureRun(st.featureRunId);
  }
  const run = await prisma.featureRun.findUnique({
    where: { id: st.featureRunId },
    include: { subTasks: { orderBy: { orderIndex: "asc" } } },
  });
  res.json({ run });
});

startSupervisorLoop(Number(process.env.SUPERVISOR_INTERVAL_MS || 8000));

app.listen(port, "0.0.0.0", () => {
  console.log(`DevCommand API listening on ${port}`);
  console.log(`Agent mode: ${process.env.AGENT_MODE || "manual"}`);
});
