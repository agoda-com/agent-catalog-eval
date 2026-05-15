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

  describe("route subcommand", () => {
    it("returns a route result with --filter and --dry-run threaded through", () => {
      const r = parseCliArgs(["route", "./cases", "./obs.jsonl", "--filter", "ioc", "--dry-run"], ctx);
      expect(r.kind).toBe("route");
      if (r.kind === "route") {
        expect(r.casesDir.endsWith("cases")).toBe(true);
        expect(r.observedJsonl.endsWith("obs.jsonl")).toBe(true);
        expect(r.filter).toBe("ioc");
        expect(r.dryRun).toBe(true);
      }
    });

    it("errors when route is missing the observed jsonl positional", () => {
      const r = parseCliArgs(["route", "./cases"], ctx);
      expect(r.kind).toBe("error");
    });

    it("does not require OPENAI_API_KEY for route mode", () => {
      const noKey = { cwd: process.cwd(), env: { ...process.env, OPENAI_API_KEY: "" } };
      const r = parseCliArgs(["route", "./cases", "./obs.jsonl"], noKey);
      expect(r.kind).toBe("route");
    });
  });
});
