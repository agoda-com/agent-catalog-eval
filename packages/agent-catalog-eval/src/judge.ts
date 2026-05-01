import OpenAI from "openai";
import type { FileSnapshot, JudgeVerdict, TestResult } from "./types.js";
import { formatFiles } from "./files.js";

const JUDGE_SYSTEM = `You are a precise code reviewer comparing an agent's output against a known-good desired state. Evaluate accuracy strictly according to the provided rubric. Respond ONLY with JSON.`;

const JUDGE_PROMPT = `## Desired state (ground truth)
{after_files}

## Agent's output
{agent_files}

## Evaluation criteria
{rubric}

Score the agent's output from 0 to 100 based on how closely it matches the desired state according to the criteria above.

Respond with JSON: {"score": <number>, "reasoning": "<brief explanation>"}`;

export interface JudgeConfig {
  agentFiles: FileSnapshot[];
  desiredFiles: FileSnapshot[];
  rubric: string;
  model: string;
  apiKey: string;
  baseUrl: string;
  headers: Record<string, string>;
}

export async function evaluate(config: JudgeConfig): Promise<JudgeVerdict> {
  const { agentFiles, desiredFiles, rubric, model, apiKey, baseUrl, headers } = config;

  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    defaultHeaders: headers,
  });

  const prompt = JUDGE_PROMPT
    .replace("{after_files}", formatFiles(desiredFiles))
    .replace("{agent_files}", formatFiles(agentFiles))
    .replace("{rubric}", rubric);

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: JUDGE_SYSTEM },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Judge returned empty response");

  const parsed = JSON.parse(content);
  if (typeof parsed.score !== "number" || typeof parsed.reasoning !== "string") {
    throw new Error(`Invalid judge response format: ${content}`);
  }

  return { score: parsed.score, reasoning: parsed.reasoning };
}

export interface DiagnoseConfig {
  failures: TestResult[];
  model: string;
  apiKey: string;
  baseUrl: string;
  headers: Record<string, string>;
}

/**
 * Asks an LLM to analyze test failures and provide an actionable summary.
 */
export async function diagnoseFailures(config: DiagnoseConfig): Promise<string> {
  const { failures, model, apiKey, baseUrl, headers } = config;

  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    defaultHeaders: headers,
  });

  const details = failures
    .map((f) => {
      if (f.error) return `### ${f.name}\n**Error:** ${f.error}`;
      return `### ${f.name}\nScore: ${f.score}% (needed ${f.threshold}%)\nJudge reasoning: ${f.reasoning}`;
    })
    .join("\n\n");

  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: `You are analyzing failures from an E2E skill evaluation pipeline that tests whether coding agents produce correct output when guided by a skill document.\n\n## Failed Tests\n${details}\n\nProvide a brief, actionable diagnosis: what went wrong and what to fix. Be concise.`,
      },
    ],
    temperature: 0,
  });

  return response.choices[0]?.message?.content ?? "No diagnosis available.";
}
