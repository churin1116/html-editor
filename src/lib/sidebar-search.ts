// Name-based lookup over what the sidebar already has in memory: the loaded
// file trees plus the shortcut list. A query only ever matches within a file
// or folder *name*; the surrounding path is a filter (for path-shaped
// queries), never something a bare term can match against. File contents are
// never read.
//
// Structural types, so the sidebar can pass its own tree/shortcut nodes
// without this module importing the server-side tree walker (node:fs).
export type SearchableTreeEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: SearchableTreeEntry[];
};

export type SearchableShortcut =
  | { type: "file"; path: string; alias?: string }
  | { type: "folder"; children: SearchableShortcut[] };

export type SearchEntry = {
  /** Absolute path on disk. */
  path: string;
  /** Basename (file name or directory name). */
  name: string;
  type: "file" | "directory";
  /** Root this entry's tree belongs to; null for shortcut-only entries. */
  rootPath: string | null;
  /** Shortcut display name, when the path is registered as a shortcut. */
  alias?: string;
  /** Whether the entry was found only in the shortcut list. */
  source: "tree" | "shortcut";
};

export type SearchHit = SearchEntry & { score: number };

export const MAX_SEARCH_RESULTS = 40;

export function buildSearchIndex(
  trees: Record<string, SearchableTreeEntry[]>,
  shortcuts: SearchableShortcut[],
): SearchEntry[] {
  const byPath = new Map<string, SearchEntry>();

  const walk = (entries: SearchableTreeEntry[], rootPath: string) => {
    for (const entry of entries) {
      if (!byPath.has(entry.path)) {
        byPath.set(entry.path, {
          path: entry.path,
          name: entry.name,
          type: entry.type,
          rootPath,
          source: "tree",
        });
      }
      if (entry.children) walk(entry.children, rootPath);
    }
  };
  for (const [rootPath, entries] of Object.entries(trees)) walk(entries, rootPath);

  // Shortcuts either annotate an entry already in a tree (with its alias) or
  // add a path that lives outside every root.
  const walkShortcuts = (nodes: SearchableShortcut[]) => {
    for (const node of nodes) {
      if (node.type === "folder") {
        walkShortcuts(node.children);
        continue;
      }
      const existing = byPath.get(node.path);
      if (existing) {
        if (node.alias && !existing.alias) existing.alias = node.alias;
        continue;
      }
      byPath.set(node.path, {
        path: node.path,
        name: node.path.split("/").pop() ?? node.path,
        type: "file",
        rootPath: null,
        alias: node.alias,
        source: "shortcut",
      });
    }
  };
  walkShortcuts(shortcuts);

  return Array.from(byPath.values());
}

// Matching is always against the file/folder name itself — never against
// arbitrary substrings of the absolute path. Scores are ordered best-first;
// null means the entry does not match at all.
function scoreName(entry: SearchEntry, needle: string): number | null {
  const lowerName = entry.name.toLowerCase();
  const nameNoExt = lowerName.replace(/\.[^./]+$/, "");
  const alias = entry.alias?.toLowerCase();
  if (lowerName === needle || nameNoExt === needle || alias === needle) return 0;
  if (lowerName.startsWith(needle) || alias?.startsWith(needle)) return 1;
  if (lowerName.includes(needle) || alias?.includes(needle)) return 2;
  return null;
}

/** The directory a path lives in, lowercased. */
function parentDir(path: string, name: string): string {
  return path.slice(0, Math.max(0, path.length - name.length - 1)).toLowerCase();
}

export function searchEntries(entries: SearchEntry[], rawQuery: string): SearchHit[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];

  // `~`, `./` and a leading `/` are stripped so absolute, home-relative and
  // relative queries all reduce to the same "folder tail + name" shape — no
  // home directory lookup needed.
  const normalized = trimmed
    .replace(/^~(?=\/)/, "")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "")
    .replace(/^\/+/, "");
  if (!normalized) return [];

  const lowered = normalized.toLowerCase();
  // A query with a slash is split into "where" and "what": the last segment is
  // the name pattern, everything before it constrains the containing folder.
  // The folder part has to line up with whole segments, so "_ref/reviews" finds
  // that one folder and not every path that happens to contain the text.
  const slash = lowered.lastIndexOf("/");
  const isPathQuery = slash !== -1;
  const needle = isPathQuery ? lowered.slice(slash + 1) : lowered;
  const dirNeedle = isPathQuery ? lowered.slice(0, slash) : "";
  if (!needle) return [];

  const hits: SearchHit[] = [];
  for (const entry of entries) {
    const score = scoreName(entry, needle);
    if (score === null) continue;
    if (isPathQuery && dirNeedle) {
      const dir = parentDir(entry.path, entry.name);
      if (dir !== dirNeedle && !dir.endsWith(`/${dirNeedle}`)) continue;
    }
    hits.push({ ...entry, score });
  }

  hits.sort(
    (a, b) =>
      a.score - b.score ||
      // Shallower paths first — they are usually the more prominent match.
      a.path.split("/").length - b.path.split("/").length ||
      a.path.length - b.path.length ||
      a.path.localeCompare(b.path),
  );
  return hits.slice(0, MAX_SEARCH_RESULTS);
}

/** Directories between `rootPath` (exclusive) and `target` (exclusive). */
export function ancestorDirPaths(rootPath: string, target: string): string[] {
  if (!target.startsWith(`${rootPath}/`)) return [];
  const parts = target.slice(rootPath.length + 1).split("/");
  const out: string[] = [];
  let current = rootPath;
  for (let i = 0; i < parts.length - 1; i++) {
    current = `${current}/${parts[i]}`;
    out.push(current);
  }
  return out;
}
