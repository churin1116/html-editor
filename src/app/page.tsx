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
