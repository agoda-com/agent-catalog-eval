import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildOtelEnv,
  OTEL_PLUGIN_NAME,
  placeSkill,
  runAgent,
  skillsDirForAgent,
} from "./agent.js";
import type { OtelRunContext } from "./agent.js";
import type { AgentType } from "./types.js";

vi.mock("node:child_process", () => ({
  spawn: () => {
    const proc = new EventEmitter();
    queueMicrotask(() => proc.emit("close", 0));
    return proc;
  },
}));

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ace-agent-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
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

  it.each(["cursor", "opencode", "claude-code"] as const)(
    "copies the skill folder into %s and skips unwanted entries",
    async (agent) => {
      const source = join(tmp, "source");
      await mkdir(join(source, "references", "nested"), { recursive: true });
      await mkdir(join(source, "references", "node_modules"));
      await mkdir(join(source, ".hidden-dir"));
      await writeFile(join(source, "SKILL.md"), "# disk version");
      await writeFile(join(source, "references", "nested", "details.md"), "details");
      await writeFile(join(source, "references", ".hidden"), "hidden");
      await writeFile(join(source, ".hidden-dir", "hidden.md"), "hidden");
      await writeFile(join(source, "references", "node_modules", "dependency.js"), "dependency");
      await symlink("nested/details.md", join(source, "references", "linked.md"));
      await symlink("references", join(source, "linked-dir"), "dir");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await placeSkill(tmp, agent, "example", "# supplied version", source);

      const installed = join(tmp, skillsDirForAgent(agent), "example");
      expect((await readdir(installed)).sort()).toEqual(["SKILL.md", "references"]);
      expect(await readdir(join(installed, "references"))).toEqual(["nested"]);
      expect(await readFile(join(installed, "references", "nested", "details.md"), "utf-8")).toBe(
        "details",
      );
      expect(await readFile(join(installed, "SKILL.md"), "utf-8")).toBe("# supplied version");
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/symlink.*references.*linked\.md/i));
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/symlink.*linked-dir/i));
    },
  );

  it.each([".cursor", ".cursor/skills/example/references", ".cursor/skills/example/SKILL.md"])(
    "rejects a pre-existing destination symlink at %s",
    async (path) => {
      const source = join(tmp, "source");
      const work = join(tmp, "work");
      const outside = join(tmp, "outside");
      const destination = join(work, path);
      await mkdir(join(source, "references"), { recursive: true });
      await mkdir(dirname(destination), { recursive: true });
      await mkdir(outside);
      await writeFile(join(source, "references", "details.md"), "details");
      await writeFile(join(outside, "unrelated.md"), "unrelated");
      if (path.endsWith("SKILL.md")) {
        await symlink(join(outside, "unrelated.md"), destination);
      } else {
        await symlink(outside, destination, "dir");
      }

      await expect(placeSkill(work, "cursor", "example", "skill", source)).rejects.toThrow(
        "symlink",
      );
      expect(await readdir(outside)).toEqual(["unrelated.md"]);
      expect(await readFile(join(outside, "unrelated.md"), "utf-8")).toBe("unrelated");
    },
  );

  it.each(["cursor", "opencode", "claude-code"] as const)(
    "warns about a skill folder over 1 MB for %s and still copies it",
    async (agent) => {
      const source = join(tmp, "source");
      await mkdir(source);
      await writeFile(join(source, "large.bin"), Buffer.alloc(1024 * 1024 + 1));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await placeSkill(tmp, agent, "large", "", source);

      const installed = join(tmp, skillsDirForAgent(agent), "large");
      expect((await stat(join(installed, "large.bin"))).size).toBe(1048577);
      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/1048577 bytes/));
    },
  );
});

describe("runAgent skill installation", () => {
  it.each(["cursor", "opencode", "claude-code"] as const)(
    "installs and logs the primary and additional skill folders for %s",
    async (agent) => {
      const primary = join(tmp, "primary-source");
      const extra = join(tmp, "extra-source");
      await mkdir(join(primary, "references"), { recursive: true });
      await mkdir(extra);
      await writeFile(join(primary, "references", "primary.md"), "primary reference");
      await writeFile(join(extra, "extra.md"), "extra reference");
      await writeFile(join(extra, "line\nbreak.md"), "line break");
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      const result = await runAgent({
        workDir: tmp,
        prompt: "noop",
        skillContent: "# primary",
        skillName: "primary",
        skillDir: primary,
        additionalSkills: [
          { name: "extra", content: "# extra", dir: extra },
          { name: "markdown-only", content: "# markdown only" },
        ],
        agent,
        model: "model",
        apiKey: "key",
        baseUrl: "https://api.example/v1",
        timeoutMs: 1000,
        headers: {},
      });

      expect(result.exitCode).toBe(0);
      const installed = join(tmp, skillsDirForAgent(agent));
      expect(await readFile(join(installed, "primary", "references", "primary.md"), "utf-8")).toBe(
        "primary reference",
      );
      expect(await readFile(join(installed, "extra", "extra.md"), "utf-8")).toBe("extra reference");
      expect(await readdir(join(installed, "markdown-only"))).toEqual(["SKILL.md"]);
      expect(log).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(
          /Installed skill files: primary \(SKILL.md, references\/primary.md\); extra \(SKILL.md, extra.md, line\\nbreak.md\); markdown-only \(SKILL.md\)/,
        ),
      );
    },
  );
});

describe("runAgent → opencode.json", () => {
  async function readOpencodeJson(workDir: string) {
    const raw = await readFile(join(workDir, "opencode.json"), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  }

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
