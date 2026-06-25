/**
 * Example MCP tool: echo
 *
 * A minimal tool that demonstrates the registry + handler pattern.
 * Returns the input message verbatim so tests can assert deterministic behavior.
 */

import { z } from "zod";
import { registerTool, type McpTool } from "@/mcp/registry.ts";

export const echoTool: McpTool = {
  name: "echo",
  description: "Echo back the provided message",
  inputSchema: {
    message: z.string().describe("The text to echo back"),
  },
  handler: async (args: Record<string, unknown>) => {
    const message = (args.message as string) ?? "";
    return {
      content: [
        {
          type: "text",
          text: message,
        },
      ],
    };
  },
};

// Self-register on module load. server.ts imports this module as a side effect.
registerTool(echoTool);
