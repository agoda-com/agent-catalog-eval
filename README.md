# agent-catalog-eval: The Ultimate Coding Agent Exam Board 🎓🤖

Welcome to `agent-catalog-eval`, the CLI that grades your coding agents so you don't have to! Think of it as a rigorous (but fair) professor for your AI assistants. We evaluate coding-agent **skills** against a catalog of test cases to see if they're actually learning or just hallucinating their way through the semester.

You provide the homework (a directory of cases with a `prompt.md`, `before/` and `after/` snapshots, an `eval.yaml`, and a judge rubric), and we do the grading! This CLI unleashes your chosen agent (Cursor, OpenCode, or Claude Code) on every case, compares the resulting workspace against your `after/` snapshot using an LLM judge, and hands out the pass/fail grades.

We extracted this runner from an internal skills repository so you can run the same harness against your own skill catalogs without the dreaded copy-paste. DRY, baby! ☂️

## Install: Getting the Party Started 🎉

Ready to test some bots? Let's get this installed!

```bash
# For the commitment-phobes (one-off)
npx agoda-agent-catalog-eval --help

# For the long haul (project install)
pnpm add -D agoda-agent-catalog-eval
```

The published binary is `agent-catalog-eval`. Easy peasy! 🍋

## Quick Start: Zero to Hero in 3 Commands 🦸‍♂️

```bash
agent-catalog-eval                       # Run all cases in your current directory
agent-catalog-eval tests/e2e             # Run cases hiding in ./tests/e2e
agent-catalog-eval ./skills --filter ioc # Only run cases with "ioc" in the name (for when you're feeling specific)
```

### Routing eval mode

Routing eval checks **which skill the agent picked** for a given prompt, deterministically.
Two modes:

#### End-to-end against an MCP-hosted catalog (recommended)

```bash
agent-catalog-eval route ./routing-cases --upstream-mcp https://skills.example/mcp
```

Per case, the harness:

1. Spawns OpenCode in a fresh per-case workdir under `<output-dir>/<caseId>/`.
2. Writes an `opencode.json` that registers a stdio MCP server pointing at the
   bundled proxy with `--case-id` baked in.
