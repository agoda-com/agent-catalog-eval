import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkSkillUsage,
  discoverTests,
  printResult,
  printSummary,
} from "./runner.js";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ace-runner-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function writeCase(
  rel: string,
  opts: { skillPath: string; threshold: number; rubric: string; prompt: string },
) {
  const dir = join(tmp, rel);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "eval.yaml"),
    `skill_path: ${opts.skillPath}\nthreshold: ${opts.threshold}\njudge_rubric: |\n  ${opts.rubric}\n`,
  );
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

describe("checkSkillUsage", () => {
  const empty = { stdout: "", stderr: "", exitCode: 0, timedOut: false };

  it("matches when the skill name appears in stdout", () => {
    expect(
      checkSkillUsage({ ...empty, stdout: "applying my-skill now" }, "my-skill"),
    ).toBe(true);
  });

  it("matches when SKILL.md appears in stderr", () => {
    expect(checkSkillUsage({ ...empty, stderr: "loaded SKILL.md" }, "other")).toBe(true);
  });

  it("matches the literal .cursor/skills path", () => {
    expect(checkSkillUsage({ ...empty, stdout: "found .cursor/skills/x" }, "x")).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(checkSkillUsage({ ...empty, stdout: "wrote a file" }, "ioc")).toBe(false);
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
});
