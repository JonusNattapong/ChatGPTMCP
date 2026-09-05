import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "chatgpt-developer-plugin", version: "0.1.0" });

  server.tool(
    "system_ping",
    "Confirm that the plugin MCP server is reachable.",
    {},
    async () => ({ content: [{ type: "text" as const, text: "pong" }] }),
  );

  return server;
}
