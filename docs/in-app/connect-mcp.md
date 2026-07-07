# Connect an MCP client

This server exposes a [Model Context Protocol](https://modelcontextprotocol.io) (MCP)
server over **Streamable HTTP**. Any MCP-capable client -- Claude Code, Claude
Desktop, claude.ai custom connectors, ChatGPT, Cursor, or your own agent -- can
connect to it and call the tools it publishes.

The live list of tools this server currently registers is at
[/docs/tools](/docs/tools).

## Endpoint

```
https://<your-domain>/api/mcp
```

- Transport: Streamable HTTP (POST JSON-RPC, responses stream back as SSE).
- The trailing-slash form (`/api/mcp/`) works too; other subpaths 404.
- There is no separate SSE endpoint -- modern clients only need the URL above.

## Authentication

The server's auth posture is controlled by the `MCP_AUTH_MODE` environment
variable on the deployment:

- **`public`** (the default) -- no credentials required. Anyone with the URL can
  call the tools. A presented token is still resolved (tools can personalize),
  it just is not required.
- **`oauth`** -- a Bearer token is **required** on every request.

Two token types are accepted, routed by prefix:

| Token | Who uses it | How to get one |
| --- | --- | --- |
| `mcp_at_...` OAuth 2.1 access token (primary) | Interactive clients: claude.ai connectors, ChatGPT, Claude Code, IDE clients | Automatic. The server ships its own OAuth 2.1 authorization server with discovery and dynamic client registration -- paste the server URL into your client and it walks you through a browser sign-in and consent page. No manual client registration. |
| `mcp_sk_...` API key (secondary) | Headless / server-to-server callers, CI | Minted by a signed-in team member via `POST /api/api-keys`; the plaintext is shown once. Send it as `Authorization: Bearer mcp_sk_...`. |

OAuth discovery documents live at
`https://<your-domain>/.well-known/oauth-authorization-server` and
`https://<your-domain>/.well-known/oauth-protected-resource`; in `oauth` mode an
unauthenticated request gets a 401 whose `WWW-Authenticate` header points
clients at them, so the whole flow is hands-free in mainstream clients.

## Claude Code

```
claude mcp add --transport http my-server https://<your-domain>/api/mcp
```

If the server runs in `oauth` mode, Claude Code opens a browser window for the
sign-in and consent step the first time you use it. To use an API key instead:

```
claude mcp add --transport http my-server https://<your-domain>/api/mcp --header "Authorization: Bearer mcp_sk_..."
```

## Claude Desktop

Add the server under `mcpServers` in `claude_desktop_config.json` (Settings >
Developer > Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "my-server": {
      "url": "https://<your-domain>/api/mcp",
      "transport": "http"
    }
  }
}
```

Alternatively, on paid Claude plans you can add it as a custom connector
(Settings > Connectors > Add custom connector) by pasting the endpoint URL --
the OAuth flow runs automatically.

## Cursor

Add the server to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json`
(global):

```json
{
  "mcpServers": {
    "my-server": {
      "url": "https://<your-domain>/api/mcp"
    }
  }
}
```

## Smoke test with curl

The transport requires clients to accept both JSON and SSE; the reply arrives
as an SSE envelope:

```bash
curl -s -X POST https://<your-domain>/api/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.0.1"}}}'
```

In `oauth` mode, add `-H 'Authorization: Bearer mcp_sk_...'`.

You can also point the MCP Inspector at it:

```bash
npx @modelcontextprotocol/inspector https://<your-domain>/api/mcp
```

## Browser-based clients

The server validates the `Origin` header (DNS-rebinding protection). Requests
without an Origin header -- which is every desktop/CLI MCP client -- pass
through. Browser-issued requests are rejected unless the deployment
allowlists the origin via the `MCP_ALLOWED_ORIGINS` environment variable
(comma-separated origins).

## Paid tools

Some tools may be monetized. A call that is not yet paid for or entitled does
not error opaquely: the tool result explains what is required and, where
applicable, includes a checkout link. Tool descriptions advertise their cost
up front, so agents can surface it before calling.
