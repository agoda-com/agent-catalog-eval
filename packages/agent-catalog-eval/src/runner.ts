import { readdir, readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { parse } from "yaml";
import chalk from "chalk";
import type { Span } from "@opentelemetry/api";
import type {
  AgentResult,
  AgentType,
  EvalConfig,
  OpenCodeSkillSignals,
  RunnerConfig,
  TestCase,
  TestResult,
} from "./types.js";
import { collectFiles, copyDir, createWorkDir, removeDir } from "./files.js";
import { runAgent, skillsDirForAgent } from "./agent.js";
import { evaluate, diagnoseFailures } from "./judge.js";
import { withSpan } from "./tracing.js";

const SKIP_DIRS = new Set(["node_modules", "src", "dist", ".git", "output"]);

const TRACE_DIR = ".agent-trace";

export async function discoverTests(casesDir: string, repoRoot: string): Promise<TestCase[]> {
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
        additionalSkillPaths: (config.additional_skills ?? []).map((p) => resolve(repoRoot, p)),
        threshold: config.threshold,
        judgeRubric: config.judge_rubric,
        prompt,
        beforeDir: join(dir, "before"),
        afterDir: join(dir, "after"),
        category: config.category,
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

/** Returns the set of distinct, non-empty categories across the given tests, sorted. */
export function getCategories(tests: TestCase[]): string[] {
  const categories = new Set<string>();
  for (const t of tests) {
    if (t.category) categories.add(t.category);
  }
  return [...categories].sort();
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

export function checkSkillUsage(
  agentResult: AgentResult,
  skillName: string,
  agent?: AgentType,
): boolean {
  const combined = agentResult.stdout + agentResult.stderr;
  const skillsPath = agent ? skillsDirForAgent(agent) : ".cursor/skills";
  return (
    combined.includes(skillName) || combined.includes("SKILL.md") || combined.includes(skillsPath)
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Greps the OpenCode debug log for the two signals that prove a skill
 * was actually loaded and used:
 *
 *   1. registration — `service=permission permission=skill pattern=<name>`
 *      is logged once per skill the auto-discoverer finds at startup.
 *      No line for `<name>` ⇒ OpenCode never saw the skill (most likely
 *      because it was placed in a directory OpenCode doesn't scan).
 *
 *   2. invocation — `tool_name=skill` appears for each `tool_result` event
 *      from the OTel plugin when the agent calls the skill tool. Reading
 *      the SKILL.md file via the `read` tool does NOT count.
 *
 * These match what surfaces with `--log-level DEBUG --print-logs`, which
 * is what the runner already passes to opencode.
 */
export function checkOpenCodeSkillSignals(
  agentResult: AgentResult,
  skillNames: string[],
): OpenCodeSkillSignals {
  const combined = agentResult.stdout + agentResult.stderr;

  const registrations = skillNames.map((skill) => ({
    skill,
    // Anchor with whitespace (or end-of-string) after the name so e.g.
    // `pattern=foo-bar` doesn't satisfy a request for `foo` — `\b` would,
    // since `-` is not a word char.
    registered: new RegExp(`permission=skill\\s+pattern=${escapeRegex(skill)}(?:\\s|$)`).test(
      combined,
    ),
  }));

  const anyInvoked = /\btool_name=skill\b/.test(combined);

  return { registrations, anyInvoked };
}

/**
 * Returns a non-empty error message when the OpenCode signals indicate a
 * skill failed to load or wasn't used, otherwise `undefined`. The runner
 * uses this to fail the test regardless of the judge's verdict.
 */
export function describeOpenCodeSkillSignalFailure(
  signals: OpenCodeSkillSignals,
): string | undefined {
  const unregistered = signals.registrations.filter((r) => !r.registered).map((r) => r.skill);
  if (unregistered.length > 0) {
    return (
      `OpenCode never registered skill(s): ${unregistered.join(", ")}. ` +
      `Auto-discovery missed them — make sure they're in .opencode/skills/<name>/SKILL.md.`
    );
  }
  if (!signals.anyInvoked) {
    return (
      `OpenCode registered the skill(s) but never invoked the skill tool ` +
      `(no tool_name=skill event in the log). The agent worked around the skill ` +
      `instead of using it.`
    );
  }
  return undefined;
}

async function executeTest(testCase: TestCase, config: RunnerConfig): Promise<TestResult> {
  // Wrap the whole test in an `eval.test` span so the OpenAI judge call
  // (auto-instrumented by OpenInference) and any future child spans
  // share a parent in Arize. When tracing isn't initialised the helper
  // resolves to a no-op span, so this is free at runtime.
  return withSpan(
    "eval.test",
    {
      "agoda.eval.test_name": testCase.name,
      "agoda.eval.skill_path": testCase.skillPath,
      "agoda.eval.threshold": testCase.threshold,
      "agoda.eval.agent": config.agent,
      "agoda.eval.worker_model": config.workerModel,
      "agoda.eval.judge_model": config.judgeModel,
      ...(testCase.category ? { "agoda.eval.category": testCase.category } : {}),
    },
    (span) => runTestBody(testCase, config, span),
  );
}

async function runTestBody(
  testCase: TestCase,
  config: RunnerConfig,
  span: Span,
): Promise<TestResult> {
  const start = Date.now();
  const label = testCase.name.replace(/\//g, "-");
  const workDir = await createWorkDir(config.outputDir, label);

  try {
    await copyDir(testCase.beforeDir, workDir);

    const skillContent = await readFile(testCase.skillPath, "utf-8");
    const skillName = basename(dirname(testCase.skillPath));

    const additionalSkills = await Promise.all(
      testCase.additionalSkillPaths.map(async (p) => ({
        name: basename(dirname(p)),
        content: await readFile(p, "utf-8"),
      })),
    );

    const agentResult = await runAgent({
      workDir,
      prompt: testCase.prompt,
      skillContent,
      skillName,
      additionalSkills,
      agent: config.agent,
      model: config.workerModel,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      headers: config.headers,
      otel: config.otel
        ? {
            config: config.otel,
            resourceAttributes: {
              "agoda.eval.test_name": testCase.name,
              "agoda.eval.skill_name": skillName,
              "agoda.eval.agent": config.agent,
              "agoda.eval.worker_model": config.workerModel,
              "agoda.ci.project": config.ciContext.project,
              "agoda.ci.pipeline_id": config.ciContext.pipeline_id,
              "agoda.ci.commit_sha": config.ciContext.commit_sha,
              "agoda.ci.branch": config.ciContext.branch,
              ...(testCase.category ? { "agoda.eval.category": testCase.category } : {}),
            },
          }
        : undefined,
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
        chalk.yellow(
          `  ⚠ Agent exited with code ${agentResult.exitCode} (still evaluating output)`,
        ),
      );
    }

    const allSkillNames = [skillName, ...additionalSkills.map((s) => s.name)];

    let skillSignals: OpenCodeSkillSignals | undefined;
    let signalError: string | undefined;
    if (config.agent === "opencode") {
      skillSignals = checkOpenCodeSkillSignals(agentResult, allSkillNames);
      signalError = describeOpenCodeSkillSignalFailure(skillSignals);
    } else {
      for (const name of allSkillNames) {
        if (!checkSkillUsage(agentResult, name, config.agent)) {
          console.log(
            chalk.yellow(
              `  ⚠ Skill "${name}" was not referenced in agent output — ` +
                `the prompt may not trigger skill discovery, or the skill needs a better title/description`,
            ),
          );
        }
      }
    }

    const agentFiles = (await collectFiles(workDir)).filter(
      (f) =>
        !f.path.startsWith(".cursor") &&
        !f.path.startsWith(".claude") &&
        !f.path.startsWith(".opencode") &&
        !f.path.startsWith(TRACE_DIR) &&
        f.path !== "opencode.json",
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

    const meetsThreshold = verdict.score >= testCase.threshold;
    const passed = !signalError && meetsThreshold;
    if (passed) await removeDir(workDir);

    span.setAttributes({
      "agoda.eval.score": verdict.score,
      "agoda.eval.passed": passed,
      ...(signalError ? { "agoda.eval.skill_signal_failure": signalError } : {}),
    });

    return {
      name: testCase.name,
      passed,
      score: verdict.score,
      threshold: testCase.threshold,
      reasoning: verdict.reasoning,
      durationMs: Date.now() - start,
      category: testCase.category,
      ...(skillSignals ? { skillSignals } : {}),
      ...(signalError ? { error: signalError } : {}),
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
      category: testCase.category,
    };
  }
}

export function printResult(result: TestResult) {
  const icon = result.passed ? chalk.green("✓") : chalk.red("✗");
  const score = result.passed ? chalk.green(`${result.score}%`) : chalk.red(`${result.score}%`);
  const time = chalk.dim(`${(result.durationMs / 1000).toFixed(1)}s`);

  console.log(`  ${icon} ${result.name}  ${score} (threshold: ${result.threshold}%)  ${time}`);

  if (result.skillSignals) {
    const regParts = result.skillSignals.registrations.map(
      (r) => `${r.registered ? chalk.green("✓") : chalk.red("✗")} ${r.skill}`,
    );
    const invokedMark = result.skillSignals.anyInvoked ? chalk.green("✓") : chalk.red("✗");
    console.log(chalk.dim(`    skill registered: ${regParts.join(", ")}`));
    console.log(chalk.dim(`    skill invoked:    ${invokedMark}`));
  }

  if (result.reasoning) {
    console.log(chalk.dim(`    ${result.reasoning}`));
  }
  if (result.error && (!result.passed || result.score === 0)) {
    console.log(chalk.red(`    Error: ${result.error}`));
  }
  console.log();
}

export function printSummary(results: TestResult[]) {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log(chalk.bold("━".repeat(60)));
  console.log(chalk.bold(`Results: ${passed} passed, ${failed} failed, ${results.length} total`));

  if (failed > 0) {
    console.log(chalk.red.bold("\nFailed:"));
    for (const r of results.filter((r) => !r.passed)) {
      const reason = r.skillSignals && describeOpenCodeSkillSignalFailure(r.skillSignals)
        ? chalk.red(" [skill-signal failure]")
        : "";
      console.log(chalk.red(`  ✗ ${r.name} (${r.score}% < ${r.threshold}%)${reason}`));
    }
  }
  console.log();
}

export async function runAll(config: RunnerConfig): Promise<TestResult[]> {
  const allTests = await discoverTests(config.casesDir, config.repoRoot);

  let tests = config.filter ? allTests.filter((t) => t.name.includes(config.filter!)) : allTests;

  if (config.category) {
    tests = tests.filter((t) => t.category === config.category);
  }

  if (config.notCategory) {
    const exclude = new Set(config.notCategory.split(",").map((c) => c.trim()));
    tests = tests.filter((t) => !t.category || !exclude.has(t.category));
  }

  if (tests.length === 0) {
    console.log(chalk.yellow("No test cases found."));
    return [];
  }

  console.log(chalk.bold(`\nDiscovered ${tests.length} test case(s):\n`));
  for (const t of tests) {
    const categoryLabel = t.category ? chalk.dim(` [${t.category}]`) : "";
    console.log(`  ${chalk.cyan("•")} ${t.name}${categoryLabel} (threshold: ${t.threshold}%)`);
  }
  console.log();

  const allCategories = getCategories(allTests);
  if (allCategories.length > 0) {
    console.log(chalk.dim(`Categories: ${allCategories.join(", ")}\n`));
  }

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
