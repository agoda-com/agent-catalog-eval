import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { initTracing, withSpan, injectTraceContext } from "./tracing.js";
import { buildTraceContextEnv } from "./agent.js";

describe("initTracing", () => {
  const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  afterEach(() => {
    if (originalEndpoint === undefined) {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    } else {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEndpoint;
    }
  });

  it("returns a no-op handle when OTEL_EXPORTER_OTLP_ENDPOINT is unset", () => {
    const handle = initTracing({});
    expect(handle.enabled).toBe(false);
  });

  it("returns a no-op handle when the endpoint is whitespace", () => {
    const handle = initTracing({ OTEL_EXPORTER_OTLP_ENDPOINT: "   " });
    expect(handle.enabled).toBe(false);
  });
});

describe("withSpan / injectTraceContext (tracing not initialised)", () => {
  it("withSpan still runs the body and returns its value when tracing is off", async () => {
    const result = await withSpan("noop", { foo: "bar" }, () => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("withSpan rethrows but still completes when the body throws", async () => {
    await expect(
      withSpan("noop-fail", {}, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });

  it("injectTraceContext returns an empty carrier when there is no active span", () => {
    const carrier = injectTraceContext({});
    expect(carrier).toEqual({});
  });

  it("buildTraceContextEnv returns {} when there is no active span", () => {
    expect(buildTraceContextEnv()).toEqual({});
  });
});

describe("withSpan with a real tracer (in-memory exporter)", () => {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;
  let contextManager: AsyncLocalStorageContextManager;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);

    contextManager = new AsyncLocalStorageContextManager();
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  });

  afterEach(async () => {
    await provider.shutdown();
    contextManager.disable();
    trace.disable();
    context.disable();
    propagation.disable();
  });

  it("emits a span named after the first argument with the supplied attributes", async () => {
    const value = await withSpan(
      "eval.test",
      { "agoda.eval.test_name": "ioc/refactor", "agoda.eval.threshold": 70 },
      () => Promise.resolve("done"),
    );

    expect(value).toBe("done");
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span!.name).toBe("eval.test");
    expect(span!.attributes).toMatchObject({
      "agoda.eval.test_name": "ioc/refactor",
      "agoda.eval.threshold": 70,
    });
  });

  it("records the exception and sets ERROR status when the body throws", async () => {
    await expect(
      withSpan("eval.test", {}, () => {
        throw new Error("judge failed");
      }),
    ).rejects.toThrow("judge failed");

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(span!.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(span!.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("buildTraceContextEnv returns TRACEPARENT inside an active span", async () => {
    let captured: Record<string, string> = {};
    await withSpan("eval.test", {}, () => {
      captured = buildTraceContextEnv();
      return Promise.resolve();
    });

    expect(captured.TRACEPARENT).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  it("OpenAI auto-instrumentation child spans share the eval.test traceId", async () => {
    let parentTraceId = "";
    let childTraceId = "";

    await withSpan("eval.test", {}, async (parent) => {
      parentTraceId = parent.spanContext().traceId;

      const child = trace.getTracer("test").startSpan("openai.chat.completions.create");
      childTraceId = child.spanContext().traceId;
      child.end();
    });

    expect(parentTraceId).toBe(childTraceId);
  });
});
