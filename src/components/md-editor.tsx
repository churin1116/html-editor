"use client";

import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { type MutableRefObject, useEffect, useMemo } from "react";

export function MdEditor({
  content,
  onChange,
  viewRef,
}: {
  content: string;
  onChange: (md: string) => void;
  viewRef?: MutableRefObject<EditorView | null>;
}) {
  useEffect(() => {
    return () => {
      if (viewRef) viewRef.current = null;
    };
  }, [viewRef]);

  const extensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      EditorView.theme(
        {
          "&": {
            height: "100%",
            backgroundColor: "var(--canvas)",
            color: "var(--text)",
            fontSize: "14px",
          },
          ".cm-scroller": {
            fontFamily:
              'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
            lineHeight: "1.7",
            padding: "2.5rem 5rem 6rem",
            maxWidth: "820px",
            margin: "0 auto",
          },
          ".cm-content": {
            caretColor: "var(--primary)",
          },
          ".cm-cursor, .cm-dropCursor": {
            borderLeftColor: "var(--primary)",
          },
          "&.cm-focused": {
            outline: "none",
          },
          "&.cm-focused .cm-selectionBackground, ::selection": {
            backgroundColor:
              "color-mix(in srgb, var(--primary) 22%, transparent)",
          },
          ".cm-selectionBackground": {
            backgroundColor:
              "color-mix(in srgb, var(--primary) 18%, transparent)",
          },
          ".cm-line": { padding: "0 4px" },
          ".cm-gutters": { display: "none" },
          ".cm-activeLine": { backgroundColor: "transparent" },
          ".cm-activeLineGutter": { backgroundColor: "transparent" },
          /* Markdown syntax-aware tokens */
          ".tok-heading1, .tok-heading2, .tok-heading3, .tok-heading4, .tok-heading5, .tok-heading6":
            {
              fontWeight: "600",
              color: "var(--text)",
            },
          ".tok-strong": { fontWeight: "700", color: "var(--text)" },
          ".tok-emphasis": { fontStyle: "italic", color: "var(--text)" },
          ".tok-link, .tok-url": { color: "var(--primary)" },
          ".tok-monospace, .tok-code": {
            color: "var(--text)",
            backgroundColor: "var(--surface-2)",
            padding: "0.05em 0.3em",
            borderRadius: "3px",
          },
          ".tok-quote": { color: "var(--text-muted)", fontStyle: "italic" },
          ".tok-meta, .tok-processingInstruction, .tok-punctuation": {
            color: "var(--text-subtle)",
          },
          ".tok-list": { color: "var(--text-muted)" },
        },
        { dark: false },
      ),
    ],
    [],
  );

  return (
    <div className="h-full overflow-hidden bg-canvas">
      <CodeMirror
        value={content}
        onChange={onChange}
        extensions={extensions}
        height="100%"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          indentOnInput: false,
        }}
        theme="none"
        onCreateEditor={(view) => {
          if (viewRef) viewRef.current = view;
        }}
      />
    </div>
  );
}
