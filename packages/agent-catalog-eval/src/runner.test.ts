import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkOpenCodeSkillSignals,
  checkSkillUsage,
  describeOpenCodeSkillSignalFailure,
  discoverTests,
  getCategories,
  printResult,
  printSummary,
  runAll,
} from "./runner.js";
import type { RunnerConfig, TestCase } from "./types.js";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ace-runner-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function writeCase(
  rel: string,
  opts: {
    skillPath: string;
    threshold: number;
    rubric: string;
    prompt: string;
    category?: string;
    additionalSkills?: string[];
  },
) {
  const dir = join(tmp, rel);
  await mkdir(dir, { recursive: true });

  const lines: string[] = [
    `skill_path: ${opts.skillPath}`,
    `threshold: ${opts.threshold}`,
    `judge_rubric: |`,
    `  ${opts.rubric}`,
  ];
  if (opts.category) lines.push(`category: ${opts.category}`);
  if (opts.additionalSkills && opts.additionalSkills.length > 0) {
    lines.push("additional_skills:");
    for (const p of opts.additionalSkills) lines.push(`  - ${p}`);
  }

  await writeFile(join(dir, "eval.yaml"), lines.join("\n") + "\n");
  await writeFile(join(dir, "prompt.md"), opts.prompt);
}

describe("discoverTests", () => {
  it("finds eval.yaml leaves, parses them, and resolves skill_path against repo root", async () => {
    await writeCase("a/case-1", {
      skillPath: "skills/foo/SKILL.md",
      threshold: 70,
      rubric: "rub1",
      prompt: "do thing 1",
    });
    await writeCase("b/case-2", {
      skillPath: "skills/bar/SKILL.md",
      threshold: 80,
      rubric: "rub2",
      prompt: "do thing 2",
    });

    const tests = await discoverTests(tmp, "/repo/root");

    expect(tests).toHaveLength(2);
    expect(tests.map((t) => t.name)).toEqual(["a/case-1", "b/case-2"]);

    const t = tests[0]!;
    expect(t.skillPath).toBe("/repo/root/skills/foo/SKILL.md");
    expect(t.threshold).toBe(70);
    expect(t.judgeRubric).toContain("rub1");
    expect(t.prompt).toBe("do thing 1");
    expect(t.beforeDir).toBe(join(tmp, "a/case-1", "before"));
    expect(t.afterDir).toBe(join(tmp, "a/case-1", "after"));
    expect(t.category).toBeUndefined();
    expect(t.additionalSkillPaths).toEqual([]);
  });

  it("parses optional `category` from eval.yaml onto the test case", async () => {
    await writeCase("office/case", {
      skillPath: "skills/foo/SKILL.md",
      threshold: 70,
      rubric: "r",
      prompt: "p",
      category: "office",
    });
    await writeCase("plain/case", {
      skillPath: "skills/foo/SKILL.md",
      threshold: 70,
      rubric: "r",
      prompt: "p",
    });

    const tests = await discoverTests(tmp, "/repo");
    const byName = Object.fromEntries(tests.map((t) => [t.name, t]));
    expect(byName["office/case"]!.category).toBe("office");
    expect(byName["plain/case"]!.category).toBeUndefined();
  });

  it("resolves `additional_skills` against repo root onto additionalSkillPaths", async () => {
    await writeCase("multi/case", {
      skillPath: "skills/primary/SKILL.md",
      threshold: 70,
      rubric: "r",
      prompt: "p",
      additionalSkills: ["skills/extra-a/SKILL.md", "skills/extra-b/SKILL.md"],
    });

    const tests = await discoverTests(tmp, "/repo/root");
    expect(tests).toHaveLength(1);
    expect(tests[0]!.skillPath).toBe("/repo/root/skills/primary/SKILL.md");
    expect(tests[0]!.additionalSkillPaths).toEqual([
      "/repo/root/skills/extra-a/SKILL.md",
      "/repo/root/skills/extra-b/SKILL.md",
    ]);
  });

  it("sorts results by name", async () => {
    await writeCase("zebra", {
      skillPath: "z",
      threshold: 1,
      rubric: "r",
      prompt: "p",
    });
    await writeCase("apple", {
      skillPath: "a",
      threshold: 1,
      rubric: "r",
      prompt: "p",
    });
    await writeCase("mango", {
      skillPath: "m",
      threshold: 1,
      rubric: "r",
      prompt: "p",
    });

    const tests = await discoverTests(tmp, tmp);
    expect(tests.map((t) => t.name)).toEqual(["apple", "mango", "zebra"]);
  });

  it("skips node_modules / src / dist / .git / output dirs", async () => {
    for (const skip of ["node_modules", "src", "dist", ".git", "output"]) {
      await writeCase(`${skip}/inside`, {
        skillPath: "x",
        threshold: 1,
        rubric: "r",
        prompt: "p",
      });
    }
    await writeCase("real-case", {
      skillPath: "x",
      threshold: 1,
      rubric: "r",
      prompt: "p",
    });

    const tests = await discoverTests(tmp, tmp);
    expect(tests.map((t) => t.name)).toEqual(["real-case"]);
  });

  it("does not descend into a directory once it has its own eval.yaml", async () => {
    await writeCase("outer", {
      skillPath: "x",
      threshold: 1,
      rubric: "r",
      prompt: "p",
    });
    await writeCase("outer/nested-should-be-ignored", {
      skillPath: "x",
      threshold: 1,
      rubric: "r",
      prompt: "p",
    });

    const tests = await discoverTests(tmp, tmp);
    expect(tests.map((t) => t.name)).toEqual(["outer"]);
  });
});

