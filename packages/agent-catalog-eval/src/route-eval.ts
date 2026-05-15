import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type RouteExpectation =
  | { kind: "skill"; expected_skill: string }
  | { kind: "any_of"; expected_any_of: string[] }
  | { kind: "none" };

export interface RouteCase {
  id: string;
  prompt: string;
  expectation: RouteExpectation;
  forbidden_skills: string[];
  notes?: string;
}

export interface ObservedCall {
  caseId: string;
  tool?: string;
  visibleTools?: string[];
  rationale?: string;
}

export interface CaseResult {
  caseId: string;
  passed: boolean;
  reason?: string;
  observed: string[];
  visibleTools?: string[];
  rationale?: string;
  expected: {
    expected_skill?: string;
    expected_any_of?: string[];
    expected_none?: boolean;
    forbidden_skills: string[];
  };
}

export interface RouteEvalOptions {
  filter?: string;
  dryRun?: boolean;
}

/**
 * Derive the caseId for a case directory from its eval.yaml path.
 *
 * The proxy/observation producer must emit the same string for `observedCall.caseId`
 * so the scorer can correlate observed calls to cases. This is the contract:
 *
 * - Forward slashes (POSIX), regardless of host OS
 * - Relative to `casesDir`
 * - No leading "./" and no trailing "/"
 */
export function caseIdFromPath(casesDir: string, evalYamlPath: string): string {
  const rel = path.relative(casesDir, path.dirname(evalYamlPath)).replaceAll("\\", "/");
  return rel.replace(/^\.\//, "").replace(/\/$/, "");
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile() && e.name === "eval.yaml") out.push(p);
  }
  return out;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRouteCase(input: unknown, id: string): RouteCase {
  if (!isRecord(input)) throw new Error(`${id}: eval.yaml must be a mapping`);
  if (input.mode !== "routing") throw new Error(`${id}: mode must be 'routing'`);

  const prompt = input.prompt;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new Error(`${id}: prompt is required (non-empty string)`);
  }

  const present = (
    ["expected_skill", "expected_any_of", "expected_none"] as const
  ).filter((k) => input[k] !== undefined);
  if (present.length !== 1) {
    throw new Error(
      `${id}: exactly one of expected_skill / expected_any_of / expected_none is required (found: ${
        present.length === 0 ? "none" : present.join(", ")
      })`,
    );
  }

  let expectation: RouteExpectation;
  if (input.expected_skill !== undefined) {
    if (typeof input.expected_skill !== "string") {
      throw new Error(`${id}: expected_skill must be a string`);
    }
    expectation = { kind: "skill", expected_skill: input.expected_skill };
  } else if (input.expected_any_of !== undefined) {
    if (!isStringArray(input.expected_any_of) || input.expected_any_of.length === 0) {
      throw new Error(`${id}: expected_any_of must be a non-empty array of strings`);
    }
    expectation = { kind: "any_of", expected_any_of: input.expected_any_of };
  } else {
    if (input.expected_none !== true) {
      throw new Error(`${id}: expected_none must be the literal true`);
    }
    expectation = { kind: "none" };
  }

  let forbidden_skills: string[] = [];
  if (input.forbidden_skills !== undefined) {
    if (!isStringArray(input.forbidden_skills)) {
      throw new Error(`${id}: forbidden_skills must be an array of strings`);
    }
    forbidden_skills = input.forbidden_skills;
  }

  let notes: string | undefined;
  if (input.notes !== undefined) {
    if (typeof input.notes !== "string") throw new Error(`${id}: notes must be a string`);
    notes = input.notes;
  }

  return { id, prompt, expectation, forbidden_skills, notes };
}

