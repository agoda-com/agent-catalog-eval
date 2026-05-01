# agoda-agent-catalog-eval

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
