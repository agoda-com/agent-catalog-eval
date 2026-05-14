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
});
