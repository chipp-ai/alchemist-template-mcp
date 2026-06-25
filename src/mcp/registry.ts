/**
 * MCP Tool Registry
 *
 * A minimal, explicit registry for MCP tools. Each tool declares:
 * - name (unique)
 * - description (shown to clients)
 * - inputSchema (plain object mapping argName -> Zod type)
 * - handler (receives validated args, returns MCP content blocks)
 *
 * This keeps tool definitions decoupled from the transport wiring and
 * makes it easy to enumerate / introspect available tools.
 */

import { z } from "zod";

export type ToolInputShape = Record<string, z.ZodTypeAny>;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: ToolInputShape;
  handler: (args: Record<string, unknown>) => Promise<{
    content: Array<{ type: "text"; text: string }>;
  }>;
}

const registeredTools: McpTool[] = [];

export function registerMcpTool(tool: McpTool): void {
  if (registeredTools.some((t) => t.name === tool.name)) {
    throw new Error(`MCP tool "${tool.name}" is already registered`);
  }
  registeredTools.push(tool);
}

export function listMcpTools(): McpTool[] {
  return [...registeredTools];
}

export function getMcpTool(name: string): McpTool | undefined {
  return registeredTools.find((t) => t.name === name);
}
