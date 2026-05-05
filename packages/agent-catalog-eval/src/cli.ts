import { parseCliArgs } from "./cli-parser.js";
import { discoverTests, getCategories, runAll } from "./runner.js";
import { reportMetrics } from "./telemetry.js";
import { initTracing } from "./tracing.js";

async function main(): Promise<number> {
  const tracing = initTracing();

  try {
    return await runMain();
  } finally {
    if (tracing.enabled) {
      try {
        await tracing.shutdown();
      } catch (err) {
        console.error("Warning: failed to flush traces:", err instanceof Error ? err.message : err);
      }
    }
  }
}

async function runMain(): Promise<number> {
  const result = parseCliArgs(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
  });

  if (result.kind === "help") {
    console.log(result.text);
    return 0;
  }

  if (result.kind === "error") {
    console.error(`Error: ${result.message}`);
    return 1;
  }

  if (result.kind === "list-categories") {
    const tests = await discoverTests(result.casesDir, result.repoRoot);
    const categories = getCategories(tests);

    console.log("\nAvailable categories:\n");
    for (const cat of categories) {
      const count = tests.filter((t) => t.category === cat).length;
      console.log(`  ${cat} (${count} tests)`);
    }

    const uncategorized = tests.filter((t) => !t.category);
    if (uncategorized.length > 0) {
      console.log(`\n  [uncategorized] (${uncategorized.length} tests)`);
      for (const t of uncategorized) {
        console.log(`    - ${t.name}`);
      }
    }
    console.log();
    return 0;
  }

  const { config } = result;
  const results = await runAll(config);

  if (config.collectMetrics && results.length > 0) {
    try {
      await reportMetrics(results, config);
    } catch (err) {
      console.error("Warning: failed to send telemetry:", err instanceof Error ? err.message : err);
    }
  }

  return results.some((r) => !r.passed) ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
