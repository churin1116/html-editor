import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { PathNotAllowedError, resolveSafePath } from "@/lib/fs-safe";

export type TreeEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeEntry[];
  // Directory that readdir reported as containing nothing at all. Set only
  // for directories the walk actually listed, so an unreadable or unvisited
  // one is never mistaken for empty. See pruneAndSort.
  empty?: boolean;
};

const EDITABLE_FILE_RE = /\.(html?|md|markdown)$/i;
const IGNORED_DIRS = new Set(["node_modules", "__pycache__"]);
// Hard ceiling on dirents scanned per root walk. A root pointing at a huge
// tree (datasets, caches) would otherwise hang the server — the walk is
// breadth-first, so shallow content always makes it into the tree before the
// budget runs out; only the deepest levels of oversized roots are omitted.
const MAX_SCANNED_ENTRIES = 30_000;
// Network mounts (SMB/SSHFS) pay a round trip per readdir; batching hides it.
const READDIR_CONCURRENCY = 16;

export type WalkResult = { entries: TreeEntry[]; truncated: boolean };

export async function walkTree(dir: string): Promise<WalkResult> {
  const rootChildren: TreeEntry[] = [];
  // `node` is the entry the listing belongs to (null for the root itself), so
  // the walk can mark it empty once its listing comes back.
  const queue: { dir: string; children: TreeEntry[]; node: TreeEntry | null }[] = [
    { dir, children: rootChildren, node: null },
  ];
  let scanned = 0;
  while (queue.length > 0 && scanned < MAX_SCANNED_ENTRIES) {
    const batch = queue.splice(0, READDIR_CONCURRENCY);
    const listings = await Promise.all(
      // An unreadable subdirectory (permissions, vanished network mount entry)
      // drops out of the tree instead of failing the whole walk. `null`
      // distinguishes that failure from a directory that really is empty.
      batch.map((item) => readdir(item.dir, { withFileTypes: true }).catch(() => null)),
    );
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      const listing = listings[i];
      if (listing === null) continue;
      scanned += listing.length;
      if (listing.length === 0 && item.node) item.node.empty = true;
      for (const entry of listing) {
        if (entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) continue;
        const full = path.join(item.dir, entry.name);
        if (entry.isDirectory()) {
          const children: TreeEntry[] = [];
          const node: TreeEntry = { name: entry.name, path: full, type: "directory", children };
          item.children.push(node);
          queue.push({ dir: full, children, node });
        } else if (entry.isFile() && EDITABLE_FILE_RE.test(entry.name)) {
          item.children.push({ name: entry.name, path: full, type: "file" });
        }
      }
    }
  }
  const truncated = queue.length > 0;
  if (truncated) {
    console.warn(
      `[tree] scan budget (${MAX_SCANNED_ENTRIES}) exceeded under ${dir}; tree truncated`,
    );
  }
  return { entries: pruneAndSort(rootChildren), truncated };
}

// Directories that ended up with no editable descendants disappear; siblings
// sort directories-first, then by name — same shape the old recursive walk
// produced. Directories that are genuinely empty on disk are the exception:
// they stay, so a folder created from the sidebar doesn't vanish the moment
// it is made (and an intentionally empty folder keeps its place on reload).
function pruneAndSort(entries: TreeEntry[]): TreeEntry[] {
  const result: TreeEntry[] = [];
  for (const e of entries) {
    if (e.type === "directory") {
      const children = pruneAndSort(e.children ?? []);
      if (children.length === 0 && !e.empty) continue;
      result.push({ ...e, children });
    } else {
      result.push(e);
    }
  }
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

export type TreeResult =
  | { tree: TreeEntry[]; truncated: boolean }
  | { error: string; status: number };

// Shared by the /api/tree route and the server-rendered initial sidebar so
// both produce identical trees and error messages for a given root.
export async function loadTreeForRoot(rootPath: string): Promise<TreeResult> {
  try {
    const { absolute } = await resolveSafePath(rootPath);
    const s = await stat(absolute);
    if (!s.isDirectory()) {
      return { error: "Path is not a directory", status: 400 };
    }
    const { entries, truncated } = await walkTree(absolute);
    return { tree: entries, truncated };
  } catch (err: unknown) {
    if (err instanceof PathNotAllowedError) {
      return { error: err.message, status: 403 };
    }
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return { error: "Allowed root does not exist on disk", status: 404 };
    }
    return { error: e.message ?? "Unknown error", status: 500 };
  }
}
