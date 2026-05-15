import { fileURLToPath } from "node:url";
import { parseCliArgs } from "./cli-parser.js";
import { discoverTests, getCategories, runAll } from "./runner.js";
import { runRouteEval } from "./route-eval.js";
import { runRoute } from "./route-runner.js";
import { runProxyCli } from "./route-proxy.js";
import { reportMetrics } from "./telemetry.js";
import { initTracing } from "./tracing.js";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  // The proxy subcommand is invoked by opencode.json's MCP server config; it
  // runs over stdio and never goes through tracing setup or the eval pipeline.
  if (args[0] === "__proxy") {
    return runProxyCli(args.slice(1));
  }

  const tracing = initTracing();
  try {
    return await runMain(args);
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

function resolveProxyBin(): string {
  // process.argv[1] points at the entry that the user invoked (the bin
  // symlink, dist/cli.cjs, etc.). It's the right thing to feed back into
  // opencode.json so the spawned proxy uses the same bundle.
  const entry = process.argv[1];
  if (entry) return entry;
  // Fallback for ESM consumers — should never hit in the CJS bin path.
  return fileURLToPath(import.meta.url);
}

async function runMain(args: string[]): Promise<number> {
  const result = parseCliArgs(args, {
    cwd: process.cwd(),
    env: process.env,
  });

  if (result.kind === "help") {
    console.log(result.text);
    return 0;
  }

  if (result.kind === "error") {
    console.error(`Error: ${result.message}`);
    return 2;
  }

  if (result.kind === "route-score") {
    return runRouteEval(result.casesDir, result.observedJsonl, {
      filter: result.filter,
      dryRun: result.dryRun,
    });
  }

  if (result.kind === "route-run") {
    return runRoute({
      casesDir: result.casesDir,
      upstreamMcp: result.upstreamMcp,
      outputDir: result.outputDir,
      timeoutMs: result.timeoutMs,
      filter: result.filter,
      dryRun: result.dryRun,
      apiKey: result.apiKey,
      baseUrl: result.baseUrl,
      workerModel: result.workerModel,
      headers: result.headers,
      proxyBin: resolveProxyBin(),
    });
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
