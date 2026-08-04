import { rename as fsRename, stat } from "node:fs/promises";
import path from "node:path";
import { PathNotAllowedError, resolveSafePath } from "@/lib/fs-safe";
import { loadShortcutTree, repathFilesInTree, saveShortcutTree } from "@/lib/shortcuts";

const EDITABLE_EXT_RE = /\.(html?|md|markdown)$/i;

export type RenameResult =
  | { ok: true; path: string }
  | { ok: false; error: string; status: number };

// Renames a file or directory in place (same parent). Shared by the /api/file
// and /api/dir PATCH handlers so both behave identically; `expect` is what the
// caller believes the path is, and a mismatch is an error rather than a
// surprise rename of the wrong kind of thing.
export async function renameNode(
  rawPath: string,
  rawName: string,
  expect: "file" | "directory",
): Promise<RenameResult> {
  const name = rawName.trim();
  if (!rawPath?.trim() || !name) {
    return { ok: false, error: "Missing 'path' or 'name'", status: 400 };
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return { ok: false, error: "Invalid name", status: 400 };
  }

  try {
    const { absolute: from } = await resolveSafePath(rawPath);
    const current = await stat(from).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (!current) return { ok: false, error: "Path no longer exists", status: 404 };
    if (expect === "file" && !current.isFile()) {
      return { ok: false, error: "Path is not a file", status: 400 };
    }
    if (expect === "directory" && !current.isDirectory()) {
      return { ok: false, error: "Path is not a directory", status: 400 };
    }

    // Same rule as creation: a name without an editable extension keeps the
    // one it already had, so a file can never be renamed out of the tree.
    const finalName =
      expect === "file" && !EDITABLE_EXT_RE.test(name)
        ? `${name}${path.extname(from) || ".html"}`
        : name;

    const { absolute: to } = await resolveSafePath(path.join(path.dirname(from), finalName));
    if (to === from) return { ok: true, path: from };

    return await commitMove(from, to, current.ino);
  } catch (err: unknown) {
    return asFailure(err);
  }
}

// Moves a file or directory into another directory, keeping its own name.
// Used by drag-and-drop in the sidebar tree.
export async function moveNode(rawPath: string, rawTargetDir: string): Promise<RenameResult> {
  if (!rawPath?.trim() || !rawTargetDir?.trim()) {
    return { ok: false, error: "Missing 'path' or 'targetDir'", status: 400 };
  }

  try {
    const { absolute: from } = await resolveSafePath(rawPath);
    const { absolute: targetDir } = await resolveSafePath(rawTargetDir);

    const current = await stat(from).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (!current) return { ok: false, error: "Path no longer exists", status: 404 };

    const target = await stat(targetDir).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (!target?.isDirectory()) {
      return { ok: false, error: "Destination is not a directory", status: 400 };
    }

    // Moving a directory into itself or into its own subtree would detach it
    // from the tree; rename(2) reports EINVAL, but the check makes the reason
    // explicit and covers the "into itself" case for files too.
    if (targetDir === from || targetDir.startsWith(`${from}/`)) {
      return { ok: false, error: "Cannot move a folder into itself", status: 400 };
    }

    const to = path.join(targetDir, path.basename(from));
    if (to === from) return { ok: true, path: from };

    return await commitMove(from, to, current.ino);
  } catch (err: unknown) {
    return asFailure(err);
  }
}

// Shared tail of rename/move: refuse to clobber an existing entry, do the
// rename, then keep shortcuts pointing at the moved path (or at anything
// inside a moved directory) working.
async function commitMove(from: string, to: string, fromIno: number): Promise<RenameResult> {
  const existing = await stat(to).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  // On a case-insensitive filesystem `stat` finds the entry being renamed when
  // only its case changed; that isn't a conflict.
  if (existing && existing.ino !== fromIno) {
    return { ok: false, error: "A file or folder with that name already exists", status: 409 };
  }

  await fsRename(from, to);

  const tree = await loadShortcutTree();
  const { tree: next, changed } = repathFilesInTree(tree, from, to);
  if (changed > 0) await saveShortcutTree(next);

  return { ok: true, path: to };
}

function asFailure(err: unknown): RenameResult {
  if (err instanceof PathNotAllowedError) {
    return { ok: false, error: err.message, status: 403 };
  }
  const e = err as NodeJS.ErrnoException;
  return { ok: false, error: e.message ?? "Unknown error", status: 500 };
}
