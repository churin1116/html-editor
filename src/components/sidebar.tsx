"use client";

import { ACTIONS, type ActionIcon, type ActionId, type EditorMode } from "@/lib/editor-actions";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type AllowedRoot = { label: string; path: string };
type ShortcutFileNode = {
  type: "file";
  path: string;
  alias?: string;
  exists?: boolean;
};
type ShortcutFolderNode = {
  type: "folder";
  id: string;
  name: string;
  children: ShortcutNode[];
  cssPath?: string;
};
type ShortcutNode = ShortcutFileNode | ShortcutFolderNode;
type AddFormTarget = { parentId: string | null; kind: "file" | "folder" };
type MoveSource = { kind: "file"; path: string } | { kind: "folder"; id: string };
type DropTargetId = string | "root";

const DRAG_MIME = "application/x-shortcut-move";

function findFolderById(nodes: ShortcutNode[], id: string): ShortcutFolderNode | null {
  for (const n of nodes) {
    if (n.type !== "folder") continue;
    if (n.id === id) return n;
    const r = findFolderById(n.children, id);
    if (r) return r;
  }
  return null;
}

function isInvalidDrop(
  tree: ShortcutNode[],
  source: MoveSource | null,
  target: DropTargetId,
): boolean {
  if (!source) return false;
  if (source.kind !== "folder") return false;
  if (target === "root") return false;
  if (target === source.id) return true;
  const src = findFolderById(tree, source.id);
  if (!src) return false;
  return findFolderById(src.children, target) !== null;
}

type DnD = {
  dragOverTarget: DropTargetId | null;
  source: MoveSource | null;
  tree: ShortcutNode[];
  onDragStart: (e: React.DragEvent, source: MoveSource) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent, target: DropTargetId) => void;
  onDragLeave: (target: DropTargetId) => void;
  onDrop: (e: React.DragEvent, target: DropTargetId) => void;
};

type RenameAPI = {
  editingPath: string | null;
  onSubmit: (path: string, alias: string) => void;
  onCancel: () => void;
};

type ShortcutContextMenuOpener = (x: number, y: number, path: string, alias?: string) => void;
type TreeEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeEntry[];
};
type ContextMenuState = {
  x: number;
  y: number;
  path: string;
  source: "root" | "shortcut";
  alias?: string;
};

type FolderContextMenuState = {
  x: number;
  y: number;
  folderId: string;
  folderName: string;
  cssPath?: string;
};

type FolderContextMenuOpener = (x: number, y: number, folder: ShortcutFolderNode) => void;

