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
import type { ToolPrice } from "@/services/mpp.service.ts";

export type ToolInputShape = Record<string, z.ZodTypeAny>;

export interface McpTool {
  name: string;
  description: string;
  inputSchema: ToolInputShape;
  /**
   * Optional MPP price -- makes this a PAID tool (Stripe machine payments).
   * Unpaid calls receive a JSON-RPC -32042 error carrying signed payment
   * challenges; MPP-capable agents pay and retry with the credential in
   * `_meta["org.paymentauth/credential"]`. See src/services/mpp.service.ts
   * and docs/mcp-server.md § "Paid tools".
   */
  price?: ToolPrice;
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
