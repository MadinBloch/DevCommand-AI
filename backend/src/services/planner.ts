import type { RepoScan } from "./scanner.js";

export type PlannedStep = {
  title: string;
  objective: string;
  agent: "codex" | "antigravity" | "human";
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

  if (ui || /full.?stack|end.?to.?end/i.test(goal)) {
    draft.push({
      title: "Implement UI / frontend updates",
      objective: "Ship the user-facing changes aligned with existing design patterns in the repo.",
      agent: "antigravity",
      criteria: [
        "UI reflects the requested feature",
        "Responsive and accessible enough for primary flows",
        "No orphaned dead UI for removed paths",
      ],
    });
  }

  if (security) {
    draft.push({
      title: "Security hardening pass",
      objective: "Verify authz boundaries, secrets handling, and input validation for the change.",
      agent: "codex",
      criteria: [
        "Access control verified",
        "No secrets committed",
        "Findings documented",
      ],
    });
  }

  draft.push({
    title: "Add / update regression tests",
    objective: `Cover success and failure paths${scan.testCommand ? ` using \`${scan.testCommand}\`` : ""}.`,
    agent: "codex",
    criteria: [
      "Relevant tests added or updated",
      "Actual command output recorded",
      "Skipped checks disclosed",
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
      agent: "codex",
      criteria: [
        "PR opened against default branch",
        "Deploy notes listed",
        "Merge blocked until human approval",
      ],
    });
  }

  return draft.map((step, i) => {
    const dependsOnOrders = i === 0 ? [] : [i - 1];
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

async function llmPlan(goal: string, scan: RepoScan): Promise<PlannedStep[] | null> {
  const key = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const system = `You are DevCommand's planner. Return ONLY valid JSON array of steps.
Each step: {title, objective, agent, criteria, dependsOnOrders}
agent must be one of: codex, antigravity, human.
Keep 4-7 steps. First step inspects, last steps include tests and human approval, then PR/deploy prep.
dependsOnOrders is an array of earlier 0-based indexes.`;

  const user = `Goal: ${goal}\n\nRepo scan:\n${JSON.stringify(scan, null, 2)}`;

  try {
    if (process.env.OPENAI_API_KEY) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.OPENAI_API_KEY,
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

    if (process.env.ANTHROPIC_API_KEY) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
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
      const agent =
        raw.agent === "antigravity" || raw.agent === "human" || raw.agent === "codex"
          ? raw.agent
          : "codex";
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

export async function createFeaturePlan(goal: string, scan: RepoScan): Promise<PlannedStep[]> {
  const llm = await llmPlan(goal, scan);
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
