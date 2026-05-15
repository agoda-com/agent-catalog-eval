import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  caseIdFromPath,
  loadCases,
  loadObserved,
  score,
  type CaseResult,
  type RouteCase,
} from "./route-eval.js";
import { renderCaseReport, writeRunSummary, type VisibleTool } from "./route-report.js";

const MAX_OUTPUT = 10 * 1024 * 1024;

export interface RouteRunOptions {
  casesDir: string;
  upstreamMcp: string;
  outputDir: string;
  timeoutMs: number;
  filter?: string;
  dryRun?: boolean;
  apiKey: string;
  baseUrl: string;
  workerModel: string;
  headers: Record<string, string>;
  /**
   * Absolute path to the bin used to spawn the proxy via opencode.json. The
   * cli sets this to its own resolved script path so route mode works the
   * same whether invoked via `npx`, a local `node_modules/.bin` symlink,
   * or `node dist/cli.cjs`.
   */
  proxyBin: string;
  /** Override the spawned `opencode` invocation. Useful for tests. */
  spawnAgent?: (workDir: string, prompt: string, timeoutMs: number) => Promise<AgentExit>;
}

export interface AgentExit {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

interface CaseRunResult {
  caseResult: CaseResult;
  durationMs: number;
  visibleTools: VisibleTool[];
  reportPath: string;
}

function expectationLabel(c: RouteCase): string {
  switch (c.expectation.kind) {
    case "skill":
      return `expected_skill=${c.expectation.expected_skill}`;
    case "any_of":
      return `expected_any_of=[${c.expectation.expected_any_of.join(",")}]`;
    case "none":
      return "expected_none=true";
  }
}

async function writeOpencodeConfig(
  workDir: string,
  opts: RouteRunOptions,
  caseId: string,
  observedJsonl: string,
): Promise<void> {
  const config = {
    $schema: "https://opencode.ai/config.json",
    model: `gateway/${opts.workerModel}`,
    provider: {
      gateway: {
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: opts.baseUrl,
          apiKey: "{env:OPENAI_API_KEY}",
          headers: opts.headers,
        },
        models: {
          [opts.workerModel]: {},
        },
      },
    },
    mcp: {
      "agent-catalog-eval-proxy": {
        type: "local",
        command: [
          process.execPath,
          opts.proxyBin,
          "__proxy",
          "--upstream",
          opts.upstreamMcp,
          "--case-id",
          caseId,
          "--log",
          observedJsonl,
        ],
        enabled: true,
      },
    },
  };
  await fs.writeFile(path.join(workDir, "opencode.json"), JSON.stringify(config, null, 2));
}

function defaultSpawnAgent(
  workDir: string,
  prompt: string,
  timeoutMs: number,
  apiKey: string,
): Promise<AgentExit> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "opencode",
      ["run", prompt, "--print-logs", "--log-level", "DEBUG", "--format", "json"],
      {
        cwd: workDir,
        env: {
          ...process.env,
          OPENAI_API_KEY: apiKey,
          OPENCODE_SKIP_MIGRATIONS: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );

    let stdout = "";
    let stderr = "";
    let killed = false;

    proc.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      killed = true;
      try {
        if (proc.pid) process.kill(-proc.pid, "SIGKILL");
      } catch {
        proc.kill("SIGKILL");
      }
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start opencode: ${err.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut: killed, stdout, stderr });
    });
  });
}

