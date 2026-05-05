---
"agoda-agent-catalog-eval": minor
---

Add opt-in OpenTelemetry tracing for `opencode` runs.

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
