// Post-process Tiptap output so saved HTML diffs cleanly against
// hand-authored or pandoc-generated source. Tiptap emits everything on a
// single line and drops the trailing slash from void elements; both make
// `git diff` unusable. We restore line breaks around block elements and
// self-close voids on the server side, after editing is done.

const BLOCK_TAGS =
  "section|article|aside|nav|header|footer|main|details|summary|h[1-6]|p|ul|ol|li|blockquote|pre|figure|figcaption|table|thead|tbody|tfoot|tr|td|th|hr|div|hgroup";

const VOID_TAGS = "area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr";

export function prettyPrintHtml(html: string): string {
  if (!html) return html;
  let result = html;
  result = result.replace(new RegExp(`(?<!^)(?<!\\n)(<(?:${BLOCK_TAGS})\\b)`, "gi"), "\n$1");
  result = result.replace(new RegExp(`(</(?:${BLOCK_TAGS})>)(?!\\n)`, "gi"), "$1\n");
  result = result.replace(/\n{3,}/g, "\n\n");
  if (!result.endsWith("\n")) result += "\n";
  return result;
}

export function selfCloseVoidTags(html: string): string {
  return html.replace(new RegExp(`<(${VOID_TAGS})\\b([^>]*?)(?<!/)>`, "gi"), "<$1$2/>");
}

// Strip <figure> wrappers around bare images whose caption is missing or
// whitespace-only. The editor inserts every dropped image as
// <figure><img><figcaption></figcaption></figure> so the editorial pattern is
// the default — but that wrapper would otherwise leak into pages where the
// user wanted a decorative / inline image (no caption). Unwrap rule: "user
// typed caption text" → keep the figure; "caption left blank" → treat the
// image as decorative and emit a bare <img>. Runs before prettyPrintHtml so
// the figure block is still on one line and easy to match.
export function unwrapEmptyFigures(html: string): string {
  return html.replace(
    /<figure\b[^>]*>\s*(<img\b[^>]*?\/?>)\s*(?:<figcaption\b[^>]*>\s*<\/figcaption>\s*)?<\/figure>/gi,
    "$1",
  );
}

// On load, fragment HTML often uses blank lines as visual section breaks
// (pandoc output, hand-written prose). Tiptap drops those literal whitespaces,
// so we materialize each run of blank lines as a single empty <p></p>
// placeholder. The reverse conversion happens on save in formatForSave.
export function preserveBlankLines(html: string): string {
  return html.replace(/\n[ \t]*(\n[ \t]*)+/g, "\n<p></p>\n");
}

export function formatForSave(html: string): string {
  let s = selfCloseVoidTags(html);
  s = unwrapEmptyFigures(s);
  // Re-inject newline after <br/> so hard breaks split <p> across lines.
  s = s.replace(/<br\/>(?!\n)/g, "<br/>\n");
  s = prettyPrintHtml(s);
  // Expand empty <p></p> placeholders (and any stray empties Tiptap added at
  // the document tail) back into blank lines.
  s = s.replace(/^[ \t]*<p>[ \t]*<\/p>[ \t]*\n/gm, "\n");
  // Collapse 3+ consecutive newlines to a single blank line.
  s = s.replace(/\n{3,}/g, "\n\n");
  // Single trailing newline, no trailing blank lines.
  s = s.replace(/\n+$/, "\n");
  return s;
}

// Save formatter for full HTML documents whose body interior must round-trip
// without spurious whitespace churn (e.g. translator pipeline outputs whose
// downstream tools diff against the file). Self-closes void tags and runs
// prettyPrintHtml so Tiptap's single-line output gets newlines between block
// tags (matching how the pipeline lays out files); when the input already has
// those newlines, prettyPrintHtml is a no-op so no-edit round-trips remain
// byte-perfect. Skips the post-<br/> newline insertion that formatForSave
// applies because translator pipelines keep <br/> inline inside poems.
export function formatBodyForSave(html: string): string {
  let s = selfCloseVoidTags(html);
  s = unwrapEmptyFigures(s);
  s = prettyPrintHtml(s);
  // Reverse the preserveBlankLines placeholders back into blank lines.
  s = s.replace(/^[ \t]*<p>[ \t]*<\/p>[ \t]*\n/gm, "\n");
  s = s.replace(/<p>[ \t]*<\/p>/g, "");
  s = s.replace(/\n{3,}/g, "\n\n");
  // Collapse <aside ...>\n<p>...</p>\n</aside> back onto a single line when
  // the aside contains a single <p> with no nested block. Matches the
  // gutenberg-translator footnote convention where asides are inline.
  s = s.replace(
    /(<aside\b[^>]*>)\n(<p\b[^>]*>(?:(?!<\/?p\b)[\s\S])*?<\/p>)\n(<\/aside>)/g,
    "$1$2$3",
  );
  // Boundary whitespace lives in the full-document prefix/suffix, so trim
  // leading/trailing newlines here to keep the body content boundary clean.
  s = s.replace(/^\n+/, "").replace(/\n+$/, "");
  return s;
}
