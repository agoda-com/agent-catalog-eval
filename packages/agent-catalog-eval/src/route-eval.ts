import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";

type RouteCase = {
  id: string;
  prompt: string;
  expected_skill?: string;
  expected_any_of?: string[];
  expected_none?: boolean;
  forbidden_skills?: string[];
};

type ObservedCall = {
  caseId: string;
  tool: string;
};

type CaseResult = {
  caseId: string;
  passed: boolean;
  reason?: string;
  observed: string[];
  expected: {
    expected_skill?: string;
    expected_any_of?: string[];
    expected_none?: boolean;
    forbidden_skills?: string[];
  };
};

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

function validateCase(obj: any, id: string): RouteCase {
  if (obj?.mode !== "routing") throw new Error(`${id}: mode must be 'routing'`);
  if (!obj?.prompt || typeof obj.prompt !== "string") throw new Error(`${id}: prompt is required`);
  const has = ["expected_skill", "expected_any_of", "expected_none"].filter((k) => obj[k] !== undefined);
  if (has.length !== 1) throw new Error(`${id}: exactly one of expected_skill / expected_any_of / expected_none is required`);
  return {
    id,
    prompt: obj.prompt,
    expected_skill: obj.expected_skill,
    expected_any_of: obj.expected_any_of,
    expected_none: obj.expected_none,
    forbidden_skills: obj.forbidden_skills ?? [],
  };
}

async function loadCases(casesDir: string): Promise<RouteCase[]> {
  const files = await walk(casesDir);
  const cases: RouteCase[] = [];
  for (const f of files) {
    const txt = await fs.readFile(f, "utf8");
    const y = YAML.parse(txt);
    const id = path.relative(casesDir, path.dirname(f)).replaceAll("\\", "/");
    cases.push(validateCase(y, id));
  }
  return cases;
}

async function loadObserved(jsonlPath: string): Promise<Map<string, string[]>> {
  const txt = await fs.readFile(jsonlPath, "utf8");
  const map = new Map<string, string[]>();
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as ObservedCall;
    if (!row.caseId || !row.tool) continue;
    const arr = map.get(row.caseId) ?? [];
    arr.push(row.tool);
    map.set(row.caseId, arr);
  }
  return map;
}

function score(c: RouteCase, observed: string[]): { passed: boolean; reason?: string } {
  const forbiddenHit = (c.forbidden_skills ?? []).find((x) => observed.includes(x));
  if (forbiddenHit) return { passed: false, reason: `forbidden skill fired: ${forbiddenHit}` };

  if (c.expected_none) {
    return observed.length === 0
      ? { passed: true }
      : { passed: false, reason: `expected no skill, got: ${observed.join(", ")}` };
  }

  if (c.expected_skill) {
    return observed.includes(c.expected_skill)
      ? { passed: true }
      : observed.length === 0
        ? { passed: false, reason: "expected skill but no call observed" }
        : { passed: false, reason: `expected ${c.expected_skill}, got ${observed.join(", ")}` };
  }

  if (c.expected_any_of && c.expected_any_of.length > 0) {
    const ok = c.expected_any_of.find((x) => observed.includes(x));
    return ok
      ? { passed: true }
      : observed.length === 0
        ? { passed: false, reason: "expected one of allowed skills, got none" }
        : { passed: false, reason: `expected one of [${c.expected_any_of.join(", ")}], got ${observed.join(", ")}` };
  }

  return { passed: false, reason: "invalid case" };
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
    lines.push(`| \`${r.caseId}\` | ${r.passed ? "✅ pass" : "❌ fail"} | ${r.reason ?? ""} | ${r.observed.join(", ") || "(none)"} |`);
  }
  lines.push("");
  return lines.join("\n");
}

export async function runRouteEval(casesDir: string, observedJsonl: string): Promise<number> {
  const cases = await loadCases(casesDir);
  const observedMap = await loadObserved(observedJsonl);

  let failed = 0;
  const results: CaseResult[] = [];

  for (const c of cases) {
    const observed = observedMap.get(c.id) ?? [];
    const s = score(c, observed);

    const row: CaseResult = {
      caseId: c.id,
      passed: s.passed,
      reason: s.reason,
      observed,
      expected: {
        expected_skill: c.expected_skill,
        expected_any_of: c.expected_any_of,
        expected_none: c.expected_none,
        forbidden_skills: c.forbidden_skills,
      },
    };
    results.push(row);

    if (s.passed) {
      console.log(`✅ ${c.id}`);
    } else {
      failed += 1;
      console.log(`❌ ${c.id} - ${s.reason}`);
    }
  }

  const passed = cases.length - failed;
  console.log(`\nRoute eval complete: ${passed}/${cases.length} passed`);

  const outDir = path.join(casesDir, ".route-eval");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "results.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), total: cases.length, passed, failed, results }, null, 2),
    "utf8",
  );
  await fs.writeFile(path.join(outDir, "report.md"), toMarkdown(results, passed, cases.length), "utf8");
  console.log(`Reports written to ${outDir}`);

  return failed === 0 ? 0 : 1;
}
