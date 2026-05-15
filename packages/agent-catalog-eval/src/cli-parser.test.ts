import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./cli-parser.js";

describe("parseCliArgs", () => {
  const ctx = { cwd: process.cwd(), env: { ...process.env, OPENAI_API_KEY: "x" } };

  it("returns config on default args", () => {
    const r = parseCliArgs([], ctx);
    expect(r.kind).toBe("config");
  });

  it("returns help for --help", () => {
    const r = parseCliArgs(["--help"], ctx);
    expect(r.kind).toBe("help");
  });

  it("returns error on unknown arg", () => {
    const r = parseCliArgs(["--does-not-exist"], ctx);
    expect(r.kind).toBe("error");
  });

  describe("route subcommand — score-only", () => {
    it("returns a route-score result with --filter and --dry-run threaded through", () => {
      const r = parseCliArgs(
        ["route", "./cases", "./obs.jsonl", "--filter", "ioc", "--dry-run"],
        ctx,
      );
      expect(r.kind).toBe("route-score");
      if (r.kind === "route-score") {
        expect(r.casesDir.endsWith("cases")).toBe(true);
        expect(r.observedJsonl.endsWith("obs.jsonl")).toBe(true);
        expect(r.filter).toBe("ioc");
        expect(r.dryRun).toBe(true);
      }
    });

    it("errors when neither --upstream-mcp nor an observed positional is given", () => {
      const r = parseCliArgs(["route", "./cases"], ctx);
      expect(r.kind).toBe("error");
    });

    it("does not require OPENAI_API_KEY in score-only mode", () => {
      const noKey = { cwd: process.cwd(), env: { ...process.env, OPENAI_API_KEY: "" } };
      const r = parseCliArgs(["route", "./cases", "./obs.jsonl"], noKey);
      expect(r.kind).toBe("route-score");
    });
  });

  describe("route subcommand — e2e (--upstream-mcp)", () => {
    it("returns a route-run result with the upstream URL and resolved output dir", () => {
      const r = parseCliArgs(
        [
          "route",
          "./cases",
          "--upstream-mcp",
          "https://skills.example/mcp",
          "--output-dir",
          "./out",
        ],
        ctx,
      );
      expect(r.kind).toBe("route-run");
      if (r.kind === "route-run") {
        expect(r.upstreamMcp).toBe("https://skills.example/mcp");
        expect(r.outputDir.endsWith("out")).toBe(true);
        expect(r.timeoutMs).toBeGreaterThan(0);
      }
    });

    it("rejects passing both --upstream-mcp and a second positional", () => {
      const r = parseCliArgs(
        ["route", "./cases", "./obs.jsonl", "--upstream-mcp", "https://x/mcp"],
        ctx,
      );
      expect(r.kind).toBe("error");
    });

    it("requires OPENAI_API_KEY when not --dry-run", () => {
      const noKey = { cwd: process.cwd(), env: { ...process.env, OPENAI_API_KEY: "" } };
      const r = parseCliArgs(["route", "./cases", "--upstream-mcp", "https://x/mcp"], noKey);
      expect(r.kind).toBe("error");
    });

    it("allows --dry-run without OPENAI_API_KEY", () => {
      const noKey = { cwd: process.cwd(), env: { ...process.env, OPENAI_API_KEY: "" } };
      const r = parseCliArgs(
        ["route", "./cases", "--upstream-mcp", "https://x/mcp", "--dry-run"],
        noKey,
      );
      expect(r.kind).toBe("route-run");
    });
  });
});
