/**
 * MCP Tool Registry
 *
 * A thin abstraction over the MCP SDK's tool registration. Provides:
 * - A single place to enumerate all tools (canonical source of truth).
 * - An extension point: drop a new tool module under src/mcp/tools/ and
 *   register it here.
 * - Decouples tool definitions from the McpServer lifecycle.
 *
 * Tools are registered at module load time (side-effect import in server.ts).
 * The registry is idempotent: re-registering the same name is a no-op.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";

/**
 * Shape of a tool definition understood by our registry.
 * - `inputSchema` is a Zod *raw shape* (object of keys → schemas), NOT a z.object().
 *   This matches the MCP SDK's registerTool signature.
 */
export interface McpTool {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>;
}

/**
 * In-memory registry of MCP tools.
 * Order of registration is preserved for deterministic listing.
 */
export class ToolRegistry {
  private tools = new Map<string, McpTool>();

  /**
   * Register a tool. If a tool with the same name already exists, this is a no-op.
   */
  register(tool: McpTool): void {
    if (this.tools.has(tool.name)) {
      return;
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * List all registered tools in registration order.
   */
  list(): McpTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Apply all registered tools to an McpServer instance.
   * Called by createMcpServer() for each fresh server.
   */
  applyTo(server: McpServer): void {
    for (const tool of this.tools.values()) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        tool.handler,
      );
    }
  }

  /**
   * Reset the registry. Intended for tests only.
   */
  __resetForTests(): void {
    this.tools.clear();
  }
}

/** Singleton registry used by the application. */
export const registry = new ToolRegistry();

/**
 * Convenience to register a tool into the default singleton.
 * Import a tool module and it will self-register on load.
 */
export function registerTool(tool: McpTool): void {
  registry.register(tool);
}
