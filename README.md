<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo-light.svg" alt="Alchemist MCP Server" width="520">
  </picture>
  <p><strong>An MCP-server starter for Alchemist AI — a Deno 2 + Hono 4 app exposing a working Model Context Protocol server over HTTP at <code>/api/mcp</code>.</strong></p>
  <p>
    <a href="#quick-start">Quick Start</a> &#8226;
    <a href="#what-this-template-is">What This Template Is</a> &#8226;
    <a href="#the-mcp-server">The MCP Server</a> &#8226;
    <a href="#adding-a-tool">Adding a Tool</a> &#8226;
    <a href="#create_project-usage">create_project Usage</a> &#8226;
    <a href="#architecture">Architecture</a> &#8226;
    <a href="#conventions">Conventions</a> &#8226;
    <a href="#license">License</a>
  </p>
</div>

---

This is the **MCP-server starter template** for the Alchemist AI platform. It is selected by `create_project(template_key='mcp-server')`. The deliverable is a working MCP (Model Context Protocol) server mounted at `/api/mcp` — an HTTP-transport endpoint that MCP clients (Claude Desktop, etc.) connect to.

The Svelte SPA present in the base `alchemist-template` has been **deliberately removed**. There is no frontend; the MCP server is the product. The retained backend (auth, RBAC, billing, storage, observability, dev routes) provides optional capabilities a generated project may use.

## What this template is

