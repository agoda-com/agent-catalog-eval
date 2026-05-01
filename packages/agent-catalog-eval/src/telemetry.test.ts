import { describe, expect, it } from "vitest";
import { buildPayload } from "./telemetry.js";
import { detectCiContext } from "./ci.js";
import type { RunnerConfig, TestResult } from "./types.js";

const baseConfig = (overrides: Partial<RunnerConfig> = {}): RunnerConfig => ({
  casesDir: "/cases",
  repoRoot: "/repo",
  outputDir: "/cases/output",
  agent: "opencode",
  workerModel: "claude-opus-4-7",
  judgeModel: "gemini-3.1-flash",
  apiKey: "k",
  baseUrl: "https://gateway/v1",
  dryRun: false,
  timeoutMs: 60_000,
  collectMetrics: true,
  metricsUrl: "https://metrics/api",
  headers: {},
  ciContext: {
    project: "p",
    pipeline_id: "1",
    commit_sha: "sha",
    branch: "main",
  },
  ...overrides,
});

const result = (overrides: Partial<TestResult> = {}): TestResult => ({
  name: "case",
  passed: true,
  score: 80,
  threshold: 70,
  reasoning: "ok",
  durationMs: 1000,
  ...overrides,
});

describe("buildPayload", () => {
  it("computes summary stats and maps results 1-for-1", () => {
    const results: TestResult[] = [
      result({ name: "a", passed: true, score: 90, durationMs: 1000 }),
      result({ name: "b", passed: false, score: 50, durationMs: 2000, error: "boom" }),
      result({ name: "c", passed: true, score: 80, durationMs: 3000 }),
    ];

    const payload = buildPayload(results, baseConfig());

    expect(payload.summary).toEqual({
      total: 3,
      passed: 2,
      failed: 1,
      pass_rate: 2 / 3,
      avg_score: 73.3,
      total_duration_ms: 6000,
    });

    expect(payload.results).toEqual([
      {
        test_name: "a",
        passed: true,
        score: 90,
        threshold: 70,
        duration_ms: 1000,
        reasoning: "ok",
        error: null,
      },
      {
        test_name: "b",
        passed: false,
        score: 50,
        threshold: 70,
        duration_ms: 2000,
        reasoning: "ok",
        error: "boom",
      },
      {
        test_name: "c",
        passed: true,
        score: 80,
        threshold: 70,
        duration_ms: 3000,
        reasoning: "ok",
        error: null,
      },
    ]);
  });

  it("uses the provided CI context for project/pipeline/commit/branch", () => {
    const payload = buildPayload(
      [result()],
      baseConfig({
        ciContext: {
          project: "team/repo",
          pipeline_id: "42",
          commit_sha: "deadbeef",
          branch: "feature/x",
        },
      }),
    );

    expect(payload.project).toBe("team/repo");
    expect(payload.pipeline_id).toBe("42");
    expect(payload.commit_sha).toBe("deadbeef");
    expect(payload.branch).toBe("feature/x");
  });

  it("handles an empty results list without dividing by zero", () => {
    const payload = buildPayload([], baseConfig());
    expect(payload.summary).toEqual({
      total: 0,
      passed: 0,
      failed: 0,
      pass_rate: 0,
      avg_score: 0,
      total_duration_ms: 0,
    });
    expect(payload.results).toEqual([]);
  });

  it("includes agent / worker_model / judge_model so the server can group runs", () => {
    const payload = buildPayload([result()], baseConfig({ agent: "claude-code" }));
    expect(payload.agent).toBe("claude-code");
    expect(payload.worker_model).toBe("claude-opus-4-7");
    expect(payload.judge_model).toBe("gemini-3.1-flash");
  });
});

describe("detectCiContext", () => {
  it("reads GitLab env vars", () => {
    expect(
      detectCiContext({
        CI_PROJECT_PATH: "team/repo",
        CI_PIPELINE_ID: "1234",
        CI_COMMIT_SHA: "abc",
        CI_COMMIT_BRANCH: "main",
      }),
    ).toEqual({
      project: "team/repo",
      pipeline_id: "1234",
      commit_sha: "abc",
      branch: "main",
    });
  });

  it("reads GitHub Actions env vars", () => {
    expect(
      detectCiContext({
        GITHUB_REPOSITORY: "agoda-com/agent-catalog-eval",
        GITHUB_RUN_ID: "9876",
        GITHUB_SHA: "f00",
        GITHUB_REF_NAME: "feature/x",
      }),
    ).toEqual({
      project: "agoda-com/agent-catalog-eval",
      pipeline_id: "9876",
      commit_sha: "f00",
      branch: "feature/x",
    });
  });

  it("reads TeamCity env vars", () => {
    expect(
      detectCiContext({
        TEAMCITY_BUILDCONF_NAME: "Backend :: Build",
        BUILD_NUMBER: "42",
        BUILD_VCS_NUMBER: "cafe",
        TEAMCITY_BUILD_BRANCH: "trunk",
      }),
    ).toEqual({
      project: "Backend :: Build",
      pipeline_id: "42",
      commit_sha: "cafe",
      branch: "trunk",
    });
  });

  it("reads AppVeyor env vars", () => {
    expect(
      detectCiContext({
        APPVEYOR_PROJECT_SLUG: "user/app",
        APPVEYOR_BUILD_ID: "11",
        APPVEYOR_REPO_COMMIT: "beef",
        APPVEYOR_REPO_BRANCH: "develop",
      }),
    ).toEqual({
      project: "user/app",
      pipeline_id: "11",
      commit_sha: "beef",
      branch: "develop",
    });
  });

  it("falls back to sensible defaults when no CI vars are present", () => {
    expect(detectCiContext({})).toEqual({
      project: "unknown",
      pipeline_id: "local",
      commit_sha: "unknown",
      branch: "unknown",
    });
  });

  it("prefers GitLab over GitHub when both are set (deterministic priority)", () => {
    expect(
      detectCiContext({
        CI_PROJECT_PATH: "gitlab/team",
        GITHUB_REPOSITORY: "github/team",
      }).project,
    ).toBe("gitlab/team");
  });
});