async function runOneCase(c: RouteCase, opts: RouteRunOptions): Promise<CaseRunResult> {
  const caseDir = path.join(opts.outputDir, c.id);
  await fs.mkdir(caseDir, { recursive: true });

  const observedJsonl = path.join(caseDir, "observed.jsonl");
  const reportPath = path.join(caseDir, "report.md");
  const tracePath = path.join(caseDir, "agent.log");

  await fs.writeFile(observedJsonl, "", "utf8");
  await writeOpencodeConfig(caseDir, opts, c.id, observedJsonl);

  const start = Date.now();
  const spawnFn = opts.spawnAgent ?? ((wd, p, t) => defaultSpawnAgent(wd, p, t, opts.apiKey));
  let exit: AgentExit;
  try {
    exit = await spawnFn(caseDir, c.prompt, opts.timeoutMs);
  } catch (err) {
    exit = {
      exitCode: -1,
      timedOut: false,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
  const durationMs = Date.now() - start;

  await fs.writeFile(
    tracePath,
    `--- stdout ---\n${exit.stdout}\n--- stderr ---\n${exit.stderr}\n--- exit ---\nexitCode=${exit.exitCode} timedOut=${exit.timedOut}\n`,
    "utf8",
  );

  let visibleTools: VisibleTool[] = [];
  let calledTools: string[] = [];
  try {
    const observed = await loadObserved(observedJsonl);
    calledTools = observed.toolsByCase.get(c.id) ?? [];
    const visible = observed.visibleByCase.get(c.id);
    if (visible) {
      visibleTools = visible.map((name) => ({ name }));
    }
  } catch {
    /* observation log may be empty or malformed; treated as no observations */
  }

  // Re-parse the raw log to recover descriptions (loadObserved only keeps names).
  visibleTools = await readVisibleToolsWithDescriptions(observedJsonl, c.id, visibleTools);

  const s = score(c, calledTools);
  const caseResult: CaseResult = {
    caseId: c.id,
    passed: s.passed,
    reason: s.reason,
    observed: calledTools,
    visibleTools: visibleTools.map((t) => t.name),
    expected: expectedJson(c),
  };

  const md = renderCaseReport({
    routeCase: c,
    result: caseResult,
    visibleTools,
    calledTools,
  });
  await fs.writeFile(reportPath, md, "utf8");

  return { caseResult, durationMs, visibleTools, reportPath };
}

function expectedJson(c: RouteCase): CaseResult["expected"] {
  const out: CaseResult["expected"] = { forbidden_skills: c.forbidden_skills };
  switch (c.expectation.kind) {
    case "skill":
      out.expected_skill = c.expectation.expected_skill;
      break;
    case "any_of":
      out.expected_any_of = c.expectation.expected_any_of;
      break;
    case "none":
      out.expected_none = true;
      break;
  }
  return out;
}

/**
 * Re-walks the per-case observation log to pull out the descriptions of
 * tools the agent saw. We can't keep them in `loadObserved` without
 * reshaping the existing scorer surface, so the runner re-scans the file
 * here when it has the case-id in hand.
 */
async function readVisibleToolsWithDescriptions(
  jsonlPath: string,
  caseId: string,
  fallback: VisibleTool[],
): Promise<VisibleTool[]> {
  let raw: string;
  try {
    raw = await fs.readFile(jsonlPath, "utf8");
  } catch {
    return fallback;
  }
  const seen = new Map<string, VisibleTool>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as {
        caseId?: string;
        type?: string;
        visibleTools?: Array<{ name: string; description?: string }>;
      };
      if (row.caseId !== caseId) continue;
      if (row.type === "tools/list" && Array.isArray(row.visibleTools)) {
        for (const t of row.visibleTools) {
          if (!seen.has(t.name)) seen.set(t.name, { name: t.name, description: t.description });
        }
      }
    } catch {
      /* skip — malformed lines are surfaced elsewhere */
    }
  }
  return seen.size > 0 ? [...seen.values()] : fallback;
}

export async function runRoute(opts: RouteRunOptions): Promise<number> {
  let cases: RouteCase[];
  try {
    cases = await loadCases(opts.casesDir);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  if (opts.filter) {
    const needle = opts.filter;
    cases = cases.filter((c) => c.id.includes(needle));
  }

  if (opts.dryRun) {
    process.stdout.write(`Discovered ${cases.length} routing case(s):\n`);
    for (const c of cases) {
      process.stdout.write(`  - ${c.id}  ${expectationLabel(c)}\n`);
    }
    return 0;
  }

  await fs.mkdir(opts.outputDir, { recursive: true });

  const summary: Awaited<ReturnType<typeof writeRunSummary>> extends void
    ? Parameters<typeof writeRunSummary>[1]
    : never = {
    generatedAt: new Date().toISOString(),
    upstreamMcp: opts.upstreamMcp,
    total: cases.length,
    passed: 0,
    failed: 0,
    cases: [],
  };

  for (const c of cases) {
    const { caseResult, durationMs, reportPath } = await runOneCase(c, opts);
    if (caseResult.passed) {
      summary.passed++;
      process.stdout.write(`pass  ${c.id}\n`);
    } else {
      summary.failed++;
      process.stdout.write(`fail  ${c.id} - ${caseResult.reason ?? "unknown"}\n`);
      process.stdout.write(`      report: ${reportPath}\n`);
    }
    summary.cases.push({
      caseId: c.id,
      passed: caseResult.passed,
      reason: caseResult.reason,
      expected: caseResult.expected,
      observed: caseResult.observed,
      durationMs,
      reportPath,
    });
  }

  process.stdout.write(`\nRoute eval complete: ${summary.passed}/${summary.total} passed\n`);
  await writeRunSummary(path.join(opts.outputDir, "summary.json"), summary);
  process.stdout.write(`Summary: ${path.join(opts.outputDir, "summary.json")}\n`);

  return summary.failed === 0 ? 0 : 1;
}

// Re-export caseIdFromPath so external producers (the proxy is internal,
// but other observation pipelines too) share one ID derivation.
export { caseIdFromPath };
