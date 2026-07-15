// Single source of truth for the prose CSS applied to article content.
// Used both at save time (injected into the standalone HTML <style> tag)
// and at edit time (injected into the editor view) so files look the
// same in either context.
//
// Scoped to .prose-canvas. The standalone HTML adds that class to <article>;
// the editor adds it to the TipTap editable container.
// Shared with the Markdown editor (md-prose.ts / md-editor.tsx) so raw .md
// editing shows the same typography as saved Chameleon HTML.
export const PROSE_FONT = `-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif`;
export const PROSE_MONO_FONT = `ui-monospace, "SF Mono", Menlo, monospace`;
// h1..h6 — single source for .prose-canvas below and the Markdown editor's
// heading line classes.
export const PROSE_HEADING_SIZES = ["1.9rem", "1.5rem", "1.2rem", "1.05rem", "1rem", "0.9rem"];

export const PROSE_CSS = `
.prose-canvas {
  max-width: 760px;
  margin: 4rem auto;
  padding: 0 1.5rem;
  font-family: ${PROSE_FONT};
  line-height: 1.8;
  color: var(--text);
}
.prose-canvas h1,
.prose-canvas h2,
.prose-canvas h3,
.prose-canvas h4,
.prose-canvas h5,
.prose-canvas h6 { line-height: 1.3; margin-top: 2em; font-weight: 600; }
${PROSE_HEADING_SIZES.map((size, i) => `.prose-canvas h${i + 1} { font-size: ${size}; }`).join("\n")}
.prose-canvas p { margin: 1em 0; }
/* 強調 (em / i) は斜体ではなく傍点 (・) で示す。和文に真の斜体は無く傾けると
   不自然なため、日本語前提で傍点を既定とする (gutenberg-translator の EPUB/PDF
   出力と揃える)。エディタでは内容が Latin 主体のとき data-content-lang="other"
   で斜体に戻す (globals.css)。 */
.prose-canvas em,
.prose-canvas i {
  font-style: normal;
  -webkit-text-emphasis-style: filled dot;
  text-emphasis-style: filled dot;
}
.prose-canvas a {
  color: var(--text);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: var(--border-strong);
}
.prose-canvas a:hover { text-decoration-color: var(--text); }
.prose-canvas pre {
  background: var(--surface-2);
  padding: 1rem;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 0.9em;
  line-height: 1.6;
  font-family: ${PROSE_MONO_FONT};
}
.prose-canvas code {
  font-family: ${PROSE_MONO_FONT};
  background: var(--surface-2);
  padding: 0.15em 0.35em;
  border-radius: 3px;
  font-size: 0.9em;
}
.prose-canvas pre code { background: none; padding: 0; }
.prose-canvas blockquote {
  border-left: 4px solid var(--border-strong);
  padding-left: 1em;
  color: var(--text-muted);
  margin: 1em 0;
}
.prose-canvas ul { list-style: disc; padding-left: 1.5em; margin: 1em 0; }
.prose-canvas ol { list-style: decimal; padding-left: 1.5em; margin: 1em 0; }
.prose-canvas li { display: list-item; }
.prose-canvas table { border-collapse: collapse; width: 100%; margin: 1em 0; }
.prose-canvas th,
.prose-canvas td { border: 1px solid var(--border); padding: 0.5em 0.75em; text-align: left; }
.prose-canvas th { background: var(--surface); font-weight: 600; }
.prose-canvas img { max-width: 100%; height: auto; }
.prose-canvas hr { border: 0; height: 1px; background: var(--border); margin: 2em 0; }
.prose-canvas details {
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  margin: 1em 0;
  background: color-mix(in srgb, var(--surface) 50%, transparent);
}
.prose-canvas summary {
  cursor: pointer;
  padding: 0.5em 0.85em;
  font-weight: 500;
  user-select: none;
  list-style: none;
  color: var(--text);
}
.prose-canvas summary::-webkit-details-marker { display: none; }
.prose-canvas summary::before {
  content: "▸";
  display: inline-block;
  margin-right: 0.45em;
  color: var(--text-muted);
  transition: transform 140ms ease;
}
.prose-canvas details[open] > summary::before { transform: rotate(90deg); }
.prose-canvas details > *:not(summary) { padding-left: 0.85em; padding-right: 0.85em; }
.prose-canvas details > *:last-child:not(summary) { padding-bottom: 0.6em; }
`.trim();
