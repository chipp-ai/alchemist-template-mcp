# Alchemist MCP-Server Starter

A Deno 2 + Hono 4 template that exposes a working Model Context Protocol (MCP) server over HTTP at `/api/mcp`. Selected by `create_project(template_key='mcp-server')`.

**Powered by Alchemist AI** -- Autonomous development platform.

## Local Dev Ports

@.claude/local-dev.md

All references to `__API_PORT__` in docs mean **your** API port from the file above.

## Quick Start

```bash
./scripts/setup.sh                 # First time only
./scripts/dev.sh --api-port 8000   # Start dev stack
```

Or directly:

```bash
deno task dev   # Runs with ALCHEMIST_DEV_ROUTES=1 and --watch
```

There is no SPA or Vite. The MCP server is the deliverable.

## What this template is

This is an **MCP-server starter**, not a web app. The deliverable is a working HTTP-transport MCP server mounted at `/api/mcp`. Generated projects start from a functioning MCP server they can extend by adding tools.

The Svelte SPA that existed in the base `alchemist-template` has been **deliberately removed** (see "Web posture" below). The retained backend (auth, RBAC, billing, storage, observability, dev routes) provides optional capabilities a generated project may use.

## The MCP server

- **Endpoint:** `POST /api/mcp` (and `GET /api/mcp` for the Streamable HTTP handshake).
- **Transport:** `StreamableHTTPServerTransport` from the MCP TypeScript SDK (web-standard; the host must NOT pre-parse the request body).
- **Registry:** Tools live under `src/mcp/` (registry + `tools/`). The registry aggregates tool definitions; the server registers them with `McpServer.registerTool(...)`.
- **Mount:** The route handler in `src/api/routes/mcp/` creates the transport and connects the server.

The shape is modeled on the Alchemist platform's own MCP server in `chipp-ai/alchemist-ai/src/mcp/`.

## Adding a tool

1. Create a file in `src/mcp/tools/`, e.g. `src/mcp/tools/hello.ts`.
2. Register the tool via the registry (the registry imports and wires it).
3. Use the MCP SDK registration shape:

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

**Conventions:**
- Import `@modelcontextprotocol/sdk` via a **bare specifier** declared in `deno.json` (never inline `npm:@modelcontextprotocol/sdk` in source).
- Use Zod for `inputSchema`.
- Handler returns `{ content: [{ type: "text", text: "..." }] }` (or other MCP content types).
- Tools are aggregated by the registry and registered once at server construction time.

See the "MCP conventions" section below for the full contract.

## create_project usage

When the Alchemist platform calls:

```ts
create_project(template_key="mcp-server", ...)
```

it clones this repo (at `staging`) as the seed. The generated project inherits:

- A working `/api/mcp` endpoint (once the `mcpserver` ticket lands).
- The registry + tools pattern under `src/mcp/`.
- This README + `CLAUDE.md` documenting how to add tools.
- The full retained backend as optional capabilities.

## Architecture

```
MCP Client (Claude Desktop, etc.)
   |
   v
Hono 4 API + MCP server   (src/api/routes/mcp  ->  src/mcp/)
   |   Streamable HTTP, tools via registry
   v
PostgreSQL                (Kysely, YYYYMMDDHHMMSS_*.sql migrations)
   +
Redis                     (sessions, cache)
   +
(Stripe, SMTP, R2 — optional)
```

**Stack:**
- **API:** Deno 2 + Hono 4
- **MCP:** `@modelcontextprotocol/sdk` (bare specifier), Streamable HTTP transport
- **Database:** PostgreSQL via Kysely (CamelCasePlugin)
- **Cache/Sessions:** Redis

## Web posture

`web/` was removed entirely. The MCP server is an HTTP API; there is no browser surface. A minimal landing page was considered and rejected because it would have left behind Vite, Dockerfile web-builder stages, `npm install` in setup, and source-shape lints that read `web/` files — all irrelevant to an MCP-server starter.

## Engineering Preferences

These guide all code review and implementation decisions:

- **DRY is important** -- flag repetition aggressively. If you see the same logic in two places, call it out.
- **Well-tested code is non-negotiable.** Too many tests > too few tests.
- **"Engineered enough"** -- not under-engineered (fragile, hacky) and not over-engineered (premature abstraction, unnecessary complexity). Find the middle.
- **Handle real edge cases at system boundaries** (user input, external APIs, DB results) -- not phantom ones in internal code.
- **Bias toward explicit over clever.** If a reader has to pause and think about what the code does, it is too clever.

## Critical Rules

