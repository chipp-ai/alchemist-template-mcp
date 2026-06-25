> **⚠️ MCP-server template (headless).** Derived from `alchemist-template` with the Svelte SPA (`web/`) removed. Serves a **Deno + Hono** backend whose primary surface is an **MCP server at `/api/mcp`** (added in a follow-on), modeled on the platform's own MCP. Same stack otherwise (Deno 2 · TypeScript · Hono 4 · Kysely + postgres · zod · Arctic · Stripe · date-fns). Use the **web-app** template for a UI; the **api** template for a plain JSON API.

<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo-light.svg" alt="Alchemist Template" width="520">
  </picture>
  <p><strong>The Alchemist MCP-server starter template — a headless Deno + Hono backend exposing an MCP server at `/api/mcp`.</strong></p>
  <p>
    <a href="#quick-start">Quick Start</a> &#8226;
    <a href="#whats-in-the-box">What's in the Box</a> &#8226;
    <a href="#architecture">Architecture</a> &#8226;
    <a href="#mcp-server-at-apimcp">MCP Server</a> &#8226;
    <a href="#customizing-for-your-product">Customizing</a> &#8226;
    <a href="#working-with-ai-agents">Agents</a> &#8226;
    <a href="#license">License</a>
  </p>
</div>

---

This is the **Alchemist MCP-server starter template**: a headless Deno 2 + Hono 4 backend whose primary surface is a **Model Context Protocol server at `/api/mcp`**. It is selected by Alchemist Cloud's `create_project(template_key='mcp-server')` and ships with a working tool registry plus an example `echo` tool, so generated projects start from a functioning, extensible MCP server.

