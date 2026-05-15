import { describe, expect, it } from "vitest";
import { renderCaseReport, renderDescriptionDiff } from "./route-report.js";
import type { RouteCase, CaseResult } from "./route-eval.js";

const passingCase: RouteCase = {
  id: "case-a",
  prompt: "do the thing",
  expectation: { kind: "skill", expected_skill: "skill.a" },
  forbidden_skills: [],
};

const passingResult: CaseResult = {
  caseId: "case-a",
  passed: true,
  observed: ["skill.a"],
  visibleTools: ["skill.a", "skill.b"],
  expected: { forbidden_skills: [], expected_skill: "skill.a" },
};

describe("renderDescriptionDiff", () => {
  it("marks added words with + and removed words with -", () => {
    const out = renderDescriptionDiff("the quick fox", "the slow fox");
    expect(out).toContain("- quick");
    expect(out).toContain("+ slow");
    expect(out).toContain("```diff");
  });
});

describe("renderCaseReport", () => {
  it("includes prompt, expectation, visible tools, and called tools on pass", () => {
    const md = renderCaseReport({
      routeCase: passingCase,
      result: passingResult,
      visibleTools: [
        { name: "skill.a", description: "Refactor C# controllers" },
        { name: "skill.b", description: "Migrate webpack to Vite" },
      ],
      calledTools: ["skill.a"],
    });
    expect(md).toContain("# Route Eval — `case-a`");
    expect(md).toContain("**Result:** pass");
    expect(md).toContain("do the thing");
    expect(md).toContain("expected_skill: `skill.a`");
    expect(md).toContain("**`skill.a`**");
    expect(md).toContain("**`skill.b`**");
  });

  it("includes a description diff when the agent picked the wrong skill", () => {
    const failCase: RouteCase = {
      id: "case-d",
      prompt: "p",
      expectation: { kind: "skill", expected_skill: "skill.right" },
      forbidden_skills: [],
    };
    const failResult: CaseResult = {
      caseId: "case-d",
      passed: false,
      reason: "expected skill.right, got: [skill.wrong]",
      observed: ["skill.wrong"],
      visibleTools: ["skill.right", "skill.wrong"],
      expected: { forbidden_skills: [], expected_skill: "skill.right" },
    };
    const md = renderCaseReport({
      routeCase: failCase,
      result: failResult,
      visibleTools: [
        { name: "skill.right", description: "Refactor controllers to constructor injection" },
        { name: "skill.wrong", description: "Refactor controllers to property injection" },
      ],
      calledTools: ["skill.wrong"],
    });
    expect(md).toContain("Description diff");
    expect(md).toContain("- constructor");
    expect(md).toContain("+ property");
  });

  it("notes when the description diff is unavailable", () => {
    const failCase: RouteCase = {
      id: "case-e",
      prompt: "p",
      expectation: { kind: "skill", expected_skill: "skill.absent" },
      forbidden_skills: [],
    };
    const failResult: CaseResult = {
      caseId: "case-e",
      passed: false,
      reason: "expected skill.absent, got: [skill.other]",
      observed: ["skill.other"],
      expected: { forbidden_skills: [], expected_skill: "skill.absent" },
    };
    const md = renderCaseReport({
      routeCase: failCase,
      result: failResult,
      visibleTools: [],
      calledTools: ["skill.other"],
    });
    expect(md).toContain("Description diff unavailable");
  });

  it("notes when no tools/list was observed", () => {
    const md = renderCaseReport({
      routeCase: passingCase,
      result: { ...passingResult, passed: false, reason: "no list" },
      visibleTools: [],
      calledTools: [],
    });
    expect(md).toContain("No `tools/list` was observed");
    expect(md).toContain("No `tools/call` was observed");
  });
});
