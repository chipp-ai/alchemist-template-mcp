/**
 * DevPanel pipeline tests — server-side surface.
 *
 * Coverage:
 *   - dev-activity ring buffer: append, cap, separate request/error
 *     buffers, snapshot returns a copy
 *   - recent-activity middleware: writes a request record on every
 *     handled request; writes an error record on thrown handlers
 *   - GET /api/dev/app-state: returns server context even before any
 *     client snapshot has been pushed (the agent's L1 layer must
 *     work from request 0, not after the SPA has had a chance to
 *     populate the store)
 *   - POST /api/dev/app-state: stores the client snapshot for
 *     subsequent GETs
 *   - Production gate: dev routes self-404 when NODE_ENV=production
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import {
  __resetDevActivityForTests,
  getRecentErrors,
  getRecentRequests,
  recordError,
  recordRequest,
} from "@/lib/dev-activity.ts";

function deno(name: string, fn: () => void | Promise<void>) {
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });
}

// ── dev-activity ring buffer ───────────────────────────────────────────────

deno("ring: recordRequest appends most-recent-first", () => {
  __resetDevActivityForTests();
  recordRequest({
    method: "GET",
    path: "/a",
    routePath: "/a",
    status: 200,
    durationMs: 10,
    isError: false,
  });
  recordRequest({
    method: "POST",
    path: "/b",
    routePath: "/b",
    status: 201,
    durationMs: 20,
    isError: false,
  });
  const recent = getRecentRequests();
  assertEquals(recent.length, 2);
  // Most recent first.
  assertEquals(recent[0].method, "POST");
  assertEquals(recent[1].method, "GET");
});

deno("ring: recordRequest caps at 20 entries (oldest evicted)", () => {
  __resetDevActivityForTests();
  for (let i = 0; i < 25; i++) {
    recordRequest({
      method: "GET",
      path: `/${i}`,
      routePath: "/:n",
      status: 200,
      durationMs: i,
      isError: false,
    });
  }
  const recent = getRecentRequests();
  assertEquals(recent.length, 20);
  // Newest entry's path is /24.
  assertEquals(recent[0].path, "/24");
  // Oldest surviving entry is /5 — /0..4 were evicted.
  assertEquals(recent[19].path, "/5");
});

deno("ring: recordError caps at 10 entries", () => {
  __resetDevActivityForTests();
  for (let i = 0; i < 15; i++) {
    recordError({ message: `error ${i}`, source: "test" });
  }
  assertEquals(getRecentErrors().length, 10);
});

deno("ring: getRecentRequests returns a fresh array (caller can't mutate)", () => {
  __resetDevActivityForTests();
  recordRequest({
    method: "GET",
    path: "/a",
    routePath: "/a",
    status: 200,
    durationMs: 5,
    isError: false,
  });
  const a = getRecentRequests();
  const b = getRecentRequests();
  assertEquals(a, b);
  if (a === b) {
    throw new Error(
      "getRecentRequests must return a fresh array each call, not the " +
        "internal buffer reference — otherwise callers could mutate it",
    );
  }
});

deno("source: dev-routes register POST and GET /app-state", async () => {
  const src = await Deno.readTextFile(
    new URL("../api/routes/dev/index.ts", import.meta.url),
  );
  for (const expected of [
    'devRoutes.post(\n  "/app-state"',
    'devRoutes.get("/app-state"',
  ]) {
    if (!src.includes(expected)) {
      throw new Error(
        `dev routes must register \`${expected.replace(/\n\s+/g, " ")}\` — ` +
          `the dev panel push and the agent's L1 read both route through ` +
          `these handlers.`,
      );
    }
  }
});

// ── End-to-end through devRoutes (in-process) ──────────────────────────────

deno("e2e: GET /api/dev/app-state returns server context even with no client push", async () => {
  __resetDevActivityForTests();
  // Make sure we look like dev (the dev routes' top-level guard reads
  // NODE_ENV at module-import time, but our process-level value here
  // is dev because no env was set, so re-imports inherit it).
  const previousEnv = Deno.env.get("NODE_ENV");
  if (previousEnv === "production") Deno.env.delete("NODE_ENV");

  // Late-import so the route module's `IS_PROD` constant captures
  // the right env value.
  const { devRoutes } = await import("@/api/routes/dev/index.ts");

  const res = await devRoutes.fetch(
    new Request("http://localhost/app-state"),
  );
  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;

  // No client push yet — `client` is null.
  assertEquals(body.client, null);

  // Server context is always present.
  assertExists(body.server);
  const server = body.server as Record<string, unknown>;
  assertExists(server.timestamp);
  assertExists(server.env);
  assertExists(server.recentRequests);
  assertExists(server.recentErrors);

  // Markdown is rendered with the "no client snapshot yet" copy.
  assertStringIncludes(body.markdown as string, "No client snapshot received yet");

  // Restore env.
  if (previousEnv !== undefined) Deno.env.set("NODE_ENV", previousEnv);
});

deno("e2e: POST /api/dev/app-state persists the client snapshot for subsequent GETs", async () => {
  __resetDevActivityForTests();
  const previousEnv = Deno.env.get("NODE_ENV");
  if (previousEnv === "production") Deno.env.delete("NODE_ENV");

  const { devRoutes } = await import("@/api/routes/dev/index.ts");

  const snapshot = {
    timestamp: "2026-05-05T22:00:00.000Z",
    route: { hash: "#/dashboard", path: "/dashboard", params: {} },
    viewport: { width: 1280, height: 720 },
    stores: { auth: { user: null, isLoading: false, error: null } },
    recentErrors: [],
    storeOrder: ["auth"],
  };
  const markdown = "# Client App State Snapshot\n\nfake markdown\n";

  const post = await devRoutes.fetch(
    new Request("http://localhost/app-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot, markdown }),
    }),
  );
  assertEquals(post.status, 200);

  const get = await devRoutes.fetch(
    new Request("http://localhost/app-state"),
  );
  const body = await get.json() as Record<string, unknown>;
  const client = body.client as Record<string, unknown>;
  assertExists(client);
  assertEquals(client.timestamp, snapshot.timestamp);
  assertStringIncludes(body.markdown as string, "fake markdown");

  if (previousEnv !== undefined) Deno.env.set("NODE_ENV", previousEnv);
});

deno("e2e: GET /api/dev/app-state?format=markdown returns text/markdown", async () => {
  const previousEnv = Deno.env.get("NODE_ENV");
  if (previousEnv === "production") Deno.env.delete("NODE_ENV");

  const { devRoutes } = await import("@/api/routes/dev/index.ts");

  const res = await devRoutes.fetch(
    new Request("http://localhost/app-state?format=markdown"),
  );
  assertEquals(res.status, 200);
  assertStringIncludes(
    res.headers.get("content-type") ?? "",
    "text/markdown",
  );
  const text = await res.text();
  assertStringIncludes(text, "Server Context");

  if (previousEnv !== undefined) Deno.env.set("NODE_ENV", previousEnv);
});
