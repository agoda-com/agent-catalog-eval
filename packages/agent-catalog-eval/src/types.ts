export interface EvalConfig {
  skill_path: string;
  threshold: number;
  judge_rubric: string;
  /** Optional grouping label. Used by --category / --not-category filters. */
  category?: string;
  /**
   * Optional extra SKILL.md paths to install alongside `skill_path`.
   * Each path is resolved against the runner's `repoRoot`.
   */
  additional_skills?: string[];
}

export interface TestCase {
  name: string;
  dir: string;
  skillPath: string;
  /** Resolved absolute paths from `additional_skills` in eval.yaml. */
  additionalSkillPaths: string[];
  threshold: number;
  judgeRubric: string;
  prompt: string;
  beforeDir: string;
  afterDir: string;
  category?: string;
}

export interface FileSnapshot {
  path: string;
  content: string;
}

export interface JudgeVerdict {
  score: number;
  reasoning: string;
}

export interface TestResult {
  name: string;
  passed: boolean;
  score: number;
  threshold: number;
  reasoning: string;
  durationMs: number;
  error?: string;
  category?: string;
}

export interface AgentResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export type AgentType = "cursor" | "opencode" | "claude-code";

export interface CiContext {
  project: string;
  pipeline_id: string;
  commit_sha: string;
  branch: string;
}

/**
 * OpenTelemetry tracing config for the opencode agent.
 * When `endpoint` is set, the runner installs the
 * `@devtheops/opencode-plugin-otel` plugin into the per-test opencode.json
 * and sets the matching OPENCODE_* env vars on the spawned process.
 *
 * Other agents (cursor, claude-code) ignore this config — they have their
 * own telemetry stories.
 */
export interface OtelConfig {
  /** OTLP endpoint URL (e.g. http://localhost:4317). */
  endpoint: string;
  /** OTLP protocol. Plugin supports "grpc" and "http/protobuf". */
  protocol: "grpc" | "http/protobuf";
  /** Service name reported on spans. Defaults to "agoda-agent-catalog-eval". */
  serviceName: string;
}

export interface RunnerConfig {
  casesDir: string;
  repoRoot: string;
  outputDir: string;
  agent: AgentType;
  workerModel: string;
  judgeModel: string;
  apiKey: string;
  baseUrl: string;
  dryRun: boolean;
  filter?: string;
  /** Only run tests whose `category` matches this value. */
  category?: string;
  /** Comma-separated category names to exclude. */
  notCategory?: string;
  timeoutMs: number;
  collectMetrics: boolean;
  metricsUrl: string;
  headers: Record<string, string>;
  ciContext: CiContext;
  /** When set, opencode runs export OpenTelemetry traces to this endpoint. */
  otel?: OtelConfig;
}

export interface TelemetryTestResult {
  test_name: string;
  passed: boolean;
  score: number;
  threshold: number;
  duration_ms: number;
  reasoning: string;
  error: string | null;
}

export interface TelemetryPayload {
  project: string;
  pipeline_id: string;
  commit_sha: string;
  branch: string;
  triggered_at: string;
  agent: string;
  worker_model: string;
  judge_model: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    pass_rate: number;
    avg_score: number;
    total_duration_ms: number;
  };
  results: TelemetryTestResult[];
}
