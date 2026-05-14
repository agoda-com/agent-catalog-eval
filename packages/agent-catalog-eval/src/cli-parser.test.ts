import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./cli-parser.js";

describe("parseCliArgs", () => {
  const ctx = { cwd: process.cwd(), env: process.env };

  it("parses default eval mode", () => {
    const r = parseCliArgs([], ctx);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.options.mode).toBe("eval");
    }
  });

  it("parses route mode", () => {
    const r = parseCliArgs(["route", "./cases", "./observed.jsonl"], ctx);
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.options.mode).toBe("route");
      if (r.options.mode === "route") {
        expect(r.options.casesDir).toBe("./cases");
        expect(r.options.observedJsonl).toBe("./observed.jsonl");
      }
    }
  });

  it("errors on invalid route args", () => {
    const r = parseCliArgs(["route", "./cases"], ctx);
    expect(r.kind).toBe("error");
  });
});
