/**
 * MCP Server Factory
 *
 * Creates an McpServer wired to our tool registry. Tools are registered
 * by importing their modules (side-effect registration) before calling
 * createMcpServer().
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listMcpTools } from "@/mcp/registry.ts";

// Ensure example tools are registered (side-effect import)
import "@/mcp/tools/echo.ts";

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "alchemist-mcp-server",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Register all tools from the registry
  for (const tool of listMcpTools()) {
    // Convert our plain shape to the SDK's expected input shape
    const inputSchema: Record<string, z.ZodTypeAny> = { ...tool.inputSchema };

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema,
      },
      async (args: Record<string, unknown>) => {
        // Delegate to our registry handler (already validated by SDK via Zod)
        return await tool.handler(args);
      },
    );
  }

  return server;
}
