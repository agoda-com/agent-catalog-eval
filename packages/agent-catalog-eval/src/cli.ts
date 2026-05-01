import { parseCliArgs } from "./cli-parser.js";
import { runAll } from "./runner.js";
import { reportMetrics } from "./telemetry.js";

async function main(): Promise<number> {
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

  const { config } = result;
  const results = await runAll(config);

  if (config.collectMetrics && results.length > 0) {
    try {
      await reportMetrics(results, config);
    } catch (err) {
      console.error(
        "Warning: failed to send telemetry:",
        err instanceof Error ? err.message : err,
      );
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
