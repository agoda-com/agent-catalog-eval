import {
  context,
  propagation,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter as OtlpHttpExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPTraceExporter as OtlpGrpcExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { OpenAIInstrumentation } from "@arizeai/openinference-instrumentation-openai";
import OpenAI from "openai";

/**
 * Tracer name reported on spans produced by this CLI. Service name and
 * resource attributes come from the standard OTEL_SERVICE_NAME /
 * OTEL_RESOURCE_ATTRIBUTES env vars — NodeSDK picks those up automatically.
 */
export const TRACER_NAME = "agoda-agent-catalog-eval";

export interface TracingHandle {
  /** Flush + shut down the SDK. Safe to call multiple times. */
  shutdown: () => Promise<void>;
  /** True when the SDK was actually started. False = no-op handle. */
  enabled: boolean;
}

const NOOP_HANDLE: TracingHandle = {
  shutdown: () => Promise.resolve(),
  enabled: false,
};

let activeSdk: NodeSDK | null = null;
let activeHandle: TracingHandle | null = null;

/**
 * Starts an OpenTelemetry NodeSDK with OpenAI auto-instrumentation when an
 * OTLP endpoint is configured. No-op (returns a stub handle) when the
 * endpoint env var is unset, so local invocations don't try to ship spans.
 *
 * Idempotent: a second call returns the existing handle without restarting.
 */
export function initTracing(env: NodeJS.ProcessEnv = process.env): TracingHandle {
  if (activeHandle) return activeHandle;

  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) {
    activeHandle = NOOP_HANDLE;
    return activeHandle;
  }

  const protocol = (env.OTEL_EXPORTER_OTLP_PROTOCOL ?? "http/protobuf").trim();
  const traceExporter =
    protocol === "grpc"
      ? new OtlpGrpcExporter({ url: endpoint })
      : new OtlpHttpExporter({
          url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
        });

  // Manual instrumentation avoids the require-hook timing problem in ESM:
  // OpenAI is already imported by judge.ts, but patching the constructor
  // prototype here still wraps every client created afterwards.
  const openaiInstr = new OpenAIInstrumentation();
  openaiInstr.manuallyInstrument(OpenAI);

  activeSdk = new NodeSDK({
    traceExporter,
    instrumentations: [openaiInstr],
  });
  activeSdk.start();

  activeHandle = {
    enabled: true,
    shutdown: async () => {
      const sdk = activeSdk;
      activeSdk = null;
      activeHandle = null;
      if (sdk) await sdk.shutdown();
    },
  };
  return activeHandle;
}

export function getTracer() {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Runs `fn` inside an active span named `name`, recording exceptions and
 * setting the span status from the outcome. The span is always ended.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return getTracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Injects the current trace context (W3C `traceparent` / `tracestate`) into
 * the given carrier so a child process can continue the trace. Returns the
 * carrier for convenience.
 */
export function injectTraceContext(carrier: Record<string, string> = {}): Record<string, string> {
  propagation.inject(context.active(), carrier);
  return carrier;
}
