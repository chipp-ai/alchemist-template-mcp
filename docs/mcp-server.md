# MCP Server at `/api/mcp`

## What was built

A working [Model Context Protocol](https://spec.modelcontextprotocol.io/) server
served over Streamable HTTP at `/api/mcp`. It ships with a minimal tool-registry
abstraction and a single example tool (`echo`) that exercises the full
initialize → tools/list → tools/call flow.

## Files

```
src/mcp/
  registry.ts          Tool registry (registerMcpTool / listMcpTools / getMcpTool)
  server.ts            McpServer factory (createMcpServer)
  tools/
    echo.ts            Example tool: echoes the input message

src/api/routes/mcp/
  index.ts             Hono sub-router that handles /api/mcp (and /api/mcp/)

src/__tests__/routes/
  mcp_route_test.ts    Integration tests: handshake, tools/list, tools/call,
                       Origin guard, real-app wiring
```

## Key design decisions

### Stateless transport (one transport per request)

`sessionIdGenerator: undefined` tells the SDK to run in stateless mode. A fresh
`McpServer` + transport is created per POST, `handleRequest` is called, and
the response streams out. This is the simplest correct model for a starter: no
sticky routing, no session GC, no connection-lifecycle complexity.

**Trade-off:** streaming server→client notifications and long-running tool calls
are not supported in stateless mode. If those are needed, switch to a stateful
transport (generate a `sessionId`, store the transport, route subsequent POSTs
to the same process).

### Side-effect registration pattern

Tools are registered by importing their module — the `registerMcpTool()` call is
at module top-level in each `src/mcp/tools/*.ts` file. `server.ts` imports
`"@/mcp/tools/echo.ts"` (and any future tools) before calling `listMcpTools()`.

**Adding a new tool:**

```ts
// src/mcp/tools/my_tool.ts
import { z } from "zod";
import { registerMcpTool } from "@/mcp/registry.ts";

registerMcpTool({
  name: "my_tool",
  description: "Does something useful",
  inputSchema: {
    input: z.string().describe("The input value"),
  },
  handler: async (args) => {
    const result = String(args.input);
    return { content: [{ type: "text", text: result }] };
  },
});
```

Then add `import "@/mcp/tools/my_tool.ts";` to `src/mcp/server.ts`.

### Origin guard (DNS-rebinding / CSRF protection)

The MCP spec requires HTTP servers to validate the `Origin` header to prevent
DNS-rebinding attacks. The app's global CORS reflects any origin with
credentials, so without this guard a malicious web page could POST to `/api/mcp`
from a victim's browser.

**The guard (in `src/api/routes/mcp/index.ts`):**

- No `Origin` header → allowed. All real MCP clients (Claude Desktop, IDE/CLI
  plugins, the Inspector proxy) are Node-based and send no Origin header.
- `Origin` present → allowed only if the origin is in `MCP_ALLOWED_ORIGINS`
  (comma-separated env var). Default is empty → all browser origins rejected.
- A present-but-blank `Origin:` counts as _present_, not absent: the guard tests
  `origin === null` (truly absent), never `!origin`, so an empty Origin is
  rejected rather than waved through. (Regression test: `mcp: rejects an empty
  Origin header`.)

Rejected requests get a JSON-RPC-shaped 403 body so MCP clients that do send an
Origin get a sensible error.

**`MCP_ALLOWED_ORIGINS` env var:** set this if you need a browser-based MCP
client to reach your server (e.g. a web-hosted inspector or custom web UI):

```
MCP_ALLOWED_ORIGINS=https://inspector.example.com,http://localhost:6274
```

### Dual mount (trailing-slash 404 fix)

Hono normalizes route matching strictly — `/api/mcp` does NOT match `/api/mcp/`.
A client or proxy that appends a trailing slash would get a JSON 404. Fix:
mount the sub-router at both forms in `app.ts`:

```ts
app.route("/api/mcp", mcpRoutes);
app.route("/api/mcp/", mcpRoutes);
```

Subpaths (`/api/mcp/foo`) still fall through to the JSON 404.

### No `{data}/{error}` envelope

The MCP route speaks the JSON-RPC / SSE wire format dictated by the MCP spec. It
returns the raw `Response` object from the SDK transport — bypassing the normal
`c.json({ data: ... })` envelope. This is a sanctioned exception (see the
api-layer rule).

### No authentication by default

`/api/mcp` is intentionally public for the starter. The example `echo` tool has
nothing sensitive; the origin guard is the appropriate hardening for a headless
server. When adding tools that access tenant data, add `requireAuth` middleware
**before** the transport handler and scope queries to the authenticated user's
organization.

## Public contract

```
POST /api/mcp        MCP Streamable HTTP — initialize, tools/list, tools/call
                     Content-Type: application/json  →  text/event-stream SSE

Env: MCP_ALLOWED_ORIGINS  comma-separated browser origins to allowlist (default: none)
```

## Connecting a client

```bash
# Claude Desktop (claude_desktop_config.json)
{
  "mcpServers": {
    "my-server": {
      "url": "http://localhost:8000/api/mcp",
      "transport": "http"
    }
  }
}

# MCP Inspector
npx @modelcontextprotocol/inspector http://localhost:8000/api/mcp

# curl smoke-test (initialize). The transport requires the client to accept
# both application/json and text/event-stream; the reply is an SSE envelope.
curl -s -X POST http://localhost:8000/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}'
```
