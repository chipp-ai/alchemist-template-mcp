/**
 * Chipp Insights -- first-party browser analytics beacon.
 *
 * Every Alchemist customer template carries this same tiny wiring: when a
 * `chipp-insights.json` file (shaped `{"telemetryPublicKey": "tk_pub_..."}`)
 * exists at the repo root, the served HTML pages load
 * `https://build.chipp.ai/i/beacon.js` and identify the signed-in user after
 * a successful login. The file is written by the Alchemist platform at
 * provisioning time -- it is ABSENT in local dev and in any project that
 * hasn't been wired up yet.
 *
 * This template is headless (no SPA -- see README "What's in the box"), but
 * it still serves TWO real browser-facing HTML surfaces:
 *   1. `/docs` -- the public, server-rendered docs pages
 *      (src/api/routes/docs-html/index.ts)
 *   2. `/api/mcp/oauth/authorize` -- the server-rendered email-OTP login +
 *      consent screen a human uses to connect an MCP client (claude.ai,
 *      ChatGPT, Claude Code, ...) to their account
 *      (src/api/routes/mcp/oauth.ts)
 *
 * Both import `INSIGHTS_BEACON_SCRIPT_TAG` from here and splice it before
 * `</head>` in their HTML shell. `renderLoginPage()` in oauth.ts also fires
 * `window.chippInsights?.identify(email)` right after a successful
 * `/api/auth/verify-otp` call -- the only "successful login" moment this
 * headless template has in a browser context.
 *
 * Fails open by construction: the config load happens once at module
 * import (mirrors `src/config/brand.ts`'s boot-time env read) and any
 * failure -- missing file, malformed JSON, wrong shape -- is swallowed
 * with NO error/warn log. A project with no `chipp-insights.json` must
 * render every page exactly as it did before this module existed; this is
 * optional first-party telemetry, never a hard dependency, so it must
 * never be the thing that breaks a page render or fills the logs.
 */

import { escapeHtmlText } from "@/utils/html-escape.ts";

interface InsightsConfig {
  readonly telemetryPublicKey: string;
}

/**
 * Read `chipp-insights.json` from the repo root. This module lives at
 * `src/lib/`, so `../../` reaches the repo root (same relative-path
 * convention as `src/services/docs/registry.ts`'s `loadDoc`). Synchronous
 * because this is boot-time config, like `BRAND` -- but unlike `BRAND`,
 * absence is the expected common case, not a misconfiguration, so this
 * helper deliberately swallows every failure instead of throwing.
 */
function loadInsightsConfig(): InsightsConfig | null {
  try {
    const text = Deno.readTextFileSync(new URL("../../chipp-insights.json", import.meta.url));
    const parsed: unknown = JSON.parse(text);
    const key = (parsed as { telemetryPublicKey?: unknown } | null)?.telemetryPublicKey;
    if (typeof key === "string" && key.length > 0) {
      return { telemetryPublicKey: key };
    }
    return null;
  } catch {
    return null;
  }
}

const INSIGHTS_CONFIG = loadInsightsConfig();

/** True when `chipp-insights.json` was present and well-formed at boot. */
export const INSIGHTS_ENABLED: boolean = INSIGHTS_CONFIG !== null;

/**
 * `<script>` tag to splice before `</head>` in every server-rendered HTML
 * shell. Empty string when insights are not configured -- callers can
 * unconditionally interpolate this into their template with no branching.
 */
export const INSIGHTS_BEACON_SCRIPT_TAG: string = INSIGHTS_CONFIG
  ? `<script src="https://build.chipp.ai/i/beacon.js" data-project-key="${
    escapeHtmlText(INSIGHTS_CONFIG.telemetryPublicKey)
  }" async></script>`
  : "";