It ships with auth, billing, RBAC, structured logging, and an idiomatic Kysely + services layout, plus a `CLAUDE.md` authored so AI agents (Claude Code, Cursor, or the [Alchemist AI](https://adaas.dev) platform itself) can navigate and extend it without fighting the conventions. Fork it as the starting point for any new MCP-powered product.

It is also the seed repo every customer project on the [Alchemist AI](https://adaas.dev) platform is cloned from when `template_key='mcp-server'`. The conventions here are the ones autonomous agents are trained against -- using this template means agents work with you, not around you.

## What's in the box

- **MCP server** -- Model Context Protocol endpoint at `/api/mcp`, built on `@modelcontextprotocol/sdk` (bare specifier). Streamable HTTP transport, stateless per-request mode, a tool-registry abstraction, and an `echo` example tool. Add tools in `src/mcp/tools/`. See [`docs/mcp-server.md`](docs/mcp-server.md).
- **API** -- Deno 2 + Hono 4 with Zod request validation and typed error handling. No frontend is served — the MCP endpoint and the `/api/*` REST routes (auth, billing, files, etc.) are the entire surface.
- **Database** -- PostgreSQL via Kysely with `CamelCasePlugin` (camelCase in TS, snake_case in SQL). Migrations are plain SQL files in `db/migrations/`, auto-applied on startup.
- **Cache + sessions** -- Redis, with helpers for rate limits and key-scoped invalidation.
- **Auth** -- Email OTP login, session cookies, JWT for API tokens, OAuth providers via Arctic 2. Includes a documented dev-login escape hatch so local + agent testing works without an SMTP inbox.
- **Billing** -- Stripe 17. Subscriptions, credit grants, metered usage, customer portal.
- **Email** -- SMTP via nodemailer with environment-driven configuration.
- **RBAC + teams** -- Organizations, members, roles, invites. Wired through the auth middleware and routes.
- **Logging** -- Structured logger (pretty in dev, NDJSON in production), ready for Loki / Datadog / any aggregator.
- **Tests** -- Routes + services split (`test:fast` runs just those). No DB mocks -- tests hit a real Postgres instance.
- **Container-ready** -- Dockerfile + docker-compose for the dev stack; k8s-compatible image for any cluster.
- **`CLAUDE.md`** -- Authored for AI agents. They read it on session 1 and immediately know your conventions, dev login, gotchas.

## Architecture

```
MCP Client (Claude Desktop, CLI plugin, IDE, Inspector)
   |
   v  POST/GET/DELETE /api/mcp  (Streamable HTTP, SSE response)
Hono 4 API                (src/api/routes/mcp/  +  src/api/routes/*)
   |   Origin guard, MCP JSON-RPC dispatch, Zod-validated REST
   v
src/mcp/                  (tool registry + createMcpServer factory + tool modules)
   |
   v
PostgreSQL                        (Kysely, NNN_*.sql migrations auto-applied)
   +
Redis                             (sessions, cache, rate limits)
   +
Stripe                            (subscriptions, credits, customer portal)
```

**Stack:** Deno 2, Hono 4, `@modelcontextprotocol/sdk` (bare specifier), Kysely 0.27, PostgreSQL, Redis, Arctic 2, Stripe 17, Zod 3, nodemailer 6.

## Quick start

### 1. Clone and bootstrap

```bash
git clone https://github.com/chipp-ai/alchemist-template.git my-app
cd my-app
./scripts/setup.sh
```

`setup.sh` checks your toolchain (Deno, Docker), brings up Postgres + Redis via `docker-compose`, and runs all migrations.

### 2. Start the dev stack

```bash
./scripts/dev.sh --api-port 8000
```

This starts the Hono API on `:8000`. There is no Vite SPA in this template — the
MCP endpoint and `/api/*` routes are the entire surface. The MCP server is
available at `http://localhost:8000/api/mcp`.

### 3. Smoke-test the MCP server

```bash
# Initialize handshake. The Streamable HTTP transport requires the client to
# accept BOTH application/json and text/event-stream, and replies with an SSE
# envelope ("event: message\ndata: {...}").
curl -s -X POST http://localhost:8000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}'

# List the registered tools — you should see "echo" in the result.
curl -s -X POST http://localhost:8000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Call the echo tool — the result content echoes the message back ("ping").
curl -s -X POST http://localhost:8000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"message":"ping"}}}'

# Or connect via the MCP Inspector
npx @modelcontextprotocol/inspector http://localhost:8000/api/mcp
```

### 4. Dev login (for auth-gated REST routes)

There's no SMTP harness in dev, so OTP codes never reach an inbox. The MCP
endpoint is public — no login needed. For testing auth-gated REST routes:

```bash
curl -X POST -H 'Content-Type: application/json' \
     -d '{"email":"agent@dev.local"}' \
     http://localhost:8000/api/dev/login \
     -c /tmp/jar.txt
# Re-use the cookie jar with -b /tmp/jar.txt on subsequent requests.
```

The `/api/dev/*` routes 404 unless `ALCHEMIST_DEV_ROUTES` is set (it's wired into `deno task dev`; production never sets it) -- the surface is local-only by construction.

## MCP server at `/api/mcp`

The primary surface is an MCP (Model Context Protocol) server mounted at `/api/mcp`. It is served over Streamable HTTP using the MCP TypeScript SDK's `WebStandardStreamableHTTPServerTransport`, which takes a web-standard `Request` and returns a `Response`. The transport runs in **stateless mode** (`sessionIdGenerator: undefined`) — a fresh `McpServer` + transport is created per request.

- `POST /api/mcp` — `initialize` handshake and tool-call JSON-RPC bodies.
- `GET /api/mcp` — SSE streams (when a session-aware transport is used).
- `DELETE /api/mcp` — session teardown.

The route handler (`src/api/routes/mcp/index.ts`) validates the `Origin` header (DNS-rebinding / CSRF guard), then calls `createMcpServer()` (`src/mcp/server.ts`), which builds an `McpServer` from the tool registry. Tools live in `src/mcp/tools/` and self-register at import time. See [`docs/mcp-server.md`](docs/mcp-server.md) for the full design record (transport, security, dual mount).

### Add a new MCP tool

1. Create a tool module under `src/mcp/tools/` that calls `registerMcpTool(...)` at module top-level. `inputSchema` is a raw Zod shape (`ZodRawShape`), NOT `z.object({...})`:

```ts
// src/mcp/tools/greet.ts
import { z } from "zod";
import { registerMcpTool } from "@/mcp/registry.ts";

registerMcpTool({
  name: "greet",
  description: "Return a friendly greeting.",
  inputSchema: {
    name: z.string().min(1).describe("Who to greet"),
  },
  handler: async (args) => {
    const name = String(args.name ?? "");
    return { content: [{ type: "text", text: `Hello, ${name}!` }] };
  },
});
```

2. Add a side-effect import so the module runs (and registers the tool) when the server is built — `createMcpServer()` reads the registry via `listMcpTools()`:

```ts
// src/mcp/server.ts
import "@/mcp/tools/echo.ts";
import "@/mcp/tools/greet.ts"; // <- add this line
```

3. Restart the dev server and verify:

```bash
curl -X POST http://localhost:8000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

You should see your tool in the `tools` array.

**Bare specifier rule:** Import the MCP SDK as `@modelcontextprotocol/sdk/...` (mapped in `deno.json` to `npm:@modelcontextprotocol/sdk`). Never inline `npm:`, `jsr:`, or `https:` prefixes in source -- the `no-import-prefix` lint rule will fail CI. Sub-path imports require `.js` extensions (ESM requirement).

## Project structure

```
src/
  mcp/
    registry.ts    MCP tool registry (registerMcpTool / listMcpTools / getMcpTool)
    server.ts      McpServer factory (createMcpServer)
    tools/
      echo.ts      Example tool — add new tools here
  api/
    routes/
      mcp/         Hono sub-router that serves /api/mcp
      ...          Other REST route handlers
    middleware/    auth, validation, error handling
  services/        business logic (one file per domain)
  db/
    client.ts      Kysely client (CamelCasePlugin)
    schema.ts      table type definitions
  lib/logger.ts    structured logger (NDJSON in prod)
  __tests__/
    routes/        route integration tests (including mcp_route_test.ts)
    services/      service unit tests
    helpers.ts     test utilities (createIsolatedUser, ...)
db/
  migrations/      NNN_*.sql files, auto-applied on startup
  migrate.ts       migration runner
docs/
  mcp-server.md    MCP server design record (transport, tool registry, security)
scripts/
  setup.sh         one-shot dev bootstrap
  dev.sh           run API server
CLAUDE.md          project context for AI agents
```

## Customizing for your product

This template is intentionally generic. The path from clone to "your product" is:

1. **Rewrite `CLAUDE.md`.** Replace the `[Project Name]` header and `[Brief description...]` paragraph with what you're actually building. This is the file every AI agent reads first -- get it right and agents need almost no orientation. See [working with AI agents](#working-with-ai-agents) below.

2. **Centralize brand in `src/config/brand.ts`.** App name and transactional email address -- the template reads from one place so there are no string-literal leaks of "Alchemist" anywhere in your fork.

3. **Add your schema.** Create migration files in `db/migrations/` following the `NNN_description.sql` convention. The runner applies them in order on startup. Update `src/db/schema.ts` with matching TypeScript types -- the `CamelCasePlugin` handles the case conversion at the DB boundary.

4. **Add MCP tools.** Create a file in `src/mcp/tools/` that calls `registerMcpTool(...)` at module top-level, then add an `import "@/mcp/tools/my_tool.ts"` side-effect import in `src/mcp/server.ts`. See [`docs/mcp-server.md`](docs/mcp-server.md) for the full pattern and security notes.

5. **Add REST routes + services.** Drop new files into `src/api/routes/` and mount them in `app.ts` with `app.route("/api/...", yourRoutes)`. Put the logic in `src/services/`. Keep routes thin.

The template ships with the foundation you'd otherwise build yourself: organizations, users, sessions, OAuth, OTP, Stripe customers + subscriptions, credit grants, user preferences, team invites. You shouldn't have to touch most of it -- just build your domain on top.

## Working with AI agents

This template was authored so AI agents (Claude Code, Cursor, the [Alchemist AI](https://adaas.dev) platform) can extend it without ramp-up. Two things make that work:

**`CLAUDE.md` at the root** documents the stack, layout, conventions, dev login flow, and gotchas. Claude Code auto-loads it on every session; other agents you point at the repo can be told to read it first. When you fork, update it:

- Replace the project header with your product name + a real description of what it does.
- Document anything domain-specific (e.g. "events always carry a UTC timestamp", "we never delete records -- soft-delete via `archived_at`").
- Add your testing conventions, deployment specifics, and any patterns that look wrong but are intentional.

**Predictable layout.** Routes are thin orchestration; business logic lives in services; DB types come from `src/db/schema.ts`. Agents that know the pattern can add a new feature without searching for the right file. The Alchemist AI platform's agents are trained against exactly this shape.

If you also want autonomous error remediation, mission orchestration, and a kanban for agent work on top of this template, see [chipp-ai/dispatch](https://github.com/chipp-ai/dispatch).

## Development

```bash
deno task dev          # Run API with --watch
deno task check        # Type-check
deno task test:fast    # Route + service tests
deno task test         # Full test suite
deno task fmt          # Format
deno task lint         # Lint
deno task db:migrate   # Apply pending migrations explicitly
```

Run a single test file:

```bash
deno test --env --no-check --allow-all src/__tests__/services/my_test.ts
```

## Deployment

### Alchemist AI (autonomous)

Push to your fork's default branch. The Alchemist AI platform builds, migrates, and rolls out via its build orchestrator and rollout controller. No CI to configure -- the platform's own agents handle deploys.

### Self-host on Kubernetes

The Dockerfile produces a runtime-image suitable for any cluster. You need:

- A PostgreSQL instance (the app auto-applies migrations on boot).
- A Redis instance.
- Environment variables from `.env.example` (database URL, Redis URL, session secret, Stripe keys, OAuth credentials, SMTP config).

Mount the secrets, point at your databases, and run the image. A `/health` endpoint is exposed for liveness probes.

### Docker Compose

```bash
docker-compose up
```

## Contributing

Issues and pull requests welcome. If you're using Claude Code or another AI agent to contribute, the [`CLAUDE.md`](CLAUDE.md) in the repo root has the project context they'll need.

## License

[MIT](LICENSE)
