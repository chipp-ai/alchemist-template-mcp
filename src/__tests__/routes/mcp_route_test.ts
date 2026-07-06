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

// ── Auth modes (MCP_AUTH_MODE) ──────────────────────────────────────────────
//
// These tests MUTATE process env, and env is shared across parallel test
// workers -- every test here restores the previous value in `finally`, and
// every test that touches /api/mcp auth/payment env lives in THIS file so
// they serialize (tests within one file run sequentially).

import { createIsolatedUser } from "../helpers.ts";
import { apiKeyService } from "@/services/api-key.service.ts";

function withEnv(vars: Record<string, string>, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const previous = new Map<string, string | undefined>();
    for (const [k, v] of Object.entries(vars)) {
      previous.set(k, Deno.env.get(k));
      Deno.env.set(k, v);
    }
    try {
      await fn();
    } finally {
      for (const [k, old] of previous) {
        if (old === undefined) Deno.env.delete(k);
        else Deno.env.set(k, old);
      }
    }
  };
}

deno(
  "mcp auth: oauth mode without a token returns 401 with the RFC 9728 challenge",
  withEnv({ MCP_AUTH_MODE: "oauth" }, async () => {
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        host: "myapp.example.com",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    await res.text();
    assertEquals(res.status, 401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    // The challenge MUST point at the RFC 9728 PRM URL (NOT the RFC 8414 AS
    // URL) -- clients probe it as step 1 of MCP OAuth discovery.
    assertEquals(
      challenge.includes("resource_metadata="),
      true,
      `expected resource_metadata in WWW-Authenticate, got: ${challenge}`,
    );
    assertEquals(challenge.includes("/.well-known/oauth-protected-resource"), true);
  }),
);

deno(
  "mcp auth: oauth mode rejects a garbage bearer token",
  withEnv({ MCP_AUTH_MODE: "oauth" }, async () => {
    const res = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer mcp_at_definitely-not-real",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    await res.text();
    assertEquals(res.status, 401);
  }),
);

deno(
  "mcp auth: oauth mode accepts an API key (secondary method)",
  withEnv({ MCP_AUTH_MODE: "oauth" }, async () => {
    const { user, cleanup } = await createIsolatedUser("owner");
    try {
      const minted = await apiKeyService.mint({ userId: user.id, name: "test key" });
      const res = await app.request("/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${minted.key}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "echo", arguments: { message: "key hello" } },
        }),
      });
      const text = await res.text();
      assertEquals(res.status, 200);
      assertEquals(text.includes("key hello"), true);
    } finally {
      await cleanup();
    }
  }),
);

