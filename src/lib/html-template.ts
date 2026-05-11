import { PROSE_CSS } from "./prose-css";

const CHAMELEON_THEME_CSS = "https://churin1116.github.io/html-chameleon/theme/v1/theme.css";
const CHAMELEON_THEME_JS = "https://churin1116.github.io/html-chameleon/theme/v1/theme.js";

const CONTENT_OPEN = '<article id="content" class="prose-canvas" data-html-editor="1">';
const CONTENT_CLOSE = "</article>";

export function wrapContent(innerHtml: string, title: string): string {
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="ja" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="chameleon" content="v1">
<title>${safeTitle}</title>
<link rel="stylesheet" href="${CHAMELEON_THEME_CSS}">
<script src="${CHAMELEON_THEME_JS}"></script>
<style>${PROSE_CSS}</style>
</head>
<body class="bg-canvas">
${CONTENT_OPEN}
${innerHtml}
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
