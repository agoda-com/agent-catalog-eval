import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentResult, AgentType, OtelConfig } from "./types.js";
import { injectTraceContext } from "./tracing.js";

export const OTEL_PLUGIN_NAME = "@devtheops/opencode-plugin-otel";

export interface OtelRunContext {
  config: OtelConfig;
  /**
   * Extra resource attributes to set on emitted spans (test name, project,
   * pipeline id, etc.). Merged into OTEL_RESOURCE_ATTRIBUTES.
   */
  resourceAttributes?: Record<string, string>;
}

export interface AgentRunConfig {
  workDir: string;
  prompt: string;
  skillContent: string;
  skillName: string;
  /** Extra skills to install alongside the primary one. */
  additionalSkills?: Array<{ name: string; content: string }>;
  agent: AgentType;
  model: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  headers: Record<string, string>;
  /** When set, opencode runs export OTLP traces. Ignored by other agents. */
  otel?: OtelRunContext;
}

const MAX_OUTPUT = 10 * 1024 * 1024;

async function placeSkill(workDir: string, skillName: string, skillContent: string) {
  const skillDir = join(workDir, ".cursor", "skills", skillName);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, "SKILL.md"), skillContent);
}

/**
 * Spawns a process in its own process group and enforces a hard timeout.
 * Resolves with result info on completion or timeout — only rejects if
 * the process fails to start (e.g. binary not found).
 */
function execAgent(
  cmd: string,
  args: string[],
  options: Record<string, unknown>,
  timeoutMs: number,
): Promise<AgentResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    proc.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString();
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      killed = true;
      try {
        process.kill(-proc.pid!, "SIGKILL");
      } catch {
        proc.kill("SIGKILL");
      }
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start ${cmd}: ${err.message}`));
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code, timedOut: killed });
    });
  });
}

async function runCursor(workDir: string, prompt: string, timeoutMs: number): Promise<AgentResult> {
  return execAgent("cursor", ["--background-agent", prompt, workDir], {}, timeoutMs);
}

async function writeOpenCodeConfig(
  workDir: string,
  model: string,
  baseUrl: string,
  headers: Record<string, string>,
  otel?: OtelRunContext,
) {
  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    model: `gateway/${model}`,
    provider: {
      gateway: {
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: baseUrl,
          apiKey: "{env:OPENAI_API_KEY}",
          headers,
        },
        models: {
          [model]: {},
        },
      },
    },
  };
  if (otel) {
    config.plugin = [OTEL_PLUGIN_NAME];
  }
  await writeFile(join(workDir, "opencode.json"), JSON.stringify(config, null, 2));
}

/**
 * Builds OPENCODE_* / OTEL_* env vars for a single opencode run.
 *
 * `existingResourceAttributes` (typically `process.env.OTEL_RESOURCE_ATTRIBUTES`)
 * is preserved and prepended so callers' attributes aren't clobbered when the
 * returned record is spread on top of `process.env`.
 */
export function buildOtelEnv(
  otel: OtelRunContext,
  existingResourceAttributes?: string,
): Record<string, string> {
  const out: Record<string, string> = {
    OPENCODE_ENABLE_TELEMETRY: "1",
    OPENCODE_OTLP_ENDPOINT: otel.config.endpoint,
    OPENCODE_OTLP_PROTOCOL: otel.config.protocol,
    OTEL_SERVICE_NAME: otel.config.serviceName,
    OTEL_EXPORTER_OTLP_ENDPOINT: otel.config.endpoint,
    OTEL_EXPORTER_OTLP_PROTOCOL: otel.config.protocol,
  };

  const newAttrs = otel.resourceAttributes;
  const newAttrsStr =
    newAttrs && Object.keys(newAttrs).length > 0
      ? Object.entries(newAttrs)
          .map(([k, v]) => `${k}=${v}`)
          .join(",")
      : "";

  const existing = existingResourceAttributes?.trim() ?? "";
  const merged = [existing, newAttrsStr].filter(Boolean).join(",");
  if (merged) {
    out.OTEL_RESOURCE_ATTRIBUTES = merged;
  }
  return out;
}

/**
 * Returns the W3C trace context from the active OTel context as upper-case
 * env vars (TRACEPARENT / TRACESTATE). Empty when there is no active span,
 * so the OpenCode plugin (or any future trace-context-aware consumer) can
 * stitch its spans under the parent `eval.test` span when one exists.
 */
export function buildTraceContextEnv(): Record<string, string> {
  const carrier = injectTraceContext({});
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(carrier)) {
    if (typeof value === "string" && value.length > 0) {
      out[key.toUpperCase()] = value;
    }
  }
  return out;
}

async function runOpenCode(
  workDir: string,
  prompt: string,
  model: string,
  apiKey: string,
  baseUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
  otel?: OtelRunContext,
): Promise<AgentResult> {
  await writeOpenCodeConfig(workDir, model, baseUrl, headers, otel);

  return execAgent(
    "opencode",
    ["run", prompt, "--print-logs", "--log-level", "DEBUG", "--format", "json"],
    {
      cwd: workDir,
      env: {
        ...process.env,
        OPENAI_API_KEY: apiKey,
        OPENCODE_SKIP_MIGRATIONS: "1",
        ...(otel ? buildOtelEnv(otel, process.env.OTEL_RESOURCE_ATTRIBUTES) : {}),
        ...(otel ? buildTraceContextEnv() : {}),
      },
    },
    timeoutMs,
  );
}

async function runClaudeCode(
  workDir: string,
  prompt: string,
  timeoutMs: number,
): Promise<AgentResult> {
  return execAgent(
    "claude",
    ["-p", prompt, "--dangerously-skip-permissions"],
    { cwd: workDir },
    timeoutMs,
  );
}

/**
 * Runs a coding agent against the working directory.
 * The skill is placed at .cursor/skills/{name}/SKILL.md — the same path
 * used in real projects. The agent must discover and apply it naturally.
 */
export async function runAgent(config: AgentRunConfig): Promise<AgentResult> {
  const {
    workDir,
    prompt,
    skillContent,
    skillName,
    additionalSkills = [],
    agent,
    model,
    apiKey,
    baseUrl,
    headers,
    timeoutMs,
    otel,
  } = config;

  await placeSkill(workDir, skillName, skillContent);
  for (const s of additionalSkills) {
    await placeSkill(workDir, s.name, s.content);
  }

  switch (agent) {
    case "cursor":
      return runCursor(workDir, prompt, timeoutMs);
    case "opencode":
      return runOpenCode(workDir, prompt, model, apiKey, baseUrl, headers, timeoutMs, otel);
    case "claude-code":
      return runClaudeCode(workDir, prompt, timeoutMs);
  }
}
