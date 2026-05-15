import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { bridgeProxy, type ProxyObservation } from "./route-proxy.js";

/**
 * Stand up a fake upstream MCP server in-process that exposes two tools and
 * always succeeds tool calls. Returns a connected client we can hand to
 * `bridgeProxy` as the upstream.
 */
async function makeUpstream(): Promise<Client> {
  const upstreamServer = new Server(
    { name: "fake-upstream", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  upstreamServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "csharp-ioc-refactor",
        description: "Refactor C# controllers to constructor injection",
        inputSchema: { type: "object" as const, properties: {} },
      },
      {
        name: "vite-migration",
        description: "Migrate webpack projects to Vite",
        inputSchema: { type: "object" as const, properties: {} },
      },
    ],
  }));
  upstreamServer.setRequestHandler(CallToolRequestSchema, async (req) => ({
    content: [{ type: "text", text: `called ${req.params.name}` }],
  }));

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "test-client", version: "0.0.0" },
    { capabilities: {} },
  );
  await Promise.all([upstreamServer.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/**
 * Build a proxy `Server`, link it to an in-memory `Client` (the "agent"),
 * and wire it to the upstream via `bridgeProxy`. Observations are pushed
 * into `observations` so the test can assert on them.
 */
async function makeProxiedClient(upstream: Client, caseId: string) {
  const proxyServer = new Server(
    { name: "proxy", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  const observations: ProxyObservation[] = [];
  bridgeProxy(proxyServer, upstream, caseId, (obs) => observations.push(obs));

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const agent = new Client(
    { name: "agent", version: "0.0.0" },
    { capabilities: {} },
  );
  await Promise.all([proxyServer.connect(serverTransport), agent.connect(clientTransport)]);

  return { agent, observations };
}

describe("bridgeProxy", () => {
  it("forwards tools/list and logs the visible tools with descriptions", async () => {
    const upstream = await makeUpstream();
    const { agent, observations } = await makeProxiedClient(upstream, "case-a");

    const list = await agent.listTools();
    expect(list.tools.map((t) => t.name)).toEqual(["csharp-ioc-refactor", "vite-migration"]);

    expect(observations).toHaveLength(1);
    const row = observations[0];
    expect(row?.type).toBe("tools/list");
    if (row?.type === "tools/list") {
      expect(row.caseId).toBe("case-a");
      expect(row.visibleTools).toEqual([
        {
          name: "csharp-ioc-refactor",
          description: "Refactor C# controllers to constructor injection",
        },
        { name: "vite-migration", description: "Migrate webpack projects to Vite" },
      ]);
    }

    await agent.close();
    await upstream.close();
  });

  it("forwards tools/call and logs the tool name + caseId", async () => {
    const upstream = await makeUpstream();
    const { agent, observations } = await makeProxiedClient(upstream, "case-b");

    const result = await agent.callTool({
      name: "csharp-ioc-refactor",
      arguments: { foo: "bar" },
    });
    expect(result.content).toEqual([{ type: "text", text: "called csharp-ioc-refactor" }]);

    expect(observations).toHaveLength(1);
    const row = observations[0];
    expect(row?.type).toBe("tools/call");
    if (row?.type === "tools/call") {
      expect(row.caseId).toBe("case-b");
      expect(row.tool).toBe("csharp-ioc-refactor");
      expect(row.args).toEqual({ foo: "bar" });
      expect(row.isError).toBe(false);
    }

    await agent.close();
    await upstream.close();
  });

  it("logs every tool call in invocation order", async () => {
    const upstream = await makeUpstream();
    const { agent, observations } = await makeProxiedClient(upstream, "case-c");

    await agent.callTool({ name: "vite-migration" });
    await agent.callTool({ name: "csharp-ioc-refactor" });

    const calls = observations.filter((o) => o.type === "tools/call");
    expect(calls.map((c) => (c.type === "tools/call" ? c.tool : ""))).toEqual([
      "vite-migration",
      "csharp-ioc-refactor",
    ]);

    await agent.close();
    await upstream.close();
  });
});
