"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ACTIONS,
  type ActionIcon,
  type ActionId,
  type EditorMode,
} from "@/lib/editor-actions";

type AllowedRoot = { label: string; path: string };
type Shortcut = { path: string };
type TreeEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeEntry[];
};
type ContextMenuState = { x: number; y: number; path: string };

export function Sidebar({
  selectedPath,
  onSelect,
  refreshKey,
  onCreated,
  mode,
  onApply,
}: {
  selectedPath: string | null;
  onSelect: (path: string) => void;
  refreshKey: number;
  onCreated: (path: string) => void;
  mode: EditorMode | null;
  onApply: (id: ActionId) => void;
}) {
  const [roots, setRoots] = useState<AllowedRoot[]>([]);
  const [trees, setTrees] = useState<Record<string, TreeEntry[]>>({});
  const [rootErrors, setRootErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [collapsedRoots, setCollapsedRoots] = useState<Record<string, boolean>>({});
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [shortcutsCollapsed, setShortcutsCollapsed] = useState(false);
  const [showAddShortcutForm, setShowAddShortcutForm] = useState(false);

  const openContextMenu = useCallback((x: number, y: number, path: string) => {
    setContextMenu({ x, y, path });
  }, []);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const toggleRoot = useCallback((rootPath: string) => {
    setCollapsedRoots((prev) => ({ ...prev, [rootPath]: !prev[rootPath] }));
  }, []);

  const fetchRoots = useCallback(async () => {
    try {
      const r = await fetch("/api/roots");
      const data = await r.json();
      setRoots(data.roots ?? []);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const fetchShortcuts = useCallback(async () => {
    try {
      const r = await fetch("/api/shortcuts");
      const data = await r.json();
      setShortcuts(data.shortcuts ?? []);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    fetchRoots();
    fetchShortcuts();
  }, [fetchRoots, fetchShortcuts]);

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

  // Live tree updates via SSE: refresh affected root when external add/unlink happens
  useEffect(() => {
    if (roots.length === 0) return;
    const es = new EventSource("/api/watch");
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const targets = Array.from(pending);
      pending.clear();
      for (const r of targets) reloadTree(r);
    };
    es.onmessage = (ev) => {
      let data: { event?: string; root?: string };
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (
        data.event !== "add" &&
        data.event !== "unlink" &&
        data.event !== "addDir" &&
        data.event !== "unlinkDir"
      )
        return;
      if (data.root) pending.add(data.root);
      else for (const r of roots) pending.add(r.path);
      if (!timer) timer = setTimeout(flush, 200);
    };
    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [roots, reloadTree]);

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

  const handleAddShortcut = useCallback(
    async (rawPath: string) => {
      const res = await fetch("/api/shortcuts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: rawPath }),
      });
      const data = await res.json();
      if (!res.ok) {
        return data.error
          ? `${data.error}${data.path ? ` (${data.path})` : ""}`
          : "Failed";
      }
      setShortcuts(data.shortcuts ?? []);
      setShowAddShortcutForm(false);
      return null;
    },
    [],
  );

  const handleRemoveShortcut = useCallback(async (shortcutPath: string) => {
    const ok = window.confirm(
      "Remove this shortcut?\nThe file on disk is not deleted.",
    );
    if (!ok) return;
    const res = await fetch(
      `/api/shortcuts?path=${encodeURIComponent(shortcutPath)}`,
      { method: "DELETE" },
    );
    const data = await res.json();
    if (!res.ok) {
      window.alert(`Failed: ${data.error}`);
      return;
    }
    setShortcuts(data.shortcuts ?? []);
  }, []);

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
    <div className="text-sm h-full flex flex-col">
      <div className="flex-1 overflow-y-auto">
      {isEmpty && !showAddForm && <EmptyState onAdd={() => setShowAddForm(true)} />}

      {!isEmpty && (
        <div className="px-3 pt-4 pb-1 group/shortcuts">
          <div className="flex items-center justify-between px-2 mb-1.5 gap-2">
            <button
              type="button"
              onClick={() => setShortcutsCollapsed((v) => !v)}
              className="flex items-center gap-1 min-w-0 flex-1 text-left tree-root-toggle"
              aria-expanded={!shortcutsCollapsed}
            >
              <span
                className={`tree-dir-chevron ${!shortcutsCollapsed ? "is-open" : ""}`}
              >
                <ChevronIcon />
              </span>
              <span className="text-[12px] font-medium text-[var(--text-muted)] truncate tracking-tight">
                Shortcuts
              </span>
            </button>
            <div className="flex items-center gap-0.5 opacity-0 group-hover/shortcuts:opacity-100 transition-opacity duration-150 flex-shrink-0">
              <IconBtn
                onClick={() => {
                  setShortcutsCollapsed(false);
                  setShowAddShortcutForm(true);
                }}
                title="Add shortcut"
              >
                <PlusIcon />
              </IconBtn>
            </div>
          </div>
          {!shortcutsCollapsed && (
            <>
              {showAddShortcutForm && (
                <div className="px-2 mb-2">
                  <AddShortcutForm
                    onCancel={() => setShowAddShortcutForm(false)}
                    onSubmit={handleAddShortcut}
                  />
                </div>
              )}
              {shortcuts.length === 0 && !showAddShortcutForm && (
                <div className="px-4 py-1.5 text-[11px] text-[var(--text-subtle)] leading-relaxed">
                  Add absolute paths to reach files anywhere.
                </div>
              )}
              {shortcuts.map((s) => (
                <ShortcutItem
                  key={s.path}
                  shortcut={s}
                  isSelected={selectedPath === s.path}
                  onSelect={onSelect}
                  onContextMenu={openContextMenu}
                  onRemove={handleRemoveShortcut}
                />
              ))}
            </>
          )}
        </div>
      )}

      {!isEmpty && (
        <div className="flex items-center justify-between px-5 pt-3 pb-3">
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
        {roots.map((root) => {
          const isOpen = !collapsedRoots[root.path];
          return (
            <div key={root.path} className="mb-5 group">
              <div className="flex items-center justify-between px-2 mb-1.5 gap-2">
                <button
                  type="button"
                  onClick={() => toggleRoot(root.path)}
                  className="flex items-center gap-1 min-w-0 flex-1 text-left tree-root-toggle"
                  aria-expanded={isOpen}
                >
                  <span className={`tree-dir-chevron ${isOpen ? "is-open" : ""}`}>
                    <ChevronIcon />
                  </span>
                  <span className="text-[12px] font-medium text-[var(--text-muted)] truncate tracking-tight">
                    {root.label}
                  </span>
                </button>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex-shrink-0">
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
              {isOpen && (
                rootErrors[root.path] ? (
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
                    onContextMenu={openContextMenu}
                    depth={0}
                  />
                )
              )}
            </div>
          );
        })}
      </div>
      </div>
      <div className="border-t border-[var(--border-subtle)] px-3 py-2 flex items-center gap-1">
        <HelpButton mode={mode} onApply={onApply} />
        <a
          href="https://github.com/churin1116/html-editor"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
          title="View source on GitHub"
          aria-label="View source on GitHub"
        >
          <GitHubIcon />
        </a>
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          path={contextMenu.path}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}

function HelpButton({
  mode,
  onApply,
}: {
  mode: EditorMode | null;
  onApply: (id: ActionId) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = mode ? ACTIONS.filter((a) => a.supports.includes(mode)) : [];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        title="操作一覧"
        aria-label="操作一覧を表示"
        aria-expanded={open}
      >
        <QuestionIcon />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 min-w-[260px] py-1.5 rounded-md fade-in z-40 overflow-y-auto"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-subtle)",
            boxShadow:
              "0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)",
            maxHeight: "min(70vh, 560px)",
          }}
        >
          <div className="px-3 pb-1.5 pt-0.5 text-[10.5px] tracking-[0.08em] uppercase text-[var(--text-subtle)]">
            操作一覧
          </div>
          {items.length === 0 ? (
            <div className="px-3 py-2 text-[11.5px] text-[var(--text-subtle)] leading-relaxed">
              ファイルを開くと操作一覧が表示されます。
            </div>
          ) : (
            items.map((a) => (
              <button
                key={a.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onApply(a.id);
                  setOpen(false);
                }}
                className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {a.icon && (
                    <span
                      className="text-[var(--text-muted)] flex-shrink-0"
                      aria-hidden="true"
                    >
                      <ActionIconSvg icon={a.icon} />
                    </span>
                  )}
                  <span className="font-mono truncate">{a.label}</span>
                </span>
                {a.hint && (
                  <span className="text-[10.5px] text-[var(--text-subtle)] font-mono flex-shrink-0">
                    {a.hint}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ActionIconSvg({ icon }: { icon: ActionIcon }) {
  if (icon === "table") {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2.2" y="3.6" width="11.6" height="8.8" rx="0.8" />
        <path d="M2.2 7h11.6M2.2 10h11.6M6 3.6v8.8M10 3.6v8.8" />
      </svg>
    );
  }
  return null;
}

function GitHubIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function QuestionIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.4" />
      <path d="M6.2 6.2a1.8 1.8 0 0 1 3.6 0c0 1.1-1.4 1.2-1.8 2-.1.2-.2.5-.2.8" />
      <circle cx="8" cy="11.5" r="0.45" fill="currentColor" stroke="none" />
    </svg>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="px-6 pt-16 pb-10 text-center">
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
  onContextMenu,
  depth,
}: {
  entries: TreeEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onContextMenu: (x: number, y: number, path: string) => void;
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
              onContextMenu={onContextMenu}
              depth={depth}
            />
          ) : (
            <FileNode
              entry={entry}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
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
  onContextMenu,
  depth,
}: {
  entry: TreeEntry;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onContextMenu: (x: number, y: number, path: string) => void;
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
          onContextMenu={onContextMenu}
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
  onContextMenu,
  depth,
}: {
  entry: TreeEntry;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onContextMenu: (x: number, y: number, path: string) => void;
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
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e.clientX, e.clientY, entry.path);
      }}
      className={`tree-item ${isSelected ? "is-selected" : ""}`}
      style={{ paddingLeft: `${depth * 12 + 14}px` }}
      title={entry.path}
    >
      <span
        className={`file-icon ${isMd ? "file-icon-md" : "file-icon-html"} flex-shrink-0`}
        aria-hidden="true"
      >
        {isMd ? <MdIcon /> : <HtmlIcon />}
      </span>
      <span className="truncate flex-1">{display}</span>
    </button>
  );
}

function HtmlIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 4.5L1.8 8l3.2 3.5" />
      <path d="M11 4.5l3.2 3.5-3.2 3.5" />
      <path d="M9.4 3.4l-2.8 9.2" />
    </svg>
  );
}

function MdIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1.4" y="3.6" width="13.2" height="8.8" rx="1.2" />
      <path d="M3.5 10.2V6.2l1.5 2 1.5-2v4" />
      <path d="M10.5 6.5v3.4" />
      <path d="M9 8.6l1.5 1.5L12 8.6" />
    </svg>
  );
}

function ShortcutItem({
  shortcut,
  isSelected,
  onSelect,
  onContextMenu,
  onRemove,
}: {
  shortcut: Shortcut;
  isSelected: boolean;
  onSelect: (path: string) => void;
  onContextMenu: (x: number, y: number, path: string) => void;
  onRemove: (path: string) => void;
}) {
  const name = shortcut.path.split("/").pop() ?? shortcut.path;
  const ext = name.match(/\.(html?|md|markdown)$/i)?.[1].toLowerCase() ?? "";
  const display = name.replace(/\.(html?|md|markdown)$/i, "");
  const isMd = ext === "md" || ext === "markdown";
  return (
    <div className="relative group/shortcut">
      <button
        type="button"
        onClick={() => onSelect(shortcut.path)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e.clientX, e.clientY, shortcut.path);
        }}
        className={`tree-item ${isSelected ? "is-selected" : ""}`}
        style={{ paddingLeft: "14px", paddingRight: "28px" }}
        title={shortcut.path}
      >
        <span
          className={`file-icon ${isMd ? "file-icon-md" : "file-icon-html"} flex-shrink-0`}
          aria-hidden="true"
        >
          {isMd ? <MdIcon /> : <HtmlIcon />}
        </span>
        <span className="truncate flex-1">{display}</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(shortcut.path);
        }}
        title="Remove shortcut"
        aria-label="Remove shortcut"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 rounded text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-opacity opacity-0 group-hover/shortcut:opacity-100"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

function AddShortcutForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (path: string) => Promise<string | null>;
}) {
  const [path, setPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!path.trim()) {
      setErr("Path is required");
      return;
    }
    setSubmitting(true);
    const result = await onSubmit(path.trim());
    setSubmitting(false);
    if (result) {
      setErr(result);
    } else {
      setPath("");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="px-3 py-3 bg-[var(--surface-2)] rounded-lg fade-in"
    >
      <input
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="/absolute/path/to/file.html"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoFocus
        className="input-line font-mono mb-3"
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

function ContextMenu({
  x,
  y,
  path,
  onClose,
}: {
  x: number;
  y: number;
  path: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleAway = () => onClose();
    document.addEventListener("keydown", handleKey);
    document.addEventListener("click", handleAway);
    document.addEventListener("contextmenu", handleAway);
    document.addEventListener("scroll", handleAway, true);
    window.addEventListener("blur", handleAway);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("click", handleAway);
      document.removeEventListener("contextmenu", handleAway);
      document.removeEventListener("scroll", handleAway, true);
      window.removeEventListener("blur", handleAway);
    };
  }, [onClose]);

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      // Clipboard may be blocked (e.g., insecure context); silently ignore.
    }
    onClose();
  };

  const MENU_W = 180;
  const MENU_H = 44;
  const left = Math.min(x, window.innerWidth - MENU_W - 8);
  const top = Math.min(y, window.innerHeight - MENU_H - 8);

  return (
    <div
      role="menu"
      className="fixed z-50 min-w-[170px] py-1 rounded-md fade-in"
      style={{
        left,
        top,
        background: "var(--surface)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)",
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={handleCopyPath}
        className="w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
      >
        パスをコピー
      </button>
    </div>
  );
}
