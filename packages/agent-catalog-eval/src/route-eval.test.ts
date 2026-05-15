import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  caseIdFromPath,
  loadCases,
  loadObserved,
  parseRouteCase,
  runRouteEval,
  score,
  type RouteCase,
} from "./route-eval.js";

async function setupCase(dir: string, name: string, yaml: string) {
  const cdir = path.join(dir, name);
  await fs.mkdir(cdir, { recursive: true });
  await fs.writeFile(path.join(cdir, "eval.yaml"), yaml, "utf8");
}

function tmpRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "route-eval-"));
}

const skillCase = (id: string, expected: string, forbidden: string[] = []): RouteCase => ({
  id,
  prompt: "p",
  expectation: { kind: "skill", expected_skill: expected },
  forbidden_skills: forbidden,
});

const anyOfCase = (id: string, allowed: string[]): RouteCase => ({
  id,
  prompt: "p",
  expectation: { kind: "any_of", expected_any_of: allowed },
  forbidden_skills: [],
});

const noneCase = (id: string, forbidden: string[] = []): RouteCase => ({
  id,
  prompt: "p",
  expectation: { kind: "none" },
  forbidden_skills: forbidden,
});

describe("score()", () => {
  describe("expected_skill", () => {
    it("passes when expected skill is observed alone", () => {
      expect(score(skillCase("c", "skill.a"), ["skill.a"])).toEqual({ passed: true });
    });

    it("passes when expected skill is observed with other non-forbidden", () => {
      expect(score(skillCase("c", "skill.a"), ["skill.a", "skill.b"])).toEqual({ passed: true });
    });

    it("fails when only a different skill is observed (reason names what fired)", () => {
      const r = score(skillCase("c", "skill.a"), ["skill.b"]);
      expect(r.passed).toBe(false);
      expect(r.reason).toContain("skill.a");
      expect(r.reason).toContain("skill.b");
    });

    it("fails when nothing is observed", () => {
      const r = score(skillCase("c", "skill.a"), []);
      expect(r.passed).toBe(false);
      expect(r.reason).toMatch(/no call observed/);
    });

    it("fails when a forbidden skill fires (and reason names the forbidden skill)", () => {
      const r = score(skillCase("c", "skill.a", ["skill.bad"]), ["skill.a", "skill.bad"]);
      expect(r.passed).toBe(false);
      expect(r.reason).toContain("skill.bad");
    });

    it("forbidden takes precedence even when expected also fires (reason includes full observed)", () => {
      const r = score(skillCase("c", "skill.a", ["skill.bad"]), ["skill.a", "skill.bad"]);
      expect(r.passed).toBe(false);
      expect(r.reason).toContain("forbidden");
      expect(r.reason).toContain("skill.a");
    });
  });

  describe("expected_any_of", () => {
    it("passes when one of the allowed skills is observed", () => {
      expect(score(anyOfCase("c", ["skill.a", "skill.b"]), ["skill.b"])).toEqual({ passed: true });
    });

    it("fails when only a non-allowed skill is observed", () => {
      const r = score(anyOfCase("c", ["skill.a", "skill.b"]), ["skill.z"]);
      expect(r.passed).toBe(false);
      expect(r.reason).toContain("skill.a");
      expect(r.reason).toContain("skill.z");
    });

    it("fails when nothing is observed", () => {
      const r = score(anyOfCase("c", ["skill.a", "skill.b"]), []);
      expect(r.passed).toBe(false);
      expect(r.reason).toMatch(/no call observed/);
    });
  });

  describe("expected_none", () => {
    it("passes when no skill is observed", () => {
      expect(score(noneCase("c"), [])).toEqual({ passed: true });
    });

    it("fails when any skill fires (reason names what fired)", () => {
      const r = score(noneCase("c"), ["skill.x"]);
      expect(r.passed).toBe(false);
      expect(r.reason).toContain("skill.x");
    });
  });
});

describe("parseRouteCase()", () => {
  it("rejects missing mode", () => {
    expect(() => parseRouteCase({ prompt: "p", expected_skill: "s" }, "id")).toThrow(/mode/);
  });

  it("rejects when two expected_* fields are present", () => {
    expect(() =>
      parseRouteCase({ mode: "routing", prompt: "p", expected_skill: "s", expected_none: true }, "id"),
    ).toThrow(/exactly one/);
  });

  it("rejects when no expected_* field is present", () => {
    expect(() => parseRouteCase({ mode: "routing", prompt: "p" }, "id")).toThrow(/exactly one/);
  });

  it("rejects empty expected_any_of", () => {
    expect(() =>
      parseRouteCase({ mode: "routing", prompt: "p", expected_any_of: [] }, "id"),
    ).toThrow(/non-empty/);
  });

  it("rejects expected_none other than literal true", () => {
    expect(() =>
      parseRouteCase({ mode: "routing", prompt: "p", expected_none: false }, "id"),
    ).toThrow(/literal true/);
  });

  it("accepts a well-formed expected_skill case", () => {
    const c = parseRouteCase(
      { mode: "routing", prompt: "do thing", expected_skill: "skill.a", forbidden_skills: ["x"] },
      "id",
    );
    expect(c.expectation).toEqual({ kind: "skill", expected_skill: "skill.a" });
    expect(c.forbidden_skills).toEqual(["x"]);
  });
});

