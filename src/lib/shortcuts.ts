import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type ShortcutFileNode = { type: "file"; path: string; alias?: string };
// A folder on disk. The sidebar lists what is inside it the way a root's tree
// does, and everything under it can be opened (lib/fs-safe).
export type ShortcutDirNode = { type: "dir"; path: string; alias?: string };
// A named group of shortcuts — it exists only in this list, not on disk.
export type ShortcutFolderNode = {
  type: "folder";
  id: string;
  name: string;
  children: ShortcutNode[];
  // Absolute path to a CSS file that should be applied as a preview-only
  // stylesheet when opening any file under this folder. The CSS is scoped
  // to the editor preview and never written into the saved HTML.
  cssPath?: string;
};
export type ShortcutNode = ShortcutFileNode | ShortcutDirNode | ShortcutFolderNode;

export type ShortcutFileWithStatus = ShortcutFileNode & { exists: boolean };
export type ShortcutDirWithStatus = ShortcutDirNode & { exists: boolean };
export type ShortcutFolderWithStatus = {
  type: "folder";
  id: string;
  name: string;
  children: ShortcutNodeWithStatus[];
  cssPath?: string;
};
export type ShortcutNodeWithStatus =
  | ShortcutFileWithStatus
  | ShortcutDirWithStatus
  | ShortcutFolderWithStatus;

type Config = {
  shortcuts: ShortcutNode[];
};

const CONFIG_DIR = path.join(homedir(), ".config", "html-editor");
const CONFIG_PATH = path.join(CONFIG_DIR, "shortcuts.json");

function normalizeNode(raw: unknown): ShortcutNode | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.type === "folder") {
    const id = typeof obj.id === "string" && obj.id ? obj.id : randomUUID();
    const name = typeof obj.name === "string" ? obj.name : "Folder";
    const rawChildren = Array.isArray(obj.children) ? obj.children : [];
    const children = rawChildren.map(normalizeNode).filter((n): n is ShortcutNode => n !== null);
    const folder: ShortcutFolderNode = { type: "folder", id, name, children };
    if (typeof obj.cssPath === "string" && obj.cssPath.trim()) {
      folder.cssPath = path.resolve(obj.cssPath.trim());
    }
    return folder;
  }
  // Legacy or explicit file entry: { path } or { type: "file", path }; a
  // folder on disk is { type: "dir", path }.
  if (typeof obj.path === "string") {
    const node: ShortcutFileNode | ShortcutDirNode = {
      type: obj.type === "dir" ? "dir" : "file",
      path: path.resolve(obj.path),
    };
    if (typeof obj.alias === "string" && obj.alias.trim()) {
      node.alias = obj.alias.trim();
    }
    return node;
  }
  return null;
}

export async function loadShortcutTree(): Promise<ShortcutNode[]> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Config;
    const items = Array.isArray(parsed.shortcuts) ? parsed.shortcuts : [];
    return items.map(normalizeNode).filter((n): n is ShortcutNode => n !== null);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function saveShortcutTree(tree: ShortcutNode[]): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const config: Config = { shortcuts: tree };
  const json = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(CONFIG_PATH, json, "utf8");
}

export function getShortcutsPath(): string {
  return CONFIG_PATH;
}

// What the shortcuts reach beyond the roots (lib/fs-safe): each listed file,
// and everything under each listed folder on disk.
export async function loadShortcutTargets(): Promise<{ files: string[]; dirs: string[] }> {
  const tree = await loadShortcutTree();
  const files: string[] = [];
  const dirs: string[] = [];
  const walk = (nodes: ShortcutNode[]) => {
    for (const n of nodes) {
      if (n.type === "file") files.push(n.path);
      else if (n.type === "dir") dirs.push(n.path);
      else walk(n.children);
    }
  };
  walk(tree);
  return { files, dirs };
}

