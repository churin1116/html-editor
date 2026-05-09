"use client";

import { useCallback, useEffect, useState } from "react";

type AllowedRoot = { label: string; path: string };
type TreeEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeEntry[];
};

export function Sidebar({
  selectedPath,
  onSelect,
  refreshKey,
  onCreated,
}: {
  selectedPath: string | null;
  onSelect: (path: string) => void;
  refreshKey: number;
  onCreated: (path: string) => void;
}) {
  const [roots, setRoots] = useState<AllowedRoot[]>([]);
  const [trees, setTrees] = useState<Record<string, TreeEntry[]>>({});
  const [rootErrors, setRootErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/roots")
      .then((r) => r.json())
      .then((data) => setRoots(data.roots ?? []))
      .catch((e) => setError(String(e)));
  }, []);

  const reloadTree = useCallback(async (rootPath: string) => {
    try {
      const r = await fetch(`/api/tree?root=${encodeURIComponent(rootPath)}`);
      const data = await r.json();
      if (r.ok && data.tree) {
        setTrees((prev) => ({ ...prev, [rootPath]: data.tree }));
        setRootErrors((prev) => {
          if (!(rootPath in prev)) return prev;
          const { [rootPath]: _removed, ...rest } = prev;
          return rest;
        });
      } else {
        setRootErrors((prev) => ({
          ...prev,
          [rootPath]: data.error ?? `HTTP ${r.status}`,
        }));
      }
    } catch (e) {
      setRootErrors((prev) => ({ ...prev, [rootPath]: String(e) }));
    }
  }, []);

  useEffect(() => {
    for (const root of roots) reloadTree(root.path);
  }, [roots, reloadTree, refreshKey]);

  const handleNewFile = useCallback(
    async (rootPath: string) => {
      const name = window.prompt(
        "New HTML file name (e.g. 'memo' or 'memo.html'):",
      );
      if (!name) return;
      const res = await fetch("/api/file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dir: rootPath, name }),
      });
      const data = await res.json();
      if (!res.ok) {
        window.alert(`Failed: ${data.error}`);
        return;
      }
      await reloadTree(rootPath);
      onCreated(data.path);
    },
    [reloadTree, onCreated],
  );

  if (error) return <div className="p-4 text-sm text-red-600">Error: {error}</div>;
  if (roots.length === 0) {
    return (
      <div className="p-4 text-sm text-[var(--color-muted)]">
        <div className="font-semibold mb-2">No allowed roots configured</div>
        <div>Create config/allowed-roots.json (see config/allowed-roots.example.json).</div>
      </div>
    );
  }

  return (
    <div className="p-3 text-sm overflow-y-auto h-full">
      {roots.map((root) => (
        <div key={root.path} className="mb-4">
          <div className="flex items-center justify-between px-1 mb-2">
            <div className="font-semibold text-[var(--color-muted)] uppercase tracking-wider text-xs truncate">
              {root.label}
            </div>
            <button
              type="button"
              onClick={() => handleNewFile(root.path)}
              className="text-xs px-1.5 py-0.5 rounded hover:bg-black/5 text-[var(--color-muted)]"
              title="New HTML file"
            >
              + New
            </button>
          </div>
          {rootErrors[root.path] ? (
            <div className="px-2 py-2 text-xs text-red-600 bg-red-50 rounded">
              <div className="font-semibold mb-1">⚠ {rootErrors[root.path]}</div>
              <div className="text-red-500/80 break-all">{root.path}</div>
            </div>
          ) : (
            <TreeView
              entries={trees[root.path] ?? []}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={0}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function TreeView({
  entries,
  selectedPath,
  onSelect,
  depth,
}: {
  entries: TreeEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth: number;
}) {
  return (
    <ul>
      {entries.map((entry) => (
        <li key={entry.path}>
          {entry.type === "directory" ? (
            <DirectoryNode
              entry={entry}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth}
            />
          ) : (
            <FileNode
              entry={entry}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

function DirectoryNode({
  entry,
  selectedPath,
  onSelect,
  depth,
}: {
  entry: TreeEntry;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-2 py-1 rounded hover:bg-black/5 text-[var(--color-muted)]"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {open ? "▾" : "▸"} {entry.name}
      </button>
      {open && entry.children && (
        <TreeView
          entries={entry.children}
          selectedPath={selectedPath}
          onSelect={onSelect}
          depth={depth + 1}
        />
      )}
    </div>
  );
}

function FileNode({
  entry,
  selectedPath,
  onSelect,
  depth,
}: {
  entry: TreeEntry;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth: number;
}) {
  const isSelected = selectedPath === entry.path;
  const ext = entry.name.match(/\.(html?|md|markdown)$/i)?.[1].toLowerCase() ?? "";
  const display = entry.name.replace(/\.(html?|md|markdown)$/i, "");
  const isMd = ext === "md" || ext === "markdown";
  return (
    <button
      type="button"
      onClick={() => onSelect(entry.path)}
      className={`w-full text-left px-2 py-1 rounded truncate flex items-center gap-2 ${
        isSelected ? "bg-[var(--color-accent)] text-white" : "hover:bg-black/5"
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      title={entry.path}
    >
      <span className="truncate flex-1">{display}</span>
      <span
        className={`text-[10px] px-1 rounded ${
          isSelected
            ? "bg-white/20"
            : isMd
              ? "bg-amber-100 text-amber-700"
              : "bg-blue-100 text-blue-700"
        }`}
      >
        {isMd ? "MD" : "HTML"}
      </span>
    </button>
  );
}
