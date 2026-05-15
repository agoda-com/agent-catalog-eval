import { promises as fs, createWriteStream, type WriteStream } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

export interface ProxyOptions {
  upstreamUrl: string;
  caseId: string;
  logPath: string;
}

/**
 * One observation row in `observed.jsonl`. The shape is intentionally aligned
 * with the contract documented in the README so the deterministic scorer in
 * `route-eval.ts` can consume it directly.
 */
export type ProxyObservation =
  | {
      caseId: string;
      type: "tools/list";
      timestamp: string;
      visibleTools: Array<{ name: string; description?: string }>;
    }
  | {
      caseId: string;
      type: "tools/call";
      timestamp: string;
      tool: string;
      args?: Record<string, unknown>;
      isError?: boolean;
    };

/**
 * Connect to the upstream MCP server. Tries Streamable HTTP first (modern
 * spec), falls back to SSE (legacy). Both transports are common in FastMCP
 * deployments.
 */
export async function connectUpstream(upstreamUrl: string): Promise<Client> {
  const url = new URL(upstreamUrl);
  const client = new Client(
    { name: "agent-catalog-eval-proxy", version: "0.0.0" },
    { capabilities: {} },
  );
  try {
    await client.connect(new StreamableHTTPClientTransport(url));
    return client;
  } catch {
    const fallbackClient = new Client(
      { name: "agent-catalog-eval-proxy", version: "0.0.0" },
      { capabilities: {} },
    );
    await fallbackClient.connect(new SSEClientTransport(url));
    return fallbackClient;
  }
}

/**
 * Append a single newline-delimited JSON observation to the log stream.
 * Synchronous-ish from the caller's POV — we don't await drain because it
 * would slow down the request handler hot path; the stream auto-flushes
 * on close in `runProxy`.
 */
function logObservation(stream: WriteStream, obs: ProxyObservation) {
  stream.write(`${JSON.stringify(obs)}\n`);
}

function summariseToolsList(result: ListToolsResult): Array<{ name: string; description?: string }> {
  return (result.tools as Tool[]).map((t) => ({
    name: t.name,
    description: t.description,
  }));
}

/**
 * Wire a freshly-created MCP `Server` to an upstream `Client`, registering
 * `tools/list` and `tools/call` handlers that forward upstream and tee
 * each interaction as a JSONL row to the supplied write callback.
 *
 * Pulled out of `runProxy` so tests can drive the bridge in-process with
 * `InMemoryTransport` instead of spawning a stdio child.
 */
export function bridgeProxy(
  server: Server,
  upstream: Client,
  caseId: string,
  writeRow: (obs: ProxyObservation) => void,
): void {
  server.setRequestHandler(ListToolsRequestSchema, async (req) => {
    const result = (await upstream.listTools(req.params)) as ListToolsResult;
    writeRow({
      caseId,
      type: "tools/list",
      timestamp: new Date().toISOString(),
      visibleTools: summariseToolsList(result),
    });
    return result;
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    let result: CallToolResult;
    try {
      result = (await upstream.callTool(req.params)) as CallToolResult;
    } catch (err) {
      result = {
        content: [
          {
            type: "text",
            text: `proxy upstream error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
    writeRow({
      caseId,
      type: "tools/call",
      timestamp: new Date().toISOString(),
      tool: name,
      args: args as Record<string, unknown> | undefined,
      isError: result.isError === true,
    });
    return result;
  });
}

/**
 * Bridge an MCP `Server` (over stdio) to an MCP `Client` (against the
 * upstream URL). For each `tools/list` and `tools/call` request from the
 * connected agent, we forward to upstream and tee the request/response to
 * `observed.jsonl` tagged with the per-case `caseId`.
 *
 * Returns a disposer that closes both ends and flushes the log stream.
 */
export async function runProxy(opts: ProxyOptions): Promise<() => Promise<void>> {
  await fs.mkdir(path.dirname(opts.logPath), { recursive: true });
  const logStream = createWriteStream(opts.logPath, { flags: "a" });

  const upstream = await connectUpstream(opts.upstreamUrl);

  const server = new Server(
    { name: "agent-catalog-eval-proxy", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  bridgeProxy(server, upstream, opts.caseId, (obs) => logObservation(logStream, obs));

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return async () => {
    await server.close();
    await upstream.close();
    await new Promise<void>((resolve) => logStream.end(resolve));
  };
}

/**
 * CLI entry for the hidden `__proxy` subcommand. OpenCode's `opencode.json`
 * registers this as an MCP server (stdio); each case spawns its own proxy
 * process with the case ID baked in via `--case-id`, so observations land
 * in the right per-case `observed.jsonl` without any session-correlation
 * dance over headers.
 *
 * Anything written to stdout corrupts the JSON-RPC stream — only stderr is
 * safe for diagnostics.
 */
export async function runProxyCli(argv: string[]): Promise<number> {
  let upstreamUrl: string | undefined;
  let caseId: string | undefined;
  let logPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--upstream" && next) {
      upstreamUrl = next;
      i++;
    } else if (a === "--case-id" && next) {
      caseId = next;
      i++;
    } else if (a === "--log" && next) {
      logPath = next;
      i++;
    }
  }
  if (!upstreamUrl || !caseId || !logPath) {
    process.stderr.write(
      "Usage: agent-catalog-eval __proxy --upstream <url> --case-id <id> --log <path>\n",
    );
    return 2;
  }

  let dispose: (() => Promise<void>) | undefined;
  try {
    dispose = await runProxy({ upstreamUrl, caseId, logPath });
  } catch (err) {
    process.stderr.write(
      `proxy startup failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  const shutdown = async () => {
    if (dispose) await dispose();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  return new Promise<number>(() => {
    /* keep the process alive until stdin closes or a signal arrives */
  });
}