describe("getCategories", () => {
  const stub = (name: string, category?: string): TestCase => ({
    name,
    dir: "/x",
    skillPath: "/x/SKILL.md",
    additionalSkillPaths: [],
    threshold: 70,
    judgeRubric: "r",
    prompt: "p",
    beforeDir: "/x/before",
    afterDir: "/x/after",
    category,
  });

  it("returns sorted distinct non-empty categories", () => {
    const tests = [stub("a", "office"), stub("b", "prompts"), stub("c", "office"), stub("d")];
    expect(getCategories(tests)).toEqual(["office", "prompts"]);
  });

  it("returns an empty array when no test has a category", () => {
    expect(getCategories([stub("a"), stub("b")])).toEqual([]);
  });
});

describe("checkSkillUsage", () => {
  const empty = { stdout: "", stderr: "", exitCode: 0, timedOut: false };

  it("matches when the skill name appears in stdout", () => {
    expect(checkSkillUsage({ ...empty, stdout: "applying my-skill now" }, "my-skill")).toBe(true);
  });

  it("matches when SKILL.md appears in stderr", () => {
    expect(checkSkillUsage({ ...empty, stderr: "loaded SKILL.md" }, "other")).toBe(true);
  });

  it("matches the literal .cursor/skills path when no agent is given", () => {
    expect(checkSkillUsage({ ...empty, stdout: "found .cursor/skills/x" }, "x")).toBe(true);
  });

  it("matches the .opencode/skills path when agent=opencode", () => {
    expect(
      checkSkillUsage(
        { ...empty, stdout: "registered .opencode/skills/foo" },
        "irrelevant",
        "opencode",
      ),
    ).toBe(true);
  });

  it("matches the .claude/skills path when agent=claude-code", () => {
    expect(
      checkSkillUsage(
        { ...empty, stdout: "loaded .claude/skills/bar" },
        "irrelevant",
        "claude-code",
      ),
    ).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(checkSkillUsage({ ...empty, stdout: "wrote a file" }, "ioc")).toBe(false);
  });
});

