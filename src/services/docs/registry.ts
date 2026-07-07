/**
 * In-app docs registry — the source of truth for the `/docs` section.
 *
 * Each page's `body` is a LIVE READ of a markdown file under `docs/**`
 * (NOT a hand-maintained copy), loaded synchronously at module load so a
 * missing file fails loudly at boot instead of silently serving an empty
 * page. Keeping the body a live read of `docs/**` means the same markdown
 * powers this section, the search index, AND your project's AI agent —
 * one source of truth.
 *
 * To add a page: drop a `.md` file under `docs/in-app/` (or anywhere in
 * `docs/`) and add an entry below. The search indexer
 * (src/services/docs/reindex.ts) picks it up on the next boot.
 */

export interface DocPage {
  /** URL-safe id; also the search-result link target (`#/docs/<slug>`). */
  slug: string;
  /** Page title shown in the TOC and as the article heading. */
  title: string;
  /** TOC group header. Pages are grouped by this in registry order. */
  group: string;
  /** One-line description shown under the title in the TOC. */
  summary: string;
  /** Markdown body — a live read of a `docs/**` file. */
  body: string;
  /**
   * When true, the PUBLIC server-rendered HTML surface at `/docs`
   * (src/api/routes/docs-html/) responds with a uniform 404 for this page
   * unless the request carries a valid session. Defaults to false (public
   * on the HTML surface). The JSON API at `/api/docs` is unaffected -- it
   * requires auth for EVERY page regardless of this flag.
   */
  requiresAuth?: boolean;
}

/**
 * Read a markdown file from the repo root. This module lives at
 * `src/services/docs/`, so `../../../` reaches the repo root. Synchronous
 * so a missing file throws at module-load (fail loud, not silent).
 */
function loadDoc(relPath: string): string {
  return Deno.readTextFileSync(new URL(`../../../${relPath}`, import.meta.url));
}

export const DOCS_PAGES: DocPage[] = [
  {
    slug: "connect-mcp",
    title: "Connect an MCP client",
    group: "Connect",
    summary: "Endpoint URL, authentication, and setup snippets for Claude Code, Claude Desktop, and Cursor.",
    body: loadDoc("docs/in-app/connect-mcp.md"),
    requiresAuth: false, // connection instructions are for external users of the deployed server
  },
  {
    slug: "welcome",
    title: "Welcome to your in-app docs",
    group: "Getting started",
    summary: "What the docs section is and how it works.",
    body: loadDoc("docs/in-app/welcome.md"),
    // Internal team doc (describes the docs infrastructure itself) -- keep
    // it off the public HTML surface; visible there only with a session.
    requiresAuth: true,
  },
  {
    slug: "searching-docs",
    title: "Searching the docs",
    group: "Getting started",
    summary: "Semantic search, what gets indexed, and auto-reindexing.",
    body: loadDoc("docs/in-app/searching-docs.md"),
    requiresAuth: true,
  },
  {
    slug: "mcp-server",
    title: "MCP server design record",
    group: "Reference",
    summary: "How the MCP server at /api/mcp is built: transport, Origin guard, auth, monetized tools.",
    body: loadDoc("docs/mcp-server.md"),
    // Internal design record (file paths, env vars, implementation notes).
    requiresAuth: true,
  },
];

/** Find a single page by slug, or `undefined` if no such page exists. */
export function findDoc(slug: string): DocPage | undefined {
  return DOCS_PAGES.find((p) => p.slug === slug);
}
