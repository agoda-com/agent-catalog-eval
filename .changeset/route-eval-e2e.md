---
"agoda-agent-catalog-eval": minor
---

`route` mode now ships the runner half: end-to-end routing eval against an
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
