/**
 * MCP OAuth 2.1 end-to-end flow tests (real app, real Postgres).
 *
 * Walks the exact sequence a remote MCP host performs:
 *   1. discovery      GET /.well-known/oauth-protected-resource + AS metadata
 *   2. registration   POST /api/mcp/oauth/register (RFC 7591 DCR)
 *   3. authorize      GET /api/mcp/oauth/authorize (login page when logged
 *                     out; consent page with a session cookie)
 *   4. consent        POST /api/mcp/oauth/authorize -> 302 with ?code=
 *   5. token          POST /api/mcp/oauth/token (PKCE) -> access + refresh
 *   6. use            POST /api/mcp with Authorization: Bearer mcp_at_...
 *
 * No environment mutation here -- a VALID token is accepted in both auth
 * modes, so these tests are parallel-safe against the mode-flipping tests
 * in mcp_route_test.ts (which serialize within that one file).
 */

import { assert, assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { app } from "../../../app.ts";
import { createIsolatedUser } from "../helpers.ts";
import { createSessionToken } from "@/api/middleware/auth.ts";
import { computeS256Challenge } from "@/services/mcp-oauth/pkce.ts";
import { db } from "@/db/client.ts";

function test(name: string, fn: () => void | Promise<void>) {
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });
}

const REDIRECT_URI = "https://client.example.com/callback";

async function cleanupClient(clientId: string) {
  await db.deleteFrom("mcp_oauth_tokens").where("clientId", "=", clientId).execute();
  await db.deleteFrom("mcp_oauth_auth_codes").where("clientId", "=", clientId).execute();
  await db.deleteFrom("mcp_oauth_clients").where("clientId", "=", clientId).execute();
}

async function registerClient(): Promise<string> {
  const res = await app.request("/api/mcp/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI], client_name: "Flow Test Client" }),
  });
  assertEquals(res.status, 201);
  const body = await res.json();
  assert(String(body.client_id).startsWith("mcpc_"));
  assertEquals(body.token_endpoint_auth_method, "none");
  return body.client_id as string;
}

test("well-known: discovery documents carry a request-derived issuer", async () => {
  for (
    const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/api/mcp",
    ]
  ) {
    const res = await app.request(path, {
      headers: { "x-forwarded-host": "myapp.example.com", "x-forwarded-proto": "https" },
    });
    assertEquals(res.status, 200, `expected 200 for ${path}`);
    const doc = await res.json();
    assertEquals(doc.resource, "https://myapp.example.com/api/mcp");
    assertEquals(doc.authorization_servers, ["https://myapp.example.com"]);
  }

  const as = await app.request("/.well-known/oauth-authorization-server", {
    headers: { "x-forwarded-host": "myapp.example.com", "x-forwarded-proto": "https" },
  });
  assertEquals(as.status, 200);
  const doc = await as.json();
  // RFC 8414 section 2: issuer MUST match the URL the doc was fetched from.
  assertEquals(doc.issuer, "https://myapp.example.com");
  assertEquals(doc.authorization_endpoint, "https://myapp.example.com/api/mcp/oauth/authorize");
  assertEquals(doc.code_challenge_methods_supported, ["S256"]);
});

test("oauth flow: authorize renders the OTP login page when logged out", async () => {
  const clientId = await registerClient();
  try {
    const url = `/api/mcp/oauth/authorize?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code&code_challenge=${computeS256Challenge("v")}` +
      `&code_challenge_method=S256`;
    const res = await app.request(url);
    assertEquals(res.status, 200);
    const html = await res.text();
    // Headless template: server-rendered email-OTP login, not a bounce.
    assertStringIncludes(html, "Sign in to continue");
    assertStringIncludes(html, "/api/auth/send-otp");
    assertStringIncludes(html, "/api/auth/verify-otp");
  } finally {
    await cleanupClient(clientId);
  }
});

