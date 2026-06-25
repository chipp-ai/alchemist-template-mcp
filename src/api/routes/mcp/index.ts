/**
 * MCP Server Routes
 *
 * Exposes a Model Context Protocol server over HTTP at /api/mcp.
 *
 * The transport is stateless: each request creates a fresh
 * WebStandardStreamableHTTPServerTransport + McpServer. This matches
 * the SDK's own Hono example and is the minimal correct posture for
 * a starter template.
 *
 * To add auth later, insert `mcpRoutes.use("*", requireAuth);` (or a
 * more targeted middleware) before the handler. This route is
 * intentionally unauthenticated in the starter so customers can
 * decide their own posture.
 *
 * POST   /api/mcp  — JSON-RPC requests (initialize, tools/list, tools/call)
 * GET    /api/mcp  — SSE stream open (for stateful/resumable clients)
 * DELETE /api/mcp  — session termination (stateful clients)
 */

import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/mcp/server.ts";

const mcpRoutes = new Hono();

// Capture the entire sub-path under the mount point (handles both "/api/mcp" and "/api/mcp/").
// The MCP transport reads the full request (method, headers, body) and decides how to respond.
mcpRoutes.all("*", async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createMcpServer();
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

export { mcpRoutes };