- No emojis unless necessary
- Never make things up -- ask if unsure
- PRs target `staging` branch, not `main`
- **`staging` IS production.** The `staging` branch serves real users. Treat every staging issue with production-level urgency.
- Use `.scratch/` for ephemeral files (test scripts, debug logs, scratch data)
- **ALWAYS capture test output:** `deno task test 2>&1 | tee .scratch/test-output.txt`. Grep the file instead of re-running tests.
- **Use `deno task test:fast`** for quick iteration (service unit tests). To run a specific test file: `deno test --env --no-check --allow-all <file>`. Run the full suite with `deno task test`.
- **Tests that create DB resources must use `createIsolatedUser()`** -- never the shared test user. Parallel tests can delete each other's data.
- **NEVER use `--no-verify` or `--no-gpg-sign`** on any git command. If hooks fail, fix the underlying issue.
- Do not reference Vite ports or SPA paths in docs or scripts (this is an API-only template).

## Convention spokes — `.claude/rules/`

This file is the **hub**: universal rules that apply everywhere. Deep, area-specific conventions live in **spoke** files under `.claude/rules/`, each scoped to a path glob via `paths:` frontmatter. A spoke loads only when you work in its area.

| Spoke | Auto-loads when you touch | Covers |
|---|---|---|
| `database.md` | `db/**`, `*.service.ts` | Postgres extensions, Kysely + CamelCasePlugin, migrations, query safety |
| `api-layer.md` | `src/api/**` | Hono routes, validation, response envelope, WebSockets |
| `auth.md` | `src/auth/**`, middleware, `roles.ts` | Role hierarchy, capabilities, invite flow, soft-disconnect |
| `services-jobs.md` | `src/services/**`, `src/jobs/**` | Service structure, logging contract, `AppError` classes |

In Claude Code these load when you read a matching file. The Alchemist build agent injects them when a tool call touches a matching path (and exposes them via the `load_skill` tool).

## Observability stream — `.scratch/logs/observability.jsonl`

Every server log statement, HTTP request, and server error converges in time order into `.scratch/logs/observability.jsonl`. Client-side breadcrumbs are not present (no SPA).

Implementation lives in:
- `src/observability/jsonl-writer.ts`
- `src/observability/envelope.ts`
- `src/api/routes/observability/index.ts`
- Hooked into `src/lib/logger.ts` and `src/lib/dev-activity.ts`

Dev-only — the pipeline no-ops when `NODE_ENV === "production"`.

## API Conventions

> **Detailed API-layer rules live in `.claude/rules/api-layer.md`** (Hono route structure, `zValidator` + `validationHook`, the `{data}`/`{error}` envelope). They auto-load when you touch `src/api/**`. The essentials: routes are thin orchestration (logic lives in services), `zValidator` MUST pass `validationHook`, and every response is `{ data }` or `{ error, code }`.

## Database Conventions

> **Detailed database rules live in `.claude/rules/database.md`** (Postgres extensions, Kysely + CamelCasePlugin, migration filenames, query safety). They auto-load when you touch `db/**` or a `*.service.ts`. The essentials: never `CREATE EXTENSION` (the platform installs them); migrations use a `YYYYMMDDHHMMSS_` UTC-timestamp prefix, never sequential integers; CamelCase in SELECT results + INSERT values, snake_case in WHERE/ORDER BY.

## Testing

### Running Tests

```bash
# Fast iteration (service unit tests)
deno task test:fast 2>&1 | tee .scratch/test-output.txt

# All tests
deno task test 2>&1 | tee .scratch/test-output.txt

# Single file
deno test --env --no-check --allow-all src/__tests__/services/my_test.ts
```

### Test Isolation

```typescript
import { createIsolatedUser } from "../helpers.ts";

Deno.test("creates a resource", async () => {
  const { user, org, cleanup } = await createIsolatedUser("owner");
  try {
    // ... test logic using user, org
  } finally {
    await cleanup();
  }
});
```

**Rules:**
- Always use `createIsolatedUser()` for test isolation -- never shared singletons.
- Always call `cleanup()` in a `finally` block.
- ALWAYS capture test output to `.scratch/test-output.txt` and grep the file instead of re-running.

## Error Handling

> **The server-side logging contract + `AppError` class table live in `.claude/rules/services-jobs.md`** (auto-loads on `src/services/**` / `src/jobs/**`). The essentials: never bare `console.error` or `.catch(() => {})`; use `log` from `src/lib/logger.ts` with a `source` and pass the `Error` as the 3rd arg; throw `AppError` subclasses and let the global handler format them.