describe("caseIdFromPath()", () => {
  it("derives a relative POSIX path with no leading ./", () => {
    expect(caseIdFromPath("/cases", "/cases/group-a/case-1/eval.yaml")).toBe("group-a/case-1");
  });

  it("normalises Windows-style separators", () => {
    expect(caseIdFromPath("/cases", "/cases/group/eval.yaml")).toBe("group");
  });
});

describe("loadObserved()", () => {
  it("fails loud with line numbers on malformed JSON", async () => {
    const root = await tmpRoot();
    const obs = path.join(root, "observed.jsonl");
    await fs.writeFile(
      obs,
      [
        JSON.stringify({ caseId: "ok", tool: "skill.a" }),
        "this is not json",
        JSON.stringify({ caseId: "ok", tool: "skill.b" }),
      ].join("\n"),
      "utf8",
    );
    await expect(loadObserved(obs)).rejects.toThrow(/line 2/);
  });

  it("rejects rows missing caseId", async () => {
    const root = await tmpRoot();
    const obs = path.join(root, "observed.jsonl");
    await fs.writeFile(obs, JSON.stringify({ tool: "skill.a" }), "utf8");
    await expect(loadObserved(obs)).rejects.toThrow(/caseId/);
  });
});

describe("loadCases()", () => {
  it("aggregates schema errors across cases", async () => {
    const root = await tmpRoot();
    await setupCase(root, "good", "mode: routing\nprompt: hi\nexpected_skill: a\n");
    await setupCase(root, "bad", "mode: routing\nprompt: hi\n");
    await expect(loadCases(root)).rejects.toThrow(/exactly one/);
  });
});

describe("runRouteEval()", () => {
  it("passes expected_skill when observed matches and writes report files", async () => {
    const root = await tmpRoot();
    await setupCase(root, "case-a", "mode: routing\nprompt: hi\nexpected_skill: skill.a\n");
    const observed = path.join(root, "observed.jsonl");
    await fs.writeFile(observed, JSON.stringify({ caseId: "case-a", tool: "skill.a" }) + "\n", "utf8");

    const code = await runRouteEval(root, observed);
    expect(code).toBe(0);

    const report = JSON.parse(
      await fs.readFile(path.join(root, ".route-eval", "results.json"), "utf8"),
    );
    expect(report.passed).toBe(1);

    const md = await fs.readFile(path.join(root, ".route-eval", "report.md"), "utf8");
    expect(md).toContain("Route Eval Report");
  });

  it("fails expected_none when any tool fires", async () => {
    const root = await tmpRoot();
    await setupCase(root, "case-b", "mode: routing\nprompt: noop\nexpected_none: true\n");
    const observed = path.join(root, "observed.jsonl");
    await fs.writeFile(observed, JSON.stringify({ caseId: "case-b", tool: "skill.x" }) + "\n", "utf8");
    expect(await runRouteEval(root, observed)).toBe(1);
  });

  it("enforces forbidden_skills", async () => {
    const root = await tmpRoot();
    await setupCase(
      root,
      "case-c",
      "mode: routing\nprompt: test\nexpected_skill: skill.good\nforbidden_skills:\n  - skill.bad\n",
    );
    const observed = path.join(root, "observed.jsonl");
    await fs.writeFile(
      observed,
      [
        JSON.stringify({ caseId: "case-c", tool: "skill.good" }),
        JSON.stringify({ caseId: "case-c", tool: "skill.bad" }),
      ].join("\n") + "\n",
      "utf8",
    );
    expect(await runRouteEval(root, observed)).toBe(1);
  });

  it("returns 2 when cases are malformed", async () => {
    const root = await tmpRoot();
    await setupCase(root, "broken", "mode: routing\nprompt: hi\n");
    const observed = path.join(root, "observed.jsonl");
    await fs.writeFile(observed, "", "utf8");
    expect(await runRouteEval(root, observed)).toBe(2);
  });

  it("returns 2 when observed log is malformed", async () => {
    const root = await tmpRoot();
    await setupCase(root, "case-a", "mode: routing\nprompt: hi\nexpected_skill: skill.a\n");
    const observed = path.join(root, "observed.jsonl");
    await fs.writeFile(observed, "not json\n", "utf8");
    expect(await runRouteEval(root, observed)).toBe(2);
  });

  it("honours --filter (only matching cases scored)", async () => {
    const root = await tmpRoot();
    await setupCase(root, "alpha", "mode: routing\nprompt: x\nexpected_skill: a\n");
    await setupCase(root, "beta", "mode: routing\nprompt: x\nexpected_skill: b\n");
    const observed = path.join(root, "observed.jsonl");
    await fs.writeFile(observed, JSON.stringify({ caseId: "alpha", tool: "a" }) + "\n", "utf8");

    const code = await runRouteEval(root, observed, { filter: "alpha" });
    expect(code).toBe(0);
    const report = JSON.parse(
      await fs.readFile(path.join(root, ".route-eval", "results.json"), "utf8"),
    );
    expect(report.total).toBe(1);
    expect(report.results[0].caseId).toBe("alpha");
  });

  it("honours --dry-run (no observed file required, no reports written)", async () => {
    const root = await tmpRoot();
    await setupCase(root, "alpha", "mode: routing\nprompt: x\nexpected_skill: a\n");
    const code = await runRouteEval(root, "/does/not/exist.jsonl", { dryRun: true });
    expect(code).toBe(0);
    await expect(fs.access(path.join(root, ".route-eval"))).rejects.toBeDefined();
  });
});
