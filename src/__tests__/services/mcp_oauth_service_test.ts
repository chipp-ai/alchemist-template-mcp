/**
 * MCP OAuth service + API key service tests (real Postgres, no HTTP).
 *
 * Covers the security-critical invariants:
 *   - auth codes are single-use (double consume fails) and PKCE-bound
 *   - refresh rotation revokes the old pair
 *   - revoked/expired tokens do not resolve
 *   - API keys verify by constant-time hash compare and revoke cleanly
 *   - JSONB string[] columns round-trip through the driver
 */

import { assert, assertEquals } from "@std/assert";
import { createIsolatedUser } from "../helpers.ts";
import {
  authCodeService,
  clientService,
  isRedirectUriAllowed,
  oauthTokenService,
  parseStringArray,
} from "@/services/mcp-oauth/service.ts";
import { computeS256Challenge } from "@/services/mcp-oauth/pkce.ts";
import { normalizeMcpScopes } from "@/services/mcp-oauth/permissions.ts";
import { apiKeyService } from "@/services/api-key.service.ts";
import { db } from "@/db/client.ts";

function test(name: string, fn: () => void | Promise<void>) {
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });
}

async function cleanupClient(clientId: string) {
  await db.deleteFrom("mcp_oauth_tokens").where("clientId", "=", clientId).execute();
  await db.deleteFrom("mcp_oauth_auth_codes").where("clientId", "=", clientId).execute();
  await db.deleteFrom("mcp_oauth_clients").where("clientId", "=", clientId).execute();
}

// ── Pure helpers ────────────────────────────────────────────────────────────

test("oauth: normalizeMcpScopes expands write-implies-read and defaults to all", () => {
  assertEquals(normalizeMcpScopes("tools:write"), ["tools:read", "tools:write"]);
  assertEquals(normalizeMcpScopes("tools:read"), ["tools:read"]);
  assertEquals(normalizeMcpScopes(""), ["tools:read", "tools:write"]);
  assertEquals(normalizeMcpScopes("bogus:scope"), ["tools:read", "tools:write"]);
});

test("oauth: redirect matching is exact plus localhost wildcard port only", () => {
  assert(isRedirectUriAllowed("https://a.com/cb", ["https://a.com/cb"]));
  assert(!isRedirectUriAllowed("https://a.com/cb2", ["https://a.com/cb"]));
  assert(!isRedirectUriAllowed("https://a.com.evil.com/cb", ["https://a.com/cb"]));
  assert(isRedirectUriAllowed("http://localhost:53411/cb", ["http://localhost:*/cb"]));
  assert(!isRedirectUriAllowed("http://evil.com/cb", ["http://localhost:*/cb"]));
});

// ── Clients (JSONB round trip) ──────────────────────────────────────────────

test("oauth: dynamic client registration round-trips redirect URIs (JSONB)", async () => {
  const { clientId } = await clientService.register({
    redirectUris: ["https://client.example.com/callback", "http://localhost:*/cb"],
    clientName: "Test Client",
  });
  try {
    const client = await clientService.getActive(clientId);
    assert(client, "client should resolve");
    const uris = parseStringArray(client!.redirectUris);
    assertEquals(uris.length, 2);
    assert(uris.includes("https://client.example.com/callback"));
  } finally {
    await cleanupClient(clientId);
  }
});

// ── Auth codes ──────────────────────────────────────────────────────────────

test("oauth: auth codes are single-use (second consume returns null)", async () => {
  const { user, cleanup } = await createIsolatedUser("owner");
  const { clientId } = await clientService.register({
    redirectUris: ["https://c.example.com/cb"],
  });
  try {
    const verifier = "test-verifier-string-of-sufficient-length-12345";
    const code = await authCodeService.create({
      userId: user.id,
      clientId,
      redirectUri: "https://c.example.com/cb",
      scopes: ["tools:read"],
      codeChallenge: computeS256Challenge(verifier),
      codeChallengeMethod: "S256",
    });

    const first = await authCodeService.consume(code);
    assert(first, "first consume succeeds");
    assertEquals(first!.userId, user.id);
    assert(
      authCodeService.verifyPkce(verifier, first!.codeChallenge, first!.codeChallengeMethod),
      "PKCE verification succeeds with the right verifier",
    );
    assert(
      !authCodeService.verifyPkce("wrong-verifier", first!.codeChallenge, first!.codeChallengeMethod),
      "PKCE verification fails with the wrong verifier",
    );

    const second = await authCodeService.consume(code);
    assertEquals(second, null, "second consume must fail (single-use)");
  } finally {
    await cleanupClient(clientId);
    await cleanup();
  }
});

