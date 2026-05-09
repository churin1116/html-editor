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
    setStatus("Loading…");
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(p)}`);
      const data = await res.json();
      if (!res.ok) {
        setStatus(data.error);
        return;
      }
      setFile(data);
      setDraft(data.content);
      setDirty(false);
      if (data.format === "md") {
        setStatus("Markdown source — formatting may simplify on save");
      } else if (!data.managed) {
        setStatus("Unmanaged HTML — will be rewrapped on save");
      } else {
        setStatus("");
      }
    } catch (e) {
      setStatus(String(e));
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
    setStatus("Saving…");
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
            setStatus(data2.error);
            return;
          }
          setFile({ ...file, content: draft, mtimeMs: data2.mtimeMs });
          setDirty(false);
          setStatus("Overwritten");
        } else {
          setStatus("Save cancelled");
        }
        return;
      }
      if (!res.ok) {
        setStatus(data.error);
        return;
      }
      setFile({ ...file, content: draft, mtimeMs: data.mtimeMs });
      setDirty(false);
      setStatus("Saved");
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

  const saveBtnActive = !!file && dirty && !saving;

  return (
    <div className="grid grid-cols-[300px_1fr] h-screen">
      <aside className="border-r border-[var(--border-subtle)] bg-[var(--surface)] overflow-hidden flex flex-col">
        <header className="flex items-center justify-between pl-5 pr-3 pt-4 pb-3">
          <div className="wordmark lowercase">html · editor</div>
          <a
            href="https://github.com/churin1116/html-editor"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
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
          />
        </div>
      </aside>

      <main className="flex flex-col overflow-hidden bg-canvas">
        <div className="flex items-center gap-5 px-6 py-3 border-b border-[var(--border-subtle)]">
          <div className="flex-1 flex items-baseline gap-3 text-[12.5px] truncate min-w-0">
            {file ? (
              <>
                <span className="fmt-chip flex-shrink-0">{file.format}</span>
                <span className="text-[var(--text-muted)] truncate font-mono text-[11.5px]">
                  {file.path}
                </span>
                {dirty && (
                  <span className="text-[var(--text-subtle)] text-[11px] flex-shrink-0">
                    · unsaved
                  </span>
                )}
              </>
            ) : (
              <span className="text-[var(--text-subtle)]">No file selected</span>
            )}
          </div>
          {status && (
            <div className="text-[11px] tracking-[0.04em] text-[var(--text-subtle)] truncate max-w-[36ch]">
              {status}
            </div>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!saveBtnActive}
            className={saveBtnActive ? "btn-save-active" : "btn-save-inactive"}
          >
            {saving ? "Saving…" : "Save"}
            <span className="ml-2 text-[10px] opacity-60 tracking-wider">⌘S</span>
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          {file ? (
            <Editor content={draft} onChange={handleChange} />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center welcome-fade-in">
                <div
                  className="text-[36px] font-light leading-none mb-3 text-[var(--text-muted)]"
                  style={{ letterSpacing: "-0.025em" }}
                >
                  Quiet.
                </div>
                <p className="text-[12.5px] text-[var(--text-subtle)] tracking-[0.04em]">
                  Select a file to begin.
                </p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