export function Sidebar({
  selectedPath,
  onSelect,
  refreshKey,
  onCreated,
  mode,
  onApply,
  onFolderCssChanged,
}: {
  selectedPath: string | null;
  onSelect: (path: string) => void;
  refreshKey: number;
  onCreated: (path: string) => void;
  mode: EditorMode | null;
  onApply: (id: ActionId) => void;
  // Fired after a folder's cssPath was changed via the sidebar context menu.
  // EditorShell uses this to refresh just the open file's previewCss without
  // disturbing in-progress edits.
  onFolderCssChanged?: () => void;
}) {
  const [roots, setRoots] = useState<AllowedRoot[]>([]);
  const [trees, setTrees] = useState<Record<string, TreeEntry[]>>({});
  const [rootErrors, setRootErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState | null>(null);
  const [collapsedRoots, setCollapsedRoots] = useState<Record<string, boolean>>({});
  const [shortcutTree, setShortcutTree] = useState<ShortcutNode[]>([]);
  const [shortcutsCollapsed, setShortcutsCollapsed] = useState(false);
  const [addFormFor, setAddFormFor] = useState<AddFormTarget | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [dragOverTarget, setDragOverTarget] = useState<DropTargetId | null>(null);
  const [dragSource, setDragSource] = useState<MoveSource | null>(null);

  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  }, []);

  const openContextMenu = useCallback((x: number, y: number, path: string) => {
    setFolderContextMenu(null);
    setContextMenu({ x, y, path, source: "root" });
  }, []);
  const openShortcutContextMenu = useCallback(
    (x: number, y: number, path: string, alias?: string) => {
      setFolderContextMenu(null);
      setContextMenu({ x, y, path, source: "shortcut", alias });
    },
    [],
  );
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const openFolderContextMenu = useCallback<FolderContextMenuOpener>((x, y, folder) => {
    setContextMenu(null);
    setFolderContextMenu({
      x,
      y,
      folderId: folder.id,
      folderName: folder.name,
      cssPath: folder.cssPath,
    });
  }, []);
  const closeFolderContextMenu = useCallback(() => setFolderContextMenu(null), []);
  const setFolderCss = useCallback(
    async (folderId: string, cssPath: string | null) => {
      setFolderContextMenu(null);
      try {
        const r = await fetch("/api/shortcuts", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "setFolderCss", folderId, cssPath }),
        });
        const data = await r.json();
        if (!r.ok) {
          setError(data.error ?? `HTTP ${r.status}`);
          return;
        }
        setShortcutTree(data.shortcuts ?? []);
        onFolderCssChanged?.();
      } catch (e) {
        setError(String(e));
      }
    },
    [onFolderCssChanged],
  );
  const [editingAliasFor, setEditingAliasFor] = useState<string | null>(null);
  const startRenameAlias = useCallback((path: string) => {
    setEditingAliasFor(path);
    setContextMenu(null);
  }, []);
  const cancelRenameAlias = useCallback(() => setEditingAliasFor(null), []);
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
      setShortcutTree(data.shortcuts ?? []);
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
      // Also refresh shortcuts in case a shortcut target was moved/deleted
      // within a watched root.
      fetchShortcuts();
    };
    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [roots, reloadTree, fetchShortcuts]);

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

  const handleAddRoot = useCallback(async (label: string, path: string) => {
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
  }, []);

  const handleAddShortcut = useCallback(async (rawPath: string, parentId: string | null) => {
    const res = await fetch("/api/shortcuts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "file", path: rawPath, parentId }),
    });
    const data = await res.json();
    if (!res.ok) {
      return data.error ? `${data.error}${data.path ? ` (${data.path})` : ""}` : "Failed";
    }
    setShortcutTree(data.shortcuts ?? []);
    setAddFormFor(null);
    return null;
  }, []);

  const handleAddFolder = useCallback(async (name: string, parentId: string | null) => {
    const res = await fetch("/api/shortcuts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "folder", name, parentId }),
    });
    const data = await res.json();
    if (!res.ok) {
      return data.error ?? "Failed";
    }
    setShortcutTree(data.shortcuts ?? []);
    setAddFormFor(null);
    return null;
  }, []);

  const handleRemoveShortcut = useCallback(async (shortcutPath: string) => {
    const ok = window.confirm("Remove this shortcut?\nThe file on disk is not deleted.");
    if (!ok) return;
    const res = await fetch(`/api/shortcuts?path=${encodeURIComponent(shortcutPath)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      window.alert(`Failed: ${data.error}`);
      return;
    }
    setShortcutTree(data.shortcuts ?? []);
  }, []);

  const handleRemoveFolder = useCallback(
    async (folderId: string, folderName: string, hasChildren: boolean) => {
      const msg = hasChildren
        ? `Remove folder "${folderName}" and all shortcuts inside?\nFiles on disk are not deleted.`
        : `Remove folder "${folderName}"?`;
      const ok = window.confirm(msg);
      if (!ok) return;
      const res = await fetch(`/api/shortcuts?folderId=${encodeURIComponent(folderId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        window.alert(`Failed: ${data.error}`);
        return;
      }
      setShortcutTree(data.shortcuts ?? []);
    },
    [],
  );

  const openAddForm = useCallback((parentId: string | null, kind: "file" | "folder") => {
    setShortcutsCollapsed(false);
    if (parentId !== null) {
      setCollapsedFolders((prev) => (prev[parentId] ? { ...prev, [parentId]: false } : prev));
    }
    setAddFormFor({ parentId, kind });
  }, []);

  const handleSubmitAlias = useCallback(async (path: string, alias: string) => {
    setEditingAliasFor(null);
    const res = await fetch("/api/shortcuts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "rename", path, alias }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Rename failed");
      return;
    }
    setShortcutTree(data.shortcuts ?? []);
  }, []);

  const handleMove = useCallback(async (source: MoveSource, targetFolderId: string | null) => {
    const res = await fetch("/api/shortcuts", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "move", source, targetFolderId }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Move failed");
      return;
    }
    setShortcutTree(data.shortcuts ?? []);
    if (targetFolderId !== null) {
      setCollapsedFolders((prev) =>
        prev[targetFolderId] ? { ...prev, [targetFolderId]: false } : prev,
      );
    }
  }, []);

  const dnd: DnD = {
    dragOverTarget,
    source: dragSource,
    tree: shortcutTree,
    onDragStart: (e, source) => {
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(source));
      e.dataTransfer.effectAllowed = "move";
      setDragSource(source);
    },
    onDragEnd: () => {
      setDragSource(null);
      setDragOverTarget(null);
    },
    onDragOver: (e, target) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
      if (isInvalidDrop(shortcutTree, dragSource, target)) {
        e.dataTransfer.dropEffect = "none";
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOverTarget !== target) setDragOverTarget(target);
    },
    onDragLeave: (target) => {
      setDragOverTarget((prev) => (prev === target ? null : prev));
    },
    onDrop: (e, target) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      setDragOverTarget(null);
      setDragSource(null);
      const json = e.dataTransfer.getData(DRAG_MIME);
      if (!json) return;
      let source: MoveSource;
      try {
        source = JSON.parse(json) as MoveSource;
      } catch {
        return;
      }
      if (isInvalidDrop(shortcutTree, source, target)) {
        toast.error("Cannot drop a folder into itself or its descendants");
        return;
      }
      handleMove(source, target === "root" ? null : target);
    },
  };

  const handleRemoveRoot = useCallback(async (rootPath: string, label: string) => {
    const ok = window.confirm(`Remove "${label}"?\nFiles on disk are not deleted.`);
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
  }, []);

  if (error) return <div className="p-5 text-sm text-[var(--danger)]">{error}</div>;

  const isEmpty = roots.length === 0;

  return (
    <div className="text-sm h-full flex flex-col">
      <div className="flex-1 overflow-y-auto">
        {isEmpty && !showAddForm && <EmptyState onAdd={() => setShowAddForm(true)} />}

        {!isEmpty && (
          <div
            className={`px-3 pt-4 pb-1 group/shortcuts relative transition-colors ${
              dnd.dragOverTarget === "root"
                ? "bg-[color-mix(in_srgb,var(--text)_4%,transparent)] rounded-md"
                : ""
            }`}
            onDragOver={(e) => dnd.onDragOver(e, "root")}
            onDragLeave={() => dnd.onDragLeave("root")}
            onDrop={(e) => dnd.onDrop(e, "root")}
          >
            <div className="flex items-center justify-between px-2 mb-1.5 gap-2">
              <button
                type="button"
                onClick={() => setShortcutsCollapsed((v) => !v)}
                className="flex items-center gap-1 min-w-0 flex-1 text-left tree-root-toggle"
                aria-expanded={!shortcutsCollapsed}
              >
                <span className={`tree-dir-chevron ${!shortcutsCollapsed ? "is-open" : ""}`}>
                  <ChevronIcon />
                </span>
                <span className="text-[12px] font-medium text-[var(--text-muted)] truncate tracking-tight">
                  Shortcuts
                </span>
              </button>
              <div className="flex items-center gap-0.5 opacity-0 group-hover/shortcuts:opacity-100 transition-opacity duration-150 flex-shrink-0">
                <IconBtn onClick={() => openAddForm(null, "folder")} title="New folder">
                  <FolderPlusIcon />
                </IconBtn>
                <IconBtn onClick={() => openAddForm(null, "file")} title="Add shortcut">
                  <PlusIcon />
                </IconBtn>
              </div>
            </div>
            {!shortcutsCollapsed && (
              <>
                {addFormFor?.parentId === null && (
                  <div className="px-2 mb-2">
                    {addFormFor.kind === "file" ? (
                      <AddShortcutForm
                        onCancel={() => setAddFormFor(null)}
                        onSubmit={(p) => handleAddShortcut(p, null)}
                      />
                    ) : (
                      <AddFolderForm
                        onCancel={() => setAddFormFor(null)}
                        onSubmit={(n) => handleAddFolder(n, null)}
                      />
                    )}
                  </div>
                )}
                {shortcutTree.length === 0 && addFormFor === null && (
                  <div className="px-4 py-1.5 text-[11px] text-[var(--text-subtle)] leading-relaxed">
                    Add absolute paths to reach files anywhere.
                  </div>
                )}
                <ShortcutTreeView
                  nodes={shortcutTree}
                  depth={0}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  onContextMenu={openShortcutContextMenu}
                  onFolderContextMenu={openFolderContextMenu}
                  onRemoveFile={handleRemoveShortcut}
                  onRemoveFolder={handleRemoveFolder}
                  collapsedFolders={collapsedFolders}
                  onToggleFolder={toggleFolder}
                  addFormFor={addFormFor}
                  onOpenAddForm={openAddForm}
                  onCancelAddForm={() => setAddFormFor(null)}
                  onSubmitFile={handleAddShortcut}
                  onSubmitFolder={handleAddFolder}
                  dnd={dnd}
                  rename={{
                    editingPath: editingAliasFor,
                    onSubmit: handleSubmitAlias,
                    onCancel: cancelRenameAlias,
                  }}
                />
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
            <AddRootForm onCancel={() => setShowAddForm(false)} onSubmit={handleAddRoot} />
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
                {isOpen &&
                  (rootErrors[root.path] ? (
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
                      // The root header row itself sits at depth 0 (its chevron
                      // is at px-2), so the root's entries start one level in.
                      depth={1}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="border-t border-[var(--border-subtle)] px-3 py-2 flex items-center gap-1">
        <HelpButton mode={mode} onApply={onApply} />
        <SettingsButton />
        <a
          href="https://github.com/churin1116/html-editor"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center w-7 h-7 rounded-md hover:bg-[var(--surface-2)] transition-colors"
          style={{ color: "var(--text)" }}
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
          source={contextMenu.source}
          alias={contextMenu.alias}
          onClose={closeContextMenu}
          onStartRename={startRenameAlias}
        />
      )}
      {folderContextMenu && (
        <FolderContextMenu
          x={folderContextMenu.x}
          y={folderContextMenu.y}
          folderId={folderContextMenu.folderId}
          folderName={folderContextMenu.folderName}
          cssPath={folderContextMenu.cssPath}
          onClose={closeFolderContextMenu}
          onSetCss={setFolderCss}
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
            boxShadow: "0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)",
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
                    <span className="text-[var(--text-muted)] flex-shrink-0" aria-hidden="true">
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

function SettingsButton() {
  const [open, setOpen] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState<boolean | null>(null);
  const [themeVersion, setThemeVersion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  useEffect(() => {
    if (!open || autoUpdate !== null) return;
    (async () => {
      try {
        const r = await fetch("/api/settings");
        const data = await r.json();
        if (r.ok) {
          setAutoUpdate(data.settings?.themeAutoUpdate ?? true);
          setThemeVersion(data.themeVersion ?? null);
        }
      } catch {
        /* leave loading state */
      }
    })();
  }, [open, autoUpdate]);

  const toggleAutoUpdate = useCallback(async () => {
    if (autoUpdate === null || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ themeAutoUpdate: !autoUpdate }),
      });
      const data = await r.json();
      if (!r.ok) {
        toast.error(data.error ?? "Failed to update settings");
        return;
      }
      setAutoUpdate(data.settings.themeAutoUpdate);
      setThemeVersion(data.themeVersion ?? null);
      toast.success(
        data.settings.themeAutoUpdate
          ? "テーマ自動更新: ON — 保存時に最新テーマを焼き込みます"
          : "テーマ自動更新: OFF — 同期済みの固定版を使います",
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }, [autoUpdate, busy]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        title="設定"
        aria-label="設定を開く"
        aria-expanded={open}
      >
        <GearIcon />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-[268px] py-1.5 rounded-md fade-in z-40"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)",
          }}
        >
          <div className="px-3 pb-1.5 pt-0.5 text-[10.5px] tracking-[0.08em] uppercase text-[var(--text-subtle)]">
            設定
          </div>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={autoUpdate ?? false}
            disabled={autoUpdate === null || busy}
            onClick={toggleAutoUpdate}
            className="w-full flex items-start justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--surface-2)] transition-colors disabled:opacity-50"
          >
            <span className="min-w-0">
              <span className="block text-[12px] text-[var(--text)]">テーマ自動更新</span>
              <span className="block text-[10.5px] text-[var(--text-subtle)] leading-relaxed mt-0.5">
                保存時に html-chameleon の最新テーマを焼き込む
                {themeVersion && <span className="font-mono">（現在 v{themeVersion}）</span>}
              </span>
            </span>
            <span
              className={`flex-shrink-0 mt-0.5 inline-flex w-8 h-[18px] rounded-full p-[2px] transition-colors ${
                autoUpdate ? "bg-[var(--primary)]" : "bg-[var(--border-strong)]"
              }`}
              aria-hidden="true"
            >
              <span
                className={`w-[14px] h-[14px] rounded-full bg-white transition-transform ${
                  autoUpdate ? "translate-x-[14px]" : ""
                }`}
              />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

function GearIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="2.2" />
      <path d="M13.2 8c0-.38-.04-.75-.12-1.1l1.44-1.1-1.3-2.25-1.7.66a5.2 5.2 0 0 0-1.9-1.1L9.3 1.3H6.7l-.32 1.8a5.2 5.2 0 0 0-1.9 1.1l-1.7-.65-1.3 2.24 1.44 1.1a5.3 5.3 0 0 0 0 2.21L1.48 10.2l1.3 2.25 1.7-.66a5.2 5.2 0 0 0 1.9 1.1l.32 1.81h2.6l.32-1.8a5.2 5.2 0 0 0 1.9-1.1l1.7.65 1.3-2.24-1.44-1.1c.08-.36.12-.73.12-1.11z" />
    </svg>
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
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
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
      <button type="button" onClick={onAdd} className="btn-save-active">
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
      {err && <div className="text-[11.5px] text-[var(--danger)] mb-3 leading-relaxed">{err}</div>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting} className="btn-save-active disabled:opacity-40">
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

function FolderPlusIcon() {
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
      aria-hidden="true"
    >
      <path d="M1.6 4.2c0-.55.45-1 1-1h3.4l1.4 1.6h6c.55 0 1 .45 1 1v6.4c0 .55-.45 1-1 1H2.6c-.55 0-1-.45-1-1V4.2z" />
      <path d="M8 7.6v4M6 9.6h4" />
    </svg>
  );
}

function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {open ? (
        <>
          <path d="M1.6 4.2c0-.55.45-1 1-1h3.4l1.4 1.6h6c.55 0 1 .45 1 1v1.4H1.6V4.2z" />
          <path d="M1.6 7.2h12.8l-1.2 4.4c-.12.44-.52.76-.98.76H2.78c-.55 0-1-.45-1-1V7.2z" />
        </>
      ) : (
        <path d="M1.6 4.2c0-.55.45-1 1-1h3.4l1.4 1.6h6c.55 0 1 .45 1 1v6.4c0 .55-.45 1-1 1H2.6c-.55 0-1-.45-1-1V4.2z" />
      )}
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
        <span className={`tree-dir-chevron ${open ? "is-open" : ""}`}>
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

function MissingIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.6a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 0 0 0-12.8z" />
      <path d="M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2" />
    </svg>
  );
}

function ShortcutTreeView({
  nodes,
  depth,
  selectedPath,
  onSelect,
  onContextMenu,
  onFolderContextMenu,
  onRemoveFile,
  onRemoveFolder,
  collapsedFolders,
  onToggleFolder,
  addFormFor,
  onOpenAddForm,
  onCancelAddForm,
  onSubmitFile,
  onSubmitFolder,
  dnd,
  rename,
}: {
  nodes: ShortcutNode[];
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onContextMenu: ShortcutContextMenuOpener;
  onFolderContextMenu: FolderContextMenuOpener;
  onRemoveFile: (path: string) => void;
  onRemoveFolder: (id: string, name: string, hasChildren: boolean) => void;
  collapsedFolders: Record<string, boolean>;
  onToggleFolder: (id: string) => void;
  addFormFor: AddFormTarget | null;
  onOpenAddForm: (parentId: string | null, kind: "file" | "folder") => void;
  onCancelAddForm: () => void;
  onSubmitFile: (path: string, parentId: string | null) => Promise<string | null>;
  onSubmitFolder: (name: string, parentId: string | null) => Promise<string | null>;
  dnd: DnD;
  rename: RenameAPI;
}) {
  return (
    <>
      {nodes.map((node) =>
        node.type === "file" ? (
          <ShortcutItem
            key={`f:${node.path}`}
            file={node}
            depth={depth}
            isSelected={selectedPath === node.path}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
            onRemove={onRemoveFile}
            dnd={dnd}
            rename={rename}
          />
        ) : (
          <ShortcutFolderItem
            key={`d:${node.id}`}
            folder={node}
            depth={depth}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
            onFolderContextMenu={onFolderContextMenu}
            onRemoveFile={onRemoveFile}
            onRemoveFolder={onRemoveFolder}
            collapsedFolders={collapsedFolders}
            onToggleFolder={onToggleFolder}
            addFormFor={addFormFor}
            onOpenAddForm={onOpenAddForm}
            onCancelAddForm={onCancelAddForm}
            onSubmitFile={onSubmitFile}
            onSubmitFolder={onSubmitFolder}
            dnd={dnd}
            rename={rename}
          />
        ),
      )}
    </>
  );
}

function ShortcutFolderItem({
  folder,
  depth,
  selectedPath,
  onSelect,
  onContextMenu,
  onFolderContextMenu,
  onRemoveFile,
  onRemoveFolder,
  collapsedFolders,
  onToggleFolder,
  addFormFor,
  onOpenAddForm,
  onCancelAddForm,
  onSubmitFile,
  onSubmitFolder,
  dnd,
  rename,
}: {
  folder: ShortcutFolderNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onContextMenu: ShortcutContextMenuOpener;
  onFolderContextMenu: FolderContextMenuOpener;
  onRemoveFile: (path: string) => void;
  onRemoveFolder: (id: string, name: string, hasChildren: boolean) => void;
  collapsedFolders: Record<string, boolean>;
  onToggleFolder: (id: string) => void;
  addFormFor: AddFormTarget | null;
  onOpenAddForm: (parentId: string | null, kind: "file" | "folder") => void;
  onCancelAddForm: () => void;
  onSubmitFile: (path: string, parentId: string | null) => Promise<string | null>;
  onSubmitFolder: (name: string, parentId: string | null) => Promise<string | null>;
  dnd: DnD;
  rename: RenameAPI;
}) {
  const open = !collapsedFolders[folder.id];
  const showForm = addFormFor?.parentId === folder.id;
  const isDragOver = dnd.dragOverTarget === folder.id;
  const isDragging = dnd.source?.kind === "folder" && dnd.source.id === folder.id;
  return (
    <div className="group/folder">
      <div
        className={`relative flex items-center transition-colors rounded-sm ${
          isDragOver ? "bg-[color-mix(in_srgb,var(--text)_8%,transparent)]" : ""
        } ${isDragging ? "opacity-50" : ""}`}
        style={{ paddingLeft: `${depth * 12}px` }}
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          dnd.onDragStart(e, { kind: "folder", id: folder.id });
        }}
        onDragEnd={dnd.onDragEnd}
        onDragOver={(e) => {
          e.stopPropagation();
          dnd.onDragOver(e, folder.id);
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          dnd.onDragLeave(folder.id);
        }}
        onDrop={(e) => dnd.onDrop(e, folder.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onFolderContextMenu(e.clientX, e.clientY, folder);
        }}
      >
        <button
          type="button"
          onClick={() => onToggleFolder(folder.id)}
          className="tree-dir flex-1 min-w-0"
          style={{ paddingRight: "60px" }}
          aria-expanded={open}
        >
          <span className={`tree-dir-chevron ${open ? "is-open" : ""}`}>
            <ChevronIcon />
          </span>
          <span className="file-icon flex-shrink-0" aria-hidden="true">
            <FolderIcon open={open} />
          </span>
          <span className="truncate">{folder.name}</span>
          {folder.cssPath && (
            <span
              className="ml-1.5 flex-shrink-0 inline-block w-1.5 h-1.5 rounded-full bg-[var(--primary)]"
              title={`プレビュー CSS: ${folder.cssPath}`}
              aria-label={`プレビュー CSS が設定されています: ${folder.cssPath}`}
            />
          )}
        </button>
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover/folder:opacity-100 transition-opacity">
          <IconBtn onClick={() => onOpenAddForm(folder.id, "file")} title="Add shortcut here">
            <PlusIcon />
          </IconBtn>
          <IconBtn onClick={() => onOpenAddForm(folder.id, "folder")} title="New subfolder">
            <FolderPlusIcon />
          </IconBtn>
          <IconBtn
            onClick={() => onRemoveFolder(folder.id, folder.name, folder.children.length > 0)}
            title="Remove folder"
          >
            <CloseIcon />
          </IconBtn>
        </div>
      </div>
      {open && (
        <>
          {showForm && (
            <div
              className="mb-2 mt-1"
              style={{ paddingLeft: `${(depth + 1) * 12}px`, paddingRight: "4px" }}
            >
              {addFormFor.kind === "file" ? (
                <AddShortcutForm
                  onCancel={onCancelAddForm}
                  onSubmit={(p) => onSubmitFile(p, folder.id)}
                />
              ) : (
                <AddFolderForm
                  onCancel={onCancelAddForm}
                  onSubmit={(n) => onSubmitFolder(n, folder.id)}
                />
              )}
            </div>
          )}
          <ShortcutTreeView
            nodes={folder.children}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
            onContextMenu={onContextMenu}
            onFolderContextMenu={onFolderContextMenu}
            onRemoveFile={onRemoveFile}
            onRemoveFolder={onRemoveFolder}
            collapsedFolders={collapsedFolders}
            onToggleFolder={onToggleFolder}
            addFormFor={addFormFor}
            onOpenAddForm={onOpenAddForm}
            onCancelAddForm={onCancelAddForm}
            onSubmitFile={onSubmitFile}
            onSubmitFolder={onSubmitFolder}
            dnd={dnd}
            rename={rename}
          />
        </>
      )}
    </div>
  );
}

function ShortcutItem({
  file,
  depth,
  isSelected,
  onSelect,
  onContextMenu,
  onRemove,
  dnd,
  rename,
}: {
  file: ShortcutFileNode;
  depth: number;
  isSelected: boolean;
  onSelect: (path: string) => void;
  onContextMenu: ShortcutContextMenuOpener;
  onRemove: (path: string) => void;
  dnd: DnD;
  rename: RenameAPI;
}) {
  const filename = file.path.split("/").pop() ?? file.path;
  const ext = filename.match(/\.(html?|md|markdown)$/i)?.[1].toLowerCase() ?? "";
  const baseDisplay = filename.replace(/\.(html?|md|markdown)$/i, "");
  const display = file.alias ?? baseDisplay;
  const isMd = ext === "md" || ext === "markdown";
  const missing = file.exists === false;
  const isDragging = dnd.source?.kind === "file" && dnd.source.path === file.path;
  const isEditing = rename.editingPath === file.path;
  const titleParts = [
    missing ? `ファイルが見つかりません` : null,
    file.alias ? `元ファイル: ${filename}` : null,
    file.path,
  ].filter(Boolean);
  return (
    <div className={`relative group/shortcut ${isDragging ? "opacity-50" : ""}`}>
      {isEditing ? (
        <AliasRenameInput
          initial={file.alias ?? baseDisplay}
          placeholder={baseDisplay}
          originalFilename={filename}
          depth={depth}
          onSubmit={(value) => rename.onSubmit(file.path, value)}
          onCancel={rename.onCancel}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => onSelect(file.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu(e.clientX, e.clientY, file.path, file.alias);
            }}
            draggable
            onDragStart={(e) => dnd.onDragStart(e, { kind: "file", path: file.path })}
            onDragEnd={dnd.onDragEnd}
            className={`tree-item ${isSelected ? "is-selected" : ""} ${missing ? "is-missing" : ""}`}
            style={{ paddingLeft: `${depth * 12 + 14}px`, paddingRight: "28px" }}
            title={titleParts.join("\n")}
          >
            <span
              className={`file-icon ${isMd ? "file-icon-md" : "file-icon-html"} flex-shrink-0`}
              aria-hidden="true"
            >
              {missing ? <MissingIcon /> : isMd ? <MdIcon /> : <HtmlIcon />}
            </span>
            <span className="truncate flex-1">{display}</span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(file.path);
            }}
            title="Remove shortcut"
            aria-label="Remove shortcut"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 rounded text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-opacity opacity-0 group-hover/shortcut:opacity-100"
          >
            <CloseIcon />
          </button>
        </>
      )}
    </div>
  );
}

