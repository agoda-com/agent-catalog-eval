import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildOtelEnv,
  OTEL_PLUGIN_NAME,
  placeSkill,
  runAgent,
  skillsDirForAgent,
} from "./agent.js";
import type { OtelRunContext } from "./agent.js";
import type { AgentType } from "./types.js";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ace-agent-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("buildOtelEnv", () => {
  const baseOtel: OtelRunContext = {
    config: {
      endpoint: "http://collector:4317",
      protocol: "grpc",
      serviceName: "agoda-agent-catalog-eval",
    },
  };

  it("sets the opencode + standard OTEL env vars from the config", () => {
    const env = buildOtelEnv(baseOtel);
    expect(env).toMatchObject({
      OPENCODE_ENABLE_TELEMETRY: "1",
      OPENCODE_OTLP_ENDPOINT: "http://collector:4317",
      OPENCODE_OTLP_PROTOCOL: "grpc",
      OTEL_SERVICE_NAME: "agoda-agent-catalog-eval",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4317",
      OTEL_EXPORTER_OTLP_PROTOCOL: "grpc",
    });
  });

  it("propagates http/protobuf protocol to both OPENCODE_ and OTEL_ vars", () => {
    const env = buildOtelEnv({
      ...baseOtel,
      config: { ...baseOtel.config, protocol: "http/protobuf" },
    });
    expect(env.OPENCODE_OTLP_PROTOCOL).toBe("http/protobuf");
    expect(env.OTEL_EXPORTER_OTLP_PROTOCOL).toBe("http/protobuf");
  });

  it("packs resourceAttributes into OTEL_RESOURCE_ATTRIBUTES (key=value,key=value)", () => {
    const env = buildOtelEnv({
      ...baseOtel,
      resourceAttributes: {
        "agoda.eval.test_name": "ioc/refactor",
        "agoda.ci.project": "team/skills",
      },
    });
    expect(env.OTEL_RESOURCE_ATTRIBUTES).toBe(
      "agoda.eval.test_name=ioc/refactor,agoda.ci.project=team/skills",
    );
  });

  it("omits OTEL_RESOURCE_ATTRIBUTES when no attributes are given", () => {
    const env = buildOtelEnv(baseOtel);
    expect(env.OTEL_RESOURCE_ATTRIBUTES).toBeUndefined();
  });

  it("preserves an existing OTEL_RESOURCE_ATTRIBUTES value by prepending it", () => {
    const env = buildOtelEnv(
      {
        ...baseOtel,
        resourceAttributes: { "agoda.eval.test_name": "ioc/refactor" },
      },
      "deployment.environment=ci,k8s.namespace=skills",
    );
    expect(env.OTEL_RESOURCE_ATTRIBUTES).toBe(
      "deployment.environment=ci,k8s.namespace=skills,agoda.eval.test_name=ioc/refactor",
    );
  });

  it("uses only the existing value when no new attributes are given", () => {
    const env = buildOtelEnv(baseOtel, "deployment.environment=ci");
    expect(env.OTEL_RESOURCE_ATTRIBUTES).toBe("deployment.environment=ci");
  });

  it("ignores empty/whitespace existing values", () => {
    const env = buildOtelEnv(
      {
        ...baseOtel,
        resourceAttributes: { foo: "bar" },
      },
      "   ",
    );
    expect(env.OTEL_RESOURCE_ATTRIBUTES).toBe("foo=bar");
  });
});

describe("skillsDirForAgent", () => {
  it.each([
    ["cursor", join(".cursor", "skills")],
    ["opencode", join(".opencode", "skills")],
    ["claude-code", join(".claude", "skills")],
  ] as const)("returns the conventional skills dir for %s", (agent, expected) => {
    expect(skillsDirForAgent(agent as AgentType)).toBe(expected);
  });
});

describe("placeSkill", () => {
  async function exists(p: string): Promise<boolean> {
    try {
      await stat(p);
      return true;
    } catch {
      return false;
    }
  }

  it.each([
    ["cursor", join(".cursor", "skills")],
    ["opencode", join(".opencode", "skills")],
    ["claude-code", join(".claude", "skills")],
  ] as const)(
    "writes SKILL.md into %s's own discovery dir and nowhere else",
    async (agent, dir) => {
      await placeSkill(tmp, agent as AgentType, "primary-skill", "# primary skill");
      await placeSkill(tmp, agent as AgentType, "extra-skill", "# extra");

      expect(await exists(join(tmp, dir, "primary-skill", "SKILL.md"))).toBe(true);
      expect(await exists(join(tmp, dir, "extra-skill", "SKILL.md"))).toBe(true);

      for (const other of [".cursor/skills", ".opencode/skills", ".claude/skills"]) {
        if (other === dir) continue;
        expect(await exists(join(tmp, other, "primary-skill", "SKILL.md"))).toBe(false);
      }

      const content = await readFile(join(tmp, dir, "primary-skill", "SKILL.md"), "utf-8");
      expect(content).toBe("# primary skill");
    },
  );
});

describe("runAgent → opencode.json", () => {
  async function readOpencodeJson(workDir: string) {
    const raw = await readFile(join(workDir, "opencode.json"), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  }

  /**
   * Drive runAgent far enough that it writes opencode.json and tries to spawn
   * `opencode`. We don't need opencode to be installed: spawning a missing
   * binary rejects with ENOENT, and by then the config file is already on disk.
   */
  async function writeConfigViaRunAgent(opts: {
    otel?: OtelRunContext;
  }): Promise<Record<string, unknown>> {
    await runAgent({
      workDir: tmp,
      prompt: "noop",
      skillContent: "# skill",
      skillName: "noop-skill",
      agent: "opencode",
      model: "claude-opus-4-7",
      apiKey: "key",
      baseUrl: "https://api.example/v1",
      timeoutMs: 1000,
      headers: {},
      otel: opts.otel,
    }).catch(() => {
      // expected: `opencode` binary not present in the test environment
    });
    return readOpencodeJson(tmp);
  }

  it("does NOT add a plugin when otel is not configured", async () => {
    const config = await writeConfigViaRunAgent({});
    expect(config.plugin).toBeUndefined();
    expect(config.model).toBe("gateway/claude-opus-4-7");
  });

  it("adds the @devtheops opencode-plugin-otel plugin when otel is configured", async () => {
    const config = await writeConfigViaRunAgent({
      otel: {
        config: {
          endpoint: "http://collector:4317",
          protocol: "grpc",
          serviceName: "agoda-agent-catalog-eval",
        },
      },
    });
    expect(config.plugin).toEqual([OTEL_PLUGIN_NAME]);
  });
});
