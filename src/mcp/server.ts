/**
 * MCP Server Factory
 *
 * Creates an McpServer wired to our tool registry. Tools are registered
 * by importing their modules (side-effect registration) before calling
 * createMcpServer().
 *
 * PAID TOOLS (MPP / Stripe machine payments): a tool registered with a
 * `price` is wrapped in a payment gate. Unpaid calls return an isError tool
 * result carrying signed payment challenges in
 * `_meta["org.paymentauth/payment-required"]`; an
 * MPP-capable agent pays (Stripe SPT fiat or USDC on Tempo) and retries the
 * same call with the credential in `_meta["org.paymentauth/credential"]`.
 * Verified calls run the handler and the result carries a receipt in
 * `_meta["org.paymentauth/receipt"]`. Non-paying clients see a normal tool
 * error explaining how to pay -- never an opaque failure.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listMcpTools } from "@/mcp/registry.ts";
import {
  formatToolPrice,
  gatePaidToolCall,
  mppEnabled,
  paymentRequiredToolResult,
} from "@/services/mpp.service.ts";
import { log } from "@/lib/logger.ts";

// Ensure example tools are registered (side-effect import)
import "@/mcp/tools/echo.ts";
import "@/mcp/tools/premium_echo.ts";

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

    // Paid tools advertise their price in the description so agents (and
    // their humans) can discover the cost BEFORE calling.
    const description = tool.price
      ? `${tool.description} [PAID TOOL: ${formatToolPrice(tool.price)} per call via MPP ` +
        `(machine payments, https://mpp.dev). Calls without payment receive challenges in ` +
        `_meta["org.paymentauth/payment-required"]; pay and retry with the credential in ` +
        `_meta["org.paymentauth/credential"].]`
      : tool.description;

    server.registerTool(
      tool.name,
      {
        description,
        inputSchema,
      },
      async (args: Record<string, unknown>, extra: unknown) => {
        if (!tool.price) {
          return await tool.handler(args);
        }

        // ── Payment gate for priced tools ──
        if (!mppEnabled()) {
          // Fail closed, but as a NORMAL tool result with honest wording so
          // the calling agent relays the real situation instead of retrying
          // or confabulating.
          return {
            isError: true,
            content: [{
              type: "text" as const,
              text:
                `"${tool.name}" is a paid tool, but this server has no payment method ` +
                "configured yet, so the call cannot proceed. Do NOT retry. Tell the user " +
                "the server operator needs to configure MPP payments (MPP_SECRET_KEY + " +
                "Stripe credentials).",
            }],
          };
        }

        const gate = await gatePaidToolCall(
          tool.name,
          tool.price,
          (extra ?? {}) as { _meta?: Record<string, unknown> },
        );

        if (gate.kind === "unconfigured") {
          return {
            isError: true,
            content: [{ type: "text" as const, text: gate.message }],
          };
        }
        if (gate.kind === "challenge") {
          // Tool RESULT carrying _meta["org.paymentauth/payment-required"] --
          // mppx MCP clients detect it and retry with payment; other clients
          // see the honest text. (A thrown McpError would be flattened by the
          // SDK and lose the challenges.)
          return paymentRequiredToolResult(tool.name, tool.price, gate.error);
        }

        const result = await tool.handler(args);
        log.info("Paid tool call completed", {
          source: "mcp",
          toolName: tool.name,
        });
        return gate.attachReceipt(result);
      },
    );
  }

  return server;
}
