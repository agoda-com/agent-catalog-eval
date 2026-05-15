---
"agoda-agent-catalog-eval": minor
---

Add `route` subcommand: a deterministic routing-eval scorer for `mode: routing`
cases against a JSONL log of observed tool calls.

- `agent-catalog-eval route <casesDir> <observed.jsonl>` plus `--filter` and `--dry-run`
- Exit codes: `0` pass, `1` test failure, `2` usage / unparseable input
- Loud failure with line numbers on malformed `observed.jsonl` (no silent record drops)
- Aggregated case schema validation (rejects multiple/zero `expected_*`, empty
  `expected_any_of`, non-`true` `expected_none`)
- Failure reasons always include the full observed call list
- Writes `<casesDir>/.route-eval/results.json` and `report.md`
- Public exports: `runRouteEval`, `parseRouteCase`, `loadCases`, `loadObserved`,
  `score`, `caseIdFromPath`, plus `RouteCase` / `RouteExpectation` /
  `ObservedCall` / `CaseResult` / `RouteEvalOptions` types

This is the scorer + CLI hook foundation. The FastMCP observer proxy and agent
invocation that produce `observed.jsonl` end-to-end are still tracked in #12.