export async function loadCases(casesDir: string): Promise<RouteCase[]> {
  const files = await walk(casesDir);
  const cases: RouteCase[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const id = caseIdFromPath(casesDir, f);
    try {
      const txt = await fs.readFile(f, "utf8");
      const parsed: unknown = YAML.parse(txt);
      cases.push(parseRouteCase(parsed, id));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  if (errors.length > 0) {
    throw new Error(`Failed to load ${errors.length} routing case(s):\n  - ${errors.join("\n  - ")}`);
  }
  return cases;
}

export interface ObservedIndex {
  toolsByCase: Map<string, string[]>;
  visibleByCase: Map<string, string[]>;
  rationaleByCase: Map<string, string>;
}

/**
 * Accept `visibleTools` as either `string[]` (for hand-rolled observation
 * logs) or `Array<{ name: string; description?: string }>` (what the
 * built-in proxy writes). Returns just the names — descriptions are
 * recovered separately by the runner when it needs them for diffs.
 */
function extractVisibleToolNames(value: unknown, lineNo: number): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`line ${lineNo}: visibleTools must be an array`);
  }
  return value.map((entry, i) => {
    if (typeof entry === "string") return entry;
    if (isRecord(entry) && typeof entry.name === "string") return entry.name;
    throw new Error(
      `line ${lineNo}: visibleTools[${i}] must be a string or { name: string, description?: string }`,
    );
  });
}

function parseObservedRow(value: unknown, lineNo: number): ObservedCall {
  if (!isRecord(value)) {
    throw new Error(`line ${lineNo}: row must be a JSON object`);
  }
  if (typeof value.caseId !== "string" || value.caseId.trim() === "") {
    throw new Error(`line ${lineNo}: caseId is required (non-empty string)`);
  }
  const out: ObservedCall = { caseId: value.caseId };
  if (value.tool !== undefined) {
    if (typeof value.tool !== "string" || value.tool.trim() === "") {
      throw new Error(`line ${lineNo}: tool must be a non-empty string when present`);
    }
    out.tool = value.tool;
  }
  if (value.visibleTools !== undefined) {
    out.visibleTools = extractVisibleToolNames(value.visibleTools, lineNo);
  }
  if (value.rationale !== undefined) {
    if (typeof value.rationale !== "string") {
      throw new Error(`line ${lineNo}: rationale must be a string`);
    }
    out.rationale = value.rationale;
  }
  return out;
}

