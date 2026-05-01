# agoda-agent-catalog-eval

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
