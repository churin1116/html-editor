import {
  CHAMELEON_CONTRACT,
  CHAMELEON_CSS,
  CHAMELEON_JS,
  CHAMELEON_VERSION,
} from "./chameleon-theme.generated";
import { formatForSave } from "./html-pretty";
import { PROSE_CSS } from "./prose-css";

const CONTENT_OPEN = '<article id="content" class="prose-canvas" data-html-editor="1">';
const CONTENT_CLOSE = "</article>";

// The Chameleon theme is baked (inlined) into every saved file rather than
// referenced from the hosted copy: files render offline / via file:// and
// never restyle themselves when the hosted theme moves. The meta tag carries
// the update policy (content, e.g. "^1") and the exact baked version
// (data-baked) so `pnpm rebake` can upgrade files semver-style later.
// Files saved by older editor versions carried an external <link>/<script>;
// their <head> is regenerated on every save, so they migrate automatically.
export function wrapContent(innerHtml: string, title: string): string {
  const safeTitle = escapeHtml(title);
  const formattedInner = formatForSave(innerHtml).replace(/\n$/, "");
  return `<!doctype html>
<html lang="ja" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="chameleon" content="${CHAMELEON_CONTRACT}" data-baked="${CHAMELEON_VERSION}">
<title>${safeTitle}</title>
<style data-chameleon-theme>${CHAMELEON_CSS}</style>
<script data-chameleon-theme>${CHAMELEON_JS}</script>
<style>${PROSE_CSS}</style>
</head>
<body class="bg-canvas">
${CONTENT_OPEN}
${formattedInner}
${CONTENT_CLOSE}
</body>
</html>
`;
}

export function unwrapContent(fullHtml: string): { content: string; title: string } {
  const titleMatch = fullHtml.match(/<title>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? unescapeHtml(titleMatch[1].trim()) : "";

  // Tolerant match for any attribute order; covers files written by older
  // versions of this template (no .prose-canvas class) as well as new ones.
  const openMatch = fullHtml.match(
    /<article\b[^>]*\bid=["']content["'][^>]*\bdata-html-editor=["']1["'][^>]*>/i,
  );
  if (!openMatch || openMatch.index === undefined) {
    return { content: fullHtml, title };
  }
  const contentStart = openMatch.index + openMatch[0].length;
  const endIdx = fullHtml.lastIndexOf(CONTENT_CLOSE);
  if (endIdx === -1 || endIdx < contentStart) {
    return { content: fullHtml, title };
  }
  return { content: fullHtml.slice(contentStart, endIdx).trim(), title };
}

export function isManagedHtml(fullHtml: string): boolean {
  return fullHtml.includes('data-html-editor="1"');
}

export type HtmlShape = "managed" | "fragment" | "full-document";

// Classify an on-disk HTML file. Files this editor created or has previously
// rewrapped carry `data-html-editor="1"` and round-trip cleanly. Files
// without that marker but with doctype / <html> / <head> / <body> are
// hand-authored full documents — Tiptap would silently drop those wrappers
// on parse, so we treat them as read-only. Everything else is a fragment.
export function classifyHtml(raw: string): HtmlShape {
  if (isManagedHtml(raw)) return "managed";
  if (/<!doctype\s+html/i.test(raw)) return "full-document";
  if (/<html[\s>]/i.test(raw)) return "full-document";
  if (/<head[\s>]/i.test(raw)) return "full-document";
  if (/<body[\s>]/i.test(raw)) return "full-document";
  return "fragment";
}

export type FullDocumentSplit = {
  prefix: string;
  bodyContent: string;
  suffix: string;
};

// Split a full HTML document into the head/wrap that must be preserved and
// the body interior that Tiptap is allowed to edit. The split is exact —
// joinFullDocument(split(raw)) === raw whenever this returns non-null.
//
// Returns null when <body> or </body> can't be located, in which case the
// caller should fall back to read-only behavior. Boundary whitespace right
// inside <body>...</body> (e.g. the blank line that translator-output files
// keep between <body> and the first <div>) is absorbed into prefix/suffix so
// it round-trips byte-identically without flowing through Tiptap.
export function splitFullDocument(raw: string): FullDocumentSplit | null {
  const openMatch = raw.match(/<body\b[^>]*>/i);
  if (!openMatch || openMatch.index === undefined) return null;
  const bodyOpenEnd = openMatch.index + openMatch[0].length;
  const closeIdx = raw.toLowerCase().lastIndexOf("</body>");
  if (closeIdx < bodyOpenEnd) return null;
  let contentStart = bodyOpenEnd;
  while (contentStart < closeIdx && /\s/.test(raw[contentStart])) contentStart++;
  let contentEnd = closeIdx;
  while (contentEnd > contentStart && /\s/.test(raw[contentEnd - 1])) contentEnd--;
  return {
    prefix: raw.slice(0, contentStart),
    bodyContent: raw.slice(contentStart, contentEnd),
    suffix: raw.slice(contentEnd),
  };
}

export function joinFullDocument(split: FullDocumentSplit, newBody: string): string {
  return split.prefix + newBody + split.suffix;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