export async function loadObserved(jsonlPath: string): Promise<ObservedIndex> {
  const txt = await fs.readFile(jsonlPath, "utf8");
  const lines = txt.split(/\r?\n/);

  const errors: string[] = [];
  const rows: ObservedCall[] = [];

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      errors.push(`line ${lineNo}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    try {
      rows.push(parseObservedRow(parsed, lineNo));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  });

  if (errors.length > 0) {
    throw new Error(
      `Malformed observation log (${errors.length} error${errors.length === 1 ? "" : "s"}):\n  - ${errors.join("\n  - ")}`,
    );
  }

  const toolsByCase = new Map<string, string[]>();
  const visibleByCase = new Map<string, string[]>();
  const rationaleByCase = new Map<string, string>();

  for (const row of rows) {
    if (row.tool) {
      const arr = toolsByCase.get(row.caseId) ?? [];
      arr.push(row.tool);
      toolsByCase.set(row.caseId, arr);
    }
    if (row.visibleTools && row.visibleTools.length > 0) {
      visibleByCase.set(row.caseId, row.visibleTools);
    }
    if (row.rationale && row.rationale.trim()) {
      rationaleByCase.set(row.caseId, row.rationale.trim());
    }
  }

  return { toolsByCase, visibleByCase, rationaleByCase };
}

function describeObserved(observed: string[]): string {
  return observed.length === 0 ? "(none)" : `[${observed.join(", ")}]`;
}

export function score(c: RouteCase, observed: string[]): { passed: boolean; reason?: string } {
  const forbiddenHit = c.forbidden_skills.find((x) => observed.includes(x));
  if (forbiddenHit) {
    return {
      passed: false,
      reason: `forbidden skill fired: ${forbiddenHit} (observed: ${describeObserved(observed)})`,
    };
  }

  switch (c.expectation.kind) {
    case "none":
      return observed.length === 0
        ? { passed: true }
        : {
            passed: false,
            reason: `expected no skill, got: ${describeObserved(observed)}`,
          };
    case "skill": {
      const expected = c.expectation.expected_skill;
      if (observed.includes(expected)) return { passed: true };
      return observed.length === 0
        ? { passed: false, reason: `expected ${expected} but no call observed` }
        : {
            passed: false,
            reason: `expected ${expected}, got: ${describeObserved(observed)}`,
          };
    }
    case "any_of": {
      const allowed = c.expectation.expected_any_of;
      if (allowed.some((x) => observed.includes(x))) return { passed: true };
      return observed.length === 0
        ? { passed: false, reason: `expected one of [${allowed.join(", ")}] but no call observed` }
        : {
            passed: false,
            reason: `expected one of [${allowed.join(", ")}], got: ${describeObserved(observed)}`,
          };
    }
  }
}

function expectedJson(c: RouteCase): CaseResult["expected"] {
  const out: CaseResult["expected"] = { forbidden_skills: c.forbidden_skills };
  switch (c.expectation.kind) {
    case "skill":
      out.expected_skill = c.expectation.expected_skill;
      break;
    case "any_of":
      out.expected_any_of = c.expectation.expected_any_of;
      break;
    case "none":
      out.expected_none = true;
      break;
  }
  return out;
}

function toMarkdown(results: CaseResult[], passed: number, total: number): string {
  const lines: string[] = [];
  lines.push(`# Route Eval Report`);
  lines.push("");
  lines.push(`- Passed: **${passed}/${total}**`);
  lines.push("");
  lines.push(`| Case | Result | Reason | Observed |`);
  lines.push(`|---|---|---|---|`);
  for (const r of results) {
    lines.push(
      `| \`${r.caseId}\` | ${r.passed ? "pass" : "fail"} | ${r.reason ?? ""} | ${
        r.observed.join(", ") || "(none)"
      } |`,
    );
  }

  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    lines.push("");
    lines.push("## Failure Diagnostics");
    lines.push("");
    for (const f of failures) {
      lines.push(`### ${f.caseId}`);
      lines.push(`- Reason: ${f.reason ?? "unknown"}`);
      lines.push(`- Expected: ${JSON.stringify(f.expected)}`);
      lines.push(`- Observed: ${f.observed.length ? f.observed.join(", ") : "(none)"}`);
      if (f.visibleTools?.length) lines.push(`- Visible tools: ${f.visibleTools.join(", ")}`);
      if (f.rationale) lines.push(`- Agent rationale: ${f.rationale}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export async function runRouteEval(
  casesDir: string,
  observedJsonl: string,
  options: RouteEvalOptions = {},
): Promise<number> {
  let cases: RouteCase[];
  try {
    cases = await loadCases(casesDir);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  if (options.filter) {
    const needle = options.filter;
    cases = cases.filter((c) => c.id.includes(needle));
  }

  if (options.dryRun) {
    console.log(`Discovered ${cases.length} routing case(s):`);
    for (const c of cases) {
      const exp = JSON.stringify(expectedJson(c));
      console.log(`  - ${c.id}  ${exp}`);
    }
    return 0;
  }

  let observed: ObservedIndex;
  try {
    observed = await loadObserved(observedJsonl);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  let failed = 0;
  const results: CaseResult[] = [];

  for (const c of cases) {
    const observedCalls = observed.toolsByCase.get(c.id) ?? [];
    const s = score(c, observedCalls);

    const row: CaseResult = {
      caseId: c.id,
      passed: s.passed,
      reason: s.reason,
      observed: observedCalls,
      visibleTools: observed.visibleByCase.get(c.id),
      rationale: observed.rationaleByCase.get(c.id),
      expected: expectedJson(c),
    };
    results.push(row);

    if (s.passed) {
      console.log(`pass  ${c.id}`);
    } else {
      failed += 1;
      console.log(`fail  ${c.id} - ${s.reason}`);
    }
  }

  const passed = cases.length - failed;
  console.log(`\nRoute eval complete: ${passed}/${cases.length} passed`);

  const outDir = path.join(casesDir, ".route-eval");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "results.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), total: cases.length, passed, failed, results },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(path.join(outDir, "report.md"), toMarkdown(results, passed, cases.length), "utf8");
  console.log(`Reports written to ${outDir}`);

  return failed === 0 ? 0 : 1;
}
