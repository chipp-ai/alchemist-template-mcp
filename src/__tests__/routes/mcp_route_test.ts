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
import { app } from "../../../app.ts";

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

deno("mcp: real app mounts /api/mcp and /api/mcp/ (trailing slash), subpaths 404", async () => {
  // Exercises the REAL app from app.ts (full middleware stack), not the
  // stripped-down withTestServer mount the tests above use. Guards the
  // mount wiring: both the canonical path and its trailing-slash form must
  // reach the MCP server, while a subpath must NOT be swallowed by it.
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const initBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.1" },
    },
  });

  for (const path of ["/api/mcp", "/api/mcp/"]) {
    const res = await app.request(path, { method: "POST", headers, body: initBody });
    const text = await res.text();
    assertEquals(res.status, 200, `expected 200 for ${path}, got ${res.status}`);
    const match = text.match(/data:\s*(\{[\s\S]*\})/);
    assertExists(match, `expected an SSE data frame for ${path}`);
    const json = JSON.parse(match[1]) as Record<string, unknown>;
    const serverInfo = (json.result as Record<string, unknown>).serverInfo as Record<string, unknown>;
    assertEquals(serverInfo.name, "alchemist-mcp-server");
  }

  // A subpath under /api/mcp is not the MCP endpoint; it falls through to 404.
  const sub = await app.request("/api/mcp/foo", { method: "POST", headers, body: initBody });
  await sub.text();
  assertEquals(sub.status, 404, "subpaths under /api/mcp must not be routed to MCP");
});

deno("mcp: rejects a cross-site browser Origin (DNS rebinding / CSRF guard)", async () => {
  // A browser-issued cross-site request always carries an Origin header. With
  // no allowlist configured, the MCP endpoint must reject it (403) before the
  // transport runs, so a malicious web page in the victim's browser cannot
  // invoke MCP tools against this (unauthenticated) server.
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    origin: "https://evil.example.com",
  };
  const callBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "echo", arguments: { message: "attack" } },
  });

  const res = await app.request("/api/mcp", { method: "POST", headers, body: callBody });
  const text = await res.text();
  assertEquals(res.status, 403, "cross-site browser Origin must be rejected");
  const json = JSON.parse(text) as Record<string, unknown>;
  const error = json.error as Record<string, unknown> | undefined;
  assertExists(error, "expected a JSON-RPC error body");
  // The malicious echo payload must NOT round-trip — no tool ran.
  assertEquals(text.includes("attack"), false, "tool must not execute for a rejected origin");
});

deno("mcp: rejects an empty Origin header (present but blank, not the same as absent)", async () => {
  // An empty Origin value is a PRESENT header, not an absent one. The guard
  // must not confuse "Origin:" (blank) with a no-Origin Node client and wave
  // it through — that would defeat the stated "Origin present → allowlist only"
  // contract. With no allowlist configured, a blank Origin is rejected (403).
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  });
  headers.set("origin", "");
  const callBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "echo", arguments: { message: "attack" } },
  });

  const res = await app.request("/api/mcp", { method: "POST", headers, body: callBody });
  const text = await res.text();
  assertEquals(res.status, 403, "blank Origin must be rejected, not treated as absent");
  assertEquals(text.includes("attack"), false, "tool must not execute for a blank origin");
});

deno("mcp: no Origin header (real MCP client) is allowed through", async () => {
  // Non-browser MCP clients (Claude Desktop, IDE/CLI plugins, Inspector proxy)
  // send NO Origin header. The guard must let them through unchanged.
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const initBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.1" },
    },
  });

  const res = await app.request("/api/mcp", { method: "POST", headers, body: initBody });
  const text = await res.text();
  assertEquals(res.status, 200, "no-Origin client must reach the MCP server");
  const match = text.match(/data:\s*(\{[\s\S]*\})/);
  assertExists(match, "expected an SSE data frame");
  const json = JSON.parse(match[1]) as Record<string, unknown>;
  const serverInfo = (json.result as Record<string, unknown>).serverInfo as Record<string, unknown>;
  assertEquals(serverInfo.name, "alchemist-mcp-server");
});
