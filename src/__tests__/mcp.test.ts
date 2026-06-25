/**
 * MCP server integration tests.
 *
 * Exercises the real MCP JSON-RPC flow over HTTP using the SDK transport:
 *   initialize → tools/list → tools/call (echo)
 *
 * These tests prove:
 * - /api/mcp serves a working MCP server (handshake succeeds).
 * - The tool registry abstraction is wired and the echo tool is listed.
 * - The echo tool handler executes and returns the provided message.
 *
 * Stateless mode: each POST is independent (no Mcp-Session-Id).
 *
 * Note: The WebStandardStreamableHTTPServerTransport frames responses as
 * SSE (`event: message\ndata: <json>`). We parse the data line in tests.
 */

import { assertEquals, assertExists } from "@std/assert";
import { withTestServer } from "./helpers.ts";
import { mcpRoutes } from "@/api/routes/mcp/index.ts";

const app = withTestServer((hono) => {
  hono.route("/api/mcp", mcpRoutes);
});

/**
 * Helper to POST a JSON-RPC request and extract the JSON-RPC payload
 * from the SSE-framed response produced by the streamable HTTP transport.
 */
async function mcpRequest(body: unknown): Promise<{ status: number; data: unknown }> {
  const res = await app.request("/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  // Parse SSE: look for a line starting with "data: "
  let payload: unknown = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data: ")) {
      try {
        payload = JSON.parse(line.slice(6));
      } catch {
        // ignore malformed data lines
      }
      break;
    }
  }
  return { status: res.status, data: payload };
}

Deno.test("MCP: initialize handshake returns server info", async () => {
  const { status, data } = await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    },
  });

  assertEquals(status, 200);
  const rpc = data as { jsonrpc: string; id: number; result?: Record<string, unknown> };
  assertEquals(rpc.jsonrpc, "2.0");
  assertEquals(rpc.id, 1);
  assertExists(rpc.result);
  assertExists(rpc.result.serverInfo);
  assertEquals((rpc.result.serverInfo as { name: string }).name, "alchemist-template-mcp");
  assertExists(rpc.result.capabilities);
});

Deno.test("MCP: tools/list includes the echo tool", async () => {
  // First initialize (harmless in stateless mode).
  await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    },
  });

  const { status, data } = await mcpRequest({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  });

  assertEquals(status, 200);
  const rpc = data as { jsonrpc: string; id: number; result?: { tools?: Array<{ name: string; description?: string }> } };
  assertEquals(rpc.jsonrpc, "2.0");
  assertEquals(rpc.id, 2);
  assertExists(rpc.result);
  assertExists(rpc.result.tools);
  assertEquals(Array.isArray(rpc.result.tools), true);

  const echo = rpc.result.tools!.find((t) => t.name === "echo");
  assertExists(echo, "echo tool should be listed");
  assertEquals(echo.description, "Echo back the provided message");
});

Deno.test("MCP: tools/call echo returns the provided message", async () => {
  await mcpRequest({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" },
    },
  });

  const { status, data } = await mcpRequest({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "echo",
      arguments: { message: "hello from test" },
    },
  });

  assertEquals(status, 200);
  const rpc = data as {
    jsonrpc: string;
    id: number;
    result?: { content?: Array<{ type: string; text?: string }> };
  };
  assertEquals(rpc.jsonrpc, "2.0");
  assertEquals(rpc.id, 3);
  assertExists(rpc.result);
  assertExists(rpc.result.content);
  assertEquals(Array.isArray(rpc.result.content), true);
  assertEquals(rpc.result.content!.length, 1);
  assertEquals(rpc.result.content![0].type, "text");
  assertEquals(rpc.result.content![0].text, "hello from test");
});
