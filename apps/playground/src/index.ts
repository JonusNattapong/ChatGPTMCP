import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { builtinCapabilities, type CapabilityDescriptor } from "@chatgpt-pilot/core";
import { createMcpServer } from "@chatgpt-pilot/mcp-server";

async function runPlayground(): Promise<void> {
  console.log("=== ChatGPT Pilot Playground ===");
  console.log(`Core capabilities registered: ${builtinCapabilities.length}`);
  builtinCapabilities.forEach((cap: CapabilityDescriptor) => {
    console.log(` - [${cap.risk.toUpperCase()}] ${cap.name}: ${cap.description}`);
  });

  console.log("\nStarting in-memory MCP Server & Client...");
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);

  const client = new Client({
    name: "chatgpt-pilot-playground",
    version: "1.0.0",
  });
  await client.connect(clientTransport);

  console.log("Connected! Discovering tools...");
  const { tools } = await client.listTools();
  console.log(`Discovered ${tools.length} tool(s):`);
  tools.forEach((tool) => {
    console.log(` - ${tool.name}: ${tool.description}`);
  });

  console.log("\nInvoking 'system_ping' tool...");
  const pingResult = await client.callTool({
    name: "system_ping",
    arguments: {},
  });

  console.log("Result:", JSON.stringify(pingResult, null, 2));

  await client.close();
  await server.close();
  console.log("\nPlayground run completed successfully.");
}

runPlayground().catch((err: unknown) => {
  console.error("Playground execution failed:", err);
  process.exit(1);
});
