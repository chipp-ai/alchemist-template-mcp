/**
 * renderMarkdownToHtml -- security + rendering tests.
 *
 * The renderer is the SECURITY BOUNDARY for the public server-rendered
 * /docs pages, so the XSS cases here are the load-bearing part: raw HTML,
 * event handlers, and non-allowlisted link schemes must all come out inert.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { renderMarkdownToHtml } from "@/services/docs/render-html.ts";

function assertNotIncludes(actual: string, needle: string) {
  assert(!actual.includes(needle), `Expected output NOT to include ${JSON.stringify(needle)}:\n${actual}`);
}

// ── XSS: raw HTML is always escaped ──

Deno.test("render-html: <script> tags are escaped, never emitted", () => {
  const html = renderMarkdownToHtml("hello <script>alert(1)</script> world");
  assertNotIncludes(html, "<script>");
  assertStringIncludes(html, "&lt;script&gt;alert(1)&lt;/script&gt;");
});

Deno.test("render-html: <img onerror> is escaped", () => {
  const html = renderMarkdownToHtml(`<img src=x onerror="alert(1)">`);
  assertNotIncludes(html, "<img");
  assertStringIncludes(html, "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

Deno.test("render-html: HTML inside a fenced code block is inert", () => {
  const html = renderMarkdownToHtml("```html\n<script>alert(1)</script>\n```");
  assertNotIncludes(html, "<script>");
  assertStringIncludes(html, "<pre><code");
  assertStringIncludes(html, "&lt;script&gt;");
});

Deno.test("render-html: HTML inside inline code is inert", () => {
  const html = renderMarkdownToHtml("use `<b>bold</b>` here");
  assertNotIncludes(html, "<b>");
  assertStringIncludes(html, "<code>&lt;b&gt;bold&lt;/b&gt;</code>");
});

Deno.test("render-html: HTML in link text is escaped", () => {
  const html = renderMarkdownToHtml("[<script>x</script>](https://example.com)");
  assertNotIncludes(html, "<script>");
  assertStringIncludes(html, `<a href="https://example.com"`);
  assertStringIncludes(html, "&lt;script&gt;x&lt;/script&gt;");
});

Deno.test("render-html: HTML in headings/tables/lists is escaped", () => {
  const html = renderMarkdownToHtml(
    "# Head <svg/onload=alert(1)>\n\n- item <iframe>\n\n| a<script> | b |\n| --- | --- |\n| <img src=x> | y |",
  );
  assertNotIncludes(html, "<svg");
  assertNotIncludes(html, "<iframe");
  assertNotIncludes(html, "<img");
  assertNotIncludes(html, "<script>");
});

// ── XSS: link scheme allowlist ──

Deno.test("render-html: javascript: links render as plain text", () => {
  // No literal parens in the href, so this exercises the scheme allowlist
  // itself (a parenthesized href never even matches the link syntax).
  const html = renderMarkdownToHtml("[click](javascript:alert%281%29)");
  assertNotIncludes(html, "<a ");
  assertNotIncludes(html, `href="javascript`);
  // The raw markdown survives as visible (escaped) text.
  assertStringIncludes(html, "[click]");
});

Deno.test("render-html: javascript: links with parens are also inert", () => {
  const html = renderMarkdownToHtml("[click](javascript:alert(1))");
  assertNotIncludes(html, "<a ");
  assertNotIncludes(html, `href="javascript`);
});

Deno.test("render-html: data: links render as plain text", () => {
  const html = renderMarkdownToHtml("[x](data:text/html;base64,PHNjcmlwdD4=)");
  assertNotIncludes(html, "<a ");
});

Deno.test("render-html: scheme smuggling via control chars is blocked", () => {
  // \u0001 is not regex-\s, so this DOES match the link syntax and
  // exercises sanitizeHref's control-char strip (-> "javascript:" -> reject).
  const html = renderMarkdownToHtml("[x](java\u0001script:alert%281%29)");
  assertNotIncludes(html, "<a ");
});

Deno.test("render-html: protocol-relative and bare-relative links are not linkified", () => {
  assertNotIncludes(renderMarkdownToHtml("[x](//evil.com)"), "<a ");
  assertNotIncludes(renderMarkdownToHtml("[x](evil.com)"), "<a ");
  assertNotIncludes(renderMarkdownToHtml("[x](/etc/passwd)"), "<a ");
});

Deno.test("render-html: href attribute cannot be broken out of", () => {
  const html = renderMarkdownToHtml(`[x](https://example.com/"onmouseover="alert(1))`);
  assertNotIncludes(html, `"onmouseover`);
  // The quote inside the href is entity-escaped, so it stays inside the attribute.
  assertStringIncludes(html, "&quot;onmouseover=&quot;");
});

Deno.test("render-html: allowlisted links pass", () => {
  assertStringIncludes(
    renderMarkdownToHtml("[a](https://example.com/x)"),
    `<a href="https://example.com/x" rel="noopener noreferrer">a</a>`,
  );
  assertStringIncludes(
    renderMarkdownToHtml("[b](http://localhost:8000/api/mcp)"),
    `<a href="http://localhost:8000/api/mcp"`,
  );
  assertStringIncludes(renderMarkdownToHtml("[c](mailto:hi@example.com)"), `<a href="mailto:hi@example.com">c</a>`);
  assertStringIncludes(renderMarkdownToHtml("[d](#section)"), `<a href="#section">d</a>`);
  assertStringIncludes(renderMarkdownToHtml("[e](/docs/tools)"), `<a href="/docs/tools">e</a>`);
  assertStringIncludes(renderMarkdownToHtml("[f](/docs)"), `<a href="/docs">f</a>`);
});

// ── Rendering: block constructs ──

Deno.test("render-html: headings render at the right level", () => {
  const html = renderMarkdownToHtml("# One\n\n## Two\n\n### Three");
  assertStringIncludes(html, "<h1>One</h1>");
  assertStringIncludes(html, "<h2>Two</h2>");
  assertStringIncludes(html, "<h3>Three</h3>");
});

Deno.test("render-html: fenced code block with language", () => {
  const html = renderMarkdownToHtml("```bash\necho hi\n```");
  assertStringIncludes(html, `<pre><code class="language-bash">echo hi</code></pre>`);
});

Deno.test("render-html: fenced code block preserves blank + markdown-looking lines", () => {
  const html = renderMarkdownToHtml("```\n# not a heading\n\n- not a list\n```");
  assertStringIncludes(html, "# not a heading\n\n- not a list");
  assertNotIncludes(html, "<h1>");
  assertNotIncludes(html, "<ul>");
});

Deno.test("render-html: bold, italic, inline code", () => {
  const html = renderMarkdownToHtml("**bold** and *ital* and `code`");
  assertStringIncludes(html, "<strong>bold</strong>");
  assertStringIncludes(html, "<em>ital</em>");
  assertStringIncludes(html, "<code>code</code>");
});

Deno.test("render-html: unordered and ordered lists", () => {
  const html = renderMarkdownToHtml("- one\n- two\n\n1. first\n2. second");
  assertStringIncludes(html, "<ul><li>one</li><li>two</li></ul>");
  assertStringIncludes(html, "<ol><li>first</li><li>second</li></ol>");
});

Deno.test("render-html: one level of list nesting", () => {
  const html = renderMarkdownToHtml("- parent\n  - child a\n  - child b\n- sibling");
  assertStringIncludes(html, "<li>parent<ul><li>child a</li><li>child b</li></ul></li>");
  assertStringIncludes(html, "<li>sibling</li>");
});

Deno.test("render-html: hanging-indent continuation joins the item", () => {
  const html = renderMarkdownToHtml("- start of item\n  continues here");
  assertStringIncludes(html, "<li>start of item continues here</li>");
});

Deno.test("render-html: GFM table renders header and body", () => {
  const html = renderMarkdownToHtml("| Col A | Col B |\n| --- | --- |\n| a1 | b1 |\n| a2 | b2 |");
  assertStringIncludes(html, "<table><thead><tr><th>Col A</th><th>Col B</th></tr></thead>");
  assertStringIncludes(html, "<tbody><tr><td>a1</td><td>b1</td></tr><tr><td>a2</td><td>b2</td></tr></tbody>");
});

Deno.test("render-html: table cells run inline transforms", () => {
  const html = renderMarkdownToHtml("| K | V |\n| --- | --- |\n| `code` | **bold** |");
  assertStringIncludes(html, "<td><code>code</code></td>");
  assertStringIncludes(html, "<td><strong>bold</strong></td>");
});

Deno.test("render-html: horizontal rule and paragraphs", () => {
  const html = renderMarkdownToHtml("para one\nstill one\n\n---\n\npara two");
  assertStringIncludes(html, "<p>para one still one</p>");
  assertStringIncludes(html, "<hr>");
  assertStringIncludes(html, "<p>para two</p>");
});

Deno.test("render-html: blockquote", () => {
  const html = renderMarkdownToHtml("> quoted line\n> second line");
  assertStringIncludes(html, "<blockquote><p>quoted line second line</p></blockquote>");
});

Deno.test("render-html: empty input renders to empty output", () => {
  assertEquals(renderMarkdownToHtml(""), "");
});
