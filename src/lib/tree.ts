import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { PathNotAllowedError, resolveSafePath } from "@/lib/fs-safe";

export type TreeEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeEntry[];
};

export async function walkTree(dir: string): Promise<TreeEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const result: TreeEntry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const children = await walkTree(full);
      if (children.length === 0) continue;
      result.push({ name: entry.name, path: full, type: "directory", children });
    } else if (entry.isFile() && /\.(html?|md|markdown)$/i.test(entry.name)) {
      result.push({ name: entry.name, path: full, type: "file" });
    }
  }
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

export type TreeResult = { tree: TreeEntry[] } | { error: string; status: number };

// Shared by the /api/tree route and the server-rendered initial sidebar so
// both produce identical trees and error messages for a given root.
export async function loadTreeForRoot(rootPath: string): Promise<TreeResult> {
  try {
    const { absolute } = await resolveSafePath(rootPath);
    const s = await stat(absolute);
    if (!s.isDirectory()) {
      return { error: "Path is not a directory", status: 400 };
    }
    return { tree: await walkTree(absolute) };
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