deno("mcp auth: public mode (default) still serves unauthenticated requests", async () => {
  // No env mutation -- asserts the default posture stays back-compatible.
  const res = await app.request("/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const text = await res.text();
  assertEquals(res.status, 200);
  assertEquals(text.includes("echo"), true);
});

// ── Paid tools (MPP / Stripe machine payments) ──────────────────────────────

const MPP_TEST_ENV = {
  MPP_SECRET_KEY: "dGVzdC1zZWNyZXQta2V5LXRlc3Qtc2VjcmV0LWtleS0xMg==",
  STRIPE_SECRET_KEY: "sk_test_dummy_for_challenge_generation",
  STRIPE_PROFILE_ID: "profile_test_dummy",
};

deno(
  "mcp paid tools: unpaid call returns challenges in _meta (payment-required), tool does NOT run",
  withEnv(MPP_TEST_ENV, async () => {
    // Challenge generation is fully offline -- no Stripe network call happens
    // until a client actually presents a payment credential.
    const { res, json } = await postJsonRpc(
      withTestServer((a) => {
        a.route("/api/mcp", mcpRoutes);
      }),
      "tools/call",
      { name: "premium_echo", arguments: { message: "pay me" } },
    );
    assertEquals(res.status, 200);
    assertExists(json);
    const result = (json as Record<string, unknown>).result as Record<string, unknown>;
    assertExists(result, "expected a tool RESULT (not a protocol error)");
    assertEquals(result.isError, true);

    // The paymentauth payment-required metadata carries signed challenges.
    const meta = result._meta as Record<string, unknown> | undefined;
    assertExists(meta, "expected _meta on the payment-required result");
    const paymentRequired = meta!["org.paymentauth/payment-required"] as
      | { challenges?: Array<Record<string, unknown>> }
      | undefined;
    assertExists(paymentRequired, "expected org.paymentauth/payment-required in _meta");
    const challenges = paymentRequired!.challenges ?? [];
    assertEquals(challenges.length > 0, true, "expected at least one payment challenge");
    assertEquals(challenges[0].method, "stripe");
    assertEquals(challenges[0].intent, "charge");

    // The tool body must NOT have run.
    const content = (result.content as Array<Record<string, unknown>>) ?? [];
    const text = String(content[0]?.text ?? "");
    assertEquals(text.includes("[paid] pay me"), false, "tool must not execute unpaid");
    assertEquals(text.includes("Payment required"), true);
  }),
);

deno(
  "mcp paid tools: description advertises the price",
  withEnv(MPP_TEST_ENV, async () => {
    const { json } = await postJsonRpc(
      withTestServer((a) => {
        a.route("/api/mcp", mcpRoutes);
      }),
      "tools/list",
    );
    const result = (json as Record<string, unknown>).result as Record<string, unknown>;
    const tools = (result.tools as Array<Record<string, unknown>>) ?? [];
    const premium = tools.find((t) => t.name === "premium_echo");
    assertExists(premium, "premium_echo must be listed");
    const description = String(premium!.description ?? "");
    assertEquals(description.includes("PAID TOOL"), true);
    assertEquals(description.includes("$0.50"), true);
  }),
);

deno("mcp paid tools: fail closed with honest wording when payments unconfigured", async () => {
  // Explicitly clear the MPP env for this test (restore after).
  const restore = new Map<string, string | undefined>();
  for (const k of Object.keys(MPP_TEST_ENV)) {
    restore.set(k, Deno.env.get(k));
    Deno.env.delete(k);
  }
  try {
    const { json } = await postJsonRpc(
      withTestServer((a) => {
        a.route("/api/mcp", mcpRoutes);
      }),
      "tools/call",
      { name: "premium_echo", arguments: { message: "pay me" } },
    );
    const result = (json as Record<string, unknown>).result as Record<string, unknown>;
    assertEquals(result.isError, true);
    const content = (result.content as Array<Record<string, unknown>>) ?? [];
    const text = String(content[0]?.text ?? "");
    assertEquals(text.includes("no payment method configured"), true);
    assertEquals(text.includes("Do NOT retry"), true);
  } finally {
    for (const [k, v] of restore) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
});

deno(
  "mcp paid tools: free tools stay free when MPP is configured",
  withEnv(MPP_TEST_ENV, async () => {
    const { res, json } = await postJsonRpc(
      withTestServer((a) => {
        a.route("/api/mcp", mcpRoutes);
      }),
      "tools/call",
      { name: "echo", arguments: { message: "still free" } },
    );
    assertEquals(res.status, 200);
    const result = (json as Record<string, unknown>).result as Record<string, unknown>;
    const content = (result.content as Array<Record<string, unknown>>) ?? [];
    assertEquals(content[0].text, "still free");
  }),
);

// ── Monetization gates: entitlements + credits (interactive-client lanes) ───
//
// These use Bearer identity (works in the default public mode too -- the
// middleware RESOLVES presented tokens even when not required), so no env
// mutation is needed. Test tools registered here use unique names; earlier
// tools/list assertions only check inclusion, so registry growth is safe.

import { z } from "zod";
import { registerMcpTool } from "@/mcp/registry.ts";
import { creditService } from "@/services/credit.service.ts";
import { recordProductPurchase } from "@/services/product.service.ts";
import { db } from "@/db/client.ts";

async function insertTestProduct(productKey: string, opts: {
  type?: "one_time" | "subscription";
  grantsCredits?: number | null;
} = {}): Promise<string> {
  const row = await db
    .insertInto("products")
    .values({
      productKey,
      name: `Test ${productKey}`,
      description: null,
      type: opts.type ?? "one_time",
      priceCents: 1900,
      currency: "usd",
      billingInterval: opts.type === "subscription" ? "month" : null,
      stripeProductId: null,
      stripePriceId: "price_test_gate",
      grantsCredits: opts.grantsCredits ?? null,
    })
    .returning(["id"])
    .executeTakeFirstOrThrow();
  return row.id;
}

async function deleteTestProduct(productId: string): Promise<void> {
  await db.deleteFrom("purchases").where("productId", "=", productId).execute();
  await db.deleteFrom("products").where("id", "=", productId).execute();
}

async function callToolAs(bearer: string | null, name: string, args: Record<string, unknown>) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await app.request("/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await res.text();
  const match = text.match(/data:\s*(\{[\s\S]*\})/);
  const json = match ? JSON.parse(match[1]) as Record<string, unknown> : null;
  return { res, json };
}

registerMcpTool({
  name: "gated_echo_test",
  description: "Entitlement-gated test tool.",
  inputSchema: { message: z.string() },
  requiredProductKey: "gate_test_product",
  handler: async (args) => ({
    content: [{ type: "text", text: `[gated] ${String(args.message)}` }],
  }),
});

registerMcpTool({
  name: "credit_echo_test",
  description: "Credit-priced test tool.",
  inputSchema: { message: z.string() },
  creditCost: 5,
  handler: async (args) => ({
    content: [{ type: "text", text: `[credit] ${String(args.message)}` }],
  }),
});

registerMcpTool({
  name: "credit_fail_test",
  description: "Credit-priced tool that always fails (refund path).",
  inputSchema: {},
  creditCost: 5,
  handler: () => {
    throw new Error("intentional test failure");
  },
});

deno("mcp gates: registry rejects price + creditCost on one tool", () => {
  let threw = false;
  try {
    registerMcpTool({
      name: "conflicting_lanes_test",
      description: "x",
      inputSchema: {},
      price: { fiatUsd: "0.50" },
      creditCost: 1,
      handler: async () => ({ content: [] }),
    });
  } catch {
    threw = true;
  }
  assertEquals(threw, true, "price + creditCost must be rejected at registration");
});

deno("mcp gates: entitlement tool blocks anonymous callers with connect guidance", async () => {
  const { json } = await callToolAs(null, "gated_echo_test", { message: "hi" });
  const result = (json as Record<string, unknown>).result as Record<string, unknown>;
  assertEquals(result.isError, true);
  const text = String((result.content as Array<Record<string, unknown>>)[0]?.text ?? "");
  assertEquals(text.includes("requires a signed-in account"), true);
  assertEquals(text.includes("[gated]"), false, "tool must not run");
});

deno("mcp gates: unentitled org is blocked; a purchase unlocks the tool", async () => {
  const { user, org, cleanup } = await createIsolatedUser("owner");
  const productId = await insertTestProduct("gate_test_product");
  try {
    const key = await apiKeyService.mint({ userId: user.id, name: "gate test" });

    // Unentitled -> blocked. Stripe is unconfigured in tests, so the funnel
    // degrades to the honest no-checkout-link message (never a crash).
    const blocked = await callToolAs(key.key, "gated_echo_test", { message: "locked" });
    const blockedResult = (blocked.json as Record<string, unknown>).result as Record<
      string,
      unknown
    >;
    assertEquals(blockedResult.isError, true);
    const blockedText = String(
      (blockedResult.content as Array<Record<string, unknown>>)[0]?.text ?? "",
    );
    assertEquals(blockedText.includes("[gated]"), false, "tool must not run unentitled");
    assertEquals(
      blockedText.includes("Purchase required") || blockedText.includes("checkout could not"),
      true,
      `expected purchase-funnel wording, got: ${blockedText}`,
    );

    // The webhook records a purchase -> the SAME call now succeeds.
    await recordProductPurchase({
      organizationId: org.id,
      productId,
      checkoutSessionId: `cs_gate_${org.id}`,
      amountCents: 1900,
    });
    const unlocked = await callToolAs(key.key, "gated_echo_test", { message: "open" });
    const unlockedResult = (unlocked.json as Record<string, unknown>).result as Record<
      string,
      unknown
    >;
    const unlockedText = String(
      (unlockedResult.content as Array<Record<string, unknown>>)[0]?.text ?? "",
    );
    assertEquals(unlockedText, "[gated] open");

    // tools/list advertises the requirement.
    const listRes = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    const listText = await listRes.text();
    assertEquals(listText.includes("REQUIRES PURCHASE"), true);
  } finally {
    await deleteTestProduct(productId);
    await cleanup();
  }
});

deno("mcp gates: credit tool debits per call, blocks at zero with top-up funnel", async () => {
  const { user, org, cleanup } = await createIsolatedUser("owner");
  const packId = await insertTestProduct(`credits_pack_${org.id}`, { grantsCredits: 100 });
  try {
    const key = await apiKeyService.mint({ userId: user.id, name: "credit test" });

    // Zero balance -> blocked with the top-up funnel (no Stripe in tests ->
    // degrades to the honest fallback line, never a crash).
    const broke = await callToolAs(key.key, "credit_echo_test", { message: "x" });
    const brokeResult = (broke.json as Record<string, unknown>).result as Record<string, unknown>;
    assertEquals(brokeResult.isError, true);
    const brokeText = String(
      (brokeResult.content as Array<Record<string, unknown>>)[0]?.text ?? "",
    );
    assertEquals(brokeText.includes("Insufficient credits"), true);
    assertEquals(brokeText.includes("[credit]"), false);

    // Grant 12 -> call succeeds (costs 5) -> balance 7.
    await creditService.grant({
      organizationId: org.id,
      amount: 12,
      reason: "test_grant",
      externalRef: `t:${org.id}:gate`,
    });
    const okCall = await callToolAs(key.key, "credit_echo_test", { message: "meter" });
    const okResult = (okCall.json as Record<string, unknown>).result as Record<string, unknown>;
    assertEquals(
      String((okResult.content as Array<Record<string, unknown>>)[0]?.text ?? ""),
      "[credit] meter",
    );
    assertEquals(await creditService.getBalance(org.id), 7n);

    // A failing tool run refunds the debit (charge -> run -> refund).
    const failCall = await callToolAs(key.key, "credit_fail_test", {});
    const failResult = (failCall.json as Record<string, unknown>).result as Record<
      string,
      unknown
    >;
    assertEquals(failResult.isError, true, "SDK surfaces the handler error as isError");
    assertEquals(
      await creditService.getBalance(org.id),
      7n,
      "failed run must refund the debit",
    );

    // Second success spends down to 2; a third (5 > 2) is blocked.
    await callToolAs(key.key, "credit_echo_test", { message: "again" });
    assertEquals(await creditService.getBalance(org.id), 2n);
    const blocked = await callToolAs(key.key, "credit_echo_test", { message: "nope" });
    const blockedResult = (blocked.json as Record<string, unknown>).result as Record<
      string,
      unknown
    >;
    assertEquals(blockedResult.isError, true);
  } finally {
    await deleteTestProduct(packId);
    await cleanup();
  }
});
