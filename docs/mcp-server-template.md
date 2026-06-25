# MCP-Server Template — Design Record

## What was built

The Alchemist MCP-server template (`template_key='mcp-server'`) is a
headless Deno 2 + Hono 4 backend whose primary surface is an MCP
(Model Context Protocol) server mounted at `/api/mcp`. It ships with:

- A tool registry at `src/mcp/` — a central file that collects
  every `registerTool()` call and hands the populated `McpServer`
  to the route handler.
- An example tool under `src/mcp/tools/hello.ts` that agents can
  clone as a starting pattern.
- The full Alchemist auth/billing/RBAC/services skeleton, so the
  generated project is production-ready from day one.
- A `CLAUDE.md` and `README.md` authored for the headless surface
  (no Svelte SPA, no Vite, no DevPanel).

The Svelte SPA (`web/`) was stripped at commit d777b9c. Any future
ticket that re-adds a UI layer should start from the `web-app`
template instead.

## Key design decisions

### 1. `inputSchema` is a raw `ZodRawShape`, not `z.object({...})`

`@modelcontextprotocol/sdk` v1.x (the version imported via the
`@modelcontextprotocol/sdk` bare specifier) expects `inputSchema` to
be a plain object of field → Zod validators (`ZodRawShape`):

```ts
// Correct — raw shape
inputSchema: { name: z.string().min(1) }

// Wrong — wrapped form (V2 split-package idiom; type-errors under strict)
inputSchema: z.object({ name: z.string().min(1) })
```

Most LLM training data and the v2 docs show the wrapped form. This
template explicitly documents the raw shape and gates it behind a
`Common Pitfalls` bullet in `CLAUDE.md` and an inline comment in
every recipe. Any upgrade to the v2 split-package SDK will require
updating all four recipe occurrences.

### 2. Bare specifiers via `deno.json` — no inline `npm:` or `https:` prefixes

All imports use bare specifiers mapped in `deno.json`. `deno lint`
enforces `no-import-prefix` and CI will red on any `npm:/jsr:/https:`
prefix in source. Add new packages by adding an entry to the
`"imports"` map in `deno.json`, not by inlining the specifier.

### 3. `devRoutesEnabled()` — fail-closed, positive opt-in

The dev surface (`/api/dev/*`) is guarded by `devRoutesEnabled()`
from `src/lib/dev-mode.ts`, which checks `ALCHEMIST_DEV_ROUTES=1|true`.
The guard is **fail-closed**: routes self-404 unless the env var is
explicitly set. `deno task dev` sets it; deployed pods never do.

This replaced an older `NODE_ENV !== "production"` check which was
fail-open: any pod without `NODE_ENV=production` in its env (e.g. a
misconfigured staging pod) would expose the auth-bypass routes. The
positive opt-in is safer. **Do NOT revert to NODE_ENV gating.**

### 4. `hasWebDir()` guards SPA-specific test lints

Tests that assert on Svelte/Vite source conventions (e.g. "does
`web/src/stores/*.svelte.ts` use `defineStore`?") are gated behind
`hasWebDir()` from `src/__tests__/helpers.ts`. On the headless MCP
template, `web/` does not exist, so `hasWebDir()` returns `false` and
those lints no-op. If a future ticket adds a UI, the same tests will
automatically re-engage without any code change.

## Public contract / interface

- `POST /api/mcp` — MCP JSON-RPC (`InitializeRequest`, tool calls).
- `GET /api/mcp` — SSE stream (when session-aware transport is used).
- `DELETE /api/mcp` — session teardown.
- Transport: `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`.
- Tool registry: `src/mcp/index.ts` — call `registerAllTools(server)`.
- Add a tool: create `src/mcp/tools/<name>.ts` with `registerXxxTool(server)`,
  then call it from `src/mcp/index.ts`.

## Non-obvious gotchas

- **The observability JSONL writer is gated on `NODE_ENV`**, not
  `ALCHEMIST_DEV_ROUTES`. They're two different gating axes: dev routes
  (auth-bypass) are opt-in via `ALCHEMIST_DEV_ROUTES`; observability
  (disk writes) is opt-out via `NODE_ENV=production`. Don't confuse them.
- **No SPA means no client-side breadcrumbs** in the observability stream.
  Only `source: "server"` events are written. `jq 'select(.source=="client")'`
  will always return empty in this template.
- **`createIsolatedUser()` is required in all tests** — shared singletons
  cause FK violations when tests run in parallel.
