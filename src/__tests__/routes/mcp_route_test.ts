/**
 * MCP Route Integration Tests
 *
 * Verifies that /api/mcp serves a working MCP server over Streamable HTTP:
 * - initialize handshake responds with server info
 * - tools/list advertises the registered tools (echo at minimum)
 * - tools/call executes a tool and returns its result
 *
 * These tests use withTestServer + app.request() (no real network, no DB).
 */

import { assertEquals, assertExists } from "@std/assert";
import { withTestServer } from "../helpers.ts";
import { mcpRoutes } from "@/api/routes/mcp/index.ts";

function deno(name: string, fn: () => void | Promise<void>) {
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });
}

const MCP_PATH = "/api/mcp";

async function postJsonRpc(app: ReturnType<typeof withTestServer>, method: string, params: Record<string, unknown> = {}) {
  const body = {
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 1e9),
    method,
    params,
  };
  // Streamable HTTP requires clients to advertise both JSON and SSE support.
  // See SDK: WebStandardStreamableHTTPServerTransport.handleRequest POST validation.
  const res = await app.request(MCP_PATH, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();

  // The WebStandard transport returns SSE envelopes: "event: message\ndata: {...}\n\n"
  // Extract the JSON from the first data: line for assertions.
  let json: unknown = null;
  const dataMatch = text.match(/data:\s*(\{[\s\S]*\})/);
  if (dataMatch) {
    try {
      json = JSON.parse(dataMatch[1]);
    } catch {
      json = null;
    }
  } else {
    // Fallback: try direct JSON (should not happen for this transport)
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return { res, text, json: json as Record<string, unknown> | null };
}

deno("mcp: POST initialize returns server info", async () => {
  const app = withTestServer((a) => {
    a.route("/api/mcp", mcpRoutes);
  });

  const { res, json } = await postJsonRpc(app, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.1" },
  });

  assertEquals(res.status, 200);
  assertExists(json);
  assertEquals(json.jsonrpc, "2.0");
  assertExists((json.result as Record<string, unknown>)?.serverInfo);
  const serverInfo = (json.result as Record<string, unknown>).serverInfo as Record<string, unknown>;
  assertEquals(serverInfo.name, "alchemist-mcp-server");
});

deno("mcp: tools/list advertises the echo tool", async () => {
  const app = withTestServer((a) => {
    a.route("/api/mcp", mcpRoutes);
  });

  // First initialize (some clients do this; our stateless impl tolerates it)
  await postJsonRpc(app, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.1" },
  });

  const { res, json } = await postJsonRpc(app, "tools/list");

  assertEquals(res.status, 200);
  assertExists(json);
  const result = (json as Record<string, unknown>).result as Record<string, unknown> | undefined;
  assertExists(result);
  const tools = (result.tools as Array<Record<string, unknown>>) ?? [];
  const names = tools.map((t) => String(t.name));
  assertEquals(names.includes("echo"), true, `expected "echo" in tools list, got ${names.join(", ")}`);
});

deno("mcp: tools/call echo returns the message", async () => {
  const app = withTestServer((a) => {
    a.route("/api/mcp", mcpRoutes);
  });

  const { res, json } = await postJsonRpc(app, "tools/call", {
    name: "echo",
    arguments: { message: "hello from test" },
  });

  assertEquals(res.status, 200);
  assertExists(json);
  const result = (json as Record<string, unknown>).result as Record<string, unknown> | undefined;
  assertExists(result);
  const content = (result.content as Array<Record<string, unknown>>) ?? [];
  assertEquals(content.length > 0, true);
  assertEquals(content[0].type, "text");
  assertEquals(content[0].text, "hello from test");
});
