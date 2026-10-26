import { gh } from "../github.js";

export type RepoScan = {
  fullName: string;
  defaultBranch: string;
  description: string | null;
  language: string | null;
  stack: string[];
  packageManager: string | null;
  testCommand: string | null;
  buildCommand: string | null;
  hasCi: boolean;
  frameworks: string[];
  topFiles: string[];
  relevantFiles: string[];
  readmeExcerpt: string | null;
  summary: string;
};

const STACK_HINTS: Record<string, RegExp> = {
  node: /package\.json$/,
  python: /requirements\.txt$|pyproject\.toml$|Pipfile$/,
  php: /composer\.json$/,
  go: /go\.mod$/,
  rust: /Cargo\.toml$/,
  java: /pom\.xml$|build\.gradle/,
  ruby: /Gemfile$/,
  docker: /Dockerfile$|docker-compose/,
};

const FRAMEWORK_HINTS: Array<[string, RegExp]> = [
  ["react", /react/i],
  ["vue", /"vue"/i],
  ["next", /"next"/i],
  ["vite", /"vite"/i],
  ["express", /"express"/i],
  ["laravel", /laravel\/framework|"laravel"/i],
  ["django", /django/i],
  ["fastapi", /fastapi/i],
  ["prisma", /"@prisma\/client"|prisma/i],
  ["tailwind", /tailwind/i],
];

function pickRelevant(paths: string[], goal: string, limit = 24) {
  const tokens = goal
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  const scored = paths.map((p) => {
    const lower = p.toLowerCase();
    let score = 0;
    for (const t of tokens) if (lower.includes(t)) score += 3;
    if (/\.(ts|tsx|js|jsx|php|py|go|rs|vue)$/i.test(p)) score += 1;
    if (/readme|package\.json|composer\.json|prisma|routes|controller|model|schema/i.test(p)) score += 2;
    return { p, score };
  });
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}

async function listTree(token: string, fullName: string, branch: string): Promise<string[]> {
  const data = (await gh(
    `/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token
  )) as { tree?: Array<{ path?: string; type?: string }> };
  return (data.tree || [])
    .filter((n) => n.type === "blob" && n.path)
    .map((n) => n.path!)
    .slice(0, 4000);
}

async function readFile(token: string, fullName: string, path: string): Promise<string | null> {
  try {
    const data = (await gh(`/repos/${fullName}/contents/${encodeURIComponent(path)}`, token)) as {
      content?: string;
      encoding?: string;
    };
    if (!data.content) return null;
    const raw = Buffer.from(data.content, (data.encoding as BufferEncoding) || "base64").toString("utf8");
    return raw.slice(0, 12000);
  } catch {
    return null;
  }
}

export async function scanRepository(
  token: string,
  fullName: string,
  goal: string
): Promise<RepoScan> {
  const repo = (await gh(`/repos/${fullName}`, token)) as {
    default_branch: string;
    description: string | null;
    language: string | null;
  };
  const defaultBranch = repo.default_branch || "main";
  const paths = await listTree(token, fullName, defaultBranch);

  const stack = Object.entries(STACK_HINTS)
    .filter(([, re]) => paths.some((p) => re.test(p)))
    .map(([name]) => name);

  const pkg = paths.includes("package.json") ? await readFile(token, fullName, "package.json") : null;
  const composer = paths.includes("composer.json") ? await readFile(token, fullName, "composer.json") : null;
  const readmePath = paths.find((p) => /^readme(\.md|\.txt)?$/i.test(p.split("/").pop() || ""));
  const readme = readmePath ? await readFile(token, fullName, readmePath) : null;

  let packageManager: string | null = null;
  let testCommand: string | null = null;
  let buildCommand: string | null = null;
  const frameworks: string[] = [];

  if (pkg) {
    packageManager = paths.includes("pnpm-lock.yaml")
      ? "pnpm"
      : paths.includes("yarn.lock")
        ? "yarn"
        : "npm";
    try {
      const json = JSON.parse(pkg);
      const scripts = json.scripts || {};
      testCommand = scripts.test || scripts["test:ci"] || null;
      buildCommand = scripts.build || null;
      const blob = pkg;
      for (const [name, re] of FRAMEWORK_HINTS) if (re.test(blob)) frameworks.push(name);
    } catch {
      /* ignore */
    }
  }
  if (composer) {
    if (!stack.includes("php")) stack.push("php");
    try {
      const json = JSON.parse(composer);
      if (json.require?.["laravel/framework"]) frameworks.push("laravel");
      testCommand = testCommand || "php artisan test || ./vendor/bin/phpunit";
    } catch {
      /* ignore */
    }
  }

  const hasCi = paths.some((p) => p.startsWith(".github/workflows/") || p.includes("render.yaml") || p.includes(".gitlab-ci"));
  const topFiles = paths.filter((p) => !p.includes("/")).slice(0, 40);
  const relevantFiles = pickRelevant(paths, goal);

  const summary = [
    `${fullName} on ${defaultBranch}`,
    repo.language ? `primary language: ${repo.language}` : null,
    stack.length ? `stack: ${stack.join(", ")}` : null,
    frameworks.length ? `frameworks: ${frameworks.join(", ")}` : null,
    packageManager ? `package manager: ${packageManager}` : null,
    testCommand ? `tests: ${testCommand}` : "tests: not detected",
    hasCi ? "CI config present" : "no CI workflows detected",
    `${paths.length} files indexed`,
    relevantFiles.length ? `likely relevant: ${relevantFiles.slice(0, 8).join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(". ");

  return {
    fullName,
    defaultBranch,
    description: repo.description,
    language: repo.language,
    stack,
    packageManager,
    testCommand,
    buildCommand,
    hasCi,
    frameworks,
    topFiles,
    relevantFiles,
    readmeExcerpt: readme ? readme.slice(0, 2000) : null,
    summary,
  };
}
