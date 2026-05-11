import path from "node:path";
import { loadAllowedRoots, type AllowedRoot } from "./allowed-roots";
import { loadShortcuts } from "./shortcuts";

export class PathNotAllowedError extends Error {
  constructor(p: string) {
    super(`Path is not under any allowed root: ${p}`);
    this.name = "PathNotAllowedError";
  }
}

export async function resolveSafePath(
  inputPath: string,
): Promise<{ absolute: string; root: AllowedRoot }> {
  const absolute = path.resolve(inputPath);
  const roots = await loadAllowedRoots();

  for (const root of roots) {
    const rel = path.relative(root.path, absolute);
    const isInside = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    if (isInside) {
      return { absolute, root };
    }
  }

  const shortcuts = await loadShortcuts();
  if (shortcuts.some((s) => s.path === absolute)) {
    return {
      absolute,
      root: { label: "Shortcut", path: path.dirname(absolute) },
    };
  }

  throw new PathNotAllowedError(absolute);
}