function AliasRenameInput({
  initial,
  placeholder,
  originalFilename,
  depth,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  originalFilename: string;
  depth: number;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const settledRef = useRef(false);
  const submit = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onSubmit(value);
  };
  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };
  return (
    <div
      className="tree-item is-selected"
      style={{
        paddingLeft: `${depth * 12 + 14}px`,
        paddingRight: "8px",
      }}
      title={`元ファイル: ${originalFilename}`}
    >
      <span className="file-icon flex-shrink-0" aria-hidden="true" />
      <input
        // biome-ignore lint/a11y/noAutofocus: rename input should receive focus immediately
        autoFocus
        type="text"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={submit}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[var(--text)] text-[12.5px] px-0 py-0"
      />
    </div>
  );
}

function AddFolderForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) {
      setErr("Name is required");
      return;
    }
    setSubmitting(true);
    const result = await onSubmit(name.trim());
    setSubmitting(false);
    if (result) setErr(result);
    else setName("");
  }

  return (
    <form onSubmit={handleSubmit} className="px-3 py-3 bg-[var(--surface-2)] rounded-lg fade-in">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Folder name"
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoFocus
        className="input-line mb-3"
        style={{ fontSize: "12px" }}
      />
      {err && <div className="text-[11.5px] text-[var(--danger)] mb-3 leading-relaxed">{err}</div>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting} className="btn-save-active disabled:opacity-40">
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
    <form onSubmit={handleSubmit} className="px-3 py-3 bg-[var(--surface-2)] rounded-lg fade-in">
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
      {err && <div className="text-[11.5px] text-[var(--danger)] mb-3 leading-relaxed">{err}</div>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={submitting} className="btn-save-active disabled:opacity-40">
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
  source,
  alias,
  onClose,
  onStartRename,
}: {
  x: number;
  y: number;
  path: string;
  source: "root" | "shortcut";
  alias?: string;
  onClose: () => void;
  onStartRename: (path: string) => void;
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

  const filename = path.split("/").pop() ?? path;
  const isShortcut = source === "shortcut";
  const itemCount = isShortcut ? 2 : 1;

  const MENU_W = 200;
  const MENU_H = 36 + itemCount * 30 + (isShortcut ? 16 : 0);
  const left = Math.min(x, window.innerWidth - MENU_W - 8);
  const top = Math.min(y, window.innerHeight - MENU_H - 8);

  return (
    <div
      role="menu"
      className="fixed z-50 min-w-[190px] py-1 rounded-md fade-in"
      style={{
        left,
        top,
        background: "var(--surface)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)",
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {isShortcut && (
        <div className="px-3 pt-1.5 pb-1.5 mb-1">
          {alias && (
            <div className="text-[10.5px] uppercase tracking-[0.06em] text-[var(--text-subtle)] mb-0.5">
              元ファイル
            </div>
          )}
          <div className="text-[11.5px] font-mono text-[var(--text-muted)] truncate" title={path}>
            {filename}
          </div>
        </div>
      )}
      {isShortcut && (
        <button
          type="button"
          role="menuitem"
          onClick={() => onStartRename(path)}
          className="w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          表示名を変更
        </button>
      )}
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

function FolderContextMenu({
  x,
  y,
  folderId,
  folderName,
  cssPath,
  onClose,
  onSetCss,
}: {
  x: number;
  y: number;
  folderId: string;
  folderName: string;
  cssPath?: string;
  onClose: () => void;
  onSetCss: (folderId: string, cssPath: string | null) => void;
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

  const handleSet = () => {
    const initial = cssPath ?? "";
    const input = window.prompt(
      `プレビュー CSS のパス（絶対パス）。「${folderName}」配下のファイルを開いたときにスコープ付きで適用されます。空欄で解除。`,
      initial,
    );
    if (input === null) {
      onClose();
      return;
    }
    onSetCss(folderId, input.trim() ? input.trim() : null);
  };

  const itemCount = cssPath ? 2 : 1;
  const MENU_W = 240;
  const MENU_H = 56 + itemCount * 30;
  const left = Math.min(x, window.innerWidth - MENU_W - 8);
  const top = Math.min(y, window.innerHeight - MENU_H - 8);

  return (
    <div
      role="menu"
      className="fixed z-50 min-w-[220px] py-1 rounded-md fade-in"
      style={{
        left,
        top,
        background: "var(--surface)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)",
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="px-3 pt-1.5 pb-1.5 mb-1">
        <div className="text-[10.5px] uppercase tracking-[0.06em] text-[var(--text-subtle)] mb-0.5">
          フォルダ
        </div>
        <div
          className="text-[11.5px] font-mono text-[var(--text-muted)] truncate"
          title={cssPath ?? "(プレビュー CSS 未設定)"}
        >
          {folderName}
        </div>
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={handleSet}
        className="w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
      >
        {cssPath ? "プレビュー CSS を変更..." : "プレビュー CSS を設定..."}
      </button>
      {cssPath && (
        <button
          type="button"
          role="menuitem"
          onClick={() => onSetCss(folderId, null)}
          className="w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          プレビュー CSS を解除
        </button>
      )}
    </div>
  );
}
