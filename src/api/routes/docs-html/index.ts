/**
 * Human-viewable, server-rendered docs -- mounted at `/docs` (PUBLIC).
 *
 *   GET /docs         index: DOCS_PAGES grouped by `group`, plus the live
 *                     MCP tool list (same registry /api/mcp serves from).
 *   GET /docs/tools   dynamic tool reference: every REGISTERED MCP tool
 *                     (name, description, input params), enumerated at
 *                     request time via listMcpTools().
 *   GET /docs/:slug   one registry page, rendered to HTML.
 *
 * These are developer/connection docs for the DEPLOYED product, so there
 * is no session requirement -- EXCEPT pages whose registry entry sets
 * `requiresAuth: true`, which get a uniform 404 (indistinguishable from
 * "no such page") unless the request carries a valid session cookie. The
 * optional `authMiddleware` resolves the session when present and does
 * nothing (no DB work) when absent.
 *
 * Markdown is rendered EXCLUSIVELY via renderMarkdownToHtml
 * (src/services/docs/render-html.ts) -- the escape-first, allowlisted-link
 * security boundary. Never render docs markdown to HTML any other way.
 *
 * Routing note: plain `:slug` param only. Hono's RegExpRouter mis-handles
 * regex-with-suffix route patterns, so slug validation happens via the
 * in-memory registry lookup (unknown slug -> 404), not the route pattern.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import type { z } from "zod";
import { BRAND } from "@/config/brand.ts";
import { INSIGHTS_BEACON_SCRIPT_TAG } from "@/lib/insights-beacon.ts";
import { authMiddleware } from "@/api/middleware/auth.ts";
import { DOCS_PAGES, type DocPage, findDoc } from "@/services/docs/registry.ts";
import { escapeHtml, renderMarkdownToHtml } from "@/services/docs/render-html.ts";
import { listMcpTools } from "@/mcp/registry.ts";
// Side-effect import: server.ts is where every tool module is imported
// (side-effect registration). Importing IT -- rather than re-listing the
// tool modules here -- guarantees this page enumerates EXACTLY the tool
// set the /api/mcp handler serves (createMcpServer() reads the same
// registry), so the docs can never drift from the live server.
import "@/mcp/server.ts";

const docsHtmlRoutes = new Hono();

// Optional auth: resolves c.get("user") when a valid session cookie is
// present; public requests pass straight through with zero DB work.
docsHtmlRoutes.use("*", authMiddleware);

function hasSession(c: Context): boolean {
  return Boolean((c as unknown as { get: (k: string) => unknown }).get("user"));
}

// ── HTML shell ──

/** Env-sourced brand colors go into inline CSS -- validate the shape first. */
function cssColor(value: string, fallback: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}

function shell(title: string, content: string): string {
  const brandName = escapeHtml(BRAND.name);
  const primary = cssColor(BRAND.primaryColor, "#4f46e5");
  const neutral = cssColor(BRAND.neutralColor, "#1f2937");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} | ${brandName}</title>
