/**
 * Example PAID tool -- demonstrates MPP (Stripe machine payments) pricing.
 *
 * Same behavior as `echo`, but each call costs $0.50 via card/wallet (Stripe
 * Shared Payment Tokens) or $0.05 in USDC on Tempo. When the server has no
 * payment method configured, calls fail closed with an honest explanation.
 *
 * This is the pattern for monetizing any tool: add a `price` and the
 * payment gate in src/mcp/server.ts does the rest (challenge, verification,
 * charging, receipts). Replace or delete this example in real projects.
 */

import { z } from "zod";
import { registerMcpTool } from "@/mcp/registry.ts";

registerMcpTool({
  name: "premium_echo",
  description: "Echoes the input message back (paid demonstration tool).",
  inputSchema: {
    message: z.string().describe("The message to echo back"),
  },
  price: {
    fiatUsd: "0.50",
    cryptoUsd: "0.05",
    description: "premium_echo tool call",
  },
  handler: async (args) => {
    const message = String(args.message ?? "");
    return {
      content: [{ type: "text", text: `[paid] ${message}` }],
    };
  },
});
