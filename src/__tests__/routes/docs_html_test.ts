/**
 * /docs (server-rendered HTML docs) route tests.
 *
 * No DB required: the routes only touch the DB when a session cookie is
 * present (optional authMiddleware), and every request here is anonymous.
 *
 *   - index 200 + group titles + page links + live tool names
 *   - /docs/tools 200 + at least one REAL registered tool (echo)
 *   - /docs/:slug 200 + rendered heading
 *   - unknown slug 404
 *   - requiresAuth page 404s for anonymous requests (uniform with unknown)
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { withTestServer } from "../helpers.ts";
import { docsHtmlRoutes } from "@/api/routes/docs-html/index.ts";
import { app as realApp } from "../../../app.ts";

function deno(name: string, fn: () => void | Promise<void>) {
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });
}

function makeApp() {
  return withTestServer((a) => {
    a.route("/docs", docsHtmlRoutes);
  });
}

deno("docs-html: index renders groups, page links, and live tool names", async () => {
  const app = makeApp();
  const res = await app.request("/docs");
  assertEquals(res.status, 200);
  assertStringIncludes(res.headers.get("content-type") ?? "", "text/html");
  const html = await res.text();
  // Public group + page from the registry.
  assertStringIncludes(html, "Connect");
  assertStringIncludes(html, "Connect an MCP client");
  assertStringIncludes(html, `href="/docs/connect-mcp"`);
  // The live tool list (sourced from the same registry /api/mcp serves).
  assertStringIncludes(html, "Tool reference");
  assertStringIncludes(html, "echo");
  // Footer branding.
  assertStringIncludes(html, "Powered by");
});

deno("docs-html: index hides requiresAuth pages from anonymous visitors", async () => {
  const app = makeApp();
  const html = await (await app.request("/docs")).text();
  // "mcp-server" is registered requiresAuth: true.
  assertEquals(html.includes(`href="/docs/mcp-server"`), false);
});

deno("docs-html: /docs/tools lists real registered tools with params", async () => {
  const app = makeApp();
  const res = await app.request("/docs/tools");
  assertEquals(res.status, 200);
  const html = await res.text();
  // `echo` is the template's built-in tool -- read from the LIVE registry,
  // not a hardcoded list, so this proves the page reflects registration.
  assertStringIncludes(html, "<code>echo</code>");
  assertStringIncludes(html, "Parameter");
});

deno("docs-html: /docs/:slug renders the page markdown", async () => {
  const app = makeApp();
  const res = await app.request("/docs/connect-mcp");
  assertEquals(res.status, 200);
  const html = await res.text();
  assertStringIncludes(html, "<h1>Connect an MCP client</h1>");
  // The markdown's fenced endpoint block made it through the renderer.
  assertStringIncludes(html, "/api/mcp");
});

deno("docs-html: unknown slug 404s", async () => {
  const app = makeApp();
  const res = await app.request("/docs/no-such-page");
  assertEquals(res.status, 404);
  assertStringIncludes(await res.text(), "Page not found");
});

deno("docs-html: requiresAuth page 404s unauthenticated, uniform with unknown", async () => {
  const app = makeApp();
  const gated = await app.request("/docs/mcp-server");
  assertEquals(gated.status, 404);
  const unknown = await app.request("/docs/no-such-page");
  const gatedBody = await gated.text();
  const unknownBody = await unknown.text();
  // Uniform 404: an attacker can't distinguish "gated" from "missing".
  assertEquals(gatedBody, unknownBody);
});

deno("docs-html: mounted on the real app at /docs", async () => {
  const res = await realApp.request("/docs");
  assertEquals(res.status, 200);
  assertStringIncludes(await res.text(), "Documentation");
});
