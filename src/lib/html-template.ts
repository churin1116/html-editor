const PROSE_CSS = `
  :root { color-scheme: light dark; }
  body {
    max-width: 760px;
    margin: 4rem auto;
    padding: 0 1.5rem;
    font-family: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif;
    line-height: 1.8;
    color: #1a1a1a;
    background: #fafafa;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e8e8e8; background: #111; }
    pre { background: #1c1c1c !important; }
    code { background: #2a2a2a; }
    a { color: #79b8ff; }
    blockquote { border-left-color: #444; color: #aaa; }
  }
  h1, h2, h3, h4 { line-height: 1.3; margin-top: 2em; }
  h1 { font-size: 1.9rem; }
  h2 { font-size: 1.5rem; }
  h3 { font-size: 1.2rem; }
  p { margin: 1em 0; }
  a { color: #0366d6; }
  pre {
    background: #f6f8fa;
    padding: 1rem;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.9em;
  }
  code {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    background: rgba(127,127,127,0.15);
    padding: 0.15em 0.35em;
    border-radius: 3px;
    font-size: 0.9em;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 4px solid #ddd;
    padding-left: 1em;
    color: #666;
    margin: 1em 0;
  }
  ul, ol { padding-left: 1.5em; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 0.5em 0.75em; }
  th { background: rgba(127,127,127,0.1); }
  img { max-width: 100%; height: auto; }
  hr { border: none; border-top: 1px solid #ddd; margin: 2em 0; }
`.trim();

const CONTENT_OPEN = '<article id="content" data-html-editor="1">';
const CONTENT_CLOSE = "</article>";

export function wrapContent(innerHtml: string, title: string): string {
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${PROSE_CSS}</style>
</head>
<body>
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
