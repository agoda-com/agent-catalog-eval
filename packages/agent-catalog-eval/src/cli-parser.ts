import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { AgentType, CiContext, OtelConfig, RunnerConfig } from "./types.js";
import { detectCiContext } from "./ci.js";
import { findRepoRoot } from "./repo-root.js";
import { DEFAULT_METRICS_URL } from "./telemetry.js";

export const VALID_AGENTS: ReadonlySet<AgentType> = new Set<AgentType>([
  "cursor",
  "opencode",
  "claude-code",
]);

export const DEFAULT_AGENT: AgentType = "opencode";
export const DEFAULT_WORKER_MODEL = "claude-opus-4-7";
export const DEFAULT_JUDGE_MODEL = "gemini-3.1-flash";
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_TIMEOUT_SEC = 420;
export const DEFAULT_OTEL_PROTOCOL: OtelConfig["protocol"] = "grpc";
export const DEFAULT_OTEL_SERVICE_NAME = "agoda-agent-catalog-eval";

const VALID_OTEL_PROTOCOLS: ReadonlySet<OtelConfig["protocol"]> = new Set([
  "grpc",
  "http/protobuf",
]);

export const HELP_TEXT = `agent-catalog-eval — run a coding agent against a catalog of skill test cases

Usage:
  agent-catalog-eval [cases-dir] [options]

Arguments:
  [cases-dir]                Directory containing test cases (default: cwd).
                             Each leaf with eval.yaml + prompt.md is a test case.

Options:
  --agent <name>             Coding agent: cursor, opencode, claude-code
                               (default: opencode)
  --dry-run                  Validate test discovery without running agents
  --filter <pattern>         Only run tests whose name contains <pattern>
  --category <name>          Only run tests whose eval.yaml has this category
  --not-category <names>     Exclude tests in these categories (comma-separated)
  --list-categories          Print categories found under [cases-dir] and exit
  --worker-model <name>      Model for the coding agent (default: ${DEFAULT_WORKER_MODEL})
  --judge-model <name>       Model for the LLM judge (default: ${DEFAULT_JUDGE_MODEL})
  --timeout <seconds>        Per-agent execution timeout (default: ${DEFAULT_TIMEOUT_SEC})
  --collect                  POST telemetry summary after the run
  --metrics-url <url>        Telemetry endpoint
                               (default: $METRICS_URL or ${DEFAULT_METRICS_URL})
  --header KEY=VALUE         Extra header for OpenAI calls and the metrics POST.
                               Repeatable. No defaults — pass your own.
  --project <name>           Override CI project name (default: auto-detected)
  --repo-root <path>         Repo root for resolving skill_path in eval.yaml
                               (default: nearest .git ancestor of cases-dir)
  --output-dir <path>        Where per-test workdirs are created
                               (default: <cases-dir>/output)
  --base-url <url>           OpenAI-compatible base URL
                               (default: $OPENAI_BASE_URL or ${DEFAULT_BASE_URL})
  --otel-endpoint <url>      OTLP endpoint for opencode tracing (e.g.
                               http://localhost:4317). When set, the runner
                               installs the @devtheops/opencode-plugin-otel
                               plugin into the per-test opencode.json.
                               (default: $OTEL_EXPORTER_OTLP_ENDPOINT, if set)
  --otel-protocol <proto>    OTLP protocol: grpc or http/protobuf
                               (default: $OTEL_EXPORTER_OTLP_PROTOCOL or ${DEFAULT_OTEL_PROTOCOL})
  --otel-service-name <name> service.name attribute on emitted spans
                               (default: $OTEL_SERVICE_NAME or ${DEFAULT_OTEL_SERVICE_NAME})
  --help, -h                 Show this help

Environment:
  OPENAI_API_KEY             API key for OpenAI-compatible gateway (required
                             unless --dry-run)
  OPENAI_BASE_URL            Overrides --base-url default
  METRICS_URL                Overrides --metrics-url default
  OTEL_EXPORTER_OTLP_ENDPOINT
                             Overrides --otel-endpoint default
  OTEL_EXPORTER_OTLP_PROTOCOL
                             Overrides --otel-protocol default
  OTEL_SERVICE_NAME          Overrides --otel-service-name default

Examples:
  agent-catalog-eval                                # cases under cwd
  agent-catalog-eval tests/e2e                      # cases under ./tests/e2e
  agent-catalog-eval ./skills --filter ioc          # filter by name
  agent-catalog-eval ./skills --category office     # only "office" cases
  agent-catalog-eval ./skills --list-categories     # show categories and exit
  agent-catalog-eval ./skills \\
    --collect \\
    --metrics-url https://my-metrics/api/v1/evals \\
    --header x-team=backend
`;