export async function loadShortcutTreeWithStatus(): Promise<ShortcutNodeWithStatus[]> {
  const tree = await loadShortcutTree();
  const annotate = async (nodes: ShortcutNode[]): Promise<ShortcutNodeWithStatus[]> =>
    Promise.all(
      nodes.map(async (n): Promise<ShortcutNodeWithStatus> => {
        if (n.type !== "folder") {
          try {
            const st = await stat(n.path);
            return { ...n, exists: n.type === "dir" ? st.isDirectory() : st.isFile() };
          } catch {
            return { ...n, exists: false };
          }
        }
        const folder: ShortcutFolderWithStatus = {
          type: "folder",
          id: n.id,
          name: n.name,
          children: await annotate(n.children),
        };
        if (n.cssPath) folder.cssPath = n.cssPath;
        return folder;
      }),
    );
  return annotate(tree);
}

// A path — a file or a folder on disk — is listed at most once.
export function pathExistsInTree(tree: ShortcutNode[], absolute: string): boolean {
  for (const n of tree) {
    if (n.type !== "folder") {
      if (n.path === absolute) return true;
    } else if (pathExistsInTree(n.children, absolute)) {
      return true;
    }
  }
  return false;
}

// Walk the shortcuts tree for `filePath` and return the cssPath of the
// deepest folder ancestor that has one. Returns null if the file is not in
// the tree or no ancestor folder declared a cssPath. A file inside a listed
// folder on disk counts as being where that folder is listed.
export function findFolderCssForPath(tree: ShortcutNode[], filePath: string): string | null {
  let result: string | null = null;
  const walk = (nodes: ShortcutNode[], inherited: string | null): boolean => {
    for (const n of nodes) {
      if (n.type !== "folder") {
        if (n.type === "file" ? n.path === filePath : filePath.startsWith(`${n.path}/`)) {
          result = inherited;
          return true;
        }
      } else {
        const next = n.cssPath ?? inherited;
        if (walk(n.children, next)) return true;
      }
    }
    return false;
  };
  walk(tree, null);
  return result;
}

export function findFolder(tree: ShortcutNode[], folderId: string): ShortcutFolderNode | null {
  for (const n of tree) {
    if (n.type !== "folder") continue;
    if (n.id === folderId) return n;
    const nested = findFolder(n.children, folderId);
    if (nested) return nested;
  }
  return null;
}

// Appends a file, a folder on disk or a new group at the top level, or inside
// the group `parentId`.
export function addNodeToTree(
  tree: ShortcutNode[],
  node: ShortcutNode,
  parentId: string | null,
): { tree: ShortcutNode[]; ok: boolean } {
  if (parentId === null) {
    return { tree: [...tree, node], ok: true };
  }
  let ok = false;
  const walk = (nodes: ShortcutNode[]): ShortcutNode[] =>
    nodes.map((n) => {
      if (n.type !== "folder") return n;
      if (n.id === parentId) {
        ok = true;
        return { ...n, children: [...n.children, node] };
      }
      return { ...n, children: walk(n.children) };
    });
  return { tree: walk(tree), ok };
}

// Removes the file or folder on disk listed at `absolute`.
export function removePathFromTree(
  tree: ShortcutNode[],
  absolute: string,
): { tree: ShortcutNode[]; removed: boolean } {
  let removed = false;
  const walk = (nodes: ShortcutNode[]): ShortcutNode[] =>
    nodes.flatMap<ShortcutNode>((n) => {
      if (n.type !== "folder") {
        if (n.path === absolute) {
          removed = true;
          return [];
        }
        return [n];
      }
      return [{ ...n, children: walk(n.children) }];
    });
  return { tree: walk(tree), removed };
}

export function removeFolderFromTree(
  tree: ShortcutNode[],
  folderId: string,
): { tree: ShortcutNode[]; removed: boolean } {
  let removed = false;
  const walk = (nodes: ShortcutNode[]): ShortcutNode[] =>
    nodes.flatMap<ShortcutNode>((n) => {
      if (n.type === "folder") {
        if (n.id === folderId) {
          removed = true;
          return [];
        }
        return [{ ...n, children: walk(n.children) }];
      }
      return [n];
    });
  return { tree: walk(tree), removed };
}

export function newFolder(name: string): ShortcutFolderNode {
  return { type: "folder", id: randomUUID(), name, children: [] };
}

