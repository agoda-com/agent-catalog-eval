import { readdir, readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { parse } from "yaml";
import chalk from "chalk";
import type {
  AgentResult,
  AgentType,
  EvalConfig,
  RunnerConfig,
  TestCase,
  TestResult,
} from "./types.js";
import { collectFiles, copyDir, createWorkDir, removeDir } from "./files.js";
import { runAgent } from "./agent.js";
import { evaluate, diagnoseFailures } from "./judge.js";

const SKIP_DIRS = new Set(["node_modules", "src", "dist", ".git", "output"]);

const TRACE_DIR = ".agent-trace";

export async function discoverTests(
  casesDir: string,
  repoRoot: string,
): Promise<TestCase[]> {
  const tests: TestCase[] = [];

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });

    if (entries.some((e) => e.name === "eval.yaml" && e.isFile())) {
      const evalContent = await readFile(join(dir, "eval.yaml"), "utf-8");
      const config = parse(evalContent) as EvalConfig;
      const prompt = await readFile(join(dir, "prompt.md"), "utf-8");

      tests.push({
        name: relative(casesDir, dir),
        dir,
        skillPath: resolve(repoRoot, config.skill_path),
        threshold: config.threshold,
        judgeRubric: config.judge_rubric,
        prompt,
        beforeDir: join(dir, "before"),
        afterDir: join(dir, "after"),
      });
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        await walk(join(dir, entry.name));
      }
    }
  }

  await walk(casesDir);
  return tests.sort((a, b) => a.name.localeCompare(b.name));
}

async function saveTrace(traceDir: string, agentResult: AgentResult) {
  await mkdir(traceDir, { recursive: true });
  await writeFile(join(traceDir, "stdout.txt"), agentResult.stdout || "(empty)");
  await writeFile(join(traceDir, "stderr.txt"), agentResult.stderr || "(empty)");
}

async function copyAgentLogs(traceDir: string, agent: AgentType) {
  if (agent !== "opencode") return;

  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  const logDir = join(dataHome, "opencode", "log");

  try {
    await cp(logDir, join(traceDir, "opencode-logs"), { recursive: true });
  } catch {
    // Best-effort — logs may not exist in this environment
  }
}

export function checkSkillUsage(agentResult: AgentResult, skillName: string): boolean {
  const combined = agentResult.stdout + agentResult.stderr;
  return (
    combined.includes(skillName) ||
    combined.includes("SKILL.md") ||
    combined.includes(".cursor/skills")
  );
}

async function executeTest(
  testCase: TestCase,
  config: RunnerConfig,
): Promise<TestResult> {
  const start = Date.now();
  const label = testCase.name.replace(/\//g, "-");
  const workDir = await createWorkDir(config.outputDir, label);

  try {
    await copyDir(testCase.beforeDir, workDir);

    const skillContent = await readFile(testCase.skillPath, "utf-8");
    const skillName = basename(dirname(testCase.skillPath));

    const agentResult = await runAgent({
      workDir,
      prompt: testCase.prompt,
      skillContent,
      skillName,
      agent: config.agent,
      model: config.workerModel,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      headers: config.headers,
    });

    const traceDir = join(workDir, TRACE_DIR);
    await saveTrace(traceDir, agentResult);
    await copyAgentLogs(traceDir, config.agent);

    if (agentResult.timedOut) {
      const secs = Math.round(config.timeoutMs / 1000);
      console.log(
        chalk.yellow(`  ⚠ Agent timed out after ${secs}s and was killed (still evaluating output)`),
      );
    } else if (agentResult.exitCode !== 0) {
      console.log(
        chalk.yellow(`  ⚠ Agent exited with code ${agentResult.exitCode} (still evaluating output)`),
      );
    }

    if (!checkSkillUsage(agentResult, skillName)) {
      console.log(
        chalk.yellow(
          `  ⚠ Skill "${skillName}" was not referenced in agent output — ` +
            `the prompt may not trigger skill discovery, or the skill needs a better title/description`,
        ),
      );
    }

    const agentFiles = (await collectFiles(workDir)).filter(
      (f) =>
        !f.path.startsWith(".cursor") &&
        !f.path.startsWith(".opencode") &&
        !f.path.startsWith(TRACE_DIR),
    );
    const desiredFiles = await collectFiles(testCase.afterDir);

    const verdict = await evaluate({
      agentFiles,
      desiredFiles,
      rubric: testCase.judgeRubric,
      model: config.judgeModel,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      headers: config.headers,
    });

    const passed = verdict.score >= testCase.threshold;
    if (passed) await removeDir(workDir);

    return {
      name: testCase.name,
      passed,
      score: verdict.score,
      threshold: testCase.threshold,
      reasoning: verdict.reasoning,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: testCase.name,
      passed: false,
      score: 0,
      threshold: testCase.threshold,
      reasoning: "",
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function printResult(result: TestResult) {
  const icon = result.passed ? chalk.green("✓") : chalk.red("✗");
  const score = result.passed
    ? chalk.green(`${result.score}%`)
    : chalk.red(`${result.score}%`);
  const time = chalk.dim(`${(result.durationMs / 1000).toFixed(1)}s`);

  console.log(`  ${icon} ${result.name}  ${score} (threshold: ${result.threshold}%)  ${time}`);

  if (result.reasoning) {
    console.log(chalk.dim(`    ${result.reasoning}`));
  }
  if (result.error && result.score === 0) {
    console.log(chalk.red(`    Error: ${result.error}`));
  }
  console.log();
}

export function printSummary(results: TestResult[]) {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log(chalk.bold("━".repeat(60)));
  console.log(
    chalk.bold(`Results: ${passed} passed, ${failed} failed, ${results.length} total`),
  );

  if (failed > 0) {
    console.log(chalk.red.bold("\nFailed:"));
    for (const r of results.filter((r) => !r.passed)) {
      console.log(chalk.red(`  ✗ ${r.name} (${r.score}% < ${r.threshold}%)`));
    }
  }
  console.log();
}

export async function runAll(config: RunnerConfig): Promise<TestResult[]> {
  const allTests = await discoverTests(config.casesDir, config.repoRoot);
  const tests = config.filter
    ? allTests.filter((t) => t.name.includes(config.filter!))
    : allTests;

  if (tests.length === 0) {
    console.log(chalk.yellow("No test cases found."));
    return [];
  }

  console.log(chalk.bold(`\nDiscovered ${tests.length} test case(s):\n`));
  for (const t of tests) {
    console.log(`  ${chalk.cyan("•")} ${t.name} (threshold: ${t.threshold}%)`);
  }
  console.log();

  if (config.dryRun) {
    console.log(chalk.yellow("Dry run — skipping agent execution.\n"));
    return tests.map((t) => ({
      name: t.name,
      passed: true,
      score: 0,
      threshold: t.threshold,
      reasoning: "dry run",
      durationMs: 0,
    }));
  }

  const results: TestResult[] = [];
  for (const testCase of tests) {
    console.log(chalk.dim(`Running: ${testCase.name}...`));
    const result = await executeTest(testCase, config);
    results.push(result);
    printResult(result);
  }

  printSummary(results);

  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0 && config.apiKey) {
    try {
      console.log(chalk.bold("Diagnosis:\n"));
      const diagnosis = await diagnoseFailures({
        failures,
        model: config.judgeModel,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        headers: config.headers,
      });
      console.log(diagnosis);
      console.log();
    } catch {
      // Best-effort — don't fail the run if diagnosis fails
    }
  }

  return results;
}
