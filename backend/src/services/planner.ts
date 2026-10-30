import type { RepoScan } from "./scanner.js";

export type PlannedStep = {
  title: string;
  objective: string;
  agent: "codex" | "claude" | "gemini" | "antigravity" | "testing" | "human" | "llm";
  criteria: string[];
  dependsOnOrders: number[];
  generatedPrompt: string;
};

function buildPrompt(opts: {
  agent: string;
  title: string;
  objective: string;
  goal: string;
  scan: RepoScan;
  criteria: string[];
  order: number;
  total: number;
}) {
  const { agent, title, objective, goal, scan, criteria, order, total } = opts;
  return [
    `# DevCommand task ${order + 1}/${total}: ${title}`,
    ``,
    `You are the **${agent}** agent working inside repository \`${scan.fullName}\` (branch base: \`${scan.defaultBranch}\`).`,
    ``,
    `## Feature goal`,
    goal.trim(),
    ``,
    `## Your objective`,
    objective,
    ``,
    `## Repo context`,
    scan.summary,
    scan.relevantFiles.length
      ? `Relevant paths to inspect first:\n${scan.relevantFiles
          .slice(0, 15)
          .map((f) => `- ${f}`)
          .join("\n")}`
      : "",
    scan.testCommand ? `Preferred test command: \`${scan.testCommand}\`` : "",
    ``,
    `## Acceptance criteria`,
    ...criteria.map((c) => `- [ ] ${c}`),
    ``,
    `## Rules`,
    `- Work only on this step; do not expand scope.`,
    `- Prefer small, reviewable commits.`,
    `- Do not merge to ${scan.defaultBranch}; leave changes on the feature branch.`,
    `- Record commands you ran and their outcomes.`,
    agent === "human"
      ? `- This step requires a human: review evidence, approve or request changes.`
      : `- When finished, summarize files changed and how criteria were met.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function heuristicPlan(goal: string, scan: RepoScan): PlannedStep[] {
  const ui = /ui|dashboard|design|frontend|page|layout|css|react|vue/i.test(goal);
  const security = /security|auth|oauth|permission|rbac|jwt/i.test(goal);
  const api = /api|endpoint|route|backend|service/i.test(goal);
  const deploy = /deploy|release|production|render|ship/i.test(goal);

  const draft: Array<Omit<PlannedStep, "generatedPrompt" | "dependsOnOrders">> = [
    {
      title: "Scan & map repository",
      objective: `Confirm stack (${scan.stack.join(", ") || "unknown"}) and locate files for: ${goal.slice(0, 120)}`,
      agent: "codex",
      criteria: [
        "Entry points and relevant modules identified",
        "Risks and existing tests noted",
        "No production edits during pure inspection (notes only)",
      ],
    },
  ];

  // Parallelizable backend + frontend when both apply (independent deps on scan step 0)
  const backendIdx = draft.length;
  if (api || !ui) {
    draft.push({
      title: "Implement backend / domain changes",
      objective: "Apply the core behavioral change with clear boundaries and error handling.",
      agent: "codex",
      criteria: [
        "Feature behavior matches the goal",
        "Validation and edge cases handled",
        "Diff stays reviewable",
      ],
    });
  }

  const frontendIdx = draft.length;
  if (ui || /full.?stack|end.?to.?end/i.test(goal)) {
    draft.push({
      title: "Implement UI / frontend updates",
      objective: "Ship the user-facing changes aligned with existing design patterns in the repo.",
      agent: "gemini",
      criteria: [
        "UI reflects the requested feature",
        "Responsive and accessible enough for primary flows",
        "No orphaned dead UI for removed paths",
      ],
    });
  }

  const reviewIdx = draft.length;
  if (security || api || ui) {
    draft.push({
      title: "Code quality & security review",
      objective: "Review authz boundaries, secrets handling, input validation, and code quality for the change.",
      agent: "claude",
      criteria: [
        "Access control verified",
        "No secrets committed",
        "Findings documented with concrete fixes",
      ],
    });
  }

  const testIdx = draft.length;
  draft.push({
    title: "Run automated verification",
    objective: `Execute project tests/lint/typecheck/build${scan.testCommand ? ` (prefer \`${scan.testCommand}\`)` : ""} and fix failures.`,
    agent: "testing",
    criteria: [
      "Relevant test/lint/typecheck/build commands executed",
      "Actual command output recorded",
      "Failures assigned back with logs",
    ],
  });

  draft.push({
    title: "Independent review & approval",
    objective: "Human reviews code, tests, and security notes before merge/deploy.",
    agent: "human",
    criteria: [
      "Review findings recorded",
      "CI / local checks green or explained",
      "Human explicitly approves",
    ],
  });

  if (deploy || true) {
    draft.push({
      title: "Open PR & prepare deploy",
      objective: "Open a pull request from the feature branch and prepare deploy checklist after approval.",
      agent: "antigravity",
      criteria: [
        "PR opened against default branch",
        "Deploy notes listed",
        "Merge blocked until human approval",
      ],
    });
  }

  return draft.map((step, i) => {
    let dependsOnOrders: number[] = [];
    if (i === 0) dependsOnOrders = [];
    else if (i === backendIdx || i === frontendIdx) dependsOnOrders = [0];
    else if (i === reviewIdx) {
      dependsOnOrders = [backendIdx, frontendIdx].filter((x) => x > 0 && x < reviewIdx);
      if (!dependsOnOrders.length) dependsOnOrders = [0];
    } else if (i === testIdx) {
      dependsOnOrders = [reviewIdx > 0 ? reviewIdx : Math.max(backendIdx, frontendIdx, 0)].filter(
        (x) => x >= 0 && x < testIdx
      );
      if (!dependsOnOrders.length) dependsOnOrders = i > 0 ? [i - 1] : [];
    } else {
      dependsOnOrders = [i - 1];
    }
    return {
      ...step,
      dependsOnOrders,
      generatedPrompt: buildPrompt({
        agent: step.agent,
        title: step.title,
        objective: step.objective,
        goal,
        scan,
        criteria: step.criteria,
        order: i,
        total: draft.length,
      }),
    };
  });
}

export type LlmKeys = { openaiApiKey?: string | null; anthropicApiKey?: string | null };

async function llmPlan(goal: string, scan: RepoScan, keys?: LlmKeys): Promise<PlannedStep[] | null> {
  const openaiKey = keys?.openaiApiKey || process.env.OPENAI_API_KEY;
  const anthropicKey = keys?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
  if (!openaiKey && !anthropicKey) return null;

  const system = `You are DevCommand's planner. Return ONLY valid JSON array of steps.
Each step: {title, objective, agent, criteria, dependsOnOrders}
agent must be one of: codex, claude, gemini, antigravity, testing, human, llm.
Prefer parallel independent steps (backend=codex, frontend=gemini, review=claude, verify=testing).
Keep 4-8 steps. First step inspects, include testing + human approval, then PR/deploy prep.
dependsOnOrders is an array of earlier 0-based indexes.`;

  const user = `Goal: ${goal}\n\nRepo scan:\n${JSON.stringify(scan, null, 2)}`;

  try {
    if (openaiKey) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + openaiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!r.ok) return null;
      const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content || "";
      return normalizeLlmSteps(content, goal, scan);
    }

    if (anthropicKey) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
          max_tokens: 2500,
          system,
          messages: [{ role: "user", content: user + "\n\nRespond with {\"steps\":[...]}" }],
        }),
      });
      if (!r.ok) return null;
      const data = (await r.json()) as { content?: Array<{ text?: string }> };
      const content = data.content?.[0]?.text || "";
      return normalizeLlmSteps(content, goal, scan);
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeLlmSteps(content: string, goal: string, scan: RepoScan): PlannedStep[] | null {
  try {
    const parsed = JSON.parse(content.replace(/^```json|```$/g, "").trim());
    const arr = Array.isArray(parsed) ? parsed : parsed.steps;
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr.map((raw: any, i: number) => {
      const allowed = new Set(["codex", "claude", "gemini", "antigravity", "testing", "human", "llm"]);
      const agent = allowed.has(String(raw.agent)) ? raw.agent : "codex";
      const criteria = Array.isArray(raw.criteria) ? raw.criteria.map(String) : ["Complete the objective"];
      const title = String(raw.title || `Step ${i + 1}`);
      const objective = String(raw.objective || goal);
      const dependsOnOrders = Array.isArray(raw.dependsOnOrders)
        ? raw.dependsOnOrders.map(Number).filter((n: number) => n >= 0 && n < i)
        : i === 0
          ? []
          : [i - 1];
      return {
        title,
        objective,
        agent,
        criteria,
        dependsOnOrders,
        generatedPrompt: buildPrompt({
          agent,
          title,
          objective,
          goal,
          scan,
          criteria,
          order: i,
          total: arr.length,
        }),
      };
    });
  } catch {
    return null;
  }
}

/** Legacy simple plan for /api/tasks compatibility */
export function createPlan(prompt: string) {
  const ui = /ui|dashboard|design|frontend/i.test(prompt);
  const items = [
    {
      title: "Inspect repository",
      objective: "Map stack, entry points, tests and risks before editing.",
      agent: "codex",
      criteria: ["Relevant files identified", "Existing tests reviewed", "No edits during inspection"],
    },
    {
      title: "Implement one high-impact improvement",
      objective: "Make a bounded, evidence-based change.",
      agent: ui ? "antigravity" : "codex",
      criteria: ["Acceptance criteria met", "Diff is reviewable", "Existing behavior preserved where required"],
    },
    {
      title: "Add regression tests",
      objective: "Test relevant success and failure paths.",
      agent: "codex",
      criteria: ["Relevant tests added", "Actual command output recorded", "Skipped checks disclosed"],
    },
    {
      title: "Independent review and approval",
      objective: "Review code, security and test evidence.",
      agent: "human",
      criteria: ["Review findings recorded", "CI checks pass", "Human explicitly approves merge"],
    },
  ];
  if (/security|auth/i.test(prompt))
    items.splice(2, 0, {
      title: "Security review",
      objective: "Check authorization, secrets, validation and error leakage.",
      agent: "codex",
      criteria: ["Access boundaries tested", "No secrets exposed", "Findings documented"],
    });
  return items;
}

export async function createFeaturePlan(goal: string, scan: RepoScan, keys?: LlmKeys): Promise<PlannedStep[]> {
  const llm = await llmPlan(goal, scan, keys);
  return llm || heuristicPlan(goal, scan);
}

export function buildFollowUpPrompt(original: string, logs: string, reason: string) {
  return [
    original,
    ``,
    `## Follow-up (attempt correction)`,
    `Previous attempt failed or needs revision.`,
    `Reason: ${reason}`,
    logs ? `Logs excerpt:\n\`\`\`\n${logs.slice(0, 2500)}\n\`\`\`` : "",
    `Fix the gaps, re-run checks, and report what changed.`,
  ]
    .filter(Boolean)
    .join("\n");
}
