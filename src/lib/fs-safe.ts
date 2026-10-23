import path from "node:path";
import { type AllowedRoot, loadAllowedRoots } from "./allowed-roots";
import { loadShortcutTargets } from "./shortcuts";

export class PathNotAllowedError extends Error {
  constructor(p: string) {
    super(`Path is not under any allowed root: ${p}`);
    this.name = "PathNotAllowedError";
  }
}

function isWithin(dir: string, absolute: string): boolean {
  const rel = path.relative(dir, absolute);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export async function resolveSafePath(
  inputPath: string,
): Promise<{ absolute: string; root: AllowedRoot }> {
  const absolute = path.resolve(inputPath);
  const roots = await loadAllowedRoots();

  for (const root of roots) {
    if (isWithin(root.path, absolute)) {
      return { absolute, root };
    }
  }

  const shortcuts = await loadShortcutTargets();
  // A folder listed as a shortcut opens up like a root: everything under it.
  for (const dir of shortcuts.dirs) {
    if (isWithin(dir, absolute)) {
      return { absolute, root: { label: "Shortcut", path: dir } };
    }
  }
  if (shortcuts.files.includes(absolute)) {
    return {
      absolute,
      root: { label: "Shortcut", path: path.dirname(absolute) },
    };
  }

  throw new PathNotAllowedError(absolute);
}