3. The proxy connects to `--upstream-mcp` (Streamable HTTP, SSE fallback) and
   forwards every `tools/list` and `tools/call` from OpenCode to it, while teeing
   each request to the per-case `observed.jsonl` (`tools/list` rows include each
   visible tool's name **and description** so the failure report can diff them).
4. After the agent exits or hits `--timeout`, the scorer reads the JSONL and the
   diagnostic writer renders `report.md` with the prompt, the visible tools, the
   tool(s) the agent actually called, and — when the agent picked the wrong
   skill — a word-level diff between the expected and the called skill's
   description.
5. A cumulative `<output-dir>/summary.json` lists every case for CI consumption.

Currently OpenCode is the only wired agent. Cursor and Claude Code adapters
will land in follow-up PRs.

#### Score-only mode (replay / debug)

```bash
agent-catalog-eval route ./routing-cases ./observed.jsonl
```

Skips the agent invocation and grades a pre-existing observation log. Useful when
you've captured observations from a different harness and just want the deterministic
verdict + reports.

#### Common flags

- `--filter <substring>` — only score cases whose ID contains the substring
- `--dry-run` — list discovered cases (with their expectation) and exit
- `--output-dir <path>` — where per-case workdirs and reports are written
  (default: `<casesDir>/.route-eval`)
- `--timeout <seconds>` — per-case agent execution timeout (e2e mode only)
- `--worker-model <name>` — model passed to OpenCode (e2e mode only)

#### Inputs

- `cases-dir`: directory tree of `eval.yaml` files with `mode: routing`. Each
  `eval.yaml`'s parent directory is a case. The case ID is the POSIX path of that
  directory relative to `cases-dir` (no leading `./`, no trailing `/`).
- `observed.jsonl` (score-only mode, or as produced by the proxy): newline-delimited
  JSON with one observation per line:
  - `caseId` (string, required) — must match the case ID derived from the eval.yaml path
  - `tool` (string, optional) — the invoked skill/tool name
  - `visibleTools` (optional) — `string[]` or `Array<{ name: string, description?: string }>`
    (the proxy writes the latter so the diagnostic report can diff descriptions)
  - `rationale` (string, optional) — the agent's reasoning, surfaced in failure reports
  - `type` (string, optional) — `"tools/list"` or `"tools/call"` (proxy-emitted; ignored
    by the scorer, which keys off `tool` and `visibleTools`)

If any line fails to parse or violates the schema, the eval exits **2** with the
offending line numbers — no records are silently dropped.

#### Case schema

Exactly one of `expected_skill`, `expected_any_of`, or `expected_none` is required.

```yaml
mode: routing
prompt: |
  Refactor this controller to use constructor injection.
expected_skill: csharp-ioc-refactor
# expected_any_of: [csharp-ioc-refactor, di-cleanup]
# expected_none: true
forbidden_skills: [vite-migration]
notes: optional human note shown in the report
```

`forbidden_skills` (if present) takes precedence: a case fails if any forbidden
skill fires, even when an expected skill also fires. Failure reasons always include
the full observed list so you can fix the skill descriptions.

#### Flags

- `--filter <substring>`: only score cases whose ID contains the substring
- `--dry-run`: list discovered cases (with their expectation) and exit; no
  observation file is read

#### Outputs

End-to-end mode (under `<output-dir>`, default `<casesDir>/.route-eval/`):

- `summary.json` — `{ generatedAt, upstreamMcp, total, passed, failed,
  cases: [{ caseId, passed, reason, expected, observed, durationMs, reportPath }] }`
- `<caseId>/observed.jsonl` — raw proxy log
- `<caseId>/report.md` — per-case diagnostic markdown (prompt, visible tools,
  called tool, description diff)
- `<caseId>/agent.log` — agent stdout / stderr / exit info
- `<caseId>/opencode.json` — the per-case OpenCode config that registered the proxy

Score-only mode (under `<casesDir>/.route-eval/`):

- `results.json` — `{ generatedAt, total, passed, failed, results: [{ caseId, passed,
  reason, observed, visibleTools, rationale, expected }] }`
- `report.md` — human-readable summary table plus a Failure Diagnostics section

#### Exit codes

- `0` — all cases passed
- `1` — at least one case failed
- `2` — usage error / unparseable cases / unparseable observation log


`cases-dir` is a **positional argument**, much like `vitest path/to/tests` or `jest src`. It defaults to your current working directory (`process.cwd()`). Any folder inside `cases-dir` that has an `eval.yaml` is officially a test case. (Don't worry, we automatically ignore the boring stuff like `node_modules`, `src`, `dist`, `.git`, and `output`).

## Test Case Layout: Anatomy of an Exam 📝

Here's how you structure your agent's pop quiz:

```text
my-skill-eval/
├── eval.yaml          # The syllabus: skill_path, threshold, judge_rubric
├── prompt.md          # The exam question: what you tell the agent
├── before/            # The blank canvas: initial workspace state
└── after/             # The answer key: ground-truth desired state
```

Your `eval.yaml` should look a little something like this:

```yaml
skill_path: skills/my-skill/SKILL.md # Where the skill lives (resolved against --repo-root)
threshold: 70 # The passing grade (0–100). No participation trophies here! 🏆
judge_rubric: |
  Score 100 if X. Penalize for Y.
  ...
```

## Options: Knobs and Dials 🎛️

Because we know you love to customize:

| Option                       | What it does                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `[cases-dir]`                | Where the tests live. Default: `cwd`.                                                                         |
| `--agent <name>`             | Who's taking the test? `cursor`, `opencode`, or `claude-code`. **Default: `opencode`** (because CI loves it). |
| `--dry-run`                  | Just looking! List discovered cases but don't actually run anything. 👀                                       |
| `--filter <pattern>`         | Substring match on test name.                                                                                 |
| `--worker-model <name>`      | The brains of the operation. Default: `claude-opus-4-7`.                                                      |
| `--judge-model <name>`       | The strict grader. Default: `gemini-3.1-flash`.                                                               |
| `--timeout <seconds>`        | Pencils down! Hard timeout per agent. Default: `420` seconds. ⏱️                                              |
| `--collect`                  | Send us a postcard (POST telemetry summary) after the run.                                                    |
| `--metrics-url <url>`        | Where to send the postcard. Default: `$METRICS_URL` or our built-in fallback.                                 |
| `--header KEY=VALUE`         | Extra headers for OpenAI calls **and** the metrics POST. Repeatable. **BYOH (Bring Your Own Headers)**.       |
| `--project <name>`           | Override CI project name (we auto-detect by default).                                                         |
| `--repo-root <path>`         | Where the repo starts (for resolving `skill_path`). Default: nearest `.git` ancestor.                         |
| `--output-dir <path>`        | Where the magic (and mess) happens. Default: `<cases-dir>/output`.                                            |
| `--base-url <url>`           | OpenAI-compatible base URL. Default: `$OPENAI_BASE_URL` or `https://api.openai.com/v1`.                       |
| `--otel-endpoint <url>`      | Send OpenTelemetry traces from each `opencode` run to this OTLP endpoint. Off when omitted. 🛰️                |
| `--otel-protocol <proto>`    | OTLP protocol: `grpc` or `http/protobuf`. Default: `grpc`.                                                    |
| `--otel-service-name <name>` | `service.name` attribute on emitted spans. Default: `agoda-agent-catalog-eval`.                               |
| `--help`, `-h`               | When all else fails, ask for help! 🆘                                                                         |

### Default Agent: Why `opencode`? 🤔

We default to `opencode` instead of `cursor`. Why? Because `opencode` is headless, OpenAI-compatible, and plays incredibly well with CI pipelines. `cursor`, on the other hand, needs a local install and is strictly for dev environments.

Want to switch it up? Just pass `--agent cursor` or `--agent claude-code` and you're good to go!

## Environment Variables: The Secret Sauce 🥫

| Variable                      | What it's for                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`              | Your golden ticket to the OpenAI-compatible gateway. Required (unless you're just doing a `--dry-run`). 🎫 |
| `OPENAI_BASE_URL`             | Override the default base URL.                                                                             |
| `METRICS_URL`                 | Override the default telemetry URL.                                                                        |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Standard OTEL var. Used when `--otel-endpoint` is not passed.                                              |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | Standard OTEL var. Used when `--otel-protocol` is not passed.                                              |
| `OTEL_SERVICE_NAME`           | Standard OTEL var. Used when `--otel-service-name` is not passed.                                          |

We're pretty smart about figuring out where we're running. CI context (project / pipeline / commit / branch) is auto-detected from the first matching environment variable:

| Provider          | Project                   | Pipeline            | Commit                 | Branch                  |
| ----------------- | ------------------------- | ------------------- | ---------------------- | ----------------------- |
| GitLab 🦊         | `CI_PROJECT_PATH`         | `CI_PIPELINE_ID`    | `CI_COMMIT_SHA`        | `CI_COMMIT_BRANCH`      |
| GitHub Actions 🐙 | `GITHUB_REPOSITORY`       | `GITHUB_RUN_ID`     | `GITHUB_SHA`           | `GITHUB_REF_NAME`       |
| TeamCity 🏙️       | `TEAMCITY_BUILDCONF_NAME` | `BUILD_NUMBER`      | `BUILD_VCS_NUMBER`     | `TEAMCITY_BUILD_BRANCH` |
| AppVeyor ☁️       | `APPVEYOR_PROJECT_SLUG`   | `APPVEYOR_BUILD_ID` | `APPVEYOR_REPO_COMMIT` | `APPVEYOR_REPO_BRANCH`  |
| (none) 🤷‍♂️         | `unknown`                 | `local`             | `unknown`              | `unknown`               |

Want to be the boss? Override any field with `--project` (more overrides coming soon!).

## Exit Codes: Did We Pass? 🚦

| Code | What it means                                                                                |
| ---- | -------------------------------------------------------------------------------------------- |
| `0`  | 🟢 Success! All cases passed (or you ran `--dry-run`, or we found absolutely nothing to do). |
| `1`  | 🔴 Uh oh. At least one case failed, or you typed something wrong. Better luck next time!     |

## Telemetry Payload: The Report Card 📊

If you pass the `--collect` flag, we'll POST a lovely `application/json` summary to your `--metrics-url`.

## OpenTelemetry Tracing: Watch the Agent Think 🛰️

Want to see what your tests are _actually_ doing — both the agent runs and the judge LLM calls? Wire up an OTLP endpoint and we'll ship traces from both:

```bash
agent-catalog-eval tests/e2e \
  --agent opencode \
  --otel-endpoint http://localhost:4317 \
  --otel-protocol grpc
```

When `--otel-endpoint` is set, the runner emits two flavours of spans:

**1. Judge (LLM) spans — emitted from this CLI**

The judge call to OpenAI is auto-instrumented with [`@arizeai/openinference-instrumentation-openai`](https://github.com/Arize-ai/openinference) using the OpenInference semantic conventions. That means [Arize](https://arize.com/) (and any other OpenInference-aware backend) renders these as proper LLM spans — input/output messages, model, token counts, cost — without any extra tagging from you.

Each test is wrapped in an `eval.test` parent span with these attributes, so all the LLM activity for one test is grouped together in one trace:

| Attribute                 | Value                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| `agoda.eval.test_name`    | The test case name (e.g. `csharp-ioc/refactor-manual-di`)        |
| `agoda.eval.skill_path`   | Path to the SKILL.md being evaluated                             |
| `agoda.eval.threshold`    | Pass/fail score threshold for the test                           |
| `agoda.eval.agent`        | `opencode` / `cursor` / `claude-code`                            |
| `agoda.eval.worker_model` | The worker model name                                            |
| `agoda.eval.judge_model`  | The judge model name                                             |
| `agoda.eval.category`     | The eval category, when set                                      |
| `agoda.eval.score`        | Final score from the judge (set when the test finishes)          |
| `agoda.eval.passed`       | Whether the score met the threshold (set when the test finishes) |

**2. OpenCode subprocess spans — emitted from `opencode`**

For `opencode` runs, the runner also:

1. Adds the [`@devtheops/opencode-plugin-otel`](https://github.com/DEVtheOPS/opencode-plugin-otel) plugin to the per-test `opencode.json`. (You'll need it on the box where opencode runs — the plugin is loaded from npm.)
2. Sets `OPENCODE_ENABLE_TELEMETRY=1` and the `OPENCODE_OTLP_*` env vars on the spawned process, plus the standard `OTEL_EXPORTER_OTLP_*` and `OTEL_SERVICE_NAME` vars so any other OTEL-aware tool also picks them up.
3. Packs the same per-test attributes into `OTEL_RESOURCE_ATTRIBUTES` so each opencode span knows which test, skill, agent, project, pipeline, commit, and branch it came from.
4. Injects the W3C `TRACEPARENT` env var so plugins that honour it can stitch their spans under the parent `eval.test` span.

> The judge spans are emitted regardless of `--agent`. The opencode-specific bits only fire for `--agent opencode` — `cursor` and `claude-code` have their own telemetry stories.

### Local quickstart

For a throwaway local collector that just prints whatever it receives:

```yaml
# otel-collector.yaml
receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }

processors:
  batch:

exporters:
  debug:
    verbosity: detailed

service:
  pipelines:
    traces: { receivers: [otlp], processors: [batch], exporters: [debug] }
    metrics: { receivers: [otlp], processors: [batch], exporters: [debug] }
    logs: { receivers: [otlp], processors: [batch], exporters: [debug] }
```

Run the collector, then:

```bash
agent-catalog-eval tests/e2e --otel-endpoint http://localhost:4317
```

## Example Consumer: See It In Action 🎬

An internal skills repository is our reference consumer. Once this package hits the shelves, it'll run something like this:

```bash
npx agoda-agent-catalog-eval tests/e2e \
  --agent opencode \
  --collect \
  --header x-custom-auth=my-token
```

When your brilliant code gets merged to `main`, our `changeset.yml` workflow will automatically open/merge a release PR and publish it to npm with `access: public` and provenance enabled. Magic! ✨

---

## And Finally...

Remember, in the world of AI coding agents, there are two types of people: those who test their agents, and those who trust them blindly. With `agent-catalog-eval`, you can trust _and_ verify!

Happy evaluating, and may your agents always score 100! 🚀