describe("checkOpenCodeSkillSignals", () => {
  const empty = { stdout: "", stderr: "", exitCode: 0, timedOut: false };

  // Realistic-shape lines lifted from the OpenCode debug log format.
  const registrationLine = (name: string) =>
    `service=permission permission=skill pattern=${name} ` +
    `ruleset=[{"permission":"external_directory","pattern":"/builds/.../.opencode/skills/${name}/*","action":"allow"}]`;

  const invocationLine =
    `service=opencode-plugin-otel sessionID=abc tool_name=skill success=true duration_ms=42`;

  it("marks each requested skill as registered when its permission line is present", () => {
    const stdout = [registrationLine("foo"), registrationLine("bar"), invocationLine].join("\n");
    const sig = checkOpenCodeSkillSignals({ ...empty, stdout }, ["foo", "bar"]);
    expect(sig.registrations).toEqual([
      { skill: "foo", registered: true },
      { skill: "bar", registered: true },
    ]);
    expect(sig.anyInvoked).toBe(true);
  });

  it("marks a missing skill as not registered (the failing-job case)", () => {
    const stdout = [registrationLine("skill-creator"), invocationLine].join("\n");
    const sig = checkOpenCodeSkillSignals({ ...empty, stdout }, ["postgres-table-best-practices"]);
    expect(sig.registrations).toEqual([
      { skill: "postgres-table-best-practices", registered: false },
    ]);
  });

  it("does not match a substring — `foo-bar` registration must not satisfy `foo`", () => {
    const stdout = registrationLine("foo-bar");
    const sig = checkOpenCodeSkillSignals({ ...empty, stdout }, ["foo"]);
    expect(sig.registrations[0]!.registered).toBe(false);
  });

  it("anyInvoked is false when only `read` / `glob` tool events appear", () => {
    const stdout =
      `service=opencode-plugin-otel tool_name=read success=true\n` +
      `service=opencode-plugin-otel tool_name=glob success=true`;
    const sig = checkOpenCodeSkillSignals({ ...empty, stdout }, ["x"]);
    expect(sig.anyInvoked).toBe(false);
  });

  it("inspects stderr too (OpenCode emits debug logs on both streams)", () => {
    const sig = checkOpenCodeSkillSignals(
      { ...empty, stderr: registrationLine("from-stderr") },
      ["from-stderr"],
    );
    expect(sig.registrations[0]!.registered).toBe(true);
  });

  it("escapes regex metachars in skill names so e.g. dots are literal", () => {
    const stdout = registrationLine("a.b");
    const sig = checkOpenCodeSkillSignals({ ...empty, stdout }, ["aXb"]);
    expect(sig.registrations[0]!.registered).toBe(false);
  });
});

describe("describeOpenCodeSkillSignalFailure", () => {
  it("returns undefined when every skill is registered AND something was invoked", () => {
    expect(
      describeOpenCodeSkillSignalFailure({
        registrations: [{ skill: "foo", registered: true }],
        anyInvoked: true,
      }),
    ).toBeUndefined();
  });

  it("flags unregistered skills first (it's the more specific failure)", () => {
    const msg = describeOpenCodeSkillSignalFailure({
      registrations: [
        { skill: "foo", registered: true },
        { skill: "bar", registered: false },
      ],
      anyInvoked: false,
    });
    expect(msg).toContain("never registered");
    expect(msg).toContain("bar");
    expect(msg).not.toContain("foo,"); // only the unregistered ones are listed
  });

  it("flags missing invocation when everything was registered but the tool never fired", () => {
    const msg = describeOpenCodeSkillSignalFailure({
      registrations: [{ skill: "foo", registered: true }],
      anyInvoked: false,
    });
    expect(msg).toContain("never invoked");
    expect(msg).toContain("tool_name=skill");
  });
});

