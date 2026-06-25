/**
 * MCP Server Factory
 *
 * Creates fresh McpServer instances for the stateless HTTP transport.
 * Each request gets its own server + transport (no session state).
 *
 * Side-effect import of "./tools/echo.ts" ensures the example tool is
 * registered into the default registry before any server is created.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registry } from "@/mcp/registry.ts";

// Ensure the example echo tool (and any future tools) are registered.
import "@/mcp/tools/echo.ts";

/**
 * Create a fresh McpServer with all registered tools applied.
 * Call this per-request for stateless mode.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "alchemist-template-mcp",
    version: "1.0.0",
  });

  registry.applyTo(server);
  return server;
}
