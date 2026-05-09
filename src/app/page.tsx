"use client";

import { useCallback, useEffect, useState } from "react";
import { Editor } from "@/components/editor";
import { Sidebar } from "@/components/sidebar";

type LoadedFile = {
  path: string;
  format: "html" | "md";
  content: string;
  title: string;
  mtimeMs: number;
  managed: boolean;
};

export default function Page() {
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadFile = useCallback(async (p: string) => {
    setStatus("Loading...");
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (!res.ok) {
        setStatus(`Error: ${data.error}`);
        return;
      }
      setFile(data);
      setDraft(data.content);
      setDirty(false);
      if (data.format === "md") {
        setStatus("ⓘ MD source — saved as Markdown (formatting may simplify on round-trip)");
      } else if (!data.managed) {
        setStatus("⚠ Unmanaged HTML — saving will rewrap with editor template");
      } else {
        setStatus("");
      }
    } catch (e) {
      setStatus(`Error: ${String(e)}`);
    }
  }, []);

  useEffect(() => {
    if (selected) loadFile(selected);
  }, [selected, loadFile]);

  const handleChange = useCallback(
    (html: string) => {
      setDraft(html);
      if (file && html !== file.content) setDirty(true);
    },
    [file],
  );

  const handleSave = useCallback(async () => {
    if (!file) return;
    setSaving(true);
    setStatus("Saving...");
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
          "File was modified externally since you opened it. Overwrite anyway?",
        );
        if (ok) {
          const res2 = await fetch("/api/file", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path: file.path, content: draft, title: file.title }),
          });
          const data2 = await res2.json();
          if (!res2.ok) {
            setStatus(`Error: ${data2.error}`);
            return;
          }
          setFile({ ...file, content: draft, mtimeMs: data2.mtimeMs });
          setDirty(false);
          setStatus("Saved (overwritten).");
        } else {
          setStatus("Save cancelled. Reload to see external changes.");
        }
        return;
      }
      if (!res.ok) {
        setStatus(`Error: ${data.error}`);
        return;
      }
      setFile({ ...file, content: draft, mtimeMs: data.mtimeMs });
      setDirty(false);
      setStatus("Saved.");
    } finally {
      setSaving(false);
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
    <div className="grid grid-cols-[280px_1fr] h-screen">
      <aside className="border-r border-[var(--border)] bg-[var(--surface)] overflow-hidden flex flex-col">
        <header className="px-4 py-3 border-b border-[var(--border)] font-semibold">
          html-editor
        </header>
        <div className="flex-1 overflow-hidden">
          <Sidebar
            selectedPath={selected}
            onSelect={setSelected}
            refreshKey={refreshKey}
            onCreated={handleCreated}
          />
        </div>
        <footer className="px-3 py-2 border-t border-[var(--border)]">
          <a
            href="https://github.com/churin1116/html-editor"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] opacity-60 hover:opacity-100 transition-opacity"
            title="View source on GitHub"
            aria-label="GitHub repository"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            <span>churin1116/html-editor</span>
          </a>
        </footer>
      </aside>
      <main className="flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
          <div className="flex-1 text-sm truncate text-[var(--text-muted)]">
            {file ? (
              <span>
                <span
                  className={`text-[10px] mr-2 px-1 rounded ${
                    file.format === "md"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-blue-100 text-blue-700"
                  }`}
                >
                  {file.format.toUpperCase()}
                </span>
                {file.path}
              </span>
            ) : (
              "Select a file from the sidebar"
            )}
            {dirty && <span className="ml-2 text-orange-500">●</span>}
          </div>
          <div className="text-xs text-[var(--text-muted)]">{status}</div>
          <button
            type="button"
            onClick={handleSave}
            disabled={!file || !dirty || saving}
            className="btn btn-primary px-3 py-1 text-sm disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save (⌘S)"}
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {file ? (
            <Editor content={draft} onChange={handleChange} />
          ) : (
            <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">
              No file selected.
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
