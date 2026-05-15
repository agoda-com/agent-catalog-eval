# agoda-agent-catalog-eval

## 0.6.0

### Minor Changes

- d9d821d: `route` mode now ships the runner half: end-to-end routing eval against an
  MCP-hosted skill catalog, not just a scorer.
  - `agent-catalog-eval route <casesDir> --upstream-mcp <url>` spawns OpenCode
    per case behind a stdio MCP observer proxy. The proxy forwards every
    `tools/list` and `tools/call` to `--upstream-mcp` (Streamable HTTP, SSE
    fallback) and tees observations to a per-case `observed.jsonl`.
  - Per case, the runner writes a per-case `opencode.json` that registers the
    proxy as a stdio MCP server with the case ID baked in via `--case-id`, so
    observations land in the right log without any session-correlation dance.
  - After each agent exits / hits `--timeout`, the deterministic scorer runs
    and a per-case `report.md` is written: prompt, visible tools (with
    descriptions), called tool(s), and — when the agent picked the wrong skill
    — a word-level diff between the expected and called skill descriptions.
  - Cumulative `summary.json` for CI consumption.
  - Score-only mode (`route <casesDir> <observed.jsonl>`) is preserved for
    replay / debug.
  - Hidden `__proxy` subcommand is the proxy entry; opencode.json invokes it
    via stdio and it never writes to stdout (which would corrupt the JSON-RPC
    stream).
  - Public exports: `runRoute`, `runProxy`, `runProxyCli`, `bridgeProxy`,
    `connectUpstream`, `renderCaseReport`, `renderDescriptionDiff`,
    `writeRunSummary`, plus their input / output types.

  V1 wires OpenCode only. Cursor and Claude Code adapters land in follow-up PRs.

- d9d821d: Add `route` subcommand: a deterministic routing-eval scorer for `mode: routing`
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

## 0.5.0

### Minor Changes

- afb0e5b: Place the SKILL.md in each agent's own auto-discovery directory so the agent
  actually loads it before running.

  Previously every agent received the skill at `.cursor/skills/{name}/SKILL.md`.
  That works for `cursor`, but `opencode` only scans `.opencode/skills/`,
  `.claude/skills/`, and `.agents/skills/`, and `claude-code` only scans
  `.claude/skills/`. For non-cursor agents the skill was never registered, so
  the agent had to stumble onto it through filesystem exploration — slow enough
  to blow the per-test timeout in practice.

  Skills are now placed per agent:
  - `cursor` → `.cursor/skills/{name}/SKILL.md`
  - `opencode` → `.opencode/skills/{name}/SKILL.md`
  - `claude-code` → `.claude/skills/{name}/SKILL.md`

  `additional_skills` follow the same rule. The `agentFiles` filter passed to
  the judge already ignores all three directories, so the judge's view of the
  workspace doesn't change.

  Adds public exports `skillsDirForAgent(agent)` and accepts an optional
  `agent` argument on `checkSkillUsage` so the "skill not referenced" warning
  matches against the right path. Both are additive.

  Also adds a hard post-run check for `--agent opencode` that greps the
  debug log for two signals:
  - registration: `service=permission permission=skill pattern=<name>` is
    emitted once per skill the auto-discoverer finds at startup.
  - invocation: `tool_name=skill` appears each time the agent calls the
    skill tool (reading the SKILL.md via `read` does NOT count).

  If either signal is missing, the test now fails regardless of the judge's
  score — a skill that was never registered or never invoked can't have
  caused the agent's output. The signals are printed on every opencode run
  (passing or failing) and a `[skill-signal failure]` tag is added to the
  summary line for the failure case. New `OpenCodeSkillSignals` /
  `SkillRegistrationCheck` types and `checkOpenCodeSkillSignals` /
  `describeOpenCodeSkillSignalFailure` helpers are exported.

## 0.4.0

### Minor Changes