export interface ParseResult {
  kind: "config";
  config: RunnerConfig;
}

export interface HelpResult {
  kind: "help";
  text: string;
}

export interface ErrorResult {
  kind: "error";
  message: string;
}

/**
 * Returned for `--list-categories`. The CLI entry point handles this by
 * discovering tests under `casesDir` and printing the categories found.
 */
export interface ListCategoriesResult {
  kind: "list-categories";
  casesDir: string;
  repoRoot: string;
}

export type CliParseResult = ParseResult | HelpResult | ErrorResult | ListCategoriesResult;

export interface ParseEnv {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Pure parser for CLI args. Takes argv (without `node` and script path) and
 * an env, returns a discriminated result so callers (the real cli.ts and
 * tests) can drive exit codes / output without us calling process.exit() here.
 */
export function parseCliArgs(argv: string[], envCtx: ParseEnv): CliParseResult {
  let raw: Record<string, unknown>;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: OPTIONS,
    });
    raw = parsed.values as Record<string, unknown>;
    positionals = parsed.positionals;
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }

  const v = {
    help: raw.help as boolean,
    dryRun: raw["dry-run"] as boolean,
    filter: raw.filter as string | undefined,
    category: raw.category as string | undefined,
    notCategory: raw["not-category"] as string | undefined,
    listCategories: raw["list-categories"] as boolean,
    agent: raw.agent as string,
    workerModel: raw["worker-model"] as string,
    judgeModel: raw["judge-model"] as string,
    timeout: raw.timeout as string,
    collect: raw.collect as boolean,
    metricsUrl: raw["metrics-url"] as string | undefined,
    header: (raw.header as string[] | undefined) ?? [],
    project: raw.project as string | undefined,
    repoRoot: raw["repo-root"] as string | undefined,
    outputDir: raw["output-dir"] as string | undefined,
    baseUrl: raw["base-url"] as string | undefined,
    otelEndpoint: raw["otel-endpoint"] as string | undefined,
    otelProtocol: raw["otel-protocol"] as string | undefined,
    otelServiceName: raw["otel-service-name"] as string | undefined,
  };

  if (v.help) return { kind: "help", text: HELP_TEXT };

  if (positionals.length > 1) {
    return {
      kind: "error",
      message: `Unexpected positional arguments: ${positionals.slice(1).join(", ")}`,
    };
  }

  if (v.listCategories) {
    const casesDir = resolve(envCtx.cwd, positionals[0] ?? envCtx.cwd);
    const repoRoot = v.repoRoot ? resolve(envCtx.cwd, v.repoRoot) : findRepoRoot(casesDir);
    return { kind: "list-categories", casesDir, repoRoot };
  }

  if (!VALID_AGENTS.has(v.agent as AgentType)) {
    return {
      kind: "error",
      message: `Invalid --agent "${v.agent}". Must be one of: cursor, opencode, claude-code`,
    };
  }
  const agent = v.agent as AgentType;

  const apiKey = envCtx.env.OPENAI_API_KEY;
  if (!apiKey && !v.dryRun) {
    return {
      kind: "error",
      message: "OPENAI_API_KEY is required. Set it or pass --dry-run.",
    };
  }

  const timeoutSec = parseInt(v.timeout, 10);
  if (isNaN(timeoutSec) || timeoutSec <= 0) {
    return {
      kind: "error",
      message: `Invalid --timeout "${v.timeout}". Must be a positive integer (seconds).`,
    };
  }

  let headers: Record<string, string>;
  try {
    headers = parseHeaders(v.header);
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }

  const casesDir = resolve(envCtx.cwd, positionals[0] ?? envCtx.cwd);
  const repoRoot = v.repoRoot ? resolve(envCtx.cwd, v.repoRoot) : findRepoRoot(casesDir);
  const outputDir = v.outputDir ? resolve(envCtx.cwd, v.outputDir) : resolve(casesDir, "output");

  const detected = detectCiContext(envCtx.env);
  const ciContext: CiContext = {
    ...detected,
    project: v.project ?? detected.project,
  };

  const otelEndpoint = v.otelEndpoint ?? envCtx.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const otelProtocolRaw =
    v.otelProtocol ?? envCtx.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? DEFAULT_OTEL_PROTOCOL;

  let otel: OtelConfig | undefined;
  if (otelEndpoint) {
    if (!VALID_OTEL_PROTOCOLS.has(otelProtocolRaw as OtelConfig["protocol"])) {
      return {
        kind: "error",
        message: `Invalid --otel-protocol "${otelProtocolRaw}". Must be one of: grpc, http/protobuf`,
      };
    }
    otel = {
      endpoint: otelEndpoint,
      protocol: otelProtocolRaw as OtelConfig["protocol"],
      serviceName: v.otelServiceName ?? envCtx.env.OTEL_SERVICE_NAME ?? DEFAULT_OTEL_SERVICE_NAME,
    };
  }

  const config: RunnerConfig = {
    casesDir,
    repoRoot,
    outputDir,
    agent,
    workerModel: v.workerModel,
    judgeModel: v.judgeModel,
    apiKey: apiKey ?? "",
    baseUrl: envCtx.env.OPENAI_BASE_URL ?? v.baseUrl ?? DEFAULT_BASE_URL,
    dryRun: v.dryRun,
    filter: v.filter,
    category: v.category,
    notCategory: v.notCategory,
    timeoutMs: timeoutSec * 1000,
    collectMetrics: v.collect,
    metricsUrl: v.metricsUrl ?? envCtx.env.METRICS_URL ?? DEFAULT_METRICS_URL,
    headers,
    ciContext,
    otel,
  };

  return { kind: "config", config };
}

