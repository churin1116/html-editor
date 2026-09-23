// The .prose-canvas article typography itself lives in the Chameleon theme
// (theme/v1/theme.css § PROSE CANVAS), so it is baked into saved files with
// the theme and reaches already-saved files through the extension's live
// override. These constants mirror it for the Markdown editor (md-prose.ts /
// md-editor.tsx), which styles CodeMirror in JS — keep them in sync.
export const PROSE_FONT = `-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif`;
export const PROSE_MONO_FONT = `ui-monospace, "SF Mono", Menlo, monospace`;
// h1..h6 — the Markdown editor's heading line classes.
export const PROSE_HEADING_SIZES = ["1.9rem", "1.5rem", "1.2rem", "1.05rem", "1rem", "0.9rem"];