- 364b3e1: Add LLM-shaped tracing for the judge call.

  When `OTEL_EXPORTER_OTLP_ENDPOINT` is set the CLI now starts a NodeSDK,
  auto-instruments the OpenAI client with
  `@arizeai/openinference-instrumentation-openai`, and wraps each test in an
  `eval.test` parent span carrying `agoda.eval.*` attributes. The judge call
  appears as a proper LLM span (input/output messages, model, token counts) in
  Arize and any other OpenInference-aware backend.

  The `opencode` subprocess additionally receives a W3C `TRACEPARENT` env var
  so plugins that honour it can stitch their spans under the same trace.

  Tracing is fully opt-in — with no OTLP endpoint the SDK never starts and
  behaviour is unchanged. New public exports: `initTracing`, `withSpan`,
  `getTracer`, `injectTraceContext`, `buildTraceContextEnv`, `TRACER_NAME`,
  `TracingHandle`.

## 0.3.0

### Minor Changes

- 172be41: Add opt-in OpenTelemetry tracing for `opencode` runs.

  Pass `--otel-endpoint <url>` (or set `OTEL_EXPORTER_OTLP_ENDPOINT`) and the runner
  will:
  - install [`@devtheops/opencode-plugin-otel`](https://github.com/DEVtheOPS/opencode-plugin-otel)
    into the per-test `opencode.json`
  - set `OPENCODE_ENABLE_TELEMETRY=1` and the matching `OPENCODE_OTLP_*` /
    `OTEL_EXPORTER_OTLP_*` / `OTEL_SERVICE_NAME` env vars on the spawned process
  - pack per-test context (test name, skill, agent, worker model, category, CI
    project / pipeline / commit / branch) into `OTEL_RESOURCE_ATTRIBUTES` so each
    span knows where it came from

  New flags: `--otel-endpoint`, `--otel-protocol` (`grpc` | `http/protobuf`,
  default `grpc`), `--otel-service-name` (default `agoda-agent-catalog-eval`).
  Tracing stays off when no endpoint is set, and `cursor` / `claude-code` ignore
  the flags.

## 0.2.0

### Minor Changes

- 5c7f02b: Add category-based filtering and multi-skill test cases.

  Both additions are purely additive — existing eval.yaml files and existing CLI
  invocations keep working unchanged.
  - `eval.yaml` may now declare an optional `category:` string. Tests without one
    remain valid (they just don't appear in any category).
  - `eval.yaml` may now declare an optional `additional_skills:` list of paths
    (resolved against `--repo-root`). Each one is installed alongside the
    primary skill at `.cursor/skills/{name}/SKILL.md` so the agent sees them
    all. Useful when one task naturally pulls in two skills (e.g. a
    presentation skill + a brand/template skill).
  - New CLI flags:
    - `--category <name>` — only run tests whose `category` matches.
    - `--not-category <a,b>` — exclude tests in any of the listed categories.
      Uncategorized tests still run.
    - `--list-categories` — print the categories found under `[cases-dir]` and
      exit. Does not require `OPENAI_API_KEY`.
  - New public exports: `getCategories`, `ListCategoriesResult`.
  - `TestResult` gains an optional `category` field so downstream tooling can
    group results by category.
  - Runner now also filters `.claude/` and `opencode.json` out of the snapshot
    passed to the judge (matches what we already do for `.cursor/` /
    `.opencode/`).

## 0.1.0

### Minor Changes

- a9f88ed: Initial release. Extracts the e2e skill-evaluation runner from `skills-mcp` into a
  standalone, public CLI so other repos can evaluate their own skill catalogs.
  - Positional `cases-dir` argument (defaults to `cwd`), modelled on `vitest`/`jest`.
  - Default `--agent` is now `opencode` (CI-friendly, headless).
  - Telemetry headers are no longer hard-coded — pass `--header KEY=VALUE` (repeatable).
  - Telemetry endpoint is configurable via `--metrics-url` and `METRICS_URL` env.
  - Project / pipeline / commit / branch auto-detected from GitLab, GitHub Actions,
    TeamCity, or AppVeyor env vars; override with `--project`.
  - `--repo-root` defaults to nearest `.git` ancestor; `--output-dir` defaults to
    `<cases-dir>/output`.
