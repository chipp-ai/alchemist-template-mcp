# ALCHEM3-8 — Verify the MCP-server starter template

**Status:** Shipped. Verification ticket; one functional fix (Dockerfile) + a docs completion.

## Problem

This repo is the headless `mcp-server` template (selected by
`create_project(template_key='mcp-server')`). The MCP server at `/api/mcp` was
built by sibling tickets (registry + `echo` tool + Origin guard + dual mount).
This ticket verifies the five acceptance checks end-to-end and files/fixes any
gap surfaced by check (5) "repo stays headless, diff backend-only."

The Svelte `web/` SPA was stripped in commit `d777b9c`, but the **`Dockerfile`
was never updated**: it still had a `node:20-alpine AS web-builder` stage that
ran `COPY web/package.json web/package-lock.json ./` and `npm run build`, then
the Deno builder did `COPY --from=web-builder /web/dist ./web/dist`. Against a
repo with no `web/` directory, the very first `COPY web/...` fails — so the
production Docker build of every project generated from this template would
fail at deploy time. This is the gap.

## Decision

Make the `Dockerfile` headless: delete the entire `web-builder` stage and the
`COPY --from=web-builder /web/dist ./web/dist` consumer; reword the two comments
that claimed the image folds in `web/dist/`. The Deno builder + runtime stages
are otherwise unchanged (same `deno check`, same healthcheck/EXPOSE/CMD).

Rejected alternative: file the Dockerfile as a follow-on rather than fix inline.
Rejected because it strictly fixes an always-failing build (no behavior to
preserve), the change is small and backend/infra-only (does not trip the UI
screenshot gate), and leaving it would fail the deploy this push triggers.

Also completed the documented MCP smoke-test flow: README and CLAUDE.md showed
`initialize` + `tools/list` but not `tools/call`. Added `tools/call` curl
examples (with the required `Accept: application/json, text/event-stream`
header) so the docs demonstrate the full `initialize → tools/list → tools/call`
flow the ticket verifies.

## Public contract (unchanged by this ticket — verified, not modified)

- `POST /api/mcp` and `POST /api/mcp/` — stateless Streamable HTTP. Requires
  `Content-Type: application/json` + `Accept: application/json, text/event-stream`.
  `initialize` → `serverInfo.name = "alchemist-mcp-server"`; `tools/list` lists
  `echo`; `tools/call echo {message}` → `content[0].text = message`.
- Origin guard: browser `Origin` header (incl. empty) → 403 unless allowlisted
  via `MCP_ALLOWED_ORIGINS`; no `Origin` (real MCP client) → 200.
- `@modelcontextprotocol/sdk` is a bare specifier in `deno.json`
  (`npm:@modelcontextprotocol/sdk@^1.0.0`); no inline `npm:`/`jsr:`/`https:` in source.

## Verification (all five checks demonstrated)

1. Live `POST /api/mcp`: initialize → `alchemist-mcp-server`; tools/list → echo;
   tools/call echo `{message:"ping"}` → `"ping"`. (real protocol round-trip)
2. `deno.json` bare specifier confirmed; `git grep` finds no inline prefixes in source.
3. `deno task check` exit 0; server boots on :8000; `/health` 200.
4. README + CLAUDE.md describe the template + add-a-tool recipe (now incl. tools/call).
5. No `web/`, no `serveStatic`; diff is Dockerfile + docs only. `docker build --check`
   passes with no warnings on the headless Dockerfile.
- Full suite: 93 passed / 0 failed. Verification sub-agent: VERDICT PASS (24 probes
  incl. missing/empty args, unknown tool, 100KB + unicode payloads, 406 on missing
  Accept, malformed JSON, 20-way concurrency).

## Gotchas

- This template has **no `test:db` task** — `deno task test` is the full suite
  (no DB-gating split). Don't reconcile a missing `test:db`.
- `ensure_local_dev_server` short-circuits (`dispatch_only_project`): boot the
  API by hand with `deno run … main.ts` and a `DATABASE_URL` for verification.
- Harmless leftover `web/` references in `.gitignore` (`web/dist/`) and
  `deno.json` lint `exclude` were intentionally left — they reference a
  non-existent path and break nothing; churning them only enlarges the diff.
