import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRouteEval } from "./route-eval.js";

async function setupCase(dir: string, name: string, yaml: string) {
  const cdir = path.join(dir, name);
  await fs.mkdir(cdir, { recursive: true });
  await fs.writeFile(path.join(cdir, "eval.yaml"), yaml, "utf8");
}

describe("route eval", () => {
  it("passes expected_skill when observed matches", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "route-eval-"));
    await setupCase(
      root,
      "case-a",
      `mode: routing\nprompt: hi\nexpected_skill: skill.a\n`,
    );
    const observed = path.join(root, "observed.jsonl");
    await fs.writeFile(observed, JSON.stringify({ caseId: "case-a", tool: "skill.a" }) + "\n", "utf8");

    const code = await runRouteEval(root, observed);
    expect(code).toBe(0);
  });

  it("fails expected_none when any tool fires", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "route-eval-"));
    await setupCase(root, "case-b", `mode: routing\nprompt: noop\nexpected_none: true\n`);
    const observed = path.join(root, "observed.jsonl");
    await fs.writeFile(observed, JSON.stringify({ caseId: "case-b", tool: "skill.x" }) + "\n", "utf8");

    const code = await runRouteEval(root, observed);
    expect(code).toBe(1);
  });

  it("enforces forbidden_skills", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "route-eval-"));
    await setupCase(
      root,
      "case-c",
      `mode: routing\nprompt: test\nexpected_skill: skill.good\nforbidden_skills:\n  - skill.bad\n`,
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

    const code = await runRouteEval(root, observed);
    expect(code).toBe(1);
  });
});
