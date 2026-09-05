import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./index.js";

describe("createMcpServer", () => {
  it("registers system_ping tool and responds with pong", async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);

    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(clientTransport);

    const toolList = await client.listTools();
    const pingTool = toolList.tools.find((t) => t.name === "system_ping");

    expect(pingTool).toBeDefined();
    expect(pingTool?.description).toContain("Confirm that the plugin MCP server is reachable");

    const result = await client.callTool({
      name: "system_ping",
      arguments: {},
    });

    expect(result).toEqual({
      content: [{ type: "text", text: "pong" }],
    });

    await client.close();
    await server.close();
  });
});