function parseHeaders(raw: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of raw) {
    const eq = entry.indexOf("=");
    if (eq <= 0 || eq === entry.length - 1) {
      throw new Error(`Invalid --header "${entry}". Expected KEY=VALUE.`);
    }
    const key = entry.slice(0, eq).trim();
    const value = entry.slice(eq + 1);
    if (!key) {
      throw new Error(`Invalid --header "${entry}". Expected KEY=VALUE.`);
    }
    out[key] = value;
  }
  return out;
}

const OPTIONS = {
  "dry-run": { type: "boolean", default: false },
  filter: { type: "string" },
  category: { type: "string" },
  "not-category": { type: "string" },
  "list-categories": { type: "boolean", default: false },
  agent: { type: "string", default: DEFAULT_AGENT },
  "worker-model": { type: "string", default: DEFAULT_WORKER_MODEL },
  "judge-model": { type: "string", default: DEFAULT_JUDGE_MODEL },
  timeout: { type: "string", default: String(DEFAULT_TIMEOUT_SEC) },
  collect: { type: "boolean", default: false },
  "metrics-url": { type: "string" },
  header: { type: "string", multiple: true },
  project: { type: "string" },
  "repo-root": { type: "string" },
  "output-dir": { type: "string" },
  "base-url": { type: "string" },
  "otel-endpoint": { type: "string" },
  "otel-protocol": { type: "string" },
  "otel-service-name": { type: "string" },
  help: { type: "boolean", short: "h", default: false },
} as const;
