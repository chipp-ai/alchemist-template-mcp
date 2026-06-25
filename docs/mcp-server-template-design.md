# MCP-Server Starter Template — Design Record

Ticket: ALCHEM3-2 "Shape + document the repo as the MCP-server starter template"

## What was built

`chipp-ai/alchemist-template-mcp` was derived from the full-stack
`chipp-ai/alchemist-template` and reshaped as the Alchemist MCP-server starter.
Selected by `create_project(template_key='mcp-server')`.

**Deliverable:** a repo that reads clearly as an MCP-server starter, with
documentation describing:
- What the template is and how `create_project` uses it.
- Where `/api/mcp` lives and how it works (Streamable HTTP transport).
- How to add a new tool to the registry.
- The Deno 2 / Hono 4 / bare-specifier / MCP SDK conventions.

The actual MCP server implementation (SDK wiring, registry, first example tool)
is a separate ticket (`mcpserver`). This ticket owns repo shape + docs only.

## Key decisions

### Web posture: `web/` removed entirely

The Svelte SPA that existed in the base template was **removed**, not kept as a
minimal landing page. Rationale: keeping even a trivial landing page would have
preserved Vite, a two-stage Dockerfile web-builder, `npm install` in setup, and
source-shape tests that read `web/` — all irrelevant to an MCP-server starter
and likely to confuse a generated project that tries to extend it.

**Rejected alternative:** keep a minimal static landing page. Rejected because
the MCP server is the product; a landing page adds noise without value and
leaves behind dependencies that are wrong for the use case.

### Backend retained as optional capabilities

Auth, RBAC, billing, storage, observability, and dev routes were kept. A
generated MCP server may need to authenticate tool callers, bill for usage, or
store context — the scaffolding is available but not forced. Everything in
`src/api/routes/` except `/api/mcp` is optional scaffolding.

### `APP_URL` replaces `WEB_APP_URL`

`WEB_APP_URL` was the base URL used for OAuth callbacks and Stripe return URLs
in the full-stack template (pointing at the Vite SPA port). After removing the
SPA, the env var was renamed to `APP_URL` (pointing at the API port, default
`http://localhost:8000`). Set `APP_URL` to the deployed origin in production.

### SDK specifier deferred to `mcpserver` ticket

The `@modelcontextprotocol/sdk` bare-specifier entries in `deno.json` are not
added here — that's the companion `mcpserver` ticket's responsibility. Adding
them here would cause a merge conflict at integration. The convention is fully
documented in CLAUDE.md; the specifier just isn't wired yet.

### `test:fast` repointed to `src/__tests__/services/`

The base template's `test:fast` pointed at `src/__tests__/routes/` — a directory
that never existed in this fork (routes tests were present only in the full-stack
template). The task was repointed to `src/__tests__/services/` for the service
unit-test suite.

## Public contract

| Surface | Shape |
|---|---|
| MCP endpoint | `POST /api/mcp` (and `GET /api/mcp` for handshake) |
| Transport | `StreamableHTTPServerTransport` (Streamable HTTP) |
| Registry | `src/mcp/registry.ts` aggregates tools |
| Tools | `src/mcp/tools/<name>.ts` — exported `register*` function |
| SDK import | Bare specifier in `deno.json` (never inline `npm:`) |
| Base URL env | `APP_URL` (default `http://localhost:8000`) |
| Dev-routes guard | `ALCHEMIST_DEV_ROUTES` env var (fail-closed) |

## Non-obvious gotchas

- **Dev-routes tests must set `ALCHEMIST_DEV_ROUTES=1`** — the guard is
  fail-closed on that specific env var, not on `NODE_ENV`. Tests must opt in
  and restore with `try/finally`.
- **Do NOT pre-parse the request body before passing to the MCP transport** —
  `StreamableHTTPServerTransport` reads the body stream itself; reading it first
  causes a "body already consumed" error.
- **Bare specifiers only** — `deno lint` `no-import-prefix` fails CI for inline
  `npm:`, `jsr:`, or `https:` imports in source files. Declare in `deno.json`.