- A **starter**, not a full product.
- A Deno 2 + Hono 4 HTTP API that exposes an MCP server at `/api/mcp`.
- A registry + tool pattern (modeled on the Alchemist platform's own `src/mcp/`) so generated projects start with a working server they can extend by adding tools.
- Documentation (this README + `CLAUDE.md`) that tells agents and humans exactly how to add a tool and how `create_project` consumes this template.

**Not included:** a browser UI, Vite, or any SPA scaffolding. Those were stripped because the MCP server is the deliverable; a minimal landing page would have left behind scaffolding for a surface that does not exist.

## The MCP server

The MCP server lives at `POST /api/mcp` (and `GET /api/mcp` for the Streamable HTTP transport handshake). It is implemented using the official MCP TypeScript SDK (`@modelcontextprotocol/sdk`) via a bare specifier declared in `deno.json`.

**Target shape (implemented by the companion `mcpserver` ticket):**

- `src/mcp/server.ts` — creates the `McpServer` instance and registers tools from the registry.
- `src/mcp/registry.ts` — aggregates tools from `src/mcp/tools/`.
- `src/mcp/tools/*.ts` — individual tool definitions.
- `src/api/routes/mcp/index.ts` — mounts the server at `/api/mcp` using `StreamableHTTPServerTransport` (reads the body from the raw `Request`; the host must NOT pre-parse the body).

The server uses the web-standard Streamable HTTP transport. Tools are registered with `server.registerTool(name, { description, inputSchema: z.object({...}) }, handler)` and return `{ content: [{ type: "text", text }] }`.

See `CLAUDE.md` for the full "Adding a tool" recipe and MCP SDK conventions.

## Adding a tool

1. Create a file in `src/mcp/tools/`, e.g. `src/mcp/tools/hello.ts`.
2. Export a registration function or the tool definition.
3. The registry imports and registers it.
4. Use the MCP SDK `registerTool` shape:

```ts
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerHello(server: McpServer) {
  server.registerTool(
    "hello",
    {
      description: "Say hello to someone",
      inputSchema: z.object({
        name: z.string().min(1).describe("Name to greet"),
      }),
    },
    async ({ name }) => ({
      content: [{ type: "text", text: `Hello, ${name}!` }],
    })
  );
}
```

Import the bare specifier `@modelcontextprotocol/sdk` (declared in `deno.json`). Use Zod for input schemas. Never inline `npm:`, `jsr:`, or `https:` prefixes in source — that triggers `deno lint` `no-import-prefix` failures in CI.

## create_project usage

When the Alchemist platform runs:

```ts
create_project(template_key="mcp-server", ...)
```

it clones this repo (at the `staging` ref) into the new customer's project. The generated project inherits:

- A working `/api/mcp` endpoint.
- The registry + example tool pattern under `src/mcp/`.
- This README + `CLAUDE.md` describing how to add tools.
- The full retained backend scaffold (auth, RBAC, billing, etc.) as optional capabilities.

The `mcpserver` ticket (a follow-on) ensures `/api/mcp` is actually mounted and at least one example tool is registered. This ticket (ALCHEM3-2) owns the repo shape and docs so that ticket lands into a repository that already tells the right story.

## Quick start

```bash
./scripts/setup.sh                 # First time only (Docker, migrations)
./scripts/dev.sh --api-port 8000   # Start the API
```

Or directly:

```bash
deno task dev   # Runs with ALCHEMIST_DEV_ROUTES=1 and --watch
```

The API listens on the port you pass. There is no Vite SPA; `--port` is accepted for back-compat with callers but is ignored.

Dev-only routes (`/api/dev/*`) are available when `ALCHEMIST_DEV_ROUTES=1` (set by `deno task dev`). They provide instant login and DB seed/reset for local/agent testing.

## Architecture

```
Client (MCP client / Claude Desktop)
   |
   v
Hono 4 API + MCP server   (src/api/routes/mcp  ->  src/mcp/)
   |   Streamable HTTP transport, tools via registry
   v
PostgreSQL                (Kysely, YYYYMMDDHHMMSS_*.sql migrations)
   +
Redis                     (sessions, cache)
   +
(Stripe, SMTP, R2 — optional, retained from base template)
```

**Stack:** Deno 2, Hono 4, Kysely 0.27, PostgreSQL, Redis, Zod 3, `@modelcontextprotocol/sdk`.

## Project structure

```
src/
  api/
    routes/        Hono handlers (thin orchestration)
    middleware/    auth, validation, error handling
  services/        business logic (one file per domain)
  mcp/             MCP server (created by mcpserver ticket)
    registry.ts    Aggregates tools from tools/
    server.ts      McpServer instance + transport mount
    tools/         Individual tool definitions
  db/
    client.ts      Kysely client (CamelCasePlugin)
    schema.ts      table type definitions
  lib/logger.ts    structured logger (NDJSON in prod)
  __tests__/
    routes/        route integration tests
    services/      service unit tests
db/
  migrations/      YYYYMMDDHHMMSS_description.sql files
  migrate.ts       migration runner
scripts/
  setup.sh         one-shot dev bootstrap
  dev.sh           run API + backing services
CLAUDE.md          project context for AI agents
```

## Conventions

- **Deno 2** — `new Deno.Command(...)` (not `Deno.run`), `Deno.serve`.
- **Hono 4** — `new Hono<{ Variables: ... }>()`; custom context via the generic, not global augmentation.
- **Bare specifiers** — declare `npm:` / `jsr:` packages in `deno.json` under `imports`. Never write `npm:foo` or `jsr:@bar/baz` directly in source.
- **MCP SDK** — `@modelcontextprotocol/sdk` via bare specifier. `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`. `StreamableHTTPServerTransport` (web-standard; host must not pre-parse the body).
- **Database** — Kysely + CamelCasePlugin. Migrations use `YYYYMMDDHHMMSS_` UTC-timestamp prefix. CamelCase in SELECT/INSERT values; snake_case in WHERE/ORDER BY.
- **Testing** — `deno task test:fast` for routes + services. Use `createIsolatedUser()` for DB-touching tests. Capture output with `tee .scratch/test-output.txt`.
- **Error handling** — Throw `AppError` subclasses; never bare `console.error`. Use `log` from `@/lib/logger.ts`.

See `CLAUDE.md` for the complete rule set and MCP-specific guidance.

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

Push to your fork's default branch. The Alchemist AI platform builds, migrates, and rolls out via its build orchestrator and rollout controller.

### Self-host on Kubernetes

The Dockerfile produces a runtime image. You need:

- A PostgreSQL instance (the app auto-applies migrations on boot).
- A Redis instance.
- Environment variables from `.env.example`.

A `/health` endpoint is exposed for liveness probes.

### Docker Compose

```bash
docker-compose up
```

## License

[MIT](LICENSE)
