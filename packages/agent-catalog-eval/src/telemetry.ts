import type { RunnerConfig, TelemetryPayload, TestResult } from "./types.js";

export const DEFAULT_METRICS_URL = "http://compilation-metrics/api/v1/skill-evaluations";

/**
 * Telemetry endpoint spec.
 *
 * POST <metrics-url>
 * Content-Type: application/json
 *
 * The CLI posts a TelemetryPayload (see types.ts). The server is expected to
 * return any 2xx on success; non-2xx is logged but does not fail the run.
 *
 * Custom headers passed to the CLI via --header KEY=VALUE are forwarded on this
 * request, so consumers can identify themselves to their metrics service.
 */

export function buildPayload(
  results: TestResult[],
  config: RunnerConfig,
): TelemetryPayload {
  const passed = results.filter((r) => r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
  const avgScore =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.score, 0) / results.length
      : 0;

  return {
    project: config.ciContext.project,
    pipeline_id: config.ciContext.pipeline_id,
    commit_sha: config.ciContext.commit_sha,
    branch: config.ciContext.branch,
    triggered_at: new Date().toISOString(),
    agent: config.agent,
    worker_model: config.workerModel,
    judge_model: config.judgeModel,
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      pass_rate: results.length > 0 ? passed / results.length : 0,
      avg_score: Math.round(avgScore * 10) / 10,
      total_duration_ms: totalDuration,
    },
    results: results.map((r) => ({
      test_name: r.name,
      passed: r.passed,
      score: r.score,
      threshold: r.threshold,
      duration_ms: r.durationMs,
      reasoning: r.reasoning,
      error: r.error ?? null,
    })),
  };
}

export async function reportMetrics(
  results: TestResult[],
  config: RunnerConfig,
): Promise<void> {
  const payload = buildPayload(results, config);

  console.log(`Sending telemetry to ${config.metricsUrl}...`);

  const response = await fetch(config.metricsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...config.headers,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(
      `Warning: metrics endpoint returned ${response.status}: ${body}`,
    );
    return;
  }

  console.log("Telemetry sent successfully.");
}
