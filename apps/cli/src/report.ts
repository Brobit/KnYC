// The Markdown report written to `.knyc/report.md` after an analysis.

import type { Check, LearningPath, StepChecks, Timeline, Usage } from "@knyc/core";

export interface StageStat {
  name: string;
  seconds: number;
  calls: number;
}

export interface ReportInput {
  projectName: string;
  path: LearningPath;
  timeline: Timeline;
  checks: Check[];
  stepChecks: StepChecks[];
  stages: StageStat[];
  usage: Usage;
  costUsd: number;
  models: Record<string, string>;
}

const icon = { strong: "✅", weak: "⚠️", merged: "🔗" } as const;

export function renderReport(r: ReportInput): string {
  const strong = r.stepChecks.filter((s) => s.strength === "strong").length;
  const pct = Math.round((100 * strong) / r.stepChecks.length);
  const total = r.stages.reduce((sum, s) => sum + s.seconds, 0);
  const builds = r.timeline.steps.filter((s) => s.ok).length;

  const lines = [
    `# ${r.projectName}: ${r.path.id}`,
    "",
    `**${r.path.steps.length} steps** in ${r.path.milestones.length} milestones · **${strong}/${r.stepChecks.length} steps (${pct}%) with a check proven red → green** · ${r.checks.filter((c) => c.validation).length} proven checks`,
    `Reference timeline: ${builds}/${r.timeline.steps.length} steps build on their own · last step = original code: ${r.timeline.finalMatchesOriginal ? "yes" : "**no**"}`,
    ...(r.timeline.setupFixes.length > 0 ? [`Setup adjusted so early steps build alone: ${r.timeline.setupFixes.join("; ")}`] : []),
    "",
  ];

  for (const milestone of r.path.milestones) {
    lines.push(`## ${milestone.title}`, "", milestone.summary, "", "| Step | Checks | |", "|---|---|---|");
    for (const id of milestone.stepIds) {
      const step = r.path.steps.find((s) => s.id === id)!;
      const sc = r.stepChecks.find((s) => s.stepId === id)!;
      const labels = r.checks.filter((c) => c.stepId === id && c.validation).map((c) => c.label);
      const checks = labels.length > 0 ? labels.map((l) => `\`${l.replace(/\|/g, "\\|")}\``).join("<br>") : "—";
      const notes = sc.notes.length > 0 ? sc.notes.join("; ").replace(/\|/g, "\\|").slice(0, 200) : "";
      lines.push(`| ${icon[sc.strength]} **${id}** ${step.title}<br>${step.goal} | ${checks} | ${notes} |`);
    }
    lines.push("");
  }

  lines.push(
    "## Analysis",
    "",
    "| Stage | Time | AI calls |",
    "|---|---|---|",
    ...r.stages.map((s) => `| ${s.name} | ${Math.round(s.seconds)} s | ${s.calls || "—"} |`),
    `| **Total** | **${Math.round(total)} s** | **${r.stages.reduce((n, s) => n + s.calls, 0)}** |`,
    "",
    `Models: ${Object.entries(r.models).map(([role, m]) => `${role} \`${m}\``).join(", ")}.`,
    `Tokens: ${r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens} in, ${r.usage.outputTokens} out` +
      (r.costUsd > 0 ? ` · provider estimate ≈ $${r.costUsd.toFixed(2)}` : ""),
    "",
  );
  return lines.join("\n");
}
