# agoda-agent-catalog-eval

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
