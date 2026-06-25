# [Project Name]

[Brief description of what this SaaS product does -- CUSTOMIZE THIS for your product]

This is the **Alchemist MCP-server starter template** — a headless Deno + Hono backend exposing an MCP server at `/api/mcp`. Selected by `create_project(template_key='mcp-server')` on the Alchemist Cloud platform.

**Powered by Alchemist AI** -- Autonomous development platform.

## Local Dev Ports

@.claude/local-dev.md

All references to `__API_PORT__` in docs mean **your** API port from the file above.

## Quick Start

```bash
./scripts/setup.sh                                          # First time only
./scripts/dev.sh --api-port __API_PORT__                    # Start dev stack
```

**Hit the API at `http://localhost:__API_PORT__`.** No Vite/SPA in this template.

**Dev login (local testing):** there is no SMTP / inbox harness in dev, so the email-OTP code never reaches an inbox — sign-in via the OTP form will always block. Use the dev-login escape hatch:

- **From an agent or terminal**, `curl -X POST -H 'Content-Type: application/json' -d '{"email":"agent@dev.local"}' http://localhost:__API_PORT__/api/dev/login -c /tmp/jar.txt` issues the same session. Re-use the cookie jar with `-b /tmp/jar.txt` on subsequent requests.

The `/api/dev/*` routes 404 unless `ALCHEMIST_DEV_ROUTES` is set (it's wired into `deno task dev`; production never sets it) -- the surface is local-only by construction. See "Dev affordances" further down for the full route catalog (seed / reset / introspect).

## Architecture

```
src/                    # Deno + Hono API server
  api/
    routes/             # Hono route handlers (thin orchestration)
    middleware/          # Auth, validation, error handling
  services/             # Business logic (one service per domain)
  mcp/                  # MCP server tool registry + tools
    registry.ts         # Tool registry (registerMcpTool / listMcpTools / getMcpTool)
    server.ts           # createMcpServer factory + side-effect tool imports
    tools/              # Individual tool modules (registerMcpTool + Zod shape)
      echo.ts           # Example tool
  db/
    client.ts           # Kysely client with CamelCasePlugin
    schema.ts           # TypeScript type definitions for all tables
  lib/
    logger.ts           # Structured logger (dev: pretty, prod: NDJSON)
  utils/                # Shared utilities (errors, validation hooks)
  __tests__/
    routes/             # Route integration tests
    services/           # Service unit tests
    helpers.ts          # Test utilities (createIsolatedUser, etc.)

db/
  migrations/           # SQL migration files (YYYYMMDDHHMMSS_description.sql)
  migrate.ts            # Migration runner

scripts/
  dev.sh                # Start dev stack
  setup.sh              # First-time project setup

.scratch/               # Ephemeral files (gitignored except .gitkeep)
  logs/                 # Dev server logs (server.log)
```

**Stack:**

- **API:** Deno + Hono
- **MCP:** `@modelcontextprotocol/sdk` (bare specifier in `deno.json`)
- **Database:** PostgreSQL via Kysely (CamelCasePlugin)
- **Cache/Sessions:** Redis
- **Edge Proxy:** Cloudflare Worker (when deployed)

## MCP server — `/api/mcp`

The primary surface is an MCP (Model Context Protocol) server mounted at `/api/mcp`. It uses the MCP TypeScript SDK's `WebStandardStreamableHTTPServerTransport`, which consumes a web-standard `Request` and returns a `Response` (the Deno/Hono-native transport, not the Node `req/res` one):

- `POST /api/mcp` — handles `initialize` and JSON-RPC tool calls.
- `GET /api/mcp` — SSE stream (when a session-aware transport emits one).
- `DELETE /api/mcp` — session teardown.

Stateless mode uses `sessionIdGenerator: undefined` — a fresh `McpServer` + transport is created per request (`src/api/routes/mcp/index.ts`). The route validates the `Origin` header (DNS-rebinding / CSRF guard), then calls `createMcpServer()` and hands the raw request to the transport: `await transport.handleRequest(c.req.raw)`, which returns the `Response` directly. See `docs/mcp-server.md` for the full design record.

### Tool registry

Tools live under `src/mcp/tools/`. Each tool module calls `registerMcpTool({ name, description, inputSchema, handler })` at the top level (side-effect registration). `src/mcp/server.ts` imports those modules, and `createMcpServer()` enumerates them via `listMcpTools()` and wires each into the `McpServer`. The registry API is `registerMcpTool` / `listMcpTools` / `getMcpTool` in `src/mcp/registry.ts`.

### Add a new MCP tool

1. Create a tool module that registers itself. `inputSchema` is a raw Zod shape (`ZodRawShape`), NOT `z.object({...})`:

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

2. Add a side-effect import to `src/mcp/server.ts` so the module runs (and registers) before `createMcpServer()` reads the registry:

```ts
// src/mcp/server.ts
import "@/mcp/tools/echo.ts";
import "@/mcp/tools/greet.ts"; // <- add this line
```

3. Verify:

```bash
curl -X POST http://localhost:__API_PORT__/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

You should see `"greet"` in the `tools` array.

**Bare specifier rule:** Import MCP SDK paths as `@modelcontextprotocol/sdk/...` (mapped in `deno.json` to `npm:@modelcontextprotocol/sdk`). Never inline `npm:`, `jsr:`, or `https:` prefixes in source — the `no-import-prefix` lint rule fails CI. Sub-path imports require `.js` extensions (ESM).

**`create_project(template_key='mcp-server')`:** Alchemist Cloud's project-creation API selects this repo when that key is provided. The generated project starts from a functioning, extensible MCP server at `/api/mcp` with at least one example tool.

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
- **Use `deno task test:fast`** for quick iteration (~1min). To run a specific test file: `deno test --env --no-check --allow-all <file>`.
- **Tests that create DB resources must use `createIsolatedUser()`** -- never the shared test user. Parallel tests can delete each other's data.
- **NEVER use `--no-verify` or `--no-gpg-sign`** on any git command. If hooks fail, fix the underlying issue.
- **ALWAYS use `./scripts/dev.sh --api-port __API_PORT__`** -- port is required (no default), logs go to `.scratch/logs/`.

## Convention spokes — `.claude/rules/`

This file is the **hub**: universal rules that apply everywhere. Deep,
area-specific conventions live in **spoke** files under `.claude/rules/`,
each scoped to a path glob via `paths:` frontmatter. A spoke loads only
when you work in its area, so the hub stays focused.

| Spoke              | Auto-loads when you touch             | Covers                                                                  |
| ------------------ | ------------------------------------- | ----------------------------------------------------------------------- |
| `database.md`      | `db/**`, `*.service.ts`               | Postgres extensions, Kysely + CamelCasePlugin, migrations, query safety |
| `api-layer.md`     | `src/api/**`                          | Hono routes, validation, response envelope, WebSockets                  |
| `auth.md`          | `src/auth/**`, middleware, `roles.ts` | Role hierarchy, capabilities, invite flow, soft-disconnect              |
| `services-jobs.md` | `src/services/**`, `src/jobs/**`      | Service structure, logging contract, `AppError` classes                 |

In Claude Code these load when you read a matching file. The Alchemist
build agent injects them when a tool call touches a matching path (and
exposes them via the `load_skill` tool). Add a new spoke by dropping a
`.claude/rules/<name>.md` with a `description:` and `paths:` frontmatter.

## Observability stream — `.scratch/logs/observability.jsonl`

Every server log statement, HTTP request, and server error converges in **time order** into a single JSONL file at `.scratch/logs/observability.jsonl`. This is the canonical "what happened during this test session" stream — read it after running an agent session to understand exactly what fired and what failed. (Client-side browser breadcrumbs are absent in this headless template — only `source: "server"` events are written.)

Each line is `{ts, sid, source: "client"|"server", kind, data}`. Stable `kind` slugs (do NOT mutate; analytics product depends on them): `server.log.{debug,info,warn,error}`, `server.http`, `server.error`, `client.console.{log,info,warn,error,debug}`, `client.error`, `client.promise`, `client.fetch`, `client.click`, `client.click.background`, `client.route`, `client.perf.{lcp,cls,inp}`, `client.session`.

Implementation lives in:

- `src/observability/jsonl-writer.ts` — append-only writer with 10MB rotation
- `src/observability/envelope.ts` — `recordServerEvent` / `recordClientEvents`
- `src/api/routes/observability/index.ts` — `POST /api/_observability/breadcrumb` collector
- Hooked into `src/lib/logger.ts` (every emit) and `src/lib/dev-activity.ts` (every recorded request + error)

Dev-only — the entire pipeline no-ops when `NODE_ENV === "production"`. The analytics product will replace the collector with a remote ingest at that boundary when it ships.

**When debugging a reported issue, tail this file first** — `tail -n 200 .scratch/logs/observability.jsonl | jq .` gives the most recent slice of what happened in a session, in time order.

## API Conventions

> **Detailed API-layer rules live in `.claude/rules/api-layer.md`** (Hono route
> structure, `zValidator` + `validationHook`, the `{data}`/`{error}` envelope,
> the realtime/WebSocket surface). They auto-load when you touch `src/api/**`.
> The essentials: routes are thin orchestration (logic lives in services),
> `zValidator` MUST pass `validationHook`, and every response is `{ data }` or
> `{ error, code }`.

### Roles and team management

> **The full role hierarchy, capability set, `can()`/`canManage()` helpers,
> invite flow, and soft-disconnect semantics live in `.claude/rules/auth.md`**
> (auto-loads on `src/auth/**`, `src/api/middleware/**`, `src/lib/roles.ts`).
> The essentials: 4 roles (owner/admin/editor/viewer), gate routes with
> `requireCapability(...)`, use `can(role, cap)` (never compare role strings),
> and member removal is a SOFT-DISCONNECT (`organization_id = NULL`), never a
> hard delete.

## Database Conventions

> **Detailed database rules live in `.claude/rules/database.md`** (Postgres
> extensions, Kysely + CamelCasePlugin, migration filenames, query safety).
> They auto-load when you touch `db/**` or a `*.service.ts`. The essentials:
> never `CREATE EXTENSION` (the platform installs them); migrations use a
> `YYYYMMDDHHMMSS_` UTC-timestamp prefix, never sequential integers; CamelCase
> in SELECT results + INSERT values, snake_case in WHERE/ORDER BY.

## Testing

### Running Tests

```bash
# Fast iteration (routes + services, ~1min)
deno task test:fast 2>&1 | tee .scratch/test-output.txt

# All tests
deno task test 2>&1 | tee .scratch/test-output.txt

# Single file
deno test --env --no-check --allow-all src/__tests__/services/user_test.ts

# Watch mode
deno task test:watch
```

### Test Isolation

```typescript
import { createIsolatedUser } from "../helpers.ts";

Deno.test("creates an application", async () => {
  const { user, org, workspace, cleanup } = await createIsolatedUser("owner");
  try {
    // ... test logic using user, org, workspace
  } finally {
    await cleanup();
  }
});
```

**Rules:**

- Always use `createIsolatedUser()` for test isolation -- never shared singletons.
- Always call `cleanup()` in a `finally` block.
- ALWAYS capture test output to `.scratch/test-output.txt` and grep the file instead of re-running.

### Test Structure

```
src/__tests__/
  helpers.ts              # createIsolatedUser, getTestDb, withTestServer
  routes/                 # Route integration tests
    auth_test.ts
    applications_test.ts
  services/               # Service unit tests
    user_service_test.ts
    billing_service_test.ts
```

## Error Handling

> **The server-side logging contract + `AppError` class table live in
> `.claude/rules/services-jobs.md`** (auto-loads on `src/services/**` /
> `src/jobs/**`). The essentials: never bare `console.error` or
> `.catch(() => {})`; use `log` from `src/lib/logger.ts` with a `source` and
> pass the `Error` as the 3rd arg; throw `AppError` subclasses and let the
> global handler format them.

## Git Workflow

- Stay on `staging`. Do not create feature branches.
- Commit directly on `staging`.
- PRs target `staging`, never `main`.
- **NEVER use `--no-verify` or `--no-gpg-sign`** on any git command.

### `git add -A` is the rule, not a suggestion

Multiple Claude Code workers run side-by-side on this repo's `staging` branch at all times. When you commit, **other workers' uncommitted changes may already be in your working tree** — that is expected, not a bug. The rule:

**Always `git add -A` before committing.** Never cherry-pick individual files trying to "separate your changes from another worker's." Don't try to reason about which lines are "yours" and which aren't — that distinction is meaningless when sessions get compacted, contexts overlap, and the same agent picks back up with a stale model of what it already wrote. The working tree is the truth; commit all of it.

**Never `git stash` to "isolate your commit"** from another worker's in-progress changes. Stashing parks work in a per-clone reflog that other workers can't see and that gets lost on `git reset --hard`, `git clean -fd`, or a worktree teardown — uncommitted work outside the index has no durable home. The entire point of the always-commit rule is that the index is the only place work survives.

The only acceptable workflow:

```
git add -A
git commit -m "..."
git push
```

Trust CI to catch broken intermediate states. If a partial refactor genuinely shouldn't deploy, **revert the offending lines as a follow-up commit**, don't stash them. If a commit message ends up bundling more files than the message describes, that's fine — the message is an approximation of "what shipped in this push," not a strict scope contract.

## File storage — use `storage.service.ts`, never write to R2 directly

The platform injects shared R2 credentials (`R2_ENDPOINT` /
`R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`) plus a
per-customer `R2_KEY_PREFIX` (`customer-${projectId}/`). The whole
fleet shares one bucket; cross-tenant isolation lives in the path
layer. **Every R2 key MUST start with `R2_KEY_PREFIX`.** Don't
write your own R2 helpers — `src/services/storage.service.ts` does
this for you and structurally prevents prefix escape.

### What's available

```ts
import {
  assertOwnedKey, // utility — validates a stored full key
  deleteObject, // server-side delete
  describeStorageConfig,
  getObject, // server-side fetch
  getSignedDownloadUrl, // browser-facing read URL (default 1h, max 7d)
  getSignedUploadUrl, // browser direct PUT URL (default 15m, max 7d)
  isStorageConfigured,
  putObject, // server-side upload
  scopedKey, // utility — auto-prefixes a relative key
} from "@/services/storage.service.ts";
```

### Recipe — user uploads an image

```ts
// Server: issue a presigned PUT URL the browser can use directly.
const { uploadUrl, key, expiresAt } = await fetch("/api/files/upload-url", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    key: `users/${user.id}/avatars/${crypto.randomUUID()}.jpg`,
    contentType: "image/jpeg",
  }),
}).then((r) => r.json());

// Browser: PUT the file bytes directly to R2. Server never sees them.
await fetch(uploadUrl, {
  method: "PUT",
  headers: { "Content-Type": "image/jpeg" },
  body: file,
});

// Server: store `key` (RELATIVE — without the prefix) in your DB.
await db.insertInto("app.user_avatars").values({ userId: user.id, key }).execute();
```

### Recipe — serve the image later

```ts
// Server: read the relative key from the DB row, hand back a fresh
// signed URL. The R2_KEY_PREFIX gets prepended in the helper.
const url = getSignedDownloadUrl(row.key, 3600);
return c.json({ avatarUrl: url });
```

### Cross-tenant isolation contract

`scopedKey()` (called by every public helper) **rejects**:

- Empty / missing keys
- Leading slash (would defeat prefix)
- `..` segments (path traversal)
- `.` segments (no-op but suspicious)
- Empty segments (double slash)
- Backslashes (Windows-style traversal)
- Keys longer than 900 chars

Application code passes RELATIVE keys (e.g. `images/foo.jpg`) — the
prefix is invisible to your code and impossible to escape using these
helpers. **Do NOT store the full prefixed key in your DB** — store
the relative key. That way if the prefix scheme ever changes (it
won't, but defensively), your data is portable.

### Reading an externally-supplied stored full key

If your DB stores the FULL prefixed key (legacy), validate it with
`assertOwnedKey()` before passing to any helper that accepts a raw
key. This is the only safe way to handle a fully-qualified R2 key
that came from outside your own write path.

### Built-in routes

`POST /api/files/upload-url` — body `{ key, contentType, expiresInSeconds? }`,
returns `{ uploadUrl, key, expiresAt, requiredHeaders }`. Auth required.

`POST /api/files/download-url` — body `{ key, expiresInSeconds?, downloadFilename? }`,
returns `{ downloadUrl, key, expiresAt }`. Auth required. Set
`downloadFilename` to force `Content-Disposition: attachment`.

`POST /api/files/upload` — multipart server-side proxy upload (8 MB cap).
Use this for small files when you don't want browser PUT. Body fields:
`file` (the bytes) + `key` (the relative key string).

`DELETE /api/files` — body `{ key }`. Auth required. Idempotent.

`GET /api/files/info` — diagnostic; returns `{ configured, bucket, prefix }`.

### CORS

For browser direct uploads to work, the R2 bucket needs CORS
configured to accept the customer's app origin. The platform handles
this for `*.adaas.dev` automatically — see chipp-ai/alchemist-ai
`scripts/bootstrap-r2-cors.sh`. For custom domains, the platform
adds the origin to the bucket-level rule when the customer registers
the domain (see `R2 Bucket CORS` in alchemist-ai/CLAUDE.md).

## Verification Checklist

Before reporting any implementation as complete:

1. **Type checks:** `deno task check` passes
2. **Tests written and passing:** `deno task test:fast 2>&1 | tee .scratch/test-output.txt`
3. **API tested** (for backend changes): write a scratch test in `.scratch/` and run it
4. **API verified:** write a scratch test in `.scratch/` and curl the endpoint
5. **No errors** in server logs (`.scratch/logs/server.log`)

**If ANY check fails: fix, re-run, proceed only when green.**

## Agent verification toolkit — pick the right tool

When verifying a change against the running app, three MCP tools cover almost everything. **Pick from cheapest → most expensive** and only escalate when the cheaper one doesn't answer the question.

### Tier 1 — `dev_app_state` (cheapest, no browser required)

```
mcp__dev-server__dev_app_state                  # JSON, structured
mcp__dev-server__dev_app_state({ format: "markdown" })   # Markdown, layered report
```

GETs `/api/dev/app-state` on the running customer app. Returns one merged payload:

- **Server side** — the last 20 HTTP requests with method/path/status/duration, and any captured server errors.
- **Client side** — (headless template) no SPA stores or routes; `defineStore` is not applicable.

**Use this first** for any "is the running app in the state I expect?" question. It answers "did my last PATCH succeed / did the server throw" with a single tool call. The structured JSON (default) is the L1 view; `format: "markdown"` is the L2 deep-dive (same content, formatted for reading).

What `dev_app_state` does NOT capture: plain `console.log` / `console.warn` / `console.info` calls. Those need Tier 2.

### Tier 2 — `browser_get_console_logs` (full console output)

```
mcp__browser-devtools__browser_get_console_logs           # all types
mcp__browser-devtools__browser_get_console_logs({ type: "error" })  # filter
mcp__browser-devtools__browser_get_console_logs({ search: "..." })  # grep
```

Captures every `console.*` call from Chrome via CDP — `log`, `warn`, `error`, `info`, `debug` — with stack traces and timestamps. Use this when:

- A bug is suspected in code that uses `console.log` to surface state.
- An uncaught error appears in `dev_app_state.client.recentErrors` and you want the surrounding console context.
- A third-party library is logging warnings you need to read.

(Note: in this headless template there is no client SPA; browser console logs are only relevant when you deliberately navigate the browser to an API response or error page for debugging.)

### Tier 3 — drive the browser (UI verification)

```
mcp__browser-devtools__browser_navigate
mcp__browser-devtools__browser_click
mcp__browser-devtools__browser_type
mcp__browser-devtools__browser_take_screenshot
mcp__browser-devtools__browser_execute_js
```

Use these when the previous tiers can't answer your question. In this headless template the primary verification path is `curl` + scratch tests; browser tiers are only for inspecting raw API responses or headers in the sandbox when needed.

### Decision rule

> "Could `dev_app_state` answer this?" → call it first.
> "Could `browser_get_console_logs` answer this?" → call it next.
> "Do I actually need to see / click the page?" → only then go to `browser_*`.

Skipping the cheaper tools is the most common token-waster in verification — agents reach for `browser_navigate` + `browser_take_screenshot` to check things that `dev_app_state` already returns in one call.

## Dev affordances — DO NOT reverse-engineer auth from scratch

When `ALCHEMIST_DEV_ROUTES` is set (it's wired into `deno task dev`, so
it's on in the local dev stack AND inside the agent's E2B sandbox), a
small set of **dev-only routes** at `/api/dev/*` go live so you can
verify auth-gated flows without driving the OTP send + email + verify
cycle. SMTP is not configured in the sandbox, so the OTP email goes to
console — agents that try to verify the signup flow without these
routes will spend tokens screen-scraping the log. Don't.

### Available endpoints

```
GET  /api/dev/info     # Capability advertisement (safe to call first to
                       # confirm the routes are live).
POST /api/dev/login    # Body: { email, name? }
                       # Looks up or creates user + org, sets the same
                       # session_id cookie /verify-otp would set.
                       # Returns { user, organization, session_cookie }.
POST /api/dev/seed     # Body: { users?: [{email, name?}], raw?: [{table, rows}] }
                       # Bulk-create users with their own orgs, AND/OR
                       # ad-hoc inserts into any app./billing./jobs.
                       # table. Both modes run in one transaction.
POST /api/dev/reset    # Body: { tables?: [...] } (default = all
                       # app/billing/jobs tables). TRUNCATE CASCADE.
                       # Use BEFORE seeding for a known starting point.
```

### Recipe — verify a route that requires auth

```bash
# Inside the sandbox after ensure_local_dev_server succeeded:

# 1. Reset to a clean DB (optional but recommended).
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{}' http://localhost:8000/api/dev/reset

# 2. Instant-login as the user you want to be.
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"email":"agent@dev.local"}' \
  http://localhost:8000/api/dev/login \
  -c /tmp/jar.txt

# 3. Hit the auth-gated route with the cookie jar.
curl -sS -b /tmp/jar.txt http://localhost:8000/api/auth/me
# → { user: { id, email, name }, organization: {...} }
```

### Recipe — populate mock domain data for verification

When the operator asks to "populate mock data", "seed sample
records", or "make the empty state look real" — DO NOT edit a handler
to invent placeholder data. The responses render FROM the DB; changing
only code leaves you with the same empty rows.

**Do NOT reset reflexively.** Operator-seeded rows live in the
same tables; `/api/dev/reset` wipes everything. The correct flow
inspects first and only resets when existing data is structurally
unfixable (NULL on a field the handler requires, AND no way to fix it
without re-seeding):

```bash
# 1. SEE what's already there.
curl -sS http://localhost:8000/api/<resource-list-endpoint>
# If rows exist with the field the handler needs, do NOT seed — the
# handler side is what's wrong (auth wall, route mismatch, bug).
# Diagnose that instead.

# 2. Get the organization_id you'd seed INTO if rows are missing
# or have NULL on the field the handler needs.
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"email":"agent@dev.local"}' \
  http://localhost:8000/api/dev/login | jq -r '.organization.id'

# 3. Reset ONLY when existing rows are structurally wrong AND you
# can't UPDATE in place (/api/dev/seed is INSERT-only by design).
# Narrate the destruction out loud BEFORE running so the operator
# can stop you: "Clearing N existing rows so I can re-seed with
# the required field filled in." NEVER skip this announcement.
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"tables":["recipes"]}' \
  http://localhost:8000/api/dev/reset

# 4. Insert with EVERY column the handler reads.
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"raw":[{"table":"recipes","rows":[
    {"organization_id":"<UUID>","title":"...","slug":"...",
     "description":"..."}
  ]}]}' \
  http://localhost:8000/api/dev/seed
```

**There is NO PATCH endpoint** — `/api/dev/seed` only does INSERT and `/api/dev/reset` only does TRUNCATE. To "update" existing rows, reset the table first then re-insert with the new column values. This is intentional: the dev surface stays small, and the agent's mental model is "what should the DB look like" rather than "what's the column-level diff".

### Production safety

The whole dev router is wrapped in a guard middleware that throws
`NotFoundError` unless `devRoutesEnabled()` (the fail-closed
`ALCHEMIST_DEV_ROUTES` flag in `src/lib/dev-mode.ts`) is set. The
deployed customer pod never sets `ALCHEMIST_DEV_ROUTES`, so the routes
return 404 the same as if they had never been registered. (This
positive opt-in replaced an older fail-open `NODE_ENV !== "production"`
check, which exposed the routes on any pod whose env wiring was
incomplete.) Don't remove this guard — the routes bypass auth.

## Library version idioms — fight your training-data defaults

Every dependency below is pinned to a major version where the API changed in a way that LLM training data still gets wrong by default. Read this section _before_ reaching for muscle memory on any of these libraries. When training data and this section disagree, **this section wins** — the build will fail at deploy time if you guess wrong.

### Deno 2 (`denoland/deno:2.3.1` runtime)

`Deno.run` was REMOVED in Deno 2. Most training data is Deno 1.x.

| Subprocess      | Deno 2 (use this)                                                               | Deno 1 (do NOT use)                                     |
| --------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Spawn + capture | `await new Deno.Command("git", { args: ["status"], stdout: "piped" }).output()` | `Deno.run({ cmd: ["git", "status"], stdout: "piped" })` |
| Spawn + stream  | `new Deno.Command(...).spawn()`                                                 | `Deno.run(...)`                                         |

`Deno.serve` is the default HTTP server — already used in `main.ts`. Don't fall back to `Deno.listen` + `serveHttp`.

`Deno.env.get()` is unchanged. `Deno.readTextFile`, `Deno.writeTextFile`, `Deno.readDir` are unchanged. The breakage is concentrated on `Deno.run` and a few Deno-namespace helpers — when in doubt, run `deno doc --builtin Deno.<symbol>` to confirm the symbol still exists.

### Hono 4 (`hono@^4.6.0`)

`app.fire()` was removed. The custom-context typing pattern is now:

```typescript
type AppEnv = { Variables: { user: User; session: Session } };
const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  c.set("user", currentUser);
  await next();
});

app.get("/me", (c) => c.json({ user: c.get("user") }));
```

NOT the v3 `Hono.Variables` global augmentation pattern. Middleware that mutates the context type without the `Hono<{ Variables: ... }>` generic will type-check but `c.get(...)` will return `unknown` everywhere.

### MCP TypeScript SDK (`@modelcontextprotocol/sdk`)

The SDK is imported via bare specifier (mapped in `deno.json`):

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// Deno/Hono use the web-standard transport (consumes Request, returns Response).
// The Node `req/res` transport lives at .../server/streamableHttp.js instead.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
```

Tool registration uses `registerTool` (current stable), not the deprecated `.tool()`. `inputSchema` is a raw Zod shape (`ZodRawShape`) — a plain object of field→Zod validators — NOT a wrapped `z.object({...})` (the SDK wraps it for you). Passing `z.object(...)` type-errors under `strict` and breaks validation at runtime:

```ts
server.registerTool(
  "my_tool",
  {
    description: "...",
    inputSchema: { name: z.string() }, // raw shape, not z.object({ ... })
  },
  async (args) => ({ content: [{ type: "text", text: "..." }] }),
);
```

Sub-path imports require `.js` extensions (ESM). Never inline `npm:`, `jsr:`, or `https:` in source.

### Arctic 2 (`arctic@^2.0.0`)

Arctic 2.0 was a near-total rewrite (Sept 2024). The OOTB providers in `src/lib/oauth-providers.ts` are already on v2 — DO NOT rewrite them. If a ticket asks for a new provider, mirror the v2 pattern from the existing files, NOT the older v1 pattern from public docs.

The v2 idiom for token validation:

```typescript
const tokens = await provider.validateAuthorizationCode(code, codeVerifier);
const accessToken = tokens.accessToken();
const accessTokenExpiresAt = tokens.accessTokenExpiresAt();
const refreshToken = tokens.hasRefreshToken() ? tokens.refreshToken() : null;
```

NOT `tokens.accessToken` (property), NOT `OAuth2Tokens` returned as a plain object, NOT v1's `validateAuthorizationCode(code)` two-arg-less signature.

### date-fns 3 (`date-fns@^3.0.0`)

The default export was DROPPED. Use named imports only.

```typescript
// Correct
import { differenceInDays, format, parseISO } from "date-fns";
format(new Date(), "yyyy-MM-dd");

// Wrong — silently typechecks under Deno's npm: types but throws at runtime
import dateFns from "date-fns";
dateFns.format(new Date(), "yyyy-MM-dd");
```

date-fns 3 is also ESM-first. If you need locale support: `import { enUS } from "date-fns/locale"` (no `/dist/`).

### Stripe 17 (`stripe@^17.0.0`)

Pin the API version when constructing the client — the SDK major version and the API version must agree, otherwise the `Stripe.Checkout.Session.create({...})` call will type-check but fail at runtime with `parameter_invalid` for fields the older API didn't know about.

```typescript
import Stripe from "stripe";
const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2025-02-24.acacia" as Stripe.LatestApiVersion,
});
```

The platform-injected `STRIPE_SECRET_KEY` belongs to the customer's connected Stripe account. Do not hardcode another key.

## Self-Improvement Loop (Non-Negotiable)

After ANY correction from the user, **immediately** update this `CLAUDE.md` with the pattern. Write rules for yourself that prevent the same mistake. Review this file at session start for the relevant project area.

## Common Pitfalls

This section grows as mistakes are discovered. Check it before writing code.

- **`zValidator` must always pass `validationHook`** -- raw ZodError objects are unreadable to clients
- **Zod `.trim()` before `.min(1)` for name fields** -- whitespace-only strings pass `.min(1)`
- **JSONB columns return as strings** -- always `JSON.parse()` before using
- **Never `JSON.stringify()` for Kysely JSONB** -- pass objects directly, stringify double-encodes
- **`countAll()` returns string** -- wrap with `Number()`
- **`whereIn()` with empty array crashes** -- guard with early return
- **CamelCase in SELECT/INSERT, snake_case in WHERE/ORDER** -- the CamelCasePlugin only transforms result columns
- **Test isolation requires `createIsolatedUser()`** -- shared users cause FK violations in parallel tests
- **Deno 2: `Deno.run` removed** -- use `new Deno.Command(...)` (Deno 1 idiom is the default in training data)
- **Hono 4: custom context via `Hono<{ Variables: ... }>` generic** -- not v3 global `Hono.Variables` augmentation
- **Arctic 2: tokens are objects with method calls** -- `tokens.accessToken()`, not `tokens.accessToken`
- **date-fns 3: no default export** -- `import { format } from "date-fns"`, not `import dateFns from "date-fns"`
- **Stripe 17: pin `apiVersion` on the client** -- SDK major and API version must agree
- **MCP SDK: use `registerTool`, not `.tool()`** -- `.tool()` is deprecated
- **MCP `inputSchema` is a raw Zod shape** -- `{ name: z.string() }`, NOT `z.object({ name: z.string() })` (the SDK wraps it; passing `z.object(...)` breaks validation)
- **MCP sub-imports need `.js` extension** -- `@modelcontextprotocol/sdk/server/mcp.js`, not without `.js`
- **Bare specifiers only** -- never inline `npm:`, `jsr:`, or `https:` in source (no-import-prefix lint)
