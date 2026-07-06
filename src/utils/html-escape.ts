/**
 * Minimal HTML text escaping for server-rendered pages (the headless
 * template has no SPA -- the MCP OAuth consent/login pages are rendered
 * from Hono). Escape EVERY interpolated value, even server-validated ones.
 */
export function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