describe("printResult / printSummary", () => {
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logs = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("printResult shows pass/fail icon, score, threshold, and reasoning", () => {
    printResult({
      name: "case-1",
      passed: true,
      score: 90,
      threshold: 70,
      reasoning: "matched ground truth",
      durationMs: 1500,
    });

    const all = logs.join("\n");
    expect(all).toContain("✓");
    expect(all).toContain("case-1");
    expect(all).toContain("90%");
    expect(all).toContain("threshold: 70%");
    expect(all).toContain("matched ground truth");
  });

  it("printResult surfaces error message when score is 0", () => {
    printResult({
      name: "broken",
      passed: false,
      score: 0,
      threshold: 70,
      reasoning: "",
      durationMs: 100,
      error: "agent crashed",
    });

    expect(logs.join("\n")).toContain("Error: agent crashed");
  });

  it("printResult surfaces error when not passed even with a non-zero score (signal failure case)", () => {
    printResult({
      name: "signal-fail",
      passed: false,
      score: 95,
      threshold: 70,
      reasoning: "judge thought it was great",
      durationMs: 100,
      error: "OpenCode never registered skill(s): foo",
      skillSignals: {
        registrations: [{ skill: "foo", registered: false }],
        anyInvoked: false,
      },
    });

    const all = logs.join("\n");
    expect(all).toContain("Error: OpenCode never registered");
    expect(all).toContain("skill registered:");
    expect(all).toContain("foo");
    expect(all).toContain("skill invoked:");
  });

  it("printResult shows skillSignals on a passing run (always-on visibility)", () => {
    printResult({
      name: "pass",
      passed: true,
      score: 90,
      threshold: 70,
      reasoning: "",
      durationMs: 100,
      skillSignals: {
        registrations: [{ skill: "foo", registered: true }],
        anyInvoked: true,
      },
    });

    const all = logs.join("\n");
    expect(all).toContain("skill registered:");
    expect(all).toContain("foo");
    expect(all).toContain("skill invoked:");
  });

  it("printSummary reports counts and lists failures", () => {
    printSummary([
      { name: "ok", passed: true, score: 90, threshold: 70, reasoning: "", durationMs: 1 },
      { name: "bad", passed: false, score: 50, threshold: 70, reasoning: "", durationMs: 1 },
    ]);

    const all = logs.join("\n");
    expect(all).toContain("Results: 1 passed, 1 failed, 2 total");
    expect(all).toContain("Failed:");
    expect(all).toContain("bad (50% < 70%)");
  });

  it("printSummary tags skill-signal failures specifically", () => {
    printSummary([
      {
        name: "signal-fail",
        passed: false,
        score: 95,
        threshold: 70,
        reasoning: "",
        durationMs: 1,
        skillSignals: {
          registrations: [{ skill: "foo", registered: false }],
          anyInvoked: false,
        },
      },
    ]);

    expect(logs.join("\n")).toContain("[skill-signal failure]");
  });
});

describe("runAll (--dry-run filters)", () => {
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logs = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  async function seedTwoCategories() {
    await writeCase("office/a", {
      skillPath: "skills/x/SKILL.md",
      threshold: 70,
      rubric: "r",
      prompt: "p",
      category: "office",
    });
    await writeCase("office/b", {
      skillPath: "skills/x/SKILL.md",
      threshold: 70,
      rubric: "r",
      prompt: "p",
      category: "office",
    });
    await writeCase("prompts/a", {
      skillPath: "skills/x/SKILL.md",
      threshold: 70,
      rubric: "r",
      prompt: "p",
      category: "prompts",
    });
    await writeCase("uncat/a", {
      skillPath: "skills/x/SKILL.md",
      threshold: 70,
      rubric: "r",
      prompt: "p",
    });
  }

  function configFor(extra: Partial<RunnerConfig>): RunnerConfig {
    return {
      casesDir: tmp,
      repoRoot: tmp,
      outputDir: join(tmp, "output"),
      agent: "opencode",
      workerModel: "x",
      judgeModel: "y",
      apiKey: "",
      baseUrl: "https://example/v1",
      dryRun: true,
      timeoutMs: 1000,
      collectMetrics: false,
      metricsUrl: "https://example/metrics",
      headers: {},
      ciContext: { project: "p", pipeline_id: "1", commit_sha: "c", branch: "b" },
      ...extra,
    };
  }

  it("--category keeps only matching tests", async () => {
    await seedTwoCategories();
    const results = await runAll(configFor({ category: "office" }));
    expect(results.map((r) => r.name).sort()).toEqual(["office/a", "office/b"]);
  });

  it("--not-category excludes tests in any listed category (uncategorized still pass through)", async () => {
    await seedTwoCategories();
    const results = await runAll(configFor({ notCategory: "office,prompts" }));
    expect(results.map((r) => r.name).sort()).toEqual(["uncat/a"]);
  });

  it("--filter combines with --category (intersection)", async () => {
    await seedTwoCategories();
    const results = await runAll(configFor({ category: "office", filter: "a" }));
    expect(results.map((r) => r.name)).toEqual(["office/a"]);
  });
});
