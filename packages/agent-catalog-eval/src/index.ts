export type {
  AgentResult,
  AgentType,
  CiContext,
  EvalConfig,
  FileSnapshot,
  JudgeVerdict,
  OtelConfig,
  RunnerConfig,
  TelemetryPayload,
  TelemetryTestResult,
  TestCase,
  TestResult,
} from "./types.js";

export { collectFiles, copyDir, createWorkDir, formatFiles, removeDir } from "./files.js";

export { detectCiContext } from "./ci.js";
export { findRepoRoot } from "./repo-root.js";
export {
  runAgent,
  buildOtelEnv,
  buildTraceContextEnv,
  OTEL_PLUGIN_NAME,
  type AgentRunConfig,
  type OtelRunContext,
} from "./agent.js";
export {
  initTracing,
  injectTraceContext,
  withSpan,
  getTracer,
  TRACER_NAME,
  type TracingHandle,
} from "./tracing.js";
export { evaluate, diagnoseFailures, type JudgeConfig, type DiagnoseConfig } from "./judge.js";
export {
  checkSkillUsage,
  discoverTests,
  getCategories,
  printResult,
  printSummary,
  runAll,
} from "./runner.js";
export { buildPayload, reportMetrics, DEFAULT_METRICS_URL } from "./telemetry.js";
export {
  parseCliArgs,
  HELP_TEXT,
  VALID_AGENTS,
  DEFAULT_AGENT,
  DEFAULT_WORKER_MODEL,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_SEC,
  DEFAULT_OTEL_PROTOCOL,
  DEFAULT_OTEL_SERVICE_NAME,
  type CliParseResult,
  type ListCategoriesResult,
  type ParseEnv,
} from "./cli-parser.js";
