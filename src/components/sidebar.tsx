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
      const name = window.prompt("New HTML file name");
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
        return data.error
          ? `${data.error}${data.path ? ` (${data.path})` : ""}`
          : "Failed";
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
        `Remove "${label}"?\nFiles on disk are not deleted.`,
      );
      if (!ok) return;
      const res = await fetch(
        `/api/roots?path=${encodeURIComponent(rootPath)}`,
        { method: "DELETE" },
      );
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

  if (error) return <div className="p-5 text-sm text-[var(--danger)]">{error}</div>;

  const isEmpty = roots.length === 0;

  return (
    <div className="text-sm overflow-y-auto h-full">
      {isEmpty && !showAddForm && <EmptyState onAdd={() => setShowAddForm(true)} />}

      {!isEmpty && (
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <span className="section-label">Roots</span>
          {!showAddForm && (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="text-[11px] text-[var(--text-subtle)] hover:text-[var(--text)] transition-colors"
              title="Add another root"
            >
              + add
            </button>
          )}
        </div>
      )}

      {showAddForm && (
        <div className={isEmpty ? "px-5 pt-6" : "px-3"}>
          <AddRootForm
            onCancel={() => setShowAddForm(false)}
            onSubmit={handleAddRoot}
          />
        </div>
      )}

      <div className="px-3 pb-6">
        {roots.map((root) => (
          <div key={root.path} className="mb-5 group">
            <div className="flex items-center justify-between px-2 mb-1.5">
              <span className="text-[12px] font-medium text-[var(--text-muted)] truncate tracking-tight">
                {root.label}
              </span>
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <IconBtn onClick={() => handleNewFile(root.path)} title="New HTML file">
                  <PlusIcon />
                </IconBtn>
                <IconBtn
                  onClick={() => handleRemoveRoot(root.path, root.label)}
                  title="Remove root from list"
                >
                  <CloseIcon />
                </IconBtn>
              </div>
            </div>
            {rootErrors[root.path] ? (
              <div className="mx-2 px-3 py-2.5 text-[11.5px] text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] rounded-md">
                <div className="font-medium mb-0.5">{rootErrors[root.path]}</div>
                <div className="text-[var(--text-muted)] break-all font-mono text-[10.5px]">
                  {root.path}
                </div>
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
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="px-6 pt-16 pb-10 text-center welcome-fade-in">
      <div
        className="text-[28px] font-light leading-none mb-3 text-[var(--text)]"
        style={{ letterSpacing: "-0.025em" }}
      >
        Begin.
      </div>
      <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed mb-7 max-w-[230px] mx-auto">
        Add a directory to start editing. Paths can be absolute or use{" "}
        <code className="font-mono text-[12px] text-[var(--text)]">~</code>.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="btn-save-active"
      >
        Add a root
      </button>
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
      className="mb-5 px-4 py-4 bg-[var(--surface-2)] rounded-lg fade-in"
    >
      <div className="section-label mb-3">Add root</div>
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label"
        className="input-line mb-3"
        autoFocus
      />
      <input
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="~/notes  or  /absolute/path"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        className="input-line font-mono mb-4"
        style={{ fontSize: "12px" }}
      />
      {err && (
        <div className="text-[11.5px] text-[var(--danger)] mb-3 leading-relaxed">
          {err}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="btn-save-active disabled:opacity-40"
        >
          {submitting ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] text-[var(--text-subtle)] hover:text-[var(--text)] transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function IconBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center w-5 h-5 rounded text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
    >
      {children}
    </button>
  );
}

function PlusIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 10 10" className="tree-dir-chevron-svg">
      <path
        d="M3.5 2L7 5L3.5 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
        className="tree-dir"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        <span
          className={`tree-dir-chevron ${open ? "is-open" : ""}`}
        >
          <ChevronIcon />
        </span>
        <span className="truncate">{entry.name}</span>
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
      className={`tree-item ${isSelected ? "is-selected" : ""}`}
      style={{ paddingLeft: `${depth * 12 + 14}px` }}
      title={entry.path}
    >
      <span className="truncate flex-1">{display}</span>
      <span className="fmt-chip">{isMd ? "md" : "html"}</span>
    </button>
  );
}
