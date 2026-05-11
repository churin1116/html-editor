"use client";

import { extractImageFilesFromDataTransfer, uploadImage } from "@/lib/upload-image";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { type MutableRefObject, useEffect, useMemo } from "react";
import { toast } from "sonner";

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
      EditorView.domEventHandlers({
        paste: (event, view) => {
          const files = extractImageFilesFromDataTransfer(event.clipboardData);
          if (files.length === 0) return false;
          event.preventDefault();
          void uploadAndInsertMd(view, files);
          return true;
        },
        drop: (event, view) => {
          const files = extractImageFilesFromDataTransfer(event.dataTransfer);
          if (files.length === 0) return false;
          event.preventDefault();
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          void uploadAndInsertMd(view, files, pos ?? undefined);
          return true;
        },
      }),
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
            backgroundColor: "color-mix(in srgb, var(--primary) 22%, transparent)",
          },
          ".cm-selectionBackground": {
            backgroundColor: "color-mix(in srgb, var(--primary) 18%, transparent)",
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

async function uploadAndInsertMd(view: EditorView, files: File[], at?: number) {
  for (const file of files) {
    const toastId = toast.loading(`Uploading ${file.name || "image"}...`);
    try {
      const url = await uploadImage(file);
      const alt = (file.name || "image").replace(/[\[\]]/g, "");
      const markdownText = `![${alt}](${url})`;
      const pos = at ?? view.state.selection.main.head;
      view.dispatch({
        changes: { from: pos, to: pos, insert: markdownText },
        selection: { anchor: pos + markdownText.length },
      });
      toast.success("Image uploaded", { id: toastId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast.error(message, { id: toastId });
    }
  }
}