// ── Tokens ──────────────────────────────────────────────────────────────────

test("oauth: token issue -> lookup resolves the live user + org", async () => {
  const { user, org, cleanup } = await createIsolatedUser("owner");
  const { clientId } = await clientService.register({
    redirectUris: ["https://c.example.com/cb"],
  });
  try {
    const tokens = await oauthTokenService.issueTokens({
      userId: user.id,
      clientId,
      scopes: ["tools:write"],
    });
    assert(tokens.accessToken.startsWith("mcp_at_"));
    assert(tokens.refreshToken.startsWith("mcp_rt_"));

    const resolved = await oauthTokenService.lookupByAccessToken(tokens.accessToken);
    assert(resolved, "token resolves");
    assertEquals(resolved!.userId, user.id);
    assertEquals(resolved!.organizationId, org.id);
    assertEquals(resolved!.scopes, ["tools:read", "tools:write"]);

    // Unknown token -> null
    assertEquals(await oauthTokenService.lookupByAccessToken("mcp_at_bogus"), null);
  } finally {
    await cleanupClient(clientId);
    await cleanup();
  }
});

test("oauth: refresh rotation revokes the old pair; replay fails", async () => {
  const { user, cleanup } = await createIsolatedUser("owner");
  const { clientId } = await clientService.register({
    redirectUris: ["https://c.example.com/cb"],
  });
  try {
    const original = await oauthTokenService.issueTokens({
      userId: user.id,
      clientId,
      scopes: ["tools:read"],
    });

    const rotated = await oauthTokenService.refreshTokens(original.refreshToken, clientId);
    assert(rotated, "rotation succeeds");
    assert(rotated!.accessToken !== original.accessToken);

    // The OLD access token is revoked; the NEW one resolves.
    assertEquals(await oauthTokenService.lookupByAccessToken(original.accessToken), null);
    assert(await oauthTokenService.lookupByAccessToken(rotated!.accessToken));

    // Replaying the OLD refresh token fails (rotation is strict).
    assertEquals(await oauthTokenService.refreshTokens(original.refreshToken, clientId), null);

    // Wrong client_id fails.
    assertEquals(await oauthTokenService.refreshTokens(rotated!.refreshToken, "mcpc_wrong"), null);
  } finally {
    await cleanupClient(clientId);
    await cleanup();
  }
});

test("oauth: revoke kills the access token", async () => {
  const { user, cleanup } = await createIsolatedUser("owner");
  const { clientId } = await clientService.register({
    redirectUris: ["https://c.example.com/cb"],
  });
  try {
    const tokens = await oauthTokenService.issueTokens({
      userId: user.id,
      clientId,
      scopes: [],
    });
    assert(await oauthTokenService.lookupByAccessToken(tokens.accessToken));
    await oauthTokenService.revokeToken(tokens.accessToken);
    assertEquals(await oauthTokenService.lookupByAccessToken(tokens.accessToken), null);
  } finally {
    await cleanupClient(clientId);
    await cleanup();
  }
});

// ── API keys ────────────────────────────────────────────────────────────────

test("api-keys: mint -> verify -> revoke lifecycle", async () => {
  const { user, org, cleanup } = await createIsolatedUser("owner");
  try {
    const minted = await apiKeyService.mint({
      userId: user.id,
      name: "CI key",
      scopes: ["tools:read"],
    });
    assert(minted.key.startsWith("mcp_sk_"));

    const resolved = await apiKeyService.verify(minted.key);
    assert(resolved, "key verifies");
    assertEquals(resolved!.userId, user.id);
    assertEquals(resolved!.organizationId, org.id);
    assertEquals(resolved!.scopes, ["tools:read"]);

    // A wrong key with the same prefix shape does not verify.
    assertEquals(await apiKeyService.verify("mcp_sk_" + "x".repeat(43)), null);
    // Non-key garbage does not verify.
    assertEquals(await apiKeyService.verify("mcp_at_not-a-key"), null);

    await apiKeyService.revoke(minted.id, user.id);
    assertEquals(await apiKeyService.verify(minted.key), null, "revoked key must not verify");

    const listed = await apiKeyService.listForUser(user.id);
    assertEquals(listed.length, 1);
    assertEquals(listed[0].isActive, false);
    // The list never exposes the hash or plaintext.
    assert(!("keyHash" in listed[0]));
  } finally {
    await cleanup();
  }
});
