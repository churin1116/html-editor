const CHAMELEON_THEME_CSS = "https://churin1116.github.io/html-chameleon/theme/v1/theme.css";
const CHAMELEON_THEME_JS = "https://churin1116.github.io/html-chameleon/theme/v1/theme.js";

const PROSE_CSS = `
  body {
    max-width: 760px;
    margin: 4rem auto;
    padding: 0 1.5rem;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif;
    line-height: 1.8;
  }
  h1, h2, h3, h4 { line-height: 1.3; margin-top: 2em; }
  h1 { font-size: 1.9rem; }
  h2 { font-size: 1.5rem; }
  h3 { font-size: 1.2rem; }
  p { margin: 1em 0; }
  pre {
    background: var(--surface-2);
    padding: 1rem;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.9em;
  }
  code {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    background: var(--surface-2);
    padding: 0.15em 0.35em;
    border-radius: 3px;
    font-size: 0.9em;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 4px solid var(--border-strong);
    padding-left: 1em;
    color: var(--text-muted);
    margin: 1em 0;
  }
  ul, ol { padding-left: 1.5em; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid var(--border); padding: 0.5em 0.75em; }
  th { background: var(--surface); }
  img { max-width: 100%; height: auto; }
`.trim();

const CONTENT_OPEN = '<article id="content" data-html-editor="1">';
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

  const startIdx = fullHtml.indexOf(CONTENT_OPEN);
  if (startIdx === -1) {
    return { content: fullHtml, title };
  }
  const contentStart = startIdx + CONTENT_OPEN.length;
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
