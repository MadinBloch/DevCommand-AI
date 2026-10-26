export function createPlan(prompt: string) {
 const ui = /ui|dashboard|design|frontend/i.test(prompt);
 const items = [
  {title:"Inspect repository", objective:"Map stack, entry points, tests and risks before editing.", agent:"codex", criteria:["Relevant files identified","Existing tests reviewed","No edits during inspection"]},
  {title:"Implement one high-impact improvement", objective:"Make a bounded, evidence-based change.", agent:ui?"antigravity":"codex", criteria:["Acceptance criteria met","Diff is reviewable","Existing behavior preserved where required"]},
  {title:"Add regression tests", objective:"Test relevant success and failure paths.", agent:"codex", criteria:["Relevant tests added","Actual command output recorded","Skipped checks disclosed"]},
  {title:"Independent review and approval", objective:"Review code, security and test evidence.", agent:"human", criteria:["Review findings recorded","CI checks pass","Human explicitly approves merge"]}
 ];
 if (/security|auth/i.test(prompt)) items.splice(2,0,{title:"Security review",objective:"Check authorization, secrets, validation and error leakage.",agent:"codex",criteria:["Access boundaries tested","No secrets exposed","Findings documented"]});
 return items;
}
