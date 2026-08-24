"use client";

import { confirmDialog, promptDialog } from "@/lib/dialogs";
import { ACTIONS, type ActionIcon, type ActionId, type EditorMode } from "@/lib/editor-actions";
import {
  MAX_SEARCH_RESULTS,
  type SearchEntry,
  type SearchHit,
  ancestorDirPaths,
  buildSearchIndex,
  searchEntries,
} from "@/lib/sidebar-search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
// Inline "new HTML file / new folder" draft row inside a tree directory
// (VS Code-style). `draft` names the directory the open row belongs to and
// what it creates; `onSubmit` resolves to an error message to keep the row
// open, or null on success.
type NewNodeKind = "file" | "folder";
type NewNodeDraft = { dir: string; kind: NewNodeKind };
type NewNodeAPI = {
  draft: NewNodeDraft | null;
  onStart: (dirPath: string, kind: NewNodeKind) => void;
  onSubmit: (dirPath: string, kind: NewNodeKind, name: string) => Promise<string | null>;
  onCancel: () => void;
};
type MoveSource = { kind: "file"; path: string } | { kind: "folder"; id: string };
type DropTargetId = string | "root";

const DRAG_MIME = "application/x-shortcut-move";
const TREE_DRAG_MIME = "application/x-tree-move";
// Legacy keys — sidebar UI state now lives in cookies so the server can
// render the correct state on first paint. Old localStorage values migrate
// on mount.
const COLLAPSE_STORAGE_KEY = "sidebar.collapse.v1";
const WORKSPACE_STORAGE_KEY = "sidebar.workspace.v1";
const WORKSPACE_COOKIE = "workspace";
const COLLAPSE_COOKIE = "sidebarCollapse";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function writeWorkspaceCookie(value: string | null) {
  document.cookie = value
    ? `${WORKSPACE_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
    : `${WORKSPACE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

// Everything the sidebar keeps collapsed, hydrated server-side from the
// `sidebarCollapse` cookie so the first paint already shows the right state.
export type SidebarCollapse = {
  roots: Record<string, boolean>;
  folders: Record<string, boolean>;
  // Directories inside a root's file tree, keyed by absolute path. An entry
  // is an explicit user choice (true = closed, false = open); directories
  // without one fall back to their root's default (see dirDefaultClosed).
  dirs: Record<string, boolean>;
  // Roots whose tree directories default to collapsed — set when a root is
  // added, so a freshly registered tree starts fully closed. Only the dirs
  // the user then opens are stored (as explicit `false` entries), which keeps
  // the cookie small even for huge trees.
  dirDefaultClosed: string[];
  shortcuts: boolean;
};

// Cookie payload: only the exceptions are stored, as compact arrays.
// d = explicitly closed dirs, o = explicitly opened dirs, dd = default-closed roots.
type CollapseCookiePayload = {
  r: string[];
  f: string[];
  d: string[];
  o: string[];
  dd: string[];
  s: 0 | 1;
};

function collapsedKeys(map: Record<string, boolean>): string[] {
  return Object.keys(map).filter((k) => map[k]);
}

function writeCollapseCookie(state: SidebarCollapse) {
  const underDefaultClosedRoot = (p: string) =>
    state.dirDefaultClosed.some((root) => p === root || p.startsWith(`${root}/`));
  let payload: CollapseCookiePayload = {
    r: collapsedKeys(state.roots),
    f: collapsedKeys(state.folders),
    // Store only entries that differ from their root's default: "closed"
    // under a default-open root, "opened" under a default-closed root.
    d: Object.keys(state.dirs).filter((k) => state.dirs[k] && !underDefaultClosedRoot(k)),
    o: Object.keys(state.dirs).filter((k) => state.dirs[k] === false && underDefaultClosedRoot(k)),
    dd: state.dirDefaultClosed,
    s: state.shortcuts ? 1 : 0,
  };
  let encoded = encodeURIComponent(JSON.stringify(payload));
  // Cookies cap at ~4KB. Directory paths dominate the payload, so shed those
  // first — a dropped entry just means that folder reverts to its root's
  // default state on the next reload.
  while (encoded.length > 3800 && (payload.d.length > 0 || payload.o.length > 0)) {
    if (payload.d.length > 0) {
      payload = { ...payload, d: payload.d.slice(0, Math.floor(payload.d.length / 2)) };
    } else {
      payload = { ...payload, o: payload.o.slice(0, Math.floor(payload.o.length / 2)) };
    }
    encoded = encodeURIComponent(JSON.stringify(payload));
  }
  document.cookie = `${COLLAPSE_COOKIE}=${encoded}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

// Which registered root a tree directory belongs to — the longest matching
// prefix, so a root nested inside another still resolves to itself.
function enclosingRootPath(roots: AllowedRoot[], dirPath: string): string | null {
  let best: string | null = null;
  for (const r of roots) {
    if (dirPath !== r.path && !dirPath.startsWith(`${r.path}/`)) continue;
    if (best === null || r.path.length > best.length) best = r.path;
  }
  return best;
}

function findFolderById(nodes: ShortcutNode[], id: string): ShortcutFolderNode | null {
  for (const n of nodes) {
    if (n.type !== "folder") continue;
    if (n.id === id) return n;
    const r = findFolderById(n.children, id);
    if (r) return r;
  }
  return null;
}

// Ids of the shortcut folders that have to be open for `path` to be visible,
// outermost first. null when the path isn't a shortcut at all.
function shortcutFolderChain(
  nodes: ShortcutNode[],
  path: string,
  trail: string[] = [],
): string[] | null {
  for (const n of nodes) {
    if (n.type === "file") {
      if (n.path === path) return trail;
    } else {
      const found = shortcutFolderChain(n.children, path, [...trail, n.id]);
      if (found) return found;
    }
  }
  return null;
}

// Collect every file path within a subtree (used to decide whether the open
// file lives inside a folder that's being removed).
function collectFilePaths(nodes: ShortcutNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === "file") acc.push(n.path);
    else collectFilePaths(n.children, acc);
  }
  return acc;
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
type TreeContextMenuOpener = (
  x: number,
  y: number,
  path: string,
  nodeType: "file" | "directory",
) => void;
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
  // Tree rows only ("root"): what the row points at, so the menu can offer the
  // right rename (a file and a folder go to different endpoints).
  nodeType?: "file" | "directory";
};

// Renaming an actual file/folder on disk from a tree row — distinct from
// RenameAPI above, which only changes a shortcut's display alias.
type TreeRenameAPI = {
  path: string | null;
  onSubmit: (path: string, kind: NewNodeKind, name: string) => Promise<string | null>;
  onCancel: () => void;
};

// Dragging tree rows moves the real file/folder on disk. Kept separate from
// the shortcut DnD above (which only reorders bookmarks) — including its drag
// MIME type, so neither tree can accept the other's payload.
type TreeDragSource = { path: string; type: "file" | "directory" };
type TreeDnD = {
  // Everything this drag carries: the row that was grabbed, or the whole
  // marked set when the grabbed row is part of it.
  dragging: TreeDragSource[];
  // Absolute path of the directory currently under the pointer, if droppable.
  overDir: string | null;
  onDragStart: (e: React.DragEvent, source: TreeDragSource) => void;
  onDragEnd: () => void;
  // Both dragenter and dragover must preventDefault for the element to accept
  // a drop — a pointer that stops right after entering a row emits no further
  // dragover, and the drop would be refused. Same handler for both.
  onDragEnter: (e: React.DragEvent, targetDir: string) => void;
  onDragOver: (e: React.DragEvent, targetDir: string) => void;
  onDragLeave: (targetDir: string) => void;
  onDrop: (e: React.DragEvent, targetDir: string) => void;
  // Hovering a collapsed folder mid-drag opens it after a beat, so nested
  // destinations are reachable without dropping first (as in VS Code).
  onHoverFolder: (dirPath: string, isOpen: boolean) => void;
};

const HOVER_EXPAND_MS = 600;

// Ctrl/Cmd-click marks rows; a marked row drags the whole set. Kept apart
// from `selectedPath`, which means "the file open in the editor".
type TreeMarksAPI = {
  paths: string[];
  // Returns true when the click was a marking gesture and the row's normal
  // action (open the file / toggle the folder) must not run.
  onRowClick: (e: React.MouseEvent, entry: TreeDragSource) => boolean;
};

// The import API reports per-file refusals in English (its own contract); the
// sidebar shows them in the language of the rest of its messages.
const IMPORT_ERROR_JA: Record<string, string> = {
  "Only .html and .md files can be imported": ".html / .md のみ取り込めます",
  "A file with that name already exists": "同じ名前のファイルがすでにあります",
  "File is too large": "ファイルが大きすぎます（上限 10MB）",
  "Invalid file name": "ファイル名が不正です",
};

function importErrorText(error: string): string {
  return IMPORT_ERROR_JA[error] ?? error;
}

function parentDir(p: string): string {
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : "/";
}

// A move is pointless (already there) or impossible (a folder into itself or
// its own subtree). Only entries that fail this are dropped from the payload;
// the drop as a whole is refused when nothing is left.
function isInvalidTreeDrop(source: TreeDragSource, targetDir: string): boolean {
  if (parentDir(source.path) === targetDir) return true;
  if (source.type !== "directory") return false;
  return targetDir === source.path || targetDir.startsWith(`${source.path}/`);
}

function movableInto(sources: TreeDragSource[], targetDir: string): TreeDragSource[] {
  return sources.filter((s) => !isInvalidTreeDrop(s, targetDir));
}

// Dragging a folder together with something inside it would move the child
// twice — the second move would look for a path that no longer exists.
function dropNested(sources: TreeDragSource[]): TreeDragSource[] {
  const dirs = sources.filter((s) => s.type === "directory").map((s) => s.path);
  return sources.filter((s) => !dirs.some((d) => d !== s.path && s.path.startsWith(`${d}/`)));
}

// Rows in the order they appear on screen — what Shift-click ranges over.
function flattenVisibleRows(
  entries: TreeEntry[],
  collapsedDirs: Record<string, boolean>,
  defaultCollapsed: boolean,
  out: string[],
): void {
  for (const entry of entries) {
    out.push(entry.path);
    if (entry.type !== "directory") continue;
    const explicit = collapsedDirs[entry.path];
    const open = explicit === undefined ? !defaultCollapsed : !explicit;
    if (open && entry.children)
      flattenVisibleRows(entry.children, collapsedDirs, defaultCollapsed, out);
  }
}

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
  mode,
  onApply,
  onFolderCssChanged,
  onRenamed,
  initialRoots,
  initialTrees,
  initialRootErrors,
  initialTreeTruncated,
  initialShortcuts,
  initialWorkspace,
  initialCollapse,
}: {
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
  refreshKey: number;
  mode: EditorMode | null;
  onApply: (id: ActionId) => void;
  // Fired after a folder's cssPath was changed via the sidebar context menu.
  // EditorShell uses this to refresh just the open file's previewCss without
  // disturbing in-progress edits.
  onFolderCssChanged?: () => void;
  // Fired after a tree row was renamed on disk. EditorShell repoints the open
  // file at the new path instead of reloading it, so unsaved edits survive a
  // rename of the file (or of a folder above it).
  onRenamed?: (oldPath: string, newPath: string) => void;
  // Server-rendered initial data: the first paint shows the real sidebar
  // instead of flashing the empty state while the client refetches.
  initialRoots: AllowedRoot[];
  initialTrees: Record<string, TreeEntry[]>;
  initialRootErrors: Record<string, string>;
  initialTreeTruncated: Record<string, boolean>;
  initialShortcuts: ShortcutNode[];
  initialWorkspace: string | null;
  initialCollapse: SidebarCollapse;
}) {
  const [roots, setRoots] = useState<AllowedRoot[]>(initialRoots);
  const [trees, setTrees] = useState<Record<string, TreeEntry[]>>(initialTrees);
  const [rootErrors, setRootErrors] = useState<Record<string, string>>(initialRootErrors);
  // Roots whose walk hit the scan budget — the tree is valid but incomplete,
  // and the UI says so instead of silently dropping deep content.
  const [treeTruncated, setTreeTruncated] = useState<Record<string, boolean>>(initialTreeTruncated);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState | null>(null);
  const [collapsedRoots, setCollapsedRoots] = useState<Record<string, boolean>>(
    initialCollapse.roots,
  );
  const [shortcutTree, setShortcutTree] = useState<ShortcutNode[]>(initialShortcuts);
  const [shortcutsCollapsed, setShortcutsCollapsed] = useState(initialCollapse.shortcuts);
  const [addFormFor, setAddFormFor] = useState<AddFormTarget | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>(
    initialCollapse.folders,
  );
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>(initialCollapse.dirs);
  const [dirDefaultClosed, setDirDefaultClosed] = useState<string[]>(
    initialCollapse.dirDefaultClosed,
  );
  // The one open inline draft row, if any (see NewNodeAPI).
  const [newNodeDraft, setNewNodeDraft] = useState<NewNodeDraft | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<DropTargetId | null>(null);
  const [dragSource, setDragSource] = useState<MoveSource | null>(null);
  // Row the search box asked to bring into view. A fresh object per request so
  // picking the same result twice scrolls to it again.
  const [reveal, setReveal] = useState<{ path: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // One-time migration from the old localStorage collapse persistence to the
  // cookie. Only adopted when the cookie hadn't been established yet, so an
  // already-migrated cookie always wins.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once; initialCollapse never changes after mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (!raw) return;
      localStorage.removeItem(COLLAPSE_STORAGE_KEY);
      const cookieEmpty =
        Object.keys(initialCollapse.roots).length === 0 &&
        Object.keys(initialCollapse.folders).length === 0 &&
        Object.keys(initialCollapse.dirs).length === 0 &&
        initialCollapse.dirDefaultClosed.length === 0 &&
        !initialCollapse.shortcuts;
      if (!cookieEmpty) return;
      const saved = JSON.parse(raw) as {
        roots?: Record<string, boolean>;
        folders?: Record<string, boolean>;
        shortcuts?: boolean;
      };
      if (saved.roots) setCollapsedRoots(saved.roots);
      if (saved.folders) setCollapsedFolders(saved.folders);
      if (typeof saved.shortcuts === "boolean") setShortcutsCollapsed(saved.shortcuts);
    } catch {
      // Corrupt or unavailable storage — fall back to the cookie state.
    }
  }, []);

  // Persist collapse state to the cookie so the server renders the exact
  // open/closed layout on the next load (no post-hydration flash).
  useEffect(() => {
    writeCollapseCookie({
      roots: collapsedRoots,
      folders: collapsedFolders,
      dirs: collapsedDirs,
      dirDefaultClosed,
      shortcuts: shortcutsCollapsed,
    });
  }, [collapsedRoots, collapsedFolders, collapsedDirs, dirDefaultClosed, shortcutsCollapsed]);

  const toggleFolder = useCallback((folderId: string) => {
    setCollapsedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  }, []);

  // `collapse` is the target state, computed by the caller from the current
  // effective state (explicit entry or the root's default).
  const toggleDir = useCallback((dirPath: string, collapse: boolean) => {
    setCollapsedDirs((prev) => ({ ...prev, [dirPath]: collapse }));
  }, []);

  const openContextMenu = useCallback<TreeContextMenuOpener>((x, y, path, nodeType) => {
    setFolderContextMenu(null);
    setContextMenu({ x, y, path, source: "root", nodeType });
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

  // Workspace scoping (VS Code-style): show a single root's tree, or all.
  // The server resolves `?ws=` URL param > `workspace` cookie and renders the
  // scoped sidebar on first paint; this state just tracks later switches.
  // The value is a root path or label; unknown values fall back to "all".
  const [workspace, setWorkspace] = useState<string | null>(initialWorkspace);

  // One-time migration from the old localStorage persistence to the cookie.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once; initialWorkspace never changes after mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(WORKSPACE_STORAGE_KEY);
      if (!saved) return;
      localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      if (!initialWorkspace) {
        setWorkspace(saved);
        writeWorkspaceCookie(saved);
      }
    } catch {
      // Storage unavailable — the cookie is the source of truth anyway.
    }
  }, []);

  const selectWorkspace = useCallback((rootPath: string | null) => {
    setWorkspace(rootPath);
    writeWorkspaceCookie(rootPath);
    // Keep the URL shareable/bookmarkable without triggering a navigation.
    const url = new URL(window.location.href);
    if (rootPath) url.searchParams.set("ws", rootPath);
    else url.searchParams.delete("ws");
    window.history.replaceState(null, "", url);
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

  const reloadTree = useCallback(async (rootPath: string) => {
    try {
      const r = await fetch(`/api/tree?root=${encodeURIComponent(rootPath)}`);
      const data = await r.json();
      if (r.ok && data.tree) {
        setTrees((prev) => ({ ...prev, [rootPath]: data.tree }));
        setTreeTruncated((prev) => ({ ...prev, [rootPath]: Boolean(data.truncated) }));
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

  // `ws` matches a root by path or label; no match → show all roots.
  const activeRoot = useMemo(
    () =>
      workspace ? (roots.find((r) => r.path === workspace || r.label === workspace) ?? null) : null,
    [roots, workspace],
  );
  const visibleRoots = useMemo(() => (activeRoot ? [activeRoot] : roots), [activeRoot, roots]);

  // On the first run, roots covered by the server-rendered initial data are
  // skipped — refetching them immediately after hydration would be redundant.
  const firstTreeLoad = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey is the parent's explicit "reload now" trigger; initialTrees/initialRootErrors are stable server props
  useEffect(() => {
    const skipPrefetched = firstTreeLoad.current;
    firstTreeLoad.current = false;
    for (const root of visibleRoots) {
      if (skipPrefetched && (root.path in initialTrees || root.path in initialRootErrors)) continue;
      reloadTree(root.path);
    }
  }, [visibleRoots, reloadTree, refreshKey]);

  // Live tree updates via SSE: refresh affected root when external add/unlink happens
  useEffect(() => {
    if (visibleRoots.length === 0) return;
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
      if (data.root) {
        // Only refresh roots currently shown; hidden ones reload on switch.
        if (visibleRoots.some((r) => r.path === data.root)) pending.add(data.root);
      } else {
        for (const r of visibleRoots) pending.add(r.path);
      }
      if (!timer) timer = setTimeout(flush, 200);
      // Also refresh shortcuts in case a shortcut target was moved/deleted
      // within a watched root.
      fetchShortcuts();
    };
    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [visibleRoots, reloadTree, fetchShortcuts]);

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
      const nextRoots: AllowedRoot[] = data.roots ?? [];
      // Freshly registered roots start with every folder collapsed; dirs the
      // user opens afterwards are stored as explicit exceptions, so the
      // choice survives reloads.
      const added = nextRoots.filter((r) => !roots.some((p) => p.path === r.path));
      if (added.length > 0) {
        setDirDefaultClosed((prev) => [
          ...prev,
          ...added.map((r) => r.path).filter((p) => !prev.includes(p)),
        ]);
        // If the sidebar is scoped to a workspace, the new root would be
        // invisible — scope to it so the add has a visible result.
        if (activeRoot) selectWorkspace(added[0].path);
      }
      setRoots(nextRoots);
      setShowAddForm(false);
      return null;
    },
    [roots, activeRoot, selectWorkspace],
  );

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

  const handleRemoveShortcut = useCallback(
    async (shortcutPath: string) => {
      const ok = await confirmDialog({
        title: "ショートカットを削除",
        description: "ディスク上のファイルは削除されません。",
        confirmLabel: "削除",
        destructive: true,
      });
      if (!ok) return;
      const res = await fetch(`/api/shortcuts?path=${encodeURIComponent(shortcutPath)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "削除に失敗しました");
        return;
      }
      setShortcutTree(data.shortcuts ?? []);
      // If the removed shortcut is what the main content is showing, clear it.
      if (selectedPath === shortcutPath) onSelect(null);
    },
    [selectedPath, onSelect],
  );

  const handleRemoveFolder = useCallback(
    async (folderId: string, folderName: string, hasChildren: boolean) => {
      const ok = await confirmDialog({
        title: `フォルダ「${folderName}」を削除`,
        description: hasChildren
          ? "中のショートカットもすべて削除されます。ディスク上のファイルは削除されません。"
          : undefined,
        confirmLabel: "削除",
        destructive: true,
      });
      if (!ok) return;
      // Capture the folder's file paths before it's gone from the tree.
      const removedFolder = findFolderById(shortcutTree, folderId);
      const removedPaths = removedFolder ? collectFilePaths(removedFolder.children) : [];
      const res = await fetch(`/api/shortcuts?folderId=${encodeURIComponent(folderId)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "削除に失敗しました");
        return;
      }
      setShortcutTree(data.shortcuts ?? []);
      // If the main content shows a file inside the removed folder, clear it.
      if (selectedPath && removedPaths.includes(selectedPath)) onSelect(null);
    },
    [shortcutTree, selectedPath, onSelect],
  );

  const openAddForm = useCallback((parentId: string | null, kind: "file" | "folder") => {
    setShortcutsCollapsed(false);
    if (parentId !== null) {
      setCollapsedFolders((prev) => (prev[parentId] ? { ...prev, [parentId]: false } : prev));
    }
    setAddFormFor({ parentId, kind });
  }, []);

  // The draft row is rendered among the directory's children, so the directory
  // has to be open for it to be visible.
  const startNewNode = useCallback((dirPath: string, kind: NewNodeKind) => {
    setCollapsedDirs((prev) => (prev[dirPath] === false ? prev : { ...prev, [dirPath]: false }));
    setNewNodeDraft({ dir: dirPath, kind });
  }, []);

  const cancelNewNode = useCallback(() => setNewNodeDraft(null), []);

  const submitNewNode = useCallback(
    async (dirPath: string, kind: NewNodeKind, rawName: string): Promise<string | null> => {
      const isFile = kind === "file";
      const name = rawName.trim();
      if (!name) return isFile ? "ファイル名を入力してください" : "フォルダ名を入力してください";
      if (name.includes("/") || name.includes("\\") || name.includes(".."))
        return "名前に / \\ .. は使えません";
      // The create API only writes the baked HTML template; a .md name would
      // otherwise silently become "notes.md.html".
      if (isFile && /\.(md|markdown)$/i.test(name)) return "新規作成できるのは HTML のみです";
      try {
        const res = await fetch(isFile ? "/api/file" : "/api/dir", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ dir: dirPath, name }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 409)
            return isFile
              ? "同じ名前のファイルがすでにあります"
              : "同じ名前のフォルダがすでにあります";
          return data.error ?? `HTTP ${res.status}`;
        }
        // Only close the row this call belongs to: a blur-commit can land
        // after the click that opened a draft somewhere else, and that one
        // must survive.
        setNewNodeDraft((prev) =>
          prev && prev.dir === dirPath && prev.kind === kind ? null : prev,
        );
        const rootPath = enclosingRootPath(roots, dirPath);
        if (rootPath) await reloadTree(rootPath);
        // A new file opens in the editor; a new folder can't, so it is just
        // expanded (ready for the next thing put in it) and scrolled to.
        if (isFile) onSelect(data.path);
        else setCollapsedDirs((prev) => ({ ...prev, [data.path]: false }));
        setReveal({ path: data.path });
        return null;
      } catch (e) {
        return String(e);
      }
    },
    [roots, reloadTree, onSelect],
  );

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const startTreeRename = useCallback((path: string) => {
    setContextMenu(null);
    setNewNodeDraft(null);
    setRenamingPath(path);
  }, []);
  const cancelTreeRename = useCallback(() => setRenamingPath(null), []);

  const submitTreeRename = useCallback(
    async (targetPath: string, kind: NewNodeKind, rawName: string): Promise<string | null> => {
      const name = rawName.trim();
      const currentName = targetPath.split("/").pop() ?? "";
      if (!name) return "名前を入力してください";
      if (name.includes("/") || name.includes("\\") || name.includes(".."))
        return "名前に / \\ .. は使えません";
      if (name === currentName) {
        setRenamingPath(null);
        return null;
      }
      try {
        const res = await fetch(kind === "file" ? "/api/file" : "/api/dir", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: targetPath, name }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 409) return "同じ名前のファイル／フォルダがすでにあります";
          return data.error ?? `HTTP ${res.status}`;
        }
        setRenamingPath((prev) => (prev === targetPath ? null : prev));
        const rootPath = enclosingRootPath(roots, targetPath);
        if (rootPath) await reloadTree(rootPath);
        // Carry over what the sidebar tracked by path: the open file (kept as
        // an unsaved buffer if it was dirty) and this row's collapse state.
        onRenamed?.(targetPath, data.path);
        if (kind === "folder") {
          setCollapsedDirs((prev) => {
            if (!(targetPath in prev)) return prev;
            const { [targetPath]: was, ...rest } = prev;
            return { ...rest, [data.path]: was };
          });
        }
        // Shortcuts pointing at the renamed path are repathed server-side.
        await fetchShortcuts();
        setReveal({ path: data.path });
        return null;
      } catch (e) {
        return String(e);
      }
    },
    [roots, reloadTree, fetchShortcuts, onRenamed],
  );

  // Search runs over what is already loaded — the fetched trees plus the
  // shortcut list — so a lookup never hits the disk or the network.
  const searchIndex = useMemo(() => buildSearchIndex(trees, shortcutTree), [trees, shortcutTree]);

  // Marks are paths; drop the ones that stopped existing (moved, renamed or
  // deleted elsewhere) so a later drag can't act on them.
  useEffect(() => {
    setMarked((prev) => {
      if (prev.length === 0) return prev;
      const alive = new Set(searchIndex.map((entry) => entry.path));
      const next = prev.filter((p) => alive.has(p));
      return next.length === prev.length ? prev : next;
    });
  }, [searchIndex]);

  const [treeDragging, setTreeDragging] = useState<TreeDragSource[]>([]);
  const [treeDragOverDir, setTreeDragOverDir] = useState<string | null>(null);
  // Rows marked with Ctrl/Cmd- or Shift-click, for dragging several at once.
  const [marked, setMarked] = useState<string[]>([]);
  const markAnchorRef = useRef<string | null>(null);

  const moveTreeNodes = useCallback(
    async (sources: TreeDragSource[], targetDir: string) => {
      if (sources.length === 0) return;
      try {
        const res = await fetch("/api/move", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paths: sources.map((s) => s.path), targetDir }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? `HTTP ${res.status}`);
          return;
        }
        const moved: { from: string; to: string }[] = data.results ?? [];
        const errors: { path: string; error: string; status: number }[] = data.errors ?? [];
        // Source and destination can sit under different roots (the ALL view
        // shows several), so every affected tree is refreshed.
        const affected = [
          ...moved.map((m) => enclosingRootPath(roots, m.from)),
          enclosingRootPath(roots, targetDir),
        ].filter((r, i, all): r is string => r !== null && all.indexOf(r) === i);
        await Promise.all(affected.map((r) => reloadTree(r)));
        setCollapsedDirs((prev) => ({ ...prev, [targetDir]: false }));
        for (const m of moved) onRenamed?.(m.from, m.to);
        setMarked([]);
        await fetchShortcuts();
        if (moved.length > 0) setReveal({ path: moved[moved.length - 1].to });
        for (const err of errors) {
          const name = err.path.split("/").pop();
          toast.error(
            err.status === 409
              ? `「${name}」は移動先に同じ名前があります`
              : `「${name}」: ${err.error}`,
          );
        }
      } catch (e) {
        toast.error(String(e));
      }
    },
    [roots, reloadTree, fetchShortcuts, onRenamed],
  );

  // Pending hover-expand: at most one folder is ever scheduled, and it is
  // dropped as soon as the pointer moves on or the drag ends.
  const hoverExpandRef = useRef<{ dir: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const cancelHoverExpand = useCallback(() => {
    if (hoverExpandRef.current) clearTimeout(hoverExpandRef.current.timer);
    hoverExpandRef.current = null;
  }, []);
  useEffect(() => cancelHoverExpand, [cancelHoverExpand]);

  const onHoverFolder = useCallback(
    (dirPath: string, isOpen: boolean) => {
      if (hoverExpandRef.current?.dir === dirPath) return;
      cancelHoverExpand();
      if (isOpen) return;
      const timer = setTimeout(() => {
        hoverExpandRef.current = null;
        setCollapsedDirs((prev) => ({ ...prev, [dirPath]: false }));
      }, HOVER_EXPAND_MS);
      hoverExpandRef.current = { dir: dirPath, timer };
    },
    [cancelHoverExpand],
  );

  // Copies files dropped from the OS into a tree directory.
  const importFiles = useCallback(
    async (files: File[], targetDir: string, hadDirectory: boolean) => {
      if (hadDirectory) toast.error("フォルダの取り込みには未対応です");
      if (files.length === 0) return;
      const form = new FormData();
      form.append("targetDir", targetDir);
      for (const file of files) form.append("files", file);
      try {
        const res = await fetch("/api/import", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? `HTTP ${res.status}`);
          return;
        }
        const imported: string[] = data.imported ?? [];
        const errors: { name: string; error: string }[] = data.errors ?? [];
        const rootPath = enclosingRootPath(roots, targetDir);
        if (rootPath) await reloadTree(rootPath);
        if (imported.length > 0) {
          setCollapsedDirs((prev) => ({ ...prev, [targetDir]: false }));
          setReveal({ path: imported[imported.length - 1] });
          toast.success(`${imported.length} 件を取り込みました`);
        }
        for (const err of errors) toast.error(`「${err.name}」: ${importErrorText(err.error)}`);
      } catch (e) {
        toast.error(String(e));
      }
    },
    [roots, reloadTree],
  );

  const acceptTreeDrag = (e: React.DragEvent, targetDir: string) => {
    const isTreeMove = e.dataTransfer.types.includes(TREE_DRAG_MIME);
    // Files dragged in from the OS land as a copy into the hovered directory.
    const isExternal = !isTreeMove && e.dataTransfer.types.includes("Files");
    if (!isTreeMove && !isExternal) return;
    if (isTreeMove && movableInto(treeDragging, targetDir).length === 0) {
      e.dataTransfer.dropEffect = "none";
      return;
    }
    // preventDefault is what marks the element as a drop target.
    e.preventDefault();
    e.dataTransfer.dropEffect = isTreeMove ? "move" : "copy";
    if (treeDragOverDir !== targetDir) setTreeDragOverDir(targetDir);
  };

  const treeDnd: TreeDnD = {
    dragging: treeDragging,
    overDir: treeDragOverDir,
    onDragStart: (e, source) => {
      // Grabbing a marked row drags the whole marked set; grabbing anything
      // else drags just it, and drops the marks (as VS Code does).
      let items: TreeDragSource[];
      if (marked.includes(source.path) && marked.length > 1) {
        const byPath = new Map(searchIndex.map((entry) => [entry.path, entry.type]));
        items = dropNested(
          marked.map((p) => ({ path: p, type: byPath.get(p) ?? "file" }) as TreeDragSource),
        );
      } else {
        items = [source];
        if (marked.length > 0) setMarked([]);
      }
      e.dataTransfer.setData(TREE_DRAG_MIME, JSON.stringify(items));
      e.dataTransfer.effectAllowed = "move";
      setTreeDragging(items);
    },
    onDragEnd: () => {
      cancelHoverExpand();
      setTreeDragging([]);
      setTreeDragOverDir(null);
    },
    onHoverFolder,
    onDragEnter: acceptTreeDrag,
    onDragOver: acceptTreeDrag,
    onDragLeave: (targetDir) => {
      if (hoverExpandRef.current?.dir === targetDir) cancelHoverExpand();
      setTreeDragOverDir((prev) => (prev === targetDir ? null : prev));
    },
    onDrop: (e, targetDir) => {
      const isTreeMove = e.dataTransfer.types.includes(TREE_DRAG_MIME);
      const isExternal = !isTreeMove && e.dataTransfer.types.includes("Files");
      if (!isTreeMove && !isExternal) return;
      e.preventDefault();
      e.stopPropagation();
      cancelHoverExpand();
      setTreeDragOverDir(null);
      setTreeDragging([]);

      if (isExternal) {
        // dataTransfer is emptied once this handler returns, so everything is
        // read out synchronously before the upload starts.
        const files = Array.from(e.dataTransfer.files ?? []);
        const hadDirectory = Array.from(e.dataTransfer.items ?? []).some(
          (item) => item.webkitGetAsEntry?.()?.isDirectory === true,
        );
        importFiles(
          files.filter((f) => !hadDirectory || f.size > 0),
          targetDir,
          hadDirectory,
        );
        return;
      }

      const json = e.dataTransfer.getData(TREE_DRAG_MIME);
      if (!json) return;
      let sources: TreeDragSource[];
      try {
        sources = JSON.parse(json) as TreeDragSource[];
      } catch {
        return;
      }
      moveTreeNodes(movableInto(sources, targetDir), targetDir);
    },
  };

  // Rows in screen order, for Shift-click ranges.
  const visibleRowPaths = useMemo(() => {
    const out: string[] = [];
    for (const root of visibleRoots) {
      flattenVisibleRows(
        trees[root.path] ?? [],
        collapsedDirs,
        dirDefaultClosed.includes(root.path),
        out,
      );
    }
    return out;
  }, [visibleRoots, trees, collapsedDirs, dirDefaultClosed]);

  const onRowClick = useCallback(
    (e: React.MouseEvent, entry: TreeDragSource): boolean => {
      if (e.metaKey || e.ctrlKey) {
        setMarked((prev) =>
          prev.includes(entry.path) ? prev.filter((p) => p !== entry.path) : [...prev, entry.path],
        );
        markAnchorRef.current = entry.path;
        return true;
      }
      if (e.shiftKey) {
        const anchor = markAnchorRef.current ?? selectedPath;
        const from = anchor ? visibleRowPaths.indexOf(anchor) : -1;
        const to = visibleRowPaths.indexOf(entry.path);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from <= to ? [from, to] : [to, from];
          setMarked(visibleRowPaths.slice(lo, hi + 1));
        } else {
          setMarked([entry.path]);
          markAnchorRef.current = entry.path;
        }
        return true;
      }
      // A plain click is the normal action; it also clears any marks.
      setMarked((prev) => (prev.length > 0 ? [] : prev));
      markAnchorRef.current = entry.path;
      return false;
    },
    [selectedPath, visibleRowPaths],
  );

  const treeMarks: TreeMarksAPI = { paths: marked, onRowClick };

  // Deleting is gated on the AlertDialog: nothing is touched until it is
  // confirmed, and what it does is move the entry to the Trash.
  // What the "ゴミ箱に移動" menu item acts on: the whole marked set when the
  // right-clicked row belongs to it, otherwise just that row. Nested entries
  // are dropped — trashing a folder takes its children with it.
  const trashTargetsFor = useCallback(
    (rowPath: string, rowType: "file" | "directory"): TreeDragSource[] => {
      if (!marked.includes(rowPath) || marked.length < 2) {
        return [{ path: rowPath, type: rowType }];
      }
      const byPath = new Map(searchIndex.map((entry) => [entry.path, entry.type]));
      return dropNested(
        marked.map((p) => ({ path: p, type: byPath.get(p) ?? "file" }) as TreeDragSource),
      );
    },
    [marked, searchIndex],
  );

  const trashTreeNodes = useCallback(
    async (rowPath: string, rowType: "file" | "directory") => {
      setContextMenu(null);
      const targets = trashTargetsFor(rowPath, rowType);
      const name = rowPath.split("/").pop() ?? rowPath;
      const many = targets.length > 1;
      const hasFolder = targets.some((t) => t.type === "directory");
      const ok = await confirmDialog({
        title: many ? `${targets.length} 件をゴミ箱に移動` : `「${name}」をゴミ箱に移動`,
        description: `${hasFolder ? "フォルダは中のファイルもまとめて移動します。" : ""}ゴミ箱を空にするまで Finder から取り出せます。`,
        confirmLabel: "ゴミ箱に移動",
        destructive: true,
      });
      if (!ok) return;
      try {
        const res = await fetch("/api/trash", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paths: targets.map((t) => t.path) }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? `HTTP ${res.status}`);
          return;
        }
        const trashed: { path: string }[] = data.results ?? [];
        const errors: { path: string; error: string; code?: string }[] = data.errors ?? [];
        const affected = [
          ...trashed.map((t) => enclosingRootPath(roots, t.path)),
          enclosingRootPath(roots, rowPath),
        ].filter((r, i, all): r is string => r !== null && all.indexOf(r) === i);
        await Promise.all(affected.map((r) => reloadTree(r)));
        await fetchShortcuts();
        setMarked([]);
        // The editor can't stay on something that is gone.
        if (
          selectedPath &&
          trashed.some((t) => selectedPath === t.path || selectedPath.startsWith(`${t.path}/`))
        ) {
          onSelect(null);
        }
        if (trashed.length > 0) {
          toast.success(
            trashed.length > 1
              ? `${trashed.length} 件をゴミ箱に移動しました`
              : `「${trashed[0].path.split("/").pop()}」をゴミ箱に移動しました`,
          );
        }
        for (const err of errors) {
          const failed = err.path.split("/").pop();
          toast.error(
            err.code === "cross-volume"
              ? `「${failed}」は別ボリューム上のため、ゴミ箱に入れられません（Finder から削除してください）`
              : err.code === "no-trash"
                ? "この環境にはゴミ箱がありません"
                : `「${failed}」: ${err.error}`,
          );
        }
      } catch (e) {
        toast.error(String(e));
      }
    },
    [roots, reloadTree, fetchShortcuts, selectedPath, onSelect, trashTargetsFor],
  );

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

  const handleRemoveRoot = useCallback(
    async (rootPath: string, label: string) => {
      const ok = await confirmDialog({
        title: `「${label}」を一覧から削除`,
        description: "ディスク上のファイルは削除されません。",
        confirmLabel: "削除",
        destructive: true,
      });
      if (!ok) return;
      const res = await fetch(`/api/roots?path=${encodeURIComponent(rootPath)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      // 404 means the root is already gone — the config was edited elsewhere
      // while this page held an older copy of the list. The user asked for the
      // row to go away, and it has; re-read the list so it disappears instead
      // of erroring on every click.
      if (res.status === 404) {
        const fresh = await fetch("/api/roots")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (!fresh?.roots) {
          toast.error(data.error ?? "削除に失敗しました");
          return;
        }
        setRoots(fresh.roots);
      } else if (!res.ok) {
        toast.error(data.error ?? "削除に失敗しました");
        return;
      } else {
        setRoots(data.roots ?? []);
      }
      setTrees((prev) => {
        const { [rootPath]: _, ...rest } = prev;
        return rest;
      });
      setRootErrors((prev) => {
        const { [rootPath]: _, ...rest } = prev;
        return rest;
      });
      // Drop the removed root's collapse bookkeeping so stale paths don't
      // accumulate in the cookie.
      setDirDefaultClosed((prev) => prev.filter((p) => p !== rootPath));
      setCollapsedDirs((prev) => {
        const next: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (k !== rootPath && !k.startsWith(`${rootPath}/`)) next[k] = v;
        }
        return next;
      });
      setCollapsedRoots((prev) => {
        if (!(rootPath in prev)) return prev;
        const { [rootPath]: _, ...rest } = prev;
        return rest;
      });
      // If the main content shows a file under the removed root, clear it.
      if (selectedPath && (selectedPath === rootPath || selectedPath.startsWith(`${rootPath}/`)))
        onSelect(null);
      // If the removed root was the active workspace, fall back to all roots.
      if (activeRoot?.path === rootPath) selectWorkspace(null);
    },
    [selectedPath, onSelect, activeRoot, selectWorkspace],
  );

  const openSearchHit = useCallback(
    (hit: SearchHit) => {
      if (hit.rootPath) {
        // A hit outside the active workspace would have nowhere to appear.
        if (activeRoot && activeRoot.path !== hit.rootPath) selectWorkspace(hit.rootPath);
        const ancestors = ancestorDirPaths(hit.rootPath, hit.path);
        if (ancestors.length > 0 || hit.type === "directory") {
          setCollapsedDirs((prev) => {
            const next = { ...prev };
            for (const dir of ancestors) next[dir] = false;
            if (hit.type === "directory") next[hit.path] = false;
            return next;
          });
        }
      }
      const folderChain = shortcutFolderChain(shortcutTree, hit.path);
      if (folderChain) {
        setShortcutsCollapsed(false);
        if (folderChain.length > 0) {
          setCollapsedFolders((prev) => {
            const next = { ...prev };
            for (const id of folderChain) next[id] = false;
            return next;
          });
        }
      }
      if (hit.type === "file") onSelect(hit.path);
      setReveal({ path: hit.path });
    },
    [activeRoot, selectWorkspace, onSelect, shortcutTree],
  );

  // Scroll the revealed row into view once it exists. Expanding folders or
  // switching workspace can render it a tick (or a fetch) later, so this
  // re-runs on the state that governs which rows are mounted and gives up
  // silently until then.
  const revealedRef = useRef<object | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the extra deps are the retry trigger — they decide which rows are mounted
  useEffect(() => {
    if (!reveal || revealedRef.current === reveal) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-reveal-path="${CSS.escape(reveal.path)}"]`,
    );
    if (!el) return;
    revealedRef.current = reveal;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("is-revealed");
    // Deliberately not cancelled on cleanup: this effect re-runs whenever the
    // tree changes, and a cleared timer would leave the class behind forever.
    setTimeout(() => el.classList.remove("is-revealed"), 1400);
  }, [reveal, trees, collapsedDirs, collapsedFolders, shortcutsCollapsed, shortcutTree]);

  if (error) return <div className="p-5 text-sm text-[var(--danger)]">{error}</div>;

  const isEmpty = roots.length === 0;

  return (
    <div className="text-sm h-full flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isEmpty && !showAddForm && <EmptyState onAdd={() => setShowAddForm(true)} />}

        {!isEmpty && (
          <div
            className={`px-3 pt-3 pb-1 group/shortcuts relative transition-colors ${
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
          <WorkspaceSwitcher
            roots={roots}
            activeRoot={activeRoot}
            onSelect={selectWorkspace}
            onAddRoot={() => setShowAddForm(true)}
            onRemoveRoot={handleRemoveRoot}
          />
        )}

        {showAddForm && (
          <div className={isEmpty ? "px-5 pt-6" : "px-3 pt-2"}>
            <AddRootForm onCancel={() => setShowAddForm(false)} onSubmit={handleAddRoot} />
          </div>
        )}

        {/* While a tree drag is in progress the empty space below the tree
            grows into a drop zone for the workspace root, so an entry can be
            moved back to the top level without aiming at a row. Only when a
            single root is visible — with several, "the root" is ambiguous. */}
        <div
          className={`px-3 pt-2 pb-6 ${treeDragging.length > 0 && visibleRoots.length === 1 ? "min-h-[200px]" : ""}`}
          onDragEnter={(e) => {
            if (visibleRoots.length !== 1) return;
            treeDnd.onDragEnter(e, visibleRoots[0].path);
          }}
          onDragOver={(e) => {
            if (visibleRoots.length !== 1) return;
            treeDnd.onDragOver(e, visibleRoots[0].path);
          }}
          onDragLeave={() => {
            if (visibleRoots.length === 1) treeDnd.onDragLeave(visibleRoots[0].path);
          }}
          onDrop={(e) => {
            if (visibleRoots.length !== 1) return;
            treeDnd.onDrop(e, visibleRoots[0].path);
          }}
        >
          {visibleRoots.map((root) => {
            return (
              // The area around a root's tree is a drop target for the root
              // directory itself, so an entry can be moved back to the top
              // level. Rows stop propagation, so only the empty space here
              // (and the padding around the rows) reaches this handler.
              <div
                key={root.path}
                className={`mb-5 rounded-md transition-colors ${
                  treeDnd.overDir === root.path
                    ? "bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]"
                    : ""
                }`}
                onDragEnter={(e) => treeDnd.onDragEnter(e, root.path)}
                onDragOver={(e) => treeDnd.onDragOver(e, root.path)}
                onDragLeave={() => treeDnd.onDragLeave(root.path)}
                onDrop={(e) => treeDnd.onDrop(e, root.path)}
              >
                {rootErrors[root.path] ? (
                  <div className="mx-2 px-3 py-2.5 text-[11.5px] text-[var(--danger)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] rounded-md">
                    <div className="font-medium mb-0.5">{rootErrors[root.path]}</div>
                    <div className="text-[var(--text-muted)] break-all font-mono text-[10.5px]">
                      {root.path}
                    </div>
                  </div>
                ) : trees[root.path] === undefined ? (
                  <TreeSkeleton />
                ) : (
                  <>
                    <TreeView
                      entries={trees[root.path] ?? []}
                      selectedPath={selectedPath}
                      onSelect={onSelect}
                      onContextMenu={openContextMenu}
                      // Root header rows are gone (the workspace switcher
                      // replaces them), so entries start at the base level.
                      depth={0}
                      collapsedDirs={collapsedDirs}
                      onToggleDir={toggleDir}
                      dirsDefaultCollapsed={dirDefaultClosed.includes(root.path)}
                      newNode={{
                        draft: newNodeDraft,
                        onStart: startNewNode,
                        onSubmit: submitNewNode,
                        onCancel: cancelNewNode,
                      }}
                      rename={{
                        path: renamingPath,
                        onSubmit: submitTreeRename,
                        onCancel: cancelTreeRename,
                      }}
                      dnd={treeDnd}
                      marks={treeMarks}
                    />
                    {treeTruncated[root.path] && (
                      <div className="mx-2 mt-1 px-3 py-2 text-[10.5px] text-[color-mix(in_srgb,var(--warning)_55%,var(--text-subtle))] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] rounded-md">
                        項目数が多いため、深い階層の一部は表示されていません
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* `relative` so the search popup can span the sidebar rather than the
          narrow flex cell the input occupies. */}
      <div className="relative border-t border-[var(--border-subtle)] px-3 py-2 flex items-center gap-1">
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
        <SidebarSearch index={searchIndex} onPick={openSearchHit} />
      </div>
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          path={contextMenu.path}
          source={contextMenu.source}
          alias={contextMenu.alias}
          nodeType={contextMenu.nodeType}
          onClose={closeContextMenu}
          onStartRename={startRenameAlias}
          onStartTreeRename={startTreeRename}
          onTrash={trashTreeNodes}
          trashCount={
            contextMenu.nodeType
              ? trashTargetsFor(contextMenu.path, contextMenu.nodeType).length
              : 1
          }
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

// Borderless name lookup in the sidebar footer. Enter opens the best match;
// when the query is ambiguous the candidates float above the input.
function SidebarSearch({
  index,
  onPick,
}: {
  index: SearchEntry[];
  onPick: (hit: SearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchEntries(index, query), [index, query]);
  // A single match needs no list — Enter just opens it.
  const showList = listOpen && results.length > 1;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the highlight resets whenever the query changes
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!showList) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setListOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showList]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` is what moves the highlight, so it must re-run the scroll
  useEffect(() => {
    if (!showList) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [showList, active]);

  const pick = (hit: SearchHit) => {
    setListOpen(false);
    onPick(hit);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter/Escape belong to the IME while it converts (see TreeNameInput):
    // confirming a Japanese candidate must not open the highlighted hit.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (results.length === 0) {
        if (query.trim()) toast.error("一致するファイル・フォルダがありません");
        return;
      }
      pick(results[Math.min(active, results.length - 1)]);
      return;
    }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && results.length > 1) {
      e.preventDefault();
      setListOpen(true);
      setActive((i) =>
        e.key === "ArrowDown" ? Math.min(i + 1, results.length - 1) : Math.max(i - 1, 0),
      );
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (showList) setListOpen(false);
      else setQuery("");
    }
  };

  return (
    // Not `relative`: the popup below is positioned against the footer bar so
    // it can use the full sidebar width.
    <div ref={rootRef} className="flex-1 min-w-0">
      {showList && (
        <div
          ref={listRef}
          id="sidebar-search-results"
          // biome-ignore lint/a11y/useSemanticElements: combobox popup; the options are buttons so they stay clickable
          role="listbox"
          tabIndex={-1}
          aria-label="検索候補"
          className="absolute bottom-full left-3 right-3 mb-1 py-1 rounded-md fade-in z-40 overflow-y-auto"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)",
            maxHeight: "min(50vh, 320px)",
          }}
        >
          {results.map((hit, i) => (
            <SearchResultRow
              key={hit.path}
              hit={hit}
              active={i === active}
              onHover={() => setActive(i)}
              onPick={() => pick(hit)}
            />
          ))}
          {results.length === MAX_SEARCH_RESULTS && (
            <div className="px-3 pt-1 pb-0.5 text-[10px] text-[var(--text-subtle)]">
              上位 {MAX_SEARCH_RESULTS} 件
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-1.5 pl-1.5">
        <span className="text-[var(--text-subtle)] flex-shrink-0" aria-hidden="true">
          <SearchIcon />
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setListOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setListOpen(true)}
          placeholder="ファイル名で検索"
          // Focus target for the shell's ⌘P shortcut.
          data-sidebar-search
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls="sidebar-search-results"
          aria-autocomplete="list"
          aria-label="ファイル名・フォルダ名で検索"
          className="w-full min-w-0 bg-transparent border-0 outline-none py-1 text-[12px] text-[var(--text)] placeholder:text-[var(--text-subtle)]"
        />
      </div>
    </div>
  );
}

function SearchResultRow({
  hit,
  active,
  onHover,
  onPick,
}: {
  hit: SearchHit;
  active: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const dir = hit.path.slice(0, Math.max(0, hit.path.length - hit.name.length - 1));
  const isMd = /\.(md|markdown)$/i.test(hit.name);
  return (
    <button
      type="button"
      // biome-ignore lint/a11y/useSemanticElements: option inside the search combobox popup
      role="option"
      aria-selected={active}
      data-active={active}
      // mousedown, not click: the input must not lose focus before the pick.
      onMouseDown={(e) => {
        e.preventDefault();
        onPick();
      }}
      onMouseMove={onHover}
      title={hit.path}
      className={`w-full flex items-center gap-2 px-2.5 py-1 text-left transition-colors ${
        active ? "bg-[var(--surface-2)]" : ""
      }`}
    >
      <span
        className={`file-icon flex-shrink-0 ${
          hit.type === "directory" ? "" : isMd ? "file-icon-md" : "file-icon-html"
        }`}
        aria-hidden="true"
      >
        {hit.type === "directory" ? <FolderIcon open={false} /> : isMd ? <MdIcon /> : <HtmlIcon />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] text-[var(--text)]">
          {hit.alias ?? hit.name}
        </span>
        <span className="block truncate text-[10px] text-[var(--text-subtle)] font-mono">
          {shortenLeft(dir)}
        </span>
      </span>
    </button>
  );
}

// Directories are distinguished by their tail, so trim from the left.
function shortenLeft(value: string, max = 38): string {
  return value.length <= max ? value : `…${value.slice(value.length - max)}`;
}

function SearchIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7.2" cy="7.2" r="4.4" />
      <path d="M10.5 10.5L13.6 13.6" />
    </svg>
  );
}

function WorkspaceSwitcher({
  roots,
  activeRoot,
  onSelect,
  onAddRoot,
  onRemoveRoot,
}: {
  roots: AllowedRoot[];
  activeRoot: AllowedRoot | null;
  onSelect: (rootPath: string | null) => void;
  onAddRoot: () => void;
  onRemoveRoot: (rootPath: string, label: string) => void;
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

  const pick = (rootPath: string | null) => {
    onSelect(rootPath);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative px-3 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-[var(--surface-2)] hover:bg-[color-mix(in_srgb,var(--text)_6%,var(--surface-2))] transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        title="ワークスペースを切り替え"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="text-[var(--text-subtle)] flex-shrink-0" aria-hidden="true">
            <FolderIcon open={false} />
          </span>
          <span className="text-[12px] font-medium text-[var(--text)] truncate">
            {activeRoot ? activeRoot.label : "ALL"}
          </span>
        </span>
        <span className="text-[var(--text-subtle)] flex-shrink-0" aria-hidden="true">
          <UpDownIcon />
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-3 right-3 top-full mt-1 py-1.5 rounded-md fade-in z-40 overflow-y-auto"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)",
            maxHeight: "min(60vh, 480px)",
          }}
        >
          <WorkspaceMenuItem selected={activeRoot === null} onClick={() => pick(null)}>
            ALL
          </WorkspaceMenuItem>
          {roots.map((r) => (
            <WorkspaceMenuItem
              key={r.path}
              selected={activeRoot?.path === r.path}
              onClick={() => pick(r.path)}
              title={r.path}
              onRemove={() => {
                setOpen(false);
                onRemoveRoot(r.path, r.label);
              }}
            >
              {r.label}
            </WorkspaceMenuItem>
          ))}
          <div className="my-1 border-t border-[var(--border-subtle)]" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onAddRoot();
            }}
            className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-muted)] hover:bg-[var(--surface-2)] transition-colors"
          >
            + Add
          </button>
        </div>
      )}
    </div>
  );
}

function WorkspaceMenuItem({
  selected,
  onClick,
  title,
  onRemove,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  title?: string;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  // The row is a div (not a button) so the remove control can be a real
  // button without nesting interactive elements.
  return (
    <div className="group/wsitem w-full flex items-center gap-2 pr-2 hover:bg-[var(--surface-2)] transition-colors">
      <button
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        onClick={onClick}
        title={title}
        className="flex-1 min-w-0 flex items-center justify-between gap-3 px-3 py-1.5 text-left text-[12px] text-[var(--text)]"
      >
        <span className="truncate">{children}</span>
        {selected && (
          <span className="text-[var(--primary)] flex-shrink-0" aria-hidden="true">
            <CheckIcon />
          </span>
        )}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="opacity-0 group-hover/wsitem:opacity-100 text-[var(--text-subtle)] hover:text-[var(--danger)] transition-opacity flex-shrink-0"
          title="Remove root from list"
          aria-label="Remove root from list"
        >
          <CloseIcon />
        </button>
      )}
    </div>
  );
}

function UpDownIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 6L8 2.5L11.5 6" />
      <path d="M4.5 10L8 13.5L11.5 10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.8 8.6l3.4 3.4 7-7.6" />
    </svg>
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
        aria-hidden="true"
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
        // biome-ignore lint/a11y/noAutofocus: form appears on user action; focusing its first field is expected
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
      aria-hidden="true"
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
      aria-hidden="true"
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
    <svg viewBox="0 0 10 10" className="tree-dir-chevron-svg" aria-hidden="true">
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

// Placeholder rows shown while a root's tree is being fetched (e.g. right
// after switching to a workspace whose tree isn't cached yet).
function TreeSkeleton() {
  return (
    <div className="animate-pulse" aria-hidden="true">
      {[72, 56, 64].map((w, i) => (
        <div
          key={w}
          className="flex items-center gap-2 py-[5px]"
          style={{ paddingLeft: `${i === 1 ? 26 : 14}px` }}
        >
          <div className="w-[13px] h-[13px] rounded-sm bg-[var(--surface-2)] flex-shrink-0" />
          <div className="h-[9px] rounded bg-[var(--surface-2)]" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  );
}

function TreeView({
  entries,
  selectedPath,
  onSelect,
  onContextMenu,
  depth,
  collapsedDirs,
  onToggleDir,
  dirsDefaultCollapsed,
  newNode,
  rename,
  dnd,
  marks,
}: {
  entries: TreeEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onContextMenu: TreeContextMenuOpener;
  depth: number;
  collapsedDirs: Record<string, boolean>;
  onToggleDir: (path: string, collapse: boolean) => void;
  dirsDefaultCollapsed: boolean;
  newNode: NewNodeAPI;
  rename: TreeRenameAPI;
  dnd: TreeDnD;
  marks: TreeMarksAPI;
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
              collapsedDirs={collapsedDirs}
              onToggleDir={onToggleDir}
              dirsDefaultCollapsed={dirsDefaultCollapsed}
              newNode={newNode}
              rename={rename}
              dnd={dnd}
              marks={marks}
            />
          ) : (
            <FileNode
              entry={entry}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              depth={depth}
              rename={rename}
              dnd={dnd}
              marks={marks}
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
  collapsedDirs,
  onToggleDir,
  dirsDefaultCollapsed,
  newNode,
  rename,
  dnd,
  marks,
}: {
  entry: TreeEntry;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onContextMenu: TreeContextMenuOpener;
  depth: number;
  collapsedDirs: Record<string, boolean>;
  onToggleDir: (path: string, collapse: boolean) => void;
  dirsDefaultCollapsed: boolean;
  newNode: NewNodeAPI;
  rename: TreeRenameAPI;
  dnd: TreeDnD;
  marks: TreeMarksAPI;
}) {
  // Collapse state lives in the shared map (persisted via cookie) so the
  // server can render the exact open/closed layout on first paint. Dirs
  // without an explicit entry follow their root's default.
  const explicit = collapsedDirs[entry.path];
  const open = explicit === undefined ? !dirsDefaultCollapsed : !explicit;
  const draft = newNode.draft?.dir === entry.path ? newNode.draft : null;
  const isDragging = dnd.dragging.some((s) => s.path === entry.path);
  const isDropTarget = dnd.overDir === entry.path;
  const isMarked = marks.paths.includes(entry.path);
  return (
    <div>
      {/* The hover group covers just this row, not the nested children. */}
      <div
        className={`tree-row group/row rounded-md transition-colors ${
          isDropTarget
            ? "bg-[color-mix(in_srgb,var(--primary)_14%,transparent)]"
            : isMarked
              ? "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
              : ""
        } ${isDragging ? "opacity-50" : ""}`}
        data-reveal-path={entry.path}
        // Dropping anywhere on a folder row moves the dragged entry into it.
        onDragEnter={(e) => {
          e.stopPropagation();
          dnd.onDragEnter(e, entry.path);
          dnd.onHoverFolder(entry.path, open);
        }}
        onDragOver={(e) => {
          e.stopPropagation();
          dnd.onDragOver(e, entry.path);
          dnd.onHoverFolder(entry.path, open);
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          dnd.onDragLeave(entry.path);
        }}
        onDrop={(e) => dnd.onDrop(e, entry.path)}
      >
        {rename.path === entry.path ? (
          <TreeNameInput
            kind="folder"
            depth={depth}
            initial={entry.name}
            onSubmit={(name) => rename.onSubmit(entry.path, "folder", name)}
            onCancel={rename.onCancel}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={(e) => {
                if (marks.onRowClick(e, { path: entry.path, type: "directory" })) return;
                onToggleDir(entry.path, open);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu(e.clientX, e.clientY, entry.path, "directory");
              }}
              draggable
              onDragStart={(e) => {
                e.stopPropagation();
                dnd.onDragStart(e, { path: entry.path, type: "directory" });
              }}
              onDragEnd={dnd.onDragEnd}
              className="tree-dir"
              style={{ paddingLeft: `${depth * 12 + 8}px`, paddingRight: "76px" }}
              aria-expanded={open}
            >
              <span className={`tree-dir-chevron ${open ? "is-open" : ""}`}>
                <ChevronIcon />
              </span>
              <span className="truncate">{entry.name}</span>
            </button>
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100">
              <NewNodeButton kind="file" onClick={() => newNode.onStart(entry.path, "file")} />
              <NewNodeButton kind="folder" onClick={() => newNode.onStart(entry.path, "folder")} />
              <CopyPathButton path={entry.path} />
            </div>
          </>
        )}
      </div>
      {open && (
        <>
          {draft && (
            <TreeNameInput
              // Remounting per kind resets the field when switching file↔folder.
              key={draft.kind}
              kind={draft.kind}
              depth={depth + 1}
              onSubmit={(name) => newNode.onSubmit(entry.path, draft.kind, name)}
              onCancel={newNode.onCancel}
            />
          )}
          {entry.children && (
            <TreeView
              entries={entry.children}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              depth={depth + 1}
              collapsedDirs={collapsedDirs}
              onToggleDir={onToggleDir}
              dirsDefaultCollapsed={dirsDefaultCollapsed}
              newNode={newNode}
              rename={rename}
              dnd={dnd}
              marks={marks}
            />
          )}
        </>
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
  rename,
  dnd,
  marks,
}: {
  entry: TreeEntry;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onContextMenu: TreeContextMenuOpener;
  depth: number;
  rename: TreeRenameAPI;
  dnd: TreeDnD;
  marks: TreeMarksAPI;
}) {
  const isSelected = selectedPath === entry.path;
  const ext = entry.name.match(/\.(html?|md|markdown)$/i)?.[1].toLowerCase() ?? "";
  const display = entry.name.replace(/\.(html?|md|markdown)$/i, "");
  const isMd = ext === "md" || ext === "markdown";
  if (rename.path === entry.path) {
    return (
      <div className="tree-row" data-reveal-path={entry.path}>
        <TreeNameInput
          kind="file"
          depth={depth}
          initial={entry.name}
          onSubmit={(name) => rename.onSubmit(entry.path, "file", name)}
          onCancel={rename.onCancel}
        />
      </div>
    );
  }
  // Dropping onto a file means "into the folder it sits in", as in VS Code.
  const dropDir = parentDir(entry.path);
  return (
    // No drop highlight here: the containing folder's row is the actual target
    // and lights up instead, so hovering one file doesn't flash its siblings.
    <div
      className={`tree-row group/row rounded-md transition-colors ${
        marks.paths.includes(entry.path)
          ? "bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
          : ""
      } ${dnd.dragging.some((s) => s.path === entry.path) ? "opacity-50" : ""}`}
      data-reveal-path={entry.path}
      onDragEnter={(e) => {
        e.stopPropagation();
        dnd.onDragEnter(e, dropDir);
        dnd.onHoverFolder(dropDir, true);
      }}
      onDragOver={(e) => {
        e.stopPropagation();
        dnd.onDragOver(e, dropDir);
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        dnd.onDragLeave(dropDir);
      }}
      onDrop={(e) => dnd.onDrop(e, dropDir)}
    >
      <button
        type="button"
        onClick={(e) => {
          if (marks.onRowClick(e, { path: entry.path, type: "file" })) return;
          onSelect(entry.path);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e.clientX, e.clientY, entry.path, "file");
        }}
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          dnd.onDragStart(e, { path: entry.path, type: "file" });
        }}
        onDragEnd={dnd.onDragEnd}
        className={`tree-item ${isSelected ? "is-selected" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 14}px`, paddingRight: "28px" }}
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
      <CopyPathButton
        path={entry.path}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
      />
    </div>
  );
}

function CopyIcon() {
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
      <rect x="5.8" y="5.8" width="8" height="8" rx="1.2" />
      <path d="M10.2 3.4V3.2c0-.55-.45-1-1-1H3.2c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h.2" />
    </svg>
  );
}

// Trailing "copy absolute path" control for a tree row. It is rendered as a
// sibling of the row's main button (buttons can't nest), so clicking it never
// opens the file or toggles the folder. Visibility is left to the caller so
// each row type can hook it to its own hover group.
function CopyPathButton({ path, className = "" }: { path: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      // Clipboard can be unavailable (insecure context) or blocked by policy.
      toast.error("パスをコピーできませんでした");
      return;
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      // The row wrapper also handles drag and context menu; keep those from
      // reacting to interactions aimed at this button.
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      title={copied ? "コピーしました" : "絶対パスをコピー"}
      aria-label={`絶対パスをコピー: ${path}`}
      className={`inline-flex items-center justify-center w-5 h-5 rounded flex-shrink-0 transition-[opacity,color,background-color] duration-150 ${
        copied
          ? "text-[var(--primary)]"
          : "text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
      } ${className}`}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

function FilePlusIcon() {
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
      <path d="M9 1.9H4.3c-.55 0-1 .45-1 1v10.2c0 .55.45 1 1 1H8" />
      <path d="M9 1.9l3.7 3.7v2" />
      <path d="M11.8 9.9v4.2" />
      <path d="M9.7 12h4.2" />
    </svg>
  );
}

// Trailing "create here" controls for a directory row. Like CopyPathButton
// they are siblings of the row's main button so clicking one never toggles
// the folder.
function NewNodeButton({ kind, onClick }: { kind: NewNodeKind; onClick: () => void }) {
  const label = kind === "file" ? "ここに HTML を新規作成" : "ここにフォルダを新規作成";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center w-5 h-5 rounded flex-shrink-0 text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
    >
      {kind === "file" ? <FilePlusIcon /> : <FolderPlusIcon />}
    </button>
  );
}

// VS Code-style inline name field in the tree — used both for the draft row
// that creates a file/folder (`initial` empty) and for renaming an existing
// one (`initial` = its current name). Dismissing an *empty* field (blur,
// Escape) simply removes it. A name that has been typed is never thrown away
// by losing focus — blur commits it, the same as Enter — and a rejected name
// (duplicate, bad characters) keeps the row open with the text intact so it
// can be corrected instead of retyped.
function TreeNameInput({
  kind,
  depth,
  initial = "",
  onSubmit,
  onCancel,
}: {
  kind: NewNodeKind;
  depth: number;
  initial?: string;
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  // Guards the row against settling twice (Enter then the blur it causes).
  const settledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const label = kind === "file" ? "新規ファイル名" : "新規フォルダ名";

  // Renaming starts with the extension out of the selection (as editors do),
  // so typing replaces just the name part.
  useEffect(() => {
    if (!initial) return;
    const dot = initial.lastIndexOf(".");
    inputRef.current?.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  const cancel = () => {
    // A request already in flight can't be recalled, but the row must not trap
    // the sidebar if it stalls (e.g. a slow network mount). Dismiss it and let
    // the request report its own outcome.
    if (busy) {
      toast("処理中です。完了すると一覧に反映されます");
      onCancel();
      return;
    }
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  const submit = async () => {
    if (settledRef.current) return;
    const name = value.trim();
    if (!name) {
      cancel();
      return;
    }
    settledRef.current = true;
    setBusy(true);
    const err = await onSubmit(name);
    setBusy(false);
    if (!err) return; // success: the row unmounts as the tree reloads
    settledRef.current = false;
    toast.error(err);
    inputRef.current?.focus();
  };

  return (
    <div
      className="tree-item is-selected"
      style={{ paddingLeft: `${depth * 12 + 14}px`, paddingRight: "8px" }}
    >
      <span
        className={`file-icon flex-shrink-0 ${kind === "file" ? "file-icon-html" : ""}`}
        aria-hidden="true"
      >
        {kind === "file" ? <HtmlIcon /> : <FolderIcon open={false} />}
      </span>
      <input
        ref={inputRef}
        // biome-ignore lint/a11y/noAutofocus: the draft row appears on user action and is useless unfocused
        autoFocus
        type="text"
        value={value}
        placeholder={label}
        aria-label={label}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        readOnly={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // While an IME is composing (kana → kanji), Enter belongs to the
          // conversion, not to the name: it commits the candidate and the
          // field stays open until Enter is pressed again on settled text.
          // Safari reports this as keyCode 229 rather than isComposing.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={submit}
        className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[var(--text)] text-[12.5px] px-0 py-0"
      />
    </div>
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
      aria-hidden="true"
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
      aria-hidden="true"
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
    missing ? "ファイルが見つかりません" : null,
    file.alias ? `元ファイル: ${filename}` : null,
    file.path,
  ].filter(Boolean);
  return (
    <div
      className={`tree-row group/shortcut ${isDragging ? "opacity-50" : ""}`}
      data-reveal-path={file.path}
    >
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
            style={{ paddingLeft: `${depth * 12 + 14}px`, paddingRight: "52px" }}
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
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            <CopyPathButton
              path={file.path}
              className="opacity-0 group-hover/shortcut:opacity-100 focus-visible:opacity-100"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(file.path);
              }}
              title="Remove shortcut"
              aria-label="Remove shortcut"
              className="inline-flex items-center justify-center w-5 h-5 rounded text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-opacity opacity-0 group-hover/shortcut:opacity-100 focus-visible:opacity-100"
            >
              <CloseIcon />
            </button>
          </div>
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
          // Enter belongs to the IME while it is converting (see TreeNameInput).
          if (e.nativeEvent.isComposing || e.keyCode === 229) return;
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
        // biome-ignore lint/a11y/noAutofocus: form appears on user action; focusing its first field is expected
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
        // biome-ignore lint/a11y/noAutofocus: form appears on user action; focusing its first field is expected
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
  nodeType,
  onClose,
  onStartRename,
  onStartTreeRename,
  onTrash,
  trashCount,
}: {
  x: number;
  y: number;
  path: string;
  source: "root" | "shortcut";
  alias?: string;
  nodeType?: "file" | "directory";
  onClose: () => void;
  // Shortcut rows rename their display alias; tree rows rename the file or
  // folder on disk.
  onStartRename: (path: string) => void;
  onStartTreeRename: (path: string) => void;
  onTrash: (path: string, nodeType: "file" | "directory") => void;
  // How many entries the trash item would act on (the marked set, or 1).
  trashCount: number;
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
  // Tree rows: rename / copy path / move to Trash. Shortcut rows: alias / copy.
  const canEditOnDisk = !isShortcut && nodeType !== undefined;
  const itemCount = canEditOnDisk ? 3 : isShortcut ? 2 : 1;

  const MENU_W = 200;
  const MENU_H = 36 + itemCount * 30 + (isShortcut ? 16 : 0);
  const left = Math.min(x, window.innerWidth - MENU_W - 8);
  const top = Math.min(y, window.innerHeight - MENU_H - 8);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: onClick only stops propagation; menu items are real buttons
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
      {canEditOnDisk && (
        <button
          type="button"
          role="menuitem"
          onClick={() => onStartTreeRename(path)}
          className="w-full text-left px-3 py-1.5 text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
        >
          名前を変更
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
      {canEditOnDisk && nodeType && (
        <button
          type="button"
          role="menuitem"
          // Nothing is deleted here — this only opens the confirmation dialog.
          onClick={() => onTrash(path, nodeType)}
          className="w-full text-left px-3 py-1.5 text-[12px] text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] transition-colors"
        >
          {trashCount > 1 ? `${trashCount} 件をゴミ箱に移動` : "ゴミ箱に移動"}
        </button>
      )}
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

  const handleSet = async () => {
    const input = await promptDialog({
      title: "プレビュー CSS のパス",
      description: `絶対パスを指定。「${folderName}」配下のファイルを開いたときにスコープ付きで適用されます。空欄で解除。`,
      defaultValue: cssPath ?? "",
      placeholder: "/path/to/style.css",
      confirmLabel: "設定",
    });
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
    // biome-ignore lint/a11y/useKeyWithClickEvents: onClick only stops propagation; menu items are real buttons
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
