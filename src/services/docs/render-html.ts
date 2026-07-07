/**
 * Secure markdown -> HTML renderer for the server-rendered `/docs` pages.
 *
 * THIS MODULE IS THE SECURITY BOUNDARY for everything the HTML docs
 * surface emits. The docs are self-authored developer content, but they
 * are rendered on a PUBLIC route, so the renderer treats them as
 * untrusted anyway:
 *
 *   1. ESCAPE FIRST. Every character of the source markdown is
 *      HTML-entity-escaped before any transform runs. There is NO raw
 *      HTML passthrough, ever -- `<script>` in a doc renders as the
 *      literal text "<script>".
 *   2. Allowlisted links only. `[text](href)` becomes an anchor ONLY
 *      when the href is http(s), mailto:, a `#fragment`, or a relative
 *      `/docs/...` path. Anything else (javascript:, data:, vbscript:,
 *      protocol-relative //, bare relative paths) renders as plain text.
 *
 * Supported subset (all these docs need, nothing more): #..###### headings,
 * fenced code blocks (``` with optional language), inline `code`,
 * **bold**, *italic*, unordered/ordered lists (one nesting level),
 * links, paragraphs, horizontal rules, > blockquotes, and simple GFM
 * pipe tables.
 *
 * Never render docs markdown to HTML any other way -- if a new surface
 * needs HTML docs, it must call `renderMarkdownToHtml`.
 */

/** Escape ALL HTML-significant characters. Runs before every transform. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Validate a link target against the allowlist. Returns the href to emit,
 * or null when the link must be rendered as plain text instead.
 *
 * The input arrives ALREADY entity-escaped (so a `"` can never terminate
 * the href attribute), but scheme smuggling via control chars / whitespace
 * (`java\tscript:`) is still possible in the raw text -- strip those before
 * matching the scheme.
 */
function sanitizeHref(escapedHref: string): string | null {
  const cleaned = escapedHref.replace(/[\u0000-\u0020]/g, "");
  const lower = cleaned.toLowerCase();
  if (/^https?:\/\//.test(lower)) return cleaned;
  if (lower.startsWith("mailto:")) return cleaned;
  if (cleaned.startsWith("#")) return cleaned;
  if (cleaned === "/docs" || cleaned.startsWith("/docs/")) return cleaned;
  return null;
}

/**
 * Inline transforms on a single already-block-classified chunk of text.
 * Escapes first, then: inline code (protected from further transforms via
 * placeholders), links (allowlisted), **bold**, *italic*.
 */
function renderInline(raw: string): string {
  let s = escapeHtml(raw);

  // Inline code spans are lifted out first so their contents are never
  // touched by the link/bold/italic passes (code often contains * and []).
  const codeSpans: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `\u0000${codeSpans.length - 1}\u0000`;
  });

  // Links -- allowlisted href or the whole match stays plain text.
  s = s.replace(
    /\[([^\]]+)\]\(([^()\s]+)\)/g,
    (match, text: string, href: string) => {
      const safe = sanitizeHref(href);
      if (safe === null) return match;
      const external = /^https?:/i.test(safe);
      const rel = external ? ` rel="noopener noreferrer"` : "";
      return `<a href="${safe}"${rel}>${text}</a>`;
    },
  );

  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  // Restore protected code spans.
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codeSpans[Number(i)] ?? "");
  return s;
}

// ── Block-level parsing ──

const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function isListLine(line: string): boolean {
  return LIST_ITEM_RE.test(line);
}

/** A GFM table separator row: | --- | :---: | etc. Must contain a dash. */
function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return /^\|?[\s:|-]+\|?$/.test(t) && t.includes("-") && t.includes("|");
}

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

interface ListNode {
  ordered: boolean;
  items: { text: string; child: ListNode | null }[];
}

function renderList(list: ListNode): string {
  const tag = list.ordered ? "ol" : "ul";
  const items = list.items
    .map((it) => {
      const child = it.child ? renderList(it.child) : "";
      return `<li>${renderInline(it.text)}${child}</li>`;
    })
    .join("");
  return `<${tag}>${items}</${tag}>`;
}

/**
 * Render a strict markdown subset to safe HTML. See module doc for the
 * security contract (escape-first, link allowlist, no raw HTML ever).
 */
export function renderMarkdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line -- block separator.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block. Contents are escaped verbatim; no inline
    // transforms run inside (HTML in code blocks stays inert text).
    const fence = line.match(/^```([A-Za-z0-9_-]*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip the closing fence (or run off the end -- unterminated fence)
      const cls = lang ? ` class="language-${lang}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // Heading.
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // GFM pipe table: header row + separator row.
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${headers.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead>`;
      const tbody = rows.length
        ? `<tbody>${
          rows
            .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`)
            .join("")
        }</tbody>`
        : "";
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // Blockquote -- consecutive `>`-prefixed lines join into one quote.
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote><p>${renderInline(buf.join(" "))}</p></blockquote>`);
      continue;
    }

    // Lists (unordered/ordered, one nesting level). Indented non-marker
    // lines continue the previous item.
    if (isListLine(line)) {
      const first = line.match(LIST_ITEM_RE)!;
      const root: ListNode = { ordered: /^\d+\.$/.test(first[2]), items: [] };
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === "") break;
        const m = l.match(LIST_ITEM_RE);
        if (m) {
          const indent = m[1].length;
          const ordered = /^\d+\.$/.test(m[2]);
          if (indent >= 2 && root.items.length > 0) {
            const parent = root.items[root.items.length - 1];
            if (!parent.child) parent.child = { ordered, items: [] };
            parent.child.items.push({ text: m[3], child: null });
          } else {
            root.items.push({ text: m[3], child: null });
          }
          i++;
          continue;
        }
        // Hanging-indent continuation line -> append to the newest item.
        if (/^\s{2,}\S/.test(l) && root.items.length > 0) {
          const parent = root.items[root.items.length - 1];
          const target = parent.child ? parent.child.items[parent.child.items.length - 1] : parent;
          target.text += ` ${l.trim()}`;
          i++;
          continue;
        }
        break;
      }
      out.push(renderList(root));
      continue;
    }

    // Paragraph -- consecutive plain lines join with spaces.
    const buf: string[] = [line.trim()];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (
        l.trim() === "" ||
        /^```/.test(l) ||
        /^#{1,6}\s/.test(l) ||
        /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l) ||
        /^\s*>\s?/.test(l) ||
        isListLine(l) ||
        (l.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
      ) {
        break;
      }
      buf.push(l.trim());
      i++;
    }
    out.push(`<p>${renderInline(buf.join(" "))}</p>`);
  }

  return out.join("\n");
}
