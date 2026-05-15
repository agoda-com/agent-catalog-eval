import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runRoute, type RouteRunOptions } from "./route-runner.js";

async function setupCase(dir: string, name: string, yaml: string) {
  const cdir = path.join(dir, name);
  await fs.mkdir(cdir, { recursive: true });
  await fs.writeFile(path.join(cdir, "eval.yaml"), yaml, "utf8");
}

async function tmpRoot() {
  return fs.mkdtemp(path.join(os.tmpdir(), "route-runner-"));
}

/**
 * Build a fake `spawnAgent` that writes a canned observed.jsonl into the
 * per-case workdir before "exiting." This is what a real agent-+-proxy
 * pair would have produced, minus the actual MCP/HTTP plumbing.
 */
function fakeAgent(rows: Array<Record<string, unknown>>): RouteRunOptions["spawnAgent"] {
  return async (workDir) => {
    const lines = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await fs.writeFile(path.join(workDir, "observed.jsonl"), lines, "utf8");
    return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
  };
}

const baseOpts = (root: string): Omit<RouteRunOptions, "spawnAgent"> => ({
  casesDir: root,
  upstreamMcp: "https://skills.example/mcp",
  outputDir: path.join(root, ".route-eval"),
  timeoutMs: 5000,
  apiKey: "x",
  baseUrl: "https://api.example",
  workerModel: "test-model",
  headers: {},
  proxyBin: "/dev/null/proxy",
});

describe("runRoute", () => {
  it("scores a passing case and writes per-case + summary outputs", async () => {
    const root = await tmpRoot();
    await setupCase(root, "alpha", "mode: routing\nprompt: do x\nexpected_skill: skill.a\n");

    const code = await runRoute({
      ...baseOpts(root),
      spawnAgent: fakeAgent([
        {
          caseId: "alpha",
          type: "tools/list",
          visibleTools: [{ name: "skill.a", description: "right" }],
        },
        { caseId: "alpha", type: "tools/call", tool: "skill.a" },
      ]),
    });
    expect(code).toBe(0);

    const summary = JSON.parse(
      await fs.readFile(path.join(root, ".route-eval", "summary.json"), "utf8"),
    );
    expect(summary.total).toBe(1);
    expect(summary.passed).toBe(1);
    expect(summary.upstreamMcp).toBe("https://skills.example/mcp");

    const md = await fs.readFile(path.join(root, ".route-eval", "alpha", "report.md"), "utf8");
    expect(md).toContain("**Result:** pass");
    expect(md).toContain("**`skill.a`**");
  });

  it("scores a failing case and surfaces the description diff in the report", async () => {
    const root = await tmpRoot();
    await setupCase(
      root,
      "miss",
      "mode: routing\nprompt: do x\nexpected_skill: skill.right\n",
    );

    const code = await runRoute({
      ...baseOpts(root),
      spawnAgent: fakeAgent([
        {
          caseId: "miss",
          type: "tools/list",
          visibleTools: [
            { name: "skill.right", description: "Refactor to constructor injection" },
            { name: "skill.wrong", description: "Refactor to property injection" },
          ],
        },
        { caseId: "miss", type: "tools/call", tool: "skill.wrong" },
      ]),
    });
    expect(code).toBe(1);

    const md = await fs.readFile(path.join(root, ".route-eval", "miss", "report.md"), "utf8");
    expect(md).toContain("**Result:** fail");
    expect(md).toContain("Description diff: `skill.right` (expected) → `skill.wrong` (called)");
    expect(md).toContain("- constructor");
    expect(md).toContain("+ property");
  });

  it("returns a fail and writes a 'no tools/list observed' report when the proxy logged nothing", async () => {
    const root = await tmpRoot();
    await setupCase(root, "silent", "mode: routing\nprompt: do x\nexpected_skill: skill.a\n");

    const code = await runRoute({
      ...baseOpts(root),
      spawnAgent: fakeAgent([]),
    });
    expect(code).toBe(1);

    const md = await fs.readFile(path.join(root, ".route-eval", "silent", "report.md"), "utf8");
    expect(md).toContain("No `tools/list` was observed");
    expect(md).toContain("No `tools/call` was observed");
  });

  it("--filter narrows the case set", async () => {
    const root = await tmpRoot();
    await setupCase(root, "alpha", "mode: routing\nprompt: x\nexpected_skill: a\n");
    await setupCase(root, "beta", "mode: routing\nprompt: x\nexpected_skill: b\n");

    const code = await runRoute({
      ...baseOpts(root),
      filter: "alpha",
      spawnAgent: fakeAgent([{ caseId: "alpha", type: "tools/call", tool: "a" }]),
    });
    expect(code).toBe(0);

    const summary = JSON.parse(
      await fs.readFile(path.join(root, ".route-eval", "summary.json"), "utf8"),
    );
    expect(summary.total).toBe(1);
    expect(summary.cases[0].caseId).toBe("alpha");
  });

  it("--dry-run lists discovered cases without spawning the agent", async () => {
    const root = await tmpRoot();
    await setupCase(root, "alpha", "mode: routing\nprompt: x\nexpected_skill: a\n");

    let spawned = 0;
    const code = await runRoute({
      ...baseOpts(root),
      dryRun: true,
      spawnAgent: async () => {
        spawned++;
        return { exitCode: 0, timedOut: false, stdout: "", stderr: "" };
      },
    });

    expect(code).toBe(0);
    expect(spawned).toBe(0);
    await expect(fs.access(path.join(root, ".route-eval", "summary.json"))).rejects.toBeDefined();
  });

  it("returns 2 when cases fail to load", async () => {
    const root = await tmpRoot();
    await setupCase(root, "broken", "mode: routing\nprompt: x\n"); // no expected_*

    const code = await runRoute({
      ...baseOpts(root),
      spawnAgent: fakeAgent([]),
    });
    expect(code).toBe(2);
  });
});
