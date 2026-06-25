# Design: MCP Server at /api/mcp

**Status:** implemented

## Problem

The template must expose a working Model Context Protocol (MCP) server over HTTP at `/api/mcp` so that projects generated with `template_key='mcp-server'` start with a functional, extensible MCP surface instead of a generic web app.

## Decision

Use the official MCP TypeScript SDK (`@modelcontextprotocol/sdk@^1.29.0`) with its web-standard streamable HTTP transport. Add a thin tool registry abstraction so tools are declared in one place and applied to each fresh `McpServer` instance per request (stateless mode).

### Key choices

- **Stateless transport only**: `WebStandardStreamableHTTPServerTransport` with no options (no `Mcp-Session-Id`, no server-side session map). Matches the SDK's own Hono example and keeps the starter minimal. Stateful/resumable sessions can be added later by swapping the route handler.
- **Tool registry**: `ToolRegistry` + `McpTool` interface + singleton `registry`. Tools self-register via side-effect imports from `src/mcp/tools/`. `createMcpServer()` builds a fresh server and calls `registry.applyTo(server)`.
- **Example tool**: `echo` — takes `{ message: string }` and returns it verbatim. Deterministic for tests and demonstrates the inputSchema-as-raw-shape contract.
- **Bare specifier**: SDK declared in `deno.json` as `"@modelcontextprotocol/sdk": "npm:@modelcontextprotocol/sdk@^1.29.0"`. No inline `npm:/jsr:/https:` in source.
- **Zod bump**: `^3.23.0` → `^3.25.0` to satisfy the SDK's peer dep floor (`zod ^3.25 || ^4.0`). All existing `z.*` usage is compatible.
- **No auth on the route**: Starter posture. Customers add `requireAuth` or their own middleware when they need it. Documented in a comment.
- **Route mount**: `app.route("/api/mcp", mcpRoutes)` before the static SPA fallback so `/api/mcp` reaches the transport, not `serveStatic`.

### Public contract

- `POST /api/mcp` with `Accept: application/json, text/event-stream`
  - JSON-RPC `initialize` → 200 + `{ result: { serverInfo: { name: "alchemist-template-mcp", ... }, capabilities: { tools: { listChanged: true } } } }`
  - JSON-RPC `tools/list` → 200 + `{ result: { tools: [{ name: "echo", description: "...", inputSchema: {...} }, ...] } }`
  - JSON-RPC `tools/call` with `{ name: "echo", arguments: { message: "x" } }` → 200 + `{ result: { content: [{ type: "text", text: "x" }] } }`
- SSE framing on responses (`event: message\ndata: <json>`) is handled by the SDK transport; callers parse the `data:` line.
- Adding a new tool: implement `McpTool`, export it, call `registerTool(...)` (or import the module), and it appears on `tools/list`.

### Gotchas

- `inputSchema` must be a Zod *raw shape* (`{ message: z.string() }`), not `z.object({...})`. The SDK's `registerTool` expects the former.
- Responses are SSE-framed; `res.json()` in tests will fail. Parse `data:` lines.
- Each request gets a fresh transport + server; do not store state across calls in the handler.
- CORS headers are already permissive in the template; stateless mode emits no session header so no extra `allowHeaders` needed for the starter.

## Rejected alternatives

- Using the Node-coupled `StreamableHTTPServerTransport` — does not work on Deno without an adapter.
- Stateful sessions in the starter — adds a session map, cleanup, and `Mcp-Session-Id` handling. Out of scope for a minimal starter.
- Mounting auth by default — would break the "immediately functional" goal for unauthenticated MCP clients during development.
- Hard-coding tools on `McpServer` without a registry — violates the explicit request for "a tool registry abstraction".
