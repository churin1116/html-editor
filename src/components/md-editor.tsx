"use client";

import { mdProse } from "@/lib/md-prose";
import { PROSE_FONT } from "@/lib/prose-css";
import { loadScroll, saveScroll } from "@/lib/scroll-memory";
import { extractImageFilesFromDataTransfer, uploadImage } from "@/lib/upload-image";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export function MdEditor({
  content,
  onChange,
  viewRef,
  path,
}: {
  content: string;
  onChange: (md: string) => void;
  viewRef?: MutableRefObject<EditorView | null>;
  path?: string;
}) {
  const [view, setView] = useState<EditorView | null>(null);
  const restoredPathRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (viewRef) viewRef.current = null;
    };
  }, [viewRef]);

  // Restore on file switch / initial mount / external content replacement.
  useEffect(() => {
    if (!view || !path) return;
    const el = view.scrollDOM;
    const externalChange = view.state.doc.toString() !== content;
    if (externalChange || restoredPathRef.current !== path) {
      restoredPathRef.current = path;
      const savedTop = loadScroll(path);
      const id = requestAnimationFrame(() => {
        el.scrollTop = savedTop;
      });
      return () => cancelAnimationFrame(id);
    }
  }, [view, path, content]);

  // Save on scroll (throttled) + flush on page hide.
  useEffect(() => {
    if (!view || !path) return;
    const el = view.scrollDOM;
    let timer: number | null = null;
    const flush = () => {
      saveScroll(path, el.scrollTop);
      timer = null;
    };
    const onScroll = () => {
      if (timer != null) return;
      timer = window.setTimeout(flush, 200);
    };
    const onPageHide = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
      saveScroll(path, el.scrollTop);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onPageHide);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      if (timer != null) {
        window.clearTimeout(timer);
        saveScroll(path, el.scrollTop);
      }
    };
  }, [view, path]);

  const extensions = useMemo(
    () => [
      // markdownLanguage = GFM (tables, strikethrough, task lists) — the
      // default base is CommonMark only.
      markdown({ base: markdownLanguage }),
      mdProse,
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
            // 16px so the rem-based heading sizes shared with prose-css.ts
            // land at the same visual size as the saved HTML.
            fontSize: "16px",
          },
          // Same measure and typography as .prose-canvas (prose-css.ts) so
          // editing .md reads like the rendered Chameleon page. The measure
          // lives on .cm-content (not .cm-scroller) so the scroller stays
          // full-width and its scrollbar sits at the window edge.
          ".cm-scroller": {
            fontFamily: PROSE_FONT,
            lineHeight: "1.8",
          },
          ".cm-content": {
            caretColor: "var(--primary)",
            maxWidth: "760px",
            margin: "0 auto",
            padding: "2.5rem 1.5rem 6rem",
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
        // The wrapper div react-codemirror renders has no height of its own;
        // without h-full the editor's height:100% resolves to auto and the
        // scroller grows to full content height (scrolling dies).
        className="h-full"
        height="100%"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          indentOnInput: false,
        }}
        theme="none"
        onCreateEditor={(v) => {
          if (viewRef) viewRef.current = v;
          setView(v);
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
