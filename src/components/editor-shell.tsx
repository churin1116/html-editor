"use client";

import type { EditorView } from "@codemirror/view";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Editor } from "@/components/editor";
import { MdEditor } from "@/components/md-editor";
import { Sidebar } from "@/components/sidebar";
import {
  type ActionId,
  applyHtmlAction,
  applyMdAction,
  type EditorMode,
} from "@/lib/editor-actions";

type LoadedFile = {
  path: string;
  format: "html" | "md";
  content: string;
  title: string;
  mtimeMs: number;
  managed: boolean;
};

const LAST_PATH_COOKIE = "lastSelectedPath";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function EditorShell({
  initialSelected,
  initialFile,
}: {
  initialSelected: string | null;
  initialFile: LoadedFile | null;
}) {
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [file, setFile] = useState<LoadedFile | null>(initialFile);
  const [draft, setDraft] = useState<string>(initialFile?.content ?? "");
  const [dirty, setDirty] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const mdViewRef = useRef<EditorView | null>(null);
  const htmlEditorRef = useRef<TiptapEditor | null>(null);

  const mode: EditorMode | null = file?.format ?? null;

  const applyAction = useCallback(
    (id: ActionId) => {
      if (mode === "md") {
        const view = mdViewRef.current;
        if (!view) {
          toast.error("Editor not ready");
          return;
        }
        applyMdAction(view, id);
      } else if (mode === "html") {
        const editor = htmlEditorRef.current;
        if (!editor) {
          toast.error("Editor not ready");
          return;
        }
        applyHtmlAction(editor, id);
      } else {
        toast.error("Open a file first");
      }
    },
    [mode],
  );

  useEffect(() => {
    if (initialFile?.format === "html" && !initialFile.managed) {
      toast("Unmanaged HTML — will be rewrapped on save");
    }
  }, [initialFile]);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (selected) {
      document.cookie = `${LAST_PATH_COOKIE}=${encodeURIComponent(selected)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    } else {
      document.cookie = `${LAST_PATH_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    }
  }, [selected]);

  const loadFile = useCallback(async (p: string) => {
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error);
        return;
      }
      setFile(data);
      setDraft(data.content);
      setDirty(false);
      if (data.format === "html" && !data.managed) {
        toast("Unmanaged HTML — will be rewrapped on save");
      }
    } catch (e) {
      toast.error(String(e));
    }
  }, []);

  useEffect(() => {
    if (selected && file?.path !== selected) loadFile(selected);
  }, [selected, file, loadFile]);

  const handleChange = useCallback(
    (html: string) => {
      setDraft(html);
      if (file && html !== file.content) setDirty(true);
    },
    [file],
  );

  const handleSave = useCallback(async () => {
    if (!file) return;
    try {
      const res = await fetch("/api/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: file.path,
          content: draft,
          title: file.title,
          expectedMtimeMs: file.mtimeMs,
        }),
      });
      const data = await res.json();
      if (res.status === 409) {
        const ok = window.confirm(
          "This file was modified externally since you opened it. Overwrite?",
        );
        if (ok) {
          const res2 = await fetch("/api/file", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              path: file.path,
              content: draft,
              title: file.title,
            }),
          });
          const data2 = await res2.json();
          if (!res2.ok) {
            toast.error(data2.error);
            return;
          }
          setFile({ ...file, content: draft, mtimeMs: data2.mtimeMs });
          setDirty(false);
          toast.success("Overwritten");
        } else {
          toast("Save cancelled");
        }
        return;
      }
      if (!res.ok) {
        toast.error(data.error);
        return;
      }
      setFile({ ...file, content: draft, mtimeMs: data.mtimeMs });
      setDirty(false);
      toast.success("Saved");
    } catch (e) {
      toast.error(String(e));
    }
  }, [file, draft]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  const handleCreated = useCallback((newPath: string) => {
    setRefreshKey((k) => k + 1);
    setSelected(newPath);
  }, []);

  return (
    <div className="grid grid-cols-[300px_1fr] h-screen">
      <aside className="border-r border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden flex flex-col">
        <header className="flex items-center justify-between pl-5 pr-3 pt-4 pb-3">
          <div className="wordmark lowercase">html · editor</div>
          <a
            href="https://github.com/churin1116/html-editor"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-[var(--surface-2)] transition-colors"
            style={{ color: "var(--text)" }}
            title="View source on GitHub"
            aria-label="View source on GitHub"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        </header>
        <div className="flex-1 overflow-hidden">
          <Sidebar
            selectedPath={selected}
            onSelect={setSelected}
            refreshKey={refreshKey}
            onCreated={handleCreated}
            mode={mode}
            onApply={applyAction}
          />
        </div>
      </aside>

      <main className="flex flex-col overflow-hidden bg-canvas">
        <div className="flex-1 overflow-hidden">
          {file ? (
            file.format === "md" ? (
              <MdEditor content={draft} onChange={handleChange} viewRef={mdViewRef} />
            ) : (
              <Editor content={draft} onChange={handleChange} editorRef={htmlEditorRef} />
            )
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div
                  className="text-[36px] font-light leading-none mb-3 text-[var(--text-muted)]"
                  style={{ letterSpacing: "-0.025em" }}
                >
                  Quiet.
                </div>
                <p className="text-[12.5px] text-[var(--text-subtle)] tracking-[0.04em]">
                  Select a file to begin
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