export function setFolderCssInTree(
  tree: ShortcutNode[],
  folderId: string,
  cssPath: string | null,
): { tree: ShortcutNode[]; ok: boolean } {
  let ok = false;
  const walk = (nodes: ShortcutNode[]): ShortcutNode[] =>
    nodes.map((n) => {
      if (n.type !== "folder") return n;
      if (n.id !== folderId) {
        return { ...n, children: walk(n.children) };
      }
      ok = true;
      if (cssPath?.trim()) {
        return { ...n, cssPath: path.resolve(cssPath.trim()) };
      }
      const { cssPath: _drop, ...rest } = n;
      return { ...rest, children: n.children };
    });
  return { tree: walk(tree), ok };
}

export function setAliasInTree(
  tree: ShortcutNode[],
  absolute: string,
  alias: string | null,
): { tree: ShortcutNode[]; ok: boolean } {
  let ok = false;
  const walk = (nodes: ShortcutNode[]): ShortcutNode[] =>
    nodes.map((n) => {
      if (n.type !== "folder") {
        if (n.path !== absolute) return n;
        ok = true;
        if (alias?.trim()) {
          return { ...n, alias: alias.trim() };
        }
        const { alias: _drop, ...rest } = n;
        return rest;
      }
      return { ...n, children: walk(n.children) };
    });
  return { tree: walk(tree), ok };
}

// Follows a rename made elsewhere in the app: every shortcut pointing at
// `oldPath` (or at something inside it, when a directory was renamed) is
// repointed at the new location, so renaming from the sidebar doesn't leave
// shortcuts dangling. Aliases are kept — the display name is the user's, not
// the file's.
export function repathInTree(
  tree: ShortcutNode[],
  oldPath: string,
  newPath: string,
): { tree: ShortcutNode[]; changed: number } {
  let changed = 0;
  const walk = (nodes: ShortcutNode[]): ShortcutNode[] =>
    nodes.map((n) => {
      if (n.type === "folder") return { ...n, children: walk(n.children) };
      if (n.path === oldPath) {
        changed++;
        return { ...n, path: newPath };
      }
      if (n.path.startsWith(`${oldPath}/`)) {
        changed++;
        return { ...n, path: newPath + n.path.slice(oldPath.length) };
      }
      return n;
    });
  return { tree: walk(tree), changed };
}

export type MoveSource =
  | { kind: "file"; path: string }
  | { kind: "dir"; path: string }
  | { kind: "folder"; id: string };

export function moveNodeInTree(
  tree: ShortcutNode[],
  source: MoveSource,
  targetFolderId: string | null,
): { tree: ShortcutNode[]; ok: boolean; reason?: string } {
  // 1. Extract the source node
  let extracted: ShortcutNode | null = null;
  const extract = (nodes: ShortcutNode[]): ShortcutNode[] =>
    nodes.flatMap<ShortcutNode>((n) => {
      if (extracted) return [n];
      if (
        source.kind !== "folder" &&
        n.type !== "folder" &&
        n.type === source.kind &&
        n.path === source.path
      ) {
        extracted = n;
        return [];
      }
      if (source.kind === "folder" && n.type === "folder" && n.id === source.id) {
        extracted = n;
        return [];
      }
      if (n.type === "folder") {
        return [{ ...n, children: extract(n.children) }];
      }
      return [n];
    });
  let next = extract(tree);
  if (!extracted) return { tree, ok: false, reason: "Source not found" };

  // 2. Cycle check: folder cannot be moved into itself or its descendants
  if (source.kind === "folder" && targetFolderId !== null) {
    if (targetFolderId === source.id) {
      return { tree, ok: false, reason: "Cannot drop folder into itself" };
    }
    const folder = extracted as ShortcutFolderNode;
    if (findFolder(folder.children, targetFolderId)) {
      return {
        tree,
        ok: false,
        reason: "Cannot drop folder into its descendant",
      };
    }
  }

  // 3. Insert into target
  if (targetFolderId === null) {
    next = [...next, extracted];
    return { tree: next, ok: true };
  }
  let inserted = false;
  const node = extracted;
  const insert = (nodes: ShortcutNode[]): ShortcutNode[] =>
    nodes.map((n) => {
      if (n.type !== "folder") return n;
      if (n.id === targetFolderId) {
        inserted = true;
        return { ...n, children: [...n.children, node] };
      }
      return { ...n, children: insert(n.children) };
    });
  next = insert(next);
  if (!inserted) {
    return { tree, ok: false, reason: "Target folder not found" };
  }
  return { tree: next, ok: true };
}