## Git Workflow

- Stay on `staging`. Do not create feature branches.
- Commit directly on `staging`.
- PRs target `staging`, never `main`.
- **NEVER use `--no-verify` or `--no-gpg-sign`** on any git command.

### `git add -A` is the rule, not a suggestion

Always `git add -A` before committing. Never cherry-pick individual files. The only acceptable workflow:

```
git add -A
git commit -m "..."
git push
```

## MCP conventions

**SDK import (bare specifier):**

Declare in `deno.json`:

```json
"imports": {
  "@modelcontextprotocol/sdk/server/mcp.js": "npm:@modelcontextprotocol/sdk@^1.29.0/server/mcp.js",
  "@modelcontextprotocol/sdk/server/streamableHttp.js": "npm:@modelcontextprotocol/sdk@^1.29.0/server/streamableHttp.js"
}
```

Never write `npm:@modelcontextprotocol/sdk/...` directly in source — `deno lint` `no-import-prefix` will fail CI.

> The `@modelcontextprotocol/sdk` import-map entries are added to `deno.json` by the companion `mcpserver` ticket, together with the server implementation. This shaping ticket (ALCHEM3-2) documents the convention; the specifier is not in `deno.json` yet.

**Server + transport:**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const server = new McpServer({ name: "my-server", version: "1.0.0" });

// Register tools here (via registry or inline)

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

// IMPORTANT: do NOT read the body before passing the raw Request to the transport.
// The transport reads from the Request stream itself.
await server.connect(transport);
return transport.handleRequest(req);
```

**Registering a tool:**

```ts
server.registerTool(
  "tool_name",
  {
    description: "What this tool does",
    inputSchema: z.object({
      arg: z.string().describe("Description"),
    }),
  },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(result) }],
  })
);
```

**Tool files + registry:**

- Put each tool (or logical group) in `src/mcp/tools/<name>.ts`.
- The registry imports them and calls their registration functions.
- The server is constructed once and connected to the transport per request (or per session, depending on transport semantics).

**Common pitfalls:**
- Never pre-parse the body before handing the `Request` to `StreamableHTTPServerTransport`.
- Always declare the SDK via bare specifier in `deno.json`.
- Input schemas must be Zod objects; descriptions on fields are visible to the MCP client.

## Library version idioms

### Deno 2 (`denoland/deno:2.3.1` runtime)

`Deno.run` was REMOVED in Deno 2. Use `new Deno.Command(...)`.

```ts
const output = await new Deno.Command("git", { args: ["status"], stdout: "piped" }).output();
```

`Deno.serve` is the default HTTP server.

### Hono 4 (`hono@^4.6.0`)

`app.fire()` was removed. Use the generic for custom context:

```typescript
type AppEnv = { Variables: { user: User; session: Session } };
const app = new Hono<AppEnv>();
app.use("*", async (c, next) => { c.set("user", currentUser); await next(); });
app.get("/me", (c) => c.json({ user: c.get("user") }));
```

### date-fns 3 (`date-fns@^3.0.0`)

No default export. Use named imports:

```ts
import { format, parseISO } from "date-fns";
```

## Self-Improvement Loop (Non-Negotiable)

After ANY correction from the user, **immediately** update this `CLAUDE.md` with the pattern. Write rules for yourself that prevent the same mistake. Review this file at session start for the relevant project area.

## Common Pitfalls

- **`zValidator` must always pass `validationHook`** -- raw ZodError objects are unreadable to clients
- **Zod `.trim()` before `.min(1)` for name fields** -- whitespace-only strings pass `.min(1)`
- **JSONB columns return as strings** -- always `JSON.parse()` before using
- **Never `JSON.stringify()` for Kysely JSONB** -- pass objects directly, stringify double-encodes
- **`countAll()` returns string** -- wrap with `Number()`
- **`whereIn()` with empty array crashes** -- guard with early return
- **CamelCase in SELECT/INSERT, snake_case in WHERE/ORDER** -- the CamelCasePlugin only transforms result columns
- **Deno 2: `Deno.run` removed** -- use `new Deno.Command(...)`
- **Hono 4: custom context via `Hono<{ Variables: ... }>` generic** -- not v3 global `Hono.Variables` augmentation
- **date-fns 3: no default export** -- `import { format } from "date-fns"`
- **Bare specifiers required** -- never inline `npm:`, `jsr:`, or `https:` in source; declare in `deno.json`
- **MCP transport owns the body** -- do not pre-parse the Request before passing to `StreamableHTTPServerTransport`
