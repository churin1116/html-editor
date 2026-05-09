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
  const [showAddForm, setShowAddForm] = useState(false);

  const fetchRoots = useCallback(async () => {
    try {
      const r = await fetch("/api/roots");
      const data = await r.json();
      setRoots(data.roots ?? []);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    fetchRoots();
  }, [fetchRoots]);

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

  const handleAddRoot = useCallback(
    async (label: string, path: string) => {
      const res = await fetch("/api/roots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, path }),
      });
      const data = await res.json();
      if (!res.ok) {
        return data.error ? `${data.error}${data.path ? ` (${data.path})` : ""}` : "Failed";
      }
      setRoots(data.roots ?? []);
      setShowAddForm(false);
      return null;
    },
    [],
  );

  const handleRemoveRoot = useCallback(
    async (rootPath: string, label: string) => {
      const ok = window.confirm(
        `Remove "${label}" from allowed roots?\nFiles on disk are NOT deleted.`,
      );
      if (!ok) return;
      const res = await fetch(`/api/roots?path=${encodeURIComponent(rootPath)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        window.alert(`Failed: ${data.error}`);
        return;
      }
      setRoots(data.roots ?? []);
      setTrees((prev) => {
        const { [rootPath]: _, ...rest } = prev;
        return rest;
      });
      setRootErrors((prev) => {
        const { [rootPath]: _, ...rest } = prev;
        return rest;
      });
    },
    [],
  );

  if (error) return <div className="p-4 text-sm text-red-600">Error: {error}</div>;

  const isEmpty = roots.length === 0;

  return (
    <div className="p-3 text-sm overflow-y-auto h-full">
      {isEmpty && !showAddForm && (
        <div className="mb-4 p-3 rounded bg-surface border-subtle border">
          <div className="font-semibold mb-1">No allowed roots configured</div>
          <div className="text-[var(--text-muted)] mb-3 text-xs">
            Add a directory to start editing files in it. The path can be absolute
            (<code>/Users/you/notes</code>) or use <code>~/notes</code>.
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="btn btn-primary w-full"
          >
            + Add your first root
          </button>
        </div>
      )}

      {!isEmpty && (
        <div className="flex items-center justify-between px-1 mb-2">
          <div className="font-semibold text-[var(--text-muted)] uppercase tracking-wider text-xs">
            Roots
          </div>
          {!showAddForm && (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="text-xs px-1.5 py-0.5 rounded hover:bg-black/5 text-[var(--text-muted)]"
              title="Add another root"
            >
              + Add root
            </button>
          )}
        </div>
      )}

      {showAddForm && (
        <AddRootForm
          onCancel={() => setShowAddForm(false)}
          onSubmit={handleAddRoot}
        />
      )}

      {roots.map((root) => (
        <div key={root.path} className="mb-4">
          <div className="flex items-center justify-between px-1 mb-2 group">
            <div className="font-semibold text-[var(--text-muted)] uppercase tracking-wider text-xs truncate flex-1">
              {root.label}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleNewFile(root.path)}
                className="text-xs px-1.5 py-0.5 rounded hover:bg-black/5 text-[var(--text-muted)]"
                title="New HTML file"
              >
                + New
              </button>
              <button
                type="button"
                onClick={() => handleRemoveRoot(root.path, root.label)}
                className="text-xs px-1.5 py-0.5 rounded hover:bg-black/5 text-[var(--text-muted)]"
                title={`Remove ${root.label} from allowed roots`}
              >
                ×
              </button>
            </div>
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

function AddRootForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (label: string, path: string) => Promise<string | null>;
}) {
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!label.trim() || !path.trim()) {
      setErr("Both label and path are required");
      return;
    }
    setSubmitting(true);
    const result = await onSubmit(label.trim(), path.trim());
    setSubmitting(false);
    if (result) {
      setErr(result);
    } else {
      setLabel("");
      setPath("");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 p-3 rounded bg-surface border-subtle border"
    >
      <div className="font-semibold text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2">
        Add a root
      </div>
      <label className="block mb-2">
        <span className="text-xs text-[var(--text-muted)]">Label</span>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Notes"
          className="w-full mt-1 px-2 py-1 rounded border border-[var(--border)] bg-canvas text-sm"
        />
      </label>
      <label className="block mb-2">
        <span className="text-xs text-[var(--text-muted)]">Path</span>
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="~/notes or /absolute/path"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          className="w-full mt-1 px-2 py-1 rounded border border-[var(--border)] bg-canvas text-sm font-mono"
        />
      </label>
      {err && (
        <div className="alert alert-danger text-xs mb-2">{err}</div>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="btn btn-primary text-xs disabled:opacity-40"
        >
          {submitting ? "Adding..." : "Add"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn btn-ghost text-xs"
        >
          Cancel
        </button>
      </div>
    </form>
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
        className="w-full text-left px-2 py-1 rounded hover:bg-black/5 text-[var(--text-muted)]"
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
        isSelected ? "bg-primary" : "hover:bg-black/5"
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
