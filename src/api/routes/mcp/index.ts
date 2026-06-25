/**
 * MCP HTTP Route
 *
 * Serves a Model Context Protocol server over Streamable HTTP at /api/mcp.
 *
 * The transport is stateless (sessionIdGenerator: undefined) — a fresh
 * transport is created per request. This is the simplest model for a
 * starter and avoids sticky session concerns.
 *
 * Wire-up (in app.ts):
 *   import { mcpRoutes } from "@/api/routes/mcp/index.ts";
 *   app.route("/api/mcp", mcpRoutes);
 */

import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/mcp/server.ts";

const mcpRoutes = new Hono();

mcpRoutes.all("/", async (c) => {
  // Fresh server + transport per request (stateless mode)
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  // The SDK's WebStandard transport expects a raw Request and returns a Response
  const response = await transport.handleRequest(c.req.raw);
  return response;
});

export { mcpRoutes };
