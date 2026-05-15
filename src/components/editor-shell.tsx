"use client";

import { Editor } from "@/components/editor";
import { MdEditor } from "@/components/md-editor";
import { Sidebar } from "@/components/sidebar";
import {
  type ActionId,
  type EditorMode,
  applyHtmlAction,
  applyMdAction,
} from "@/lib/editor-actions";
import { PROSE_CSS } from "@/lib/prose-css";
import type { EditorView } from "@codemirror/view";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type HtmlShape = "managed" | "fragment" | "full-document";

type LoadedFile = {
  path: string;
  format: "html" | "md";
  content: string;
  title: string;
  mtimeMs: number;
  managed: boolean;
  shape: HtmlShape | null;
};

const LAST_PATH_COOKIE = "lastSelectedPath";
const SIDEBAR_OPEN_COOKIE = "sidebarOpen";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function EditorShell({
  initialSelected,
  initialFile,
  initialSidebarOpen = true,
}: {
  initialSelected: string | null;
  initialFile: LoadedFile | null;
  initialSidebarOpen?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [file, setFile] = useState<LoadedFile | null>(initialFile);
  const [draft, setDraft] = useState<string>(initialFile?.content ?? "");
  const [dirty, setDirty] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);

  useEffect(() => {
    document.cookie = `${SIDEBAR_OPEN_COOKIE}=${sidebarOpen ? "1" : "0"}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }, [sidebarOpen]);
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
    if (initialFile?.format !== "html") return;
    if (initialFile.shape === "full-document") {
      toast.error("Read-only — full HTML document (head/doctype can't round-trip)");
    } else if (initialFile.shape === "fragment") {
      toast("Fragment HTML — saved as-is (no Chameleon wrapping)");
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
      if (data.format === "html") {
        if (data.shape === "full-document") {
          toast.error("Read-only — full HTML document (head/doctype can't round-trip)");
        } else if (data.shape === "fragment") {
          toast("Fragment HTML — saved as-is (no Chameleon wrapping)");
        }
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
    if (file.shape === "full-document") {
      toast.error("Read-only — open in a text editor to modify head/doctype");
      return;
    }
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
    <div
      className="grid h-screen transition-[grid-template-columns] duration-200 ease-out"
      style={{ gridTemplateColumns: sidebarOpen ? "300px 1fr" : "0px 1fr" }}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: PROSE_CSS is a static module-level constant. */}
      <style dangerouslySetInnerHTML={{ __html: PROSE_CSS }} />
      <aside
        className={`bg-[var(--surface)] overflow-hidden flex flex-col ${sidebarOpen ? "border-r border-[var(--border-subtle)]" : ""}`}
        aria-hidden={!sidebarOpen}
      >
        <header className="flex items-center justify-between pl-5 pr-3 pt-4 pb-3">
          <div className="wordmark lowercase">html · editor</div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            <SidebarCloseIcon />
          </button>
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

      <main className="relative flex flex-col overflow-hidden bg-canvas">
        {!sidebarOpen && (
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="absolute top-3 left-3 z-30 inline-flex items-center justify-center w-9 h-9 rounded-md text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors bg-[var(--surface)] border border-[var(--border-subtle)] shadow-sm"
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <HamburgerIcon />
          </button>
        )}
        {file?.shape === "full-document" && (
          <div className="px-5 py-2 text-[12px] bg-[var(--surface-2)] border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
            Read-only — this file is a full HTML document with{" "}
            <code className="px-1 rounded bg-[var(--surface)]">&lt;head&gt;</code> /{" "}
            <code className="px-1 rounded bg-[var(--surface)]">doctype</code>. Edits are disabled
            because Tiptap can't preserve those wrappers on save.
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          {file ? (
            file.format === "md" ? (
              <MdEditor content={draft} onChange={handleChange} viewRef={mdViewRef} />
            ) : (
              <Editor
                content={draft}
                onChange={handleChange}
                editorRef={htmlEditorRef}
                editable={file.shape !== "full-document"}
              />
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

function HamburgerIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

function SidebarCloseIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
      <path d="M15 9l-3 3 3 3" />
    </svg>
  );
}
