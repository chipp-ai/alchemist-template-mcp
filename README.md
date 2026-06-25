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

This is the **Alchemist MCP-server starter template**: a headless Deno 2 + Hono 4 backend whose primary surface is an MCP server at `/api/mcp`. It is selected by Alchemist Cloud's `create_project(template_key='mcp-server')` and ships with a working tool registry so generated projects start from a functioning, extensible MCP server.

It ships with auth, billing, RBAC, structured logging, and an idiomatic Kysely + services layout, plus a `CLAUDE.md` authored so AI agents (Claude Code, Cursor, or the [Alchemist AI](https://adaas.dev) platform itself) can navigate and extend it without fighting the conventions. Fork it as the starting point for any new MCP-powered product.

It is also the seed repo every customer project on the [Alchemist AI](https://adaas.dev) platform is cloned from when `template_key='mcp-server'`. The conventions here are the ones autonomous agents are trained against -- using this template means agents work with you, not around you.

## What's in the box

- **MCP server** -- `@modelcontextprotocol/sdk` via bare specifier, mounted at `/api/mcp`. Tool registry in `src/mcp`; add tools by creating modules under `src/mcp/tools/` and registering them.
- **API** -- Deno 2 + Hono 4 with Zod request validation and typed error handling. All `/api/*` routes (auth, billing, files, etc.) remain available alongside the MCP endpoint.
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
MCP Client (Claude, Cursor, custom agent)
   |
   v
POST/GET/DELETE /api/mcp          (StreamableHTTPServerTransport)
   |   MCP initialize, tool calls, SSE, session teardown
   v
Hono 4 API                        (src/api/routes/  ->  src/services/)
   |   Zod-validated, session + JWT auth, structured errors
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

This runs the Hono API on `:8000`. The MCP server is available at `http://localhost:8000/api/mcp`.

### 3. Log in (no SMTP needed)

There's no SMTP harness in dev, so OTP codes never reach an inbox. Use the dev-login escape hatch instead:

- **From an agent or terminal:**
  ```bash
  curl -X POST -H 'Content-Type: application/json' \
       -d '{"email":"agent@dev.local"}' \
       http://localhost:8000/api/dev/login \
       -c /tmp/jar.txt
  ```
  Re-use the cookie jar with `-b /tmp/jar.txt` on subsequent requests.

The `/api/dev/*` routes 404 when `NODE_ENV=production` -- the surface is local-only by construction.

## MCP server at `/api/mcp`

The primary surface is an MCP (Model Context Protocol) server mounted at `POST/GET/DELETE /api/mcp`. It uses the MCP TypeScript SDK's `StreamableHTTPServerTransport` for stateless or session-aware operation.

- `POST /api/mcp` with `InitializeRequest` or tool call JSON-RPC bodies.
- `GET /api/mcp` for SSE streams (when supported by the transport).
- `DELETE /api/mcp` for session teardown.

Tools are registered via a central registry under `src/mcp`. The server implementation (route + transport wiring) is added by the parallel `mcpserver` work; this template provides the registry shape so projects start ready to extend.

### Add a new MCP tool

1. Create a tool module under `src/mcp/tools/`:

```ts
// src/mcp/tools/hello.ts
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerHelloTool(server: McpServer) {
  server.registerTool(
    "hello",
    {
      description: "Return a friendly greeting.",
      inputSchema: z.object({
        name: z.string().min(1),
      }),
    },
    async ({ name }) => ({
      content: [{ type: "text", text: `Hello, ${name}!` }],
    }),
  );
}
```

2. Import and register it from the registry (the registry module is imported by the `/api/mcp` route):

```ts
// src/mcp/registry.ts (or equivalent entry point)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerHelloTool } from "./tools/hello.ts";
// ... other tool registrations

export function registerAllTools(server: McpServer) {
  registerHelloTool(server);
  // ...
}
```

3. Restart the dev server and verify:

```bash
curl -X POST http://localhost:8000/api/mcp \
  -H 'Content-Type: application/json' \
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
  api/
    routes/        Hono handlers (thin orchestration)
    middleware/    auth, validation, error handling
  services/        business logic (one file per domain)
  mcp/             MCP tool registry + tools/
    registry.ts    central registration point
    tools/         individual tool modules (registerTool + Zod schema)
  db/
    client.ts      Kysely client (CamelCasePlugin)
    schema.ts      table type definitions
  lib/logger.ts    structured logger (NDJSON in prod)
  __tests__/
    routes/        route integration tests
    services/      service unit tests
    helpers.ts     test utilities (createIsolatedUser, ...)
db/
  migrations/      NNN_*.sql files, auto-applied on startup
  migrate.ts       migration runner
scripts/
  setup.sh         one-shot dev bootstrap
  dev.sh           run API server
CLAUDE.md          project context for AI agents
```

## Customizing for your product

This template is intentionally generic. The path from clone to "your product" is:

1. **Rewrite `CLAUDE.md`.** Replace the `[Project Name]` header and `[Brief description...]` paragraph with what you're actually building. This is the file every AI agent reads first -- get it right and agents need almost no orientation. See [working with AI agents](#working-with-ai-agents) below.

2. **Centralize brand in `src/config/brand.ts`.** App name, logo, colors, marketing copy -- the template reads from one place so there are no string-literal leaks of "Alchemist" anywhere in your fork.

3. **Add your schema.** Create migration files in `db/migrations/` following the `NNN_description.sql` convention. The runner applies them in order on startup. Update `src/db/schema.ts` with matching TypeScript types -- the `CamelCasePlugin` handles the case conversion at the DB boundary.

4. **Add routes + services.** Drop new files into `src/api/routes/` and mount them in `app.ts` with `app.route("/api/...", yourRoutes)`. Put the logic in `src/services/`. Keep routes thin.

5. **Add an MCP tool to `src/mcp` registry.** Create a module under `src/mcp/tools/`, implement with `server.registerTool(name, { description, inputSchema: z.object({...}) }, handler)`, and register it from the central registry. See the [MCP server section](#mcp-server-at-apimcp) for the full recipe.

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
