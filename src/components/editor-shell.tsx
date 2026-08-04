"use client";

import { ConflictDialog, type ConflictResolution } from "@/components/conflict-dialog";
import { Editor } from "@/components/editor";
import { HtmlSource } from "@/components/html-source";
import { MdEditor } from "@/components/md-editor";
import { Sidebar, type SidebarCollapse } from "@/components/sidebar";
import type { AllowedRoot } from "@/lib/allowed-roots";
import { confirmDialog } from "@/lib/dialogs";
import {
  type ActionId,
  type EditorMode,
  applyHtmlAction,
  applyMdAction,
} from "@/lib/editor-actions";
import { PROSE_CSS } from "@/lib/prose-css";
import type { ShortcutNodeWithStatus } from "@/lib/shortcuts";
import type { TreeEntry } from "@/lib/tree";
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
  editable: boolean;
  previewCss: string;
};

const LAST_PATH_COOKIE = "lastSelectedPath";
const SIDEBAR_OPEN_COOKIE = "sidebarOpen";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function EditorShell({
  initialSelected,
  initialFile,
  initialSidebarOpen = true,
  initialRoots,
  initialTrees,
  initialRootErrors,
  initialTreeTruncated,
  initialShortcuts,
  initialWorkspace,
  initialCollapse,
}: {
  initialSelected: string | null;
  initialFile: LoadedFile | null;
  initialSidebarOpen?: boolean;
  initialRoots: AllowedRoot[];
  initialTrees: Record<string, TreeEntry[]>;
  initialRootErrors: Record<string, string>;
  initialTreeTruncated: Record<string, boolean>;
  initialShortcuts: ShortcutNodeWithStatus[];
  initialWorkspace: string | null;
  initialCollapse: SidebarCollapse;
}) {
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [file, setFile] = useState<LoadedFile | null>(initialFile);
  const [draft, setDraft] = useState<string>(initialFile?.content ?? "");
  const [dirty, setDirty] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
  const [conflict, setConflict] = useState<{
    diskContent: string;
    diskTitle: string | null;
    diskShape: HtmlShape | null;
    diskManaged: boolean | null;
    diskEditable: boolean | null;
    currentMtimeMs: number;
  } | null>(null);

  useEffect(() => {
    document.cookie = `${SIDEBAR_OPEN_COOKIE}=${sidebarOpen ? "1" : "0"}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  }, [sidebarOpen]);
  const mdViewRef = useRef<EditorView | null>(null);
  const htmlEditorRef = useRef<TiptapEditor | null>(null);

  const mode: EditorMode | null = file?.format ?? null;
  // Full-document HTML is edited as raw source (HtmlSource), not via Tiptap.
  const isHtmlSource = file?.format === "html" && file?.shape === "full-document";
  // Source mode has no Tiptap selection, so hide the rich-text toolbar actions.
  const toolbarMode: EditorMode | null = isHtmlSource ? null : mode;

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

  // Opening another file replaces the editor contents, so unsaved edits would
  // be gone with no way back. Every route into a different file goes through
  // this (sidebar click, search hit, a freshly created file opening itself),
  // so the confirmation lives here rather than at each call site. Clearing the
  // selection (`null`, e.g. the open file's shortcut was removed) keeps the
  // old behavior — the user just confirmed that removal.
  const handleSelect = useCallback(
    async (p: string | null) => {
      if (p !== null && dirty && file && p !== file.path) {
        const ok = await confirmDialog({
          title: "保存していない変更があります",
          description: `「${file.title || file.path.split("/").pop()}」の編集内容は破棄されます。`,
          confirmLabel: "破棄して開く",
          destructive: true,
        });
        if (!ok) return;
      }
      setSelected(p);
    },
    [dirty, file],
  );

  // A rename from the sidebar moves the same bytes to a new path, so the open
  // buffer is repointed rather than reloaded — unsaved edits survive, and a
  // later ⌘S writes to the new file instead of recreating the old one.
  const handleRenamed = useCallback((oldPath: string, newPath: string) => {
    const remap = (p: string) =>
      p === oldPath ? newPath : p.startsWith(`${oldPath}/`) ? newPath + p.slice(oldPath.length) : p;
    setSelected((prev) => (prev === null ? prev : remap(prev)));
    setFile((prev) => (prev === null ? prev : { ...prev, path: remap(prev.path) }));
  }, []);

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
    } catch (e) {
      toast.error(String(e));
    }
  }, []);

  useEffect(() => {
    // Selection cleared (e.g. the open file's shortcut/folder/root was removed
    // from the sidebar): drop the main content back to the empty state.
    if (!selected) {
      if (file) {
        setFile(null);
        setDraft("");
        setDirty(false);
      }
      return;
    }
    if (file?.path !== selected) loadFile(selected);
  }, [selected, file, loadFile]);

  // Refresh just the previewCss of the open file (no content/draft touch) so
  // changes made via the sidebar's folder context menu apply immediately
  // without disturbing in-progress edits.
  const refreshPreviewCss = useCallback(async () => {
    if (!file) return;
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(file.path)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { previewCss?: string };
      setFile((prev) =>
        prev && prev.path === file.path ? { ...prev, previewCss: data.previewCss ?? "" } : prev,
      );
    } catch {
      // Silent — failure just means the preview keeps the old CSS until the
      // next file open.
    }
  }, [file]);

  const handleChange = useCallback(
    (html: string) => {
      setDraft(html);
      if (file && html !== file.content) setDirty(true);
    },
    [file],
  );

  const handleSave = useCallback(
    async (overrideContent?: string) => {
      if (!file) return;
      if (!file.editable) {
        toast.error("Read-only — open in a text editor");
        return;
      }
      // HtmlSource saves pass the freshly serialized document so we don't race
      // the async draft state update.
      const contentToSave = overrideContent ?? draft;
      try {
        const res = await fetch("/api/file", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: file.path,
            content: contentToSave,
            title: file.title,
            expectedMtimeMs: file.mtimeMs,
          }),
        });
        const data = await res.json();
        if (res.status === 409) {
          setConflict({
            diskContent: data.diskContent ?? "",
            diskTitle: data.diskTitle ?? null,
            diskShape: (data.diskShape ?? null) as HtmlShape | null,
            diskManaged: data.diskManaged ?? null,
            diskEditable: data.diskEditable ?? null,
            currentMtimeMs: data.currentMtimeMs,
          });
          return;
        }
        if (!res.ok) {
          toast.error(data.error);
          return;
        }
        setFile({ ...file, content: contentToSave, mtimeMs: data.mtimeMs });
        setDirty(false);
        toast.success("Saved");
      } catch (e) {
        toast.error(String(e));
      }
    },
    [file, draft],
  );

  const resolveConflict = useCallback(
    async (action: ConflictResolution) => {
      if (!file || !conflict) {
        setConflict(null);
        return;
      }
      if (action === "cancel") {
        setConflict(null);
        toast("Save cancelled");
        return;
      }
      if (action === "reload") {
        const newShape = conflict.diskShape ?? file.shape;
        const newManaged = conflict.diskManaged ?? file.managed;
        const newEditable = conflict.diskEditable ?? file.editable;
        setFile({
          ...file,
          content: conflict.diskContent,
          title: conflict.diskTitle ?? file.title,
          shape: newShape,
          managed: newManaged,
          editable: newEditable,
          mtimeMs: conflict.currentMtimeMs,
        });
        setDraft(conflict.diskContent);
        setDirty(false);
        setConflict(null);
        toast.success("Reloaded from disk");
        return;
      }
      // overwrite
      try {
        const res = await fetch("/api/file", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: file.path,
            content: draft,
            title: file.title,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error);
          return;
        }
        setFile({ ...file, content: draft, mtimeMs: data.mtimeMs });
        setDirty(false);
        setConflict(null);
        toast.success("Overwritten");
      } catch (e) {
        toast.error(String(e));
      }
    },
    [file, draft, conflict],
  );

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
            onSelect={handleSelect}
            refreshKey={refreshKey}
            mode={toolbarMode}
            onApply={applyAction}
            onFolderCssChanged={refreshPreviewCss}
            onRenamed={handleRenamed}
            initialRoots={initialRoots}
            initialTrees={initialTrees}
            initialRootErrors={initialRootErrors}
            initialTreeTruncated={initialTreeTruncated}
            initialShortcuts={initialShortcuts}
            initialWorkspace={initialWorkspace}
            initialCollapse={initialCollapse}
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
        <div className="flex-1 overflow-hidden">
          {file ? (
            file.format === "md" ? (
              <MdEditor
                content={draft}
                onChange={handleChange}
                viewRef={mdViewRef}
                path={file.path}
              />
            ) : isHtmlSource ? (
              <HtmlSource
                content={draft}
                onChange={handleChange}
                onSave={(html) => {
                  handleChange(html);
                  void handleSave(html);
                }}
                path={file.path}
              />
            ) : (
              <Editor
                content={draft}
                onChange={handleChange}
                editorRef={htmlEditorRef}
                editable={file.editable}
                path={file.path}
                previewCss={file.previewCss}
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
      <ConflictDialog
        open={conflict !== null}
        draft={draft}
        diskContent={conflict?.diskContent ?? ""}
        onResolve={resolveConflict}
      />
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
