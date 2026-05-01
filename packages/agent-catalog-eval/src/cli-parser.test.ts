import { describe, expect, it } from "vitest";
import { parseCliArgs, DEFAULT_AGENT } from "./cli-parser.js";
import { DEFAULT_METRICS_URL } from "./telemetry.js";

describe("parseCliArgs", () => {
  const env = (extra: NodeJS.ProcessEnv = {}) => ({
    cwd: "/work",
    env: { OPENAI_API_KEY: "key", ...extra },
  });

  it("returns help text when --help is passed", () => {
    const result = parseCliArgs(["--help"], env());
    expect(result.kind).toBe("help");
    if (result.kind === "help") {
      expect(result.text).toContain("agent-catalog-eval");
      expect(result.text).toContain("[cases-dir]");
      expect(result.text).toContain("opencode");
    }
  });

  it("defaults --agent to opencode", () => {
    const result = parseCliArgs([], env());
    expect(result.kind).toBe("config");
    if (result.kind === "config") {
      expect(result.config.agent).toBe(DEFAULT_AGENT);
      expect(DEFAULT_AGENT).toBe("opencode");
    }
  });

  it("rejects an invalid --agent", () => {
    const result = parseCliArgs(["--agent", "vim"], env());
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain('Invalid --agent "vim"');
    }
  });

  it("requires OPENAI_API_KEY unless --dry-run", () => {
    const missing = parseCliArgs([], { cwd: "/work", env: {} });
    expect(missing.kind).toBe("error");
    if (missing.kind === "error") {
      expect(missing.message).toContain("OPENAI_API_KEY");
    }

    const dryRun = parseCliArgs(["--dry-run"], { cwd: "/work", env: {} });
    expect(dryRun.kind).toBe("config");
    if (dryRun.kind === "config") {
      expect(dryRun.config.dryRun).toBe(true);
      expect(dryRun.config.apiKey).toBe("");
    }
  });

  it("rejects a non-numeric --timeout", () => {
    const result = parseCliArgs(["--timeout", "abc"], env());
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("Invalid --timeout");
    }
  });

  it("rejects a zero or negative --timeout", () => {
    const zero = parseCliArgs(["--timeout", "0"], env());
    expect(zero.kind).toBe("error");

    const negative = parseCliArgs(["--timeout", "-1"], env());
    expect(negative.kind).toBe("error");
  });

  it("uses cwd as cases-dir when no positional is given", () => {
    const result = parseCliArgs([], env());
    expect(result.kind).toBe("config");
    if (result.kind === "config") {
      expect(result.config.casesDir).toBe("/work");
      expect(result.config.outputDir).toBe("/work/output");
    }
  });

  it("resolves a positional cases-dir relative to cwd", () => {
    const result = parseCliArgs(["tests/e2e"], env());
    expect(result.kind).toBe("config");
    if (result.kind === "config") {
      expect(result.config.casesDir).toBe("/work/tests/e2e");
      expect(result.config.outputDir).toBe("/work/tests/e2e/output");
    }
  });

  it("rejects multiple positional arguments", () => {
    const result = parseCliArgs(["one", "two"], env());
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("Unexpected positional");
    }
  });

  it("parses repeatable --header KEY=VALUE into a map", () => {
    const result = parseCliArgs(
      ["--header", "x-team=backend", "--header", "x-env=ci"],
      env(),
    );
    expect(result.kind).toBe("config");
    if (result.kind === "config") {
      expect(result.config.headers).toEqual({
        "x-team": "backend",
        "x-env": "ci",
      });
    }
  });

  it("preserves '=' inside the header value", () => {
    const result = parseCliArgs(["--header", "x-token=abc=def=ghi"], env());
    expect(result.kind).toBe("config");
    if (result.kind === "config") {
      expect(result.config.headers["x-token"]).toBe("abc=def=ghi");
    }
  });

  it("rejects malformed --header values", () => {
    for (const bad of ["no-equals", "=no-key", "key="]) {
      const result = parseCliArgs(["--header", bad], env());
      expect(result.kind).toBe("error");
      if (result.kind === "error") {
        expect(result.message).toContain("Invalid --header");
      }
    }
  });

  it("does not inject any default headers", () => {
    const result = parseCliArgs([], env());
    expect(result.kind).toBe("config");
    if (result.kind === "config") {
      expect(result.config.headers).toEqual({});
    }
  });

  it("--metrics-url overrides the env and the default", () => {
    const result = parseCliArgs(
      ["--metrics-url", "https://custom/api"],
      env({ METRICS_URL: "https://from-env" }),
    );
    expect(result.kind).toBe("config");
    if (result.kind === "config") {
      expect(result.config.metricsUrl).toBe("https://custom/api");
    }
  });

  it("METRICS_URL env is used when --metrics-url is absent", () => {
    const result = parseCliArgs([], env({ METRICS_URL: "https://from-env" }));
    expect(result.kind).toBe("config");
    if (result.kind === "config") {
      expect(result.config.metricsUrl).toBe("https://from-env");
    }
  });

  it("falls back to the default metrics URL when neither flag nor env is set", () => {
    const result = parseCliArgs([], env());
    expect(result.kind).toBe("config");
    if (result.kind === "config") {
      expect(result.config.metricsUrl).toBe(DEFAULT_METRICS_URL);
    }
  });

  it("--project overrides auto-detection", () => {
    const result = parseCliArgs(
      ["--project", "explicit/name"],
      env({ CI_PROJECT_PATH: "auto/name" }),
    );
    expect(result.kind).toBe("config");
    if (result.kind === "config") {
      expect(result.config.ciContext.project).toBe("explicit/name");
    }
  });

  it("auto-detects project from CI env when --project is absent", () => {
    const result = parseCliArgs([], env({ CI_PROJECT_PATH: "auto/name" }));
    expect(result.kind).toBe("config");
    if (result.kind === "config") {
      expect(result.config.ciContext.project).toBe("auto/name");
    }
  });

  it("--repo-root and --output-dir are resolved against cwd", () => {
    const result = parseCliArgs(
      ["./cases", "--repo-root", "../monorepo", "--output-dir", "/tmp/out"],
      env(),
    );
    expect(result.kind).toBe("config");
    if (result.kind === "config") {
      expect(result.config.repoRoot).toBe("/monorepo");
      expect(result.config.outputDir).toBe("/tmp/out");
    }
  });

  it("converts --timeout seconds into milliseconds on the config", () => {
    const result = parseCliArgs(["--timeout", "30"], env());
    expect(result.kind).toBe("config");
    if (result.kind === "config") {
      expect(result.config.timeoutMs).toBe(30_000);
    }
  });

  it("--filter is forwarded to the runner config", () => {
    const result = parseCliArgs(["--filter", "ioc"], env());
    expect(result.kind).toBe("config");
    if (result.kind === "config") {
      expect(result.config.filter).toBe("ioc");
    }
  });
});
