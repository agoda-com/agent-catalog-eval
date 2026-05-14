import { parseArgs } from "node:util";

export type EvalCliOptions = {
  mode: "eval";
  path: string;
  category?: string;
  filter?: string;
  workerModel?: string;
  dryRun: boolean;
};

export type RouteCliOptions = {
  mode: "route";
  casesDir: string;
  observedJsonl: string;
};

export type ParsedCliResult =
  | { kind: "ok"; options: EvalCliOptions | RouteCliOptions }
  | { kind: "help" }
  | { kind: "error"; message: string };

type ParseCliArgsInput = {
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export function parseCliArgs(argv: string[], input: ParseCliArgsInput): ParsedCliResult {
  const first = argv[0];
  if (first === "route") {
    const casesDir = argv[1];
    const observedJsonl = argv[2];
    if (!casesDir || !observedJsonl) {
      return { kind: "error", message: "Usage: agent-catalog-eval route <casesDir> <observed.jsonl>" };
    }
    return {
      kind: "ok",
      options: {
        mode: "route",
        casesDir,
        observedJsonl,
      },
    };
  }

  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      category: { type: "string", short: "c" },
      filter: { type: "string", short: "f" },
      workerModel: { type: "string", short: "m" },
      dryRun: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (parsed.values.help) {
    return { kind: "help" };
  }

  const target = parsed.positionals[0] ?? "./skills";

  return {
    kind: "ok",
    options: {
      mode: "eval",
      path: target,
      category: parsed.values.category,
      filter: parsed.values.filter,
      workerModel: parsed.values.workerModel,
      dryRun: parsed.values.dryRun,
    },
  };
}
