---
name: api-layer
description: HTTP API conventions — Hono route structure, zValidator + validationHook, the {data}/{error} response envelope, and the realtime/WebSocket surface. Load when adding or editing API routes.
paths:
  - "src/api/**"
  - "src/routes/**"
---

# API layer conventions

Authoritative for anything under `src/api/`. Routes are thin
orchestration; business logic lives in services (see the `services-jobs`
rule).

## Route structure

Routes live in `src/api/routes/`. Each route file exports a Hono app
mounted in the main router. Routes orchestrate; they never query the DB
directly — they call services.

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { validationHook } from "@/utils/zod-validation-hook.ts";

const app = new Hono();

app.get("/items", async (c) => {
  const items = await itemService.list();
  return c.json({ data: items });
});

app.post(
  "/items",
  zValidator("json", createItemSchema, validationHook),
  async (c) => {
    const body = c.req.valid("json");
    const item = await itemService.create(body);
    return c.json({ data: item }, 201);
  },
);

export default app;
```

## Request validation

- **`zValidator` MUST always pass `validationHook`** as the third argument. Without it, validation errors return a raw ZodError object and clients see `[object Object]` instead of a readable message.
- **Zod `.trim()` before `.min(1)` for name fields.** `z.string().min(1)` passes whitespace-only strings (`"   "` has length 3). Chain `.trim().min(1)` for user-facing name/label fields. Do not trim passwords or API keys.

## Response format

All endpoints return:
- **Success:** `{ data: T }` with appropriate status code (200, 201, 204)
- **Error:** `{ error: string, code: string }` with appropriate status code

Route catch blocks should re-throw `AppError` subclasses without logging
(the global error handler logs them). See the `services-jobs` rule for the
error-class table.

## Auth on routes

Protected routes use `requireAuth` middleware, which populates
`c.get("user")` and `c.get("session")`. Capability-gated routes use
`requireCapability("...")`. Both live in `src/api/middleware/auth.ts` —
see the `auth` rule for the role hierarchy + capability set.

## MCP route — exceptions to these conventions

The MCP server at `/api/mcp` (`src/api/routes/mcp/index.ts`) is a sanctioned
exception to several rules above:

- **No `zValidator` / `validationHook`.** The SDK handles JSON-RPC parsing and
  validation internally.
- **No `{data}/{error}` envelope.** The route returns the raw `Response` from
  the SDK transport (SSE body, `text/event-stream`), which is the MCP wire
  format. Standard envelope does not apply.
- **No `requireAuth` by default.** The endpoint is intentionally public for the
  starter. Add auth when adding tools that access sensitive data.
- **Origin guard is the CSRF control.** The route validates the `Origin` header
  (see DNS-rebinding note in the security checklist). No Hono-level CSRF
  middleware applies.

### Hono sub-router trailing-slash pitfall

Hono's strict route matching does NOT treat `/api/mcp` and `/api/mcp/` as
equivalent. If you mount only `app.route("/api/mcp", sub)`, then requests to
`/api/mcp/` fall through to the 404. Clients and proxies that normalize
configured URLs to a trailing slash will see confusing 404s.

**Fix:** mount the sub-router at both forms:

```ts
app.route("/api/mcp", mcpRoutes);
app.route("/api/mcp/", mcpRoutes);
```

Do NOT use `sub.all("*", …)` inside the sub-router — that swallows subpaths
(`/api/mcp/foo`) which should 404. Do NOT set `strict: false` on the top-level
app — that changes trailing-slash semantics for all existing routes.

## Realtime / WebSockets

The template ships a working WS surface so customer apps don't plumb auth
+ connection lifecycle from scratch:

- **`GET /api/auth/ws-token`** (auth-required) mints a 60-second JWT with `scope: "ws"`. Cookies don't reliably travel on cross-origin WS handshakes, so this token is the canonical way to authenticate a WS connection.
- **`GET /api/realtime/ws?token=<wsToken>`** verifies the token via `verifyWsToken` (`src/api/middleware/auth.ts`), upgrades the request, and runs a baseline echo loop (`src/api/routes/realtime/index.ts`). On open it sends `{ type: "hello", userId, organizationId, connectionId }`; on each text frame it replies `{ type: "echo", ... }`.

Add real features by replacing **the `socket.onmessage` branch** in
`src/api/routes/realtime/index.ts`. Keep the auth + open + close handlers
intact — they are load-bearing for attribution + log correlation.

**Scope segregation is enforced both ways**: `verifyToken` (session
middleware) rejects `scope: "ws"` tokens so an exfiltrated WS token can't
be used as a session cookie, and `verifyWsToken` rejects session tokens so
a leaked session cookie can't open a WS to another tenant.

```ts
// 1. Fetch a fresh token (uses the session cookie).
const { token } = await api.get<{ token: string }>("/auth/ws-token");
// 2. Open the WS with the token in the query string.
const ws = new WebSocket(`ws://${location.host}/api/realtime/ws?token=${encodeURIComponent(token)}`);
ws.onopen = () => ws.send("hello server");
ws.onmessage = (ev) => console.log("server →", ev.data);
```