<style>
  :root { --primary: ${primary}; --ink: ${neutral}; }
  * { box-sizing: border-box; }
  body { margin: 0; color: var(--ink); background: #fff;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  header { border-bottom: 1px solid #e5e7eb; }
  header .inner, main, footer .inner { max-width: 46rem; margin: 0 auto; padding: 0 1.25rem; }
  header .inner { display: flex; align-items: baseline; gap: 0.75rem; padding-top: 1rem; padding-bottom: 1rem; }
  header a { color: var(--ink); text-decoration: none; font-weight: 700; font-size: 1.05rem; }
  header .crumb { color: #6b7280; font-size: 0.9rem; }
  main { padding-top: 2rem; padding-bottom: 4rem; }
  h1 { font-size: 1.7rem; line-height: 1.25; margin: 0 0 1rem; }
  h2 { font-size: 1.25rem; margin: 2.25rem 0 0.75rem; }
  h3 { font-size: 1.05rem; margin: 1.75rem 0 0.5rem; }
  a { color: var(--primary); }
  p { margin: 0.75rem 0; }
  ul, ol { padding-left: 1.4rem; }
  li { margin: 0.3rem 0; }
  hr { border: 0; border-top: 1px solid #e5e7eb; margin: 2rem 0; }
  blockquote { margin: 1rem 0; padding: 0.1rem 1rem; border-left: 3px solid var(--primary);
    background: #f9fafb; color: #374151; }
  code { background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 4px;
    padding: 0.1em 0.35em; font-size: 0.875em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  pre { background: #111827; color: #f9fafb; border-radius: 8px; padding: 1rem;
    overflow-x: auto; margin: 1rem 0; }
  pre code { background: none; border: 0; padding: 0; color: inherit; font-size: 0.85rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.925rem; }
  th, td { border: 1px solid #e5e7eb; padding: 0.5rem 0.65rem; text-align: left; vertical-align: top; }
  th { background: #f9fafb; }
  .group { margin: 2rem 0 0; }
  .group h2 { margin-top: 0; color: #6b7280; font-size: 0.8rem; letter-spacing: 0.08em;
    text-transform: uppercase; }
  .toc-item { margin: 0.75rem 0 1.25rem; }
  .toc-item a { font-weight: 600; }
  .toc-item p { margin: 0.15rem 0 0; color: #4b5563; font-size: 0.925rem; }
  footer { border-top: 1px solid #e5e7eb; }
  footer .inner { padding-top: 1rem; padding-bottom: 1.5rem; color: #6b7280; font-size: 0.85rem; }
</style>
${INSIGHTS_BEACON_SCRIPT_TAG}
</head>
<body>
<header><div class="inner"><a href="/docs">${brandName}</a><span class="crumb">Documentation</span></div></header>
<main>
${content}
</main>
<footer><div class="inner">Powered by ${brandName}</div></footer>
</body>
</html>`;
}

/** Uniform HTML 404 -- used for unknown slugs AND auth-gated pages alike. */
function htmlNotFound(c: Context): Response {
  return c.html(
    shell("Not found", `<h1>Page not found</h1><p>No documentation page exists at this address. <a href="/docs">Back to the docs index</a>.</p>`),
    404,
  );
}

// ── MCP tool introspection ──

/** Human-readable name for a Zod schema ("string", "number", ...). */
function zodTypeName(t: z.ZodTypeAny): string {
  let cur: z.ZodTypeAny = t;
  // Unwrap optional/default/nullable wrappers to name the inner type.
  for (let depth = 0; depth < 5; depth++) {
    const def = cur._def as { typeName?: string; innerType?: z.ZodTypeAny };
    if (
      (def.typeName === "ZodOptional" || def.typeName === "ZodDefault" ||
        def.typeName === "ZodNullable") && def.innerType
    ) {
      cur = def.innerType;
      continue;
    }
    break;
  }
  const typeName = (cur._def as { typeName?: string }).typeName ?? "Zod";
  return typeName.replace(/^Zod/, "").toLowerCase();
}

function renderToolsHtml(): string {
  const tools = listMcpTools();
  const sections = tools.map((tool) => {
    const params = Object.entries(tool.inputSchema);
    const paramRows = params.length
      ? `<table><thead><tr><th>Parameter</th><th>Type</th><th>Description</th></tr></thead><tbody>${
        params
          .map(([name, schema]) => {
            const optional = schema.isOptional() ? " (optional)" : "";
            return `<tr><td><code>${escapeHtml(name)}</code></td><td>${
              escapeHtml(zodTypeName(schema) + optional)
            }</td><td>${escapeHtml(schema.description ?? "")}</td></tr>`;
          })
          .join("")
      }</tbody></table>`
      : `<p><em>No parameters.</em></p>`;
    const badges: string[] = [];
    if (tool.price) badges.push("paid per call (MPP)");
    if (tool.creditCost) badges.push(`costs ${tool.creditCost} credit${tool.creditCost === 1 ? "" : "s"} per call`);
    if (tool.requiredProductKey) badges.push(`requires the "${tool.requiredProductKey}" purchase`);
    const badgeHtml = badges.length ? `<p><em>${escapeHtml(badges.join("; "))}</em></p>` : "";
    return `<h2 id="${escapeHtml(tool.name)}"><code>${escapeHtml(tool.name)}</code></h2>
<p>${escapeHtml(tool.description)}</p>
${badgeHtml}
${paramRows}`;
  });

  return `<h1>Tool reference</h1>
<p>The ${tools.length} tool${tools.length === 1 ? "" : "s"} below ${
    tools.length === 1 ? "is" : "are"
  } what this MCP server registers right now -- this page reads the live tool registry
(the same one <code>/api/mcp</code> serves), so it can never drift from the server.
See <a href="/docs/connect-mcp">Connect an MCP client</a> for how to call them.</p>
${sections.join("\n")}`;
}

// ── Routes ──

// Index: registry pages grouped by `group` (registry order), then the
// live tool list. Auth-gated pages are hidden from the public index (they
// uniformly 404 anyway -- no dead links).
docsHtmlRoutes.get("/", (c) => {
  const authed = hasSession(c);
  const visible = DOCS_PAGES.filter((p) => !p.requiresAuth || authed);

  const groups: { group: string; pages: DocPage[] }[] = [];
  for (const p of visible) {
    let g = groups.find((x) => x.group === p.group);
    if (!g) {
      g = { group: p.group, pages: [] };
      groups.push(g);
    }
    g.pages.push(p);
  }

  const groupHtml = groups
    .map((g) =>
      `<section class="group"><h2>${escapeHtml(g.group)}</h2>${
        g.pages
          .map((p) =>
            `<div class="toc-item"><a href="/docs/${escapeHtml(p.slug)}">${escapeHtml(p.title)}</a><p>${
              escapeHtml(p.summary)
            }</p></div>`
          )
          .join("")
      }</section>`
    )
    .join("\n");

  // Live tool list on the index too (name + description, linking into the
  // full reference) -- enumerated at request time from the same registry.
  const tools = listMcpTools();
  const toolsHtml = `<section class="group"><h2>Tools</h2>
<div class="toc-item"><a href="/docs/tools">Tool reference</a><p>All ${tools.length} tool${
    tools.length === 1 ? "" : "s"
  } this server currently registers, with parameters.</p></div>
<ul>${
    tools
      .map((t) =>
        `<li><a href="/docs/tools#${escapeHtml(t.name)}"><code>${escapeHtml(t.name)}</code></a> -- ${
          escapeHtml(t.description)
        }</li>`
      )
      .join("")
  }</ul></section>`;

  return c.html(shell("Documentation", `<h1>Documentation</h1>\n${groupHtml}\n${toolsHtml}`));
});

// Dynamic tool reference. Registered BEFORE /:slug so a registry page
// can never shadow it (and vice versa the lookup below 404s "tools"
// cleanly if someone registers that slug -- don't).
docsHtmlRoutes.get("/tools", (c) => c.html(shell("Tool reference", renderToolsHtml())));

// One page. Unknown slug and auth-gated-without-session are the SAME 404.
docsHtmlRoutes.get("/:slug", (c) => {
  const page = findDoc(c.req.param("slug"));
  if (!page) return htmlNotFound(c);
  if (page.requiresAuth && !hasSession(c)) return htmlNotFound(c);
  const body = `<p><a href="/docs">&larr; All docs</a></p>\n${renderMarkdownToHtml(page.body)}`;
  return c.html(shell(page.title, body));
});

export { docsHtmlRoutes };