test("oauth flow: register -> consent -> code -> token (PKCE) -> call /api/mcp", async () => {
  const { user, cleanup } = await createIsolatedUser("owner");
  const clientId = await registerClient();
  try {
    const sessionJwt = await createSessionToken({
      id: user.id,
      email: user.email,
      name: user.name,
      organizationId: user.organizationId,
      role: user.role,
    });
    const cookie = `session_id=${sessionJwt}`;

    // 3. Authorize (logged in) -> consent page.
    const verifier = "flow-test-verifier-0123456789-0123456789-0123456789";
    const challenge = computeS256Challenge(verifier);
    const authorizeUrl = `/api/mcp/oauth/authorize?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code&code_challenge=${challenge}&code_challenge_method=S256` +
      `&state=xyz&scope=tools:write`;
    const consentRes = await app.request(authorizeUrl, { headers: { cookie } });
    assertEquals(consentRes.status, 200);
    const consentHtml = await consentRes.text();
    assertStringIncludes(consentHtml, "Flow Test Client");
    assertStringIncludes(consentHtml, user.email);

    // 4. Approve -> 302 to redirect_uri with ?code=...&state=xyz
    const form = new URLSearchParams({
      action: "approve",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: "tools:write",
      state: "xyz",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const approveRes = await app.request("/api/mcp/oauth/authorize", {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    assertEquals(approveRes.status, 302);
    const location = approveRes.headers.get("location");
    assertExists(location);
    const redirect = new URL(location!);
    assertEquals(`${redirect.origin}${redirect.pathname}`, REDIRECT_URI);
    assertEquals(redirect.searchParams.get("state"), "xyz");
    const code = redirect.searchParams.get("code");
    assertExists(code);
    assert(code!.startsWith("mcp_ac_"));

    // 5. Token exchange with PKCE.
    const tokenRes = await app.request("/api/mcp/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    });
    assertEquals(tokenRes.status, 200);
    const tokens = await tokenRes.json();
    assert(String(tokens.access_token).startsWith("mcp_at_"));
    assert(String(tokens.refresh_token).startsWith("mcp_rt_"));
    assertEquals(tokens.token_type, "Bearer");
    assertStringIncludes(String(tokens.scope), "tools:write");

    // Replaying the code fails (single-use).
    const replayRes = await app.request("/api/mcp/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    });
    assertEquals(replayRes.status, 400);

    // 6. Use the access token on the MCP endpoint (accepted in any mode).
    const mcpRes = await app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${tokens.access_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo", arguments: { message: "authed hello" } },
      }),
    });
    const mcpText = await mcpRes.text();
    assertEquals(mcpRes.status, 200);
    assertStringIncludes(mcpText, "authed hello");
  } finally {
    await cleanupClient(clientId);
    await cleanup();
  }
});

test("oauth flow: deny redirects with error=access_denied and no code", async () => {
  const { user, cleanup } = await createIsolatedUser("owner");
  const clientId = await registerClient();
  try {
    const sessionJwt = await createSessionToken({
      id: user.id,
      email: user.email,
      name: user.name,
      organizationId: user.organizationId,
      role: user.role,
    });
    const form = new URLSearchParams({
      action: "deny",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: "",
      state: "s1",
      code_challenge: computeS256Challenge("v"),
      code_challenge_method: "S256",
    });
    const res = await app.request("/api/mcp/oauth/authorize", {
      method: "POST",
      headers: {
        cookie: `session_id=${sessionJwt}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    assertEquals(res.status, 302);
    const redirect = new URL(res.headers.get("location")!);
    assertEquals(redirect.searchParams.get("error"), "access_denied");
    assertEquals(redirect.searchParams.get("code"), null);
  } finally {
    await cleanupClient(clientId);
    await cleanup();
  }
});

test("oauth flow: unregistered redirect_uri is rejected before consent", async () => {
  const clientId = await registerClient();
  try {
    const url = `/api/mcp/oauth/authorize?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent("https://evil.example.com/steal")}` +
      `&response_type=code&code_challenge=${computeS256Challenge("v")}`;
    const res = await app.request(url);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "invalid_request");
  } finally {
    await cleanupClient(clientId);
  }
});

test("oauth flow: registration rejects non-HTTPS non-localhost redirect URIs", async () => {
  const res = await app.request("/api/mcp/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["http://evil.example.com/cb"] }),
  });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "invalid_client_metadata");
});
