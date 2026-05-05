---
"agoda-agent-catalog-eval": minor
---

Add LLM-shaped tracing for the judge call.

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
