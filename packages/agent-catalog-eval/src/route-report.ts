import { promises as fs } from "node:fs";
import path from "node:path";
import { diffWordsWithSpace, type Change } from "diff";
import type { CaseResult, RouteCase } from "./route-eval.js";

export interface VisibleTool {
  name: string;
  description?: string;
}

export interface DiagnosticInputs {
  routeCase: RouteCase;
  result: CaseResult;
  visibleTools: VisibleTool[];
  /** The tool name(s) the agent actually called, in invocation order. */
  calledTools: string[];
}

/**
 * Render a unified-style word-diff between two descriptions as a markdown
 * fenced block. Used to surface *why* the agent might have picked the wrong
 * skill — most routing failures trace back to one description being more
 * attractive than another, and seeing them inline tells you which sentences
 * to rewrite.
 */
export function renderDescriptionDiff(expected: string, actual: string): string {
  const changes: Change[] = diffWordsWithSpace(expected, actual);
  const lines: string[] = [];
  for (const change of changes) {
    if (change.added) {
      lines.push(`+ ${change.value}`);
    } else if (change.removed) {
      lines.push(`- ${change.value}`);
    } else {
      lines.push(`  ${change.value}`);
    }
  }
  return ["```diff", lines.join(""), "```"].join("\n");
}

function expectedToolName(c: RouteCase): string | undefined {
  switch (c.expectation.kind) {
    case "skill":
      return c.expectation.expected_skill;
    case "any_of":
      return c.expectation.expected_any_of[0];
    case "none":
      return undefined;
  }
}

function describeExpectation(c: RouteCase): string {
  switch (c.expectation.kind) {
    case "skill":
      return `expected_skill: \`${c.expectation.expected_skill}\``;
    case "any_of":
      return `expected_any_of: [${c.expectation.expected_any_of.map((s) => `\`${s}\``).join(", ")}]`;
    case "none":
      return "expected_none: true";
  }
}

export function renderCaseReport(input: DiagnosticInputs): string {
  const { routeCase, result, visibleTools, calledTools } = input;
  const lines: string[] = [];

  lines.push(`# Route Eval — \`${routeCase.id}\``);
  lines.push("");
  lines.push(`**Result:** ${result.passed ? "pass" : "fail"}`);
  if (!result.passed && result.reason) {
    lines.push("");
    lines.push(`**Reason:** ${result.reason}`);
  }
  lines.push("");

  lines.push("## Prompt");
  lines.push("");
  lines.push("```");
  lines.push(routeCase.prompt.trim());
  lines.push("```");
  lines.push("");

  lines.push("## Expectation");
  lines.push("");
  lines.push(`- ${describeExpectation(routeCase)}`);
  if (routeCase.forbidden_skills.length > 0) {
    lines.push(`- forbidden_skills: [${routeCase.forbidden_skills.map((s) => `\`${s}\``).join(", ")}]`);
  }
  lines.push("");

  lines.push("## Visible tools at decision time");
  lines.push("");
  if (visibleTools.length === 0) {
    lines.push("_No `tools/list` was observed — the agent never queried the proxy._");
  } else {
    for (const t of visibleTools) {
      const desc = t.description?.trim() ?? "_(no description)_";
      lines.push(`- **\`${t.name}\`** — ${desc.split("\n")[0]}`);
    }
  }
  lines.push("");

  lines.push("## Tool calls observed");
  lines.push("");
  if (calledTools.length === 0) {
    lines.push("_No `tools/call` was observed._");
  } else {
    for (const c of calledTools) {
      lines.push(`- \`${c}\``);
    }
  }
  lines.push("");

  if (!result.passed) {
    const expected = expectedToolName(routeCase);
    const actual = calledTools[0];
    if (expected && actual && expected !== actual) {
      const expectedDesc = visibleTools.find((t) => t.name === expected)?.description;
      const actualDesc = visibleTools.find((t) => t.name === actual)?.description;
      if (expectedDesc && actualDesc) {
        lines.push(`## Description diff: \`${expected}\` (expected) → \`${actual}\` (called)`);
        lines.push("");
        lines.push(renderDescriptionDiff(expectedDesc, actualDesc));
        lines.push("");
        lines.push(
          "_Lines starting with `-` are in the expected skill's description, lines with `+` are in the called skill's description. Look for adjective and verb differences — those are usually what tipped the routing._",
        );
        lines.push("");
      } else {
        lines.push(
          "_Description diff unavailable — one or both of the expected / called skills were not in the observed `tools/list`._",
        );
        lines.push("");
      }
    }
  }

  if (routeCase.notes) {
    lines.push("## Notes");
    lines.push("");
    lines.push(routeCase.notes);
    lines.push("");
  }

  return lines.join("\n");
}

export interface RunSummary {
  generatedAt: string;
  upstreamMcp: string;
  total: number;
  passed: number;
  failed: number;
  cases: Array<{
    caseId: string;
    passed: boolean;
    reason?: string;
    expected: CaseResult["expected"];
    observed: string[];
    durationMs: number;
    reportPath: string;
  }>;
}

export async function writeRunSummary(outputPath: string, summary: RunSummary): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(summary, null, 2), "utf8");
}
