// Shows the open file's row when a page opens, so the sidebar doesn't start
// at the top with the file somewhere far below, or folded away.
//
// Two steps: the server renders the page with the folders above the file
// open (unfoldToOpenFile), and an inline script at the end of the sidebar
// scrolls the row into view while the page is still loading (revealOpenFile).

import type { SidebarCollapse } from "@/lib/sidebar-collapse";

// Structural, so the server and the Sidebar can each pass their own nodes.
type RevealTreeEntry = { path: string; type: "file" | "directory"; children?: RevealTreeEntry[] };
type RevealShortcut =
  | { type: "file"; path: string }
  | { type: "folder"; id: string; children: RevealShortcut[] };

// Folders that have to be open for `path`'s row to show in this tree,
// outermost first; null when the tree doesn't list the file.
function treeFolderChain(entries: RevealTreeEntry[], path: string): string[] | null {
  for (const entry of entries) {
    if (entry.type === "file") {
      if (entry.path === path) return [];
    } else if (path.startsWith(`${entry.path}/`)) {
      // No other folder on this level can hold the path.
      const below = treeFolderChain(entry.children ?? [], path);
      return below ? [entry.path, ...below] : null;
    }
  }
  return null;
}

// Ids of the shortcut folders that have to be open for `path` to be visible,
// outermost first. null when the path isn't a shortcut at all.
export function shortcutFolderChain(
  nodes: RevealShortcut[],
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

// The folds a page opens with: as saved, except that whatever hides the open
// file is open — the folders on its path in the first visible tree that lists
// it, or, for a file listed only as a shortcut, its shortcut folders and the
// Shortcuts section. The Sidebar saves the difference like any other fold.
export function unfoldToOpenFile(
  collapse: SidebarCollapse,
  path: string | null,
  rootPaths: string[],
  trees: Record<string, RevealTreeEntry[]>,
  shortcuts: RevealShortcut[],
): SidebarCollapse {
  if (!path) return collapse;
  for (const root of rootPaths) {
    const chain = treeFolderChain(trees[root] ?? [], path);
    if (!chain) continue;
    // A folder without an entry of its own follows its root's default.
    const closedByDefault = collapse.dirDefaultClosed.includes(root);
    const closed = chain.filter((dir) => collapse.dirs[dir] ?? closedByDefault);
    if (closed.length === 0) return collapse;
    const dirs = { ...collapse.dirs };
    for (const dir of closed) dirs[dir] = false;
    return { ...collapse, dirs };
  }
  const chain = shortcutFolderChain(shortcuts, path);
  if (!chain) return collapse;
  const closed = chain.filter((id) => collapse.folders[id]);
  if (closed.length === 0 && !collapse.shortcuts) return collapse;
  const folders = { ...collapse.folders };
  for (const id of closed) folders[id] = false;
  return { ...collapse, folders, shortcuts: false };
}

// Scrolls the sidebar so the open file's row is in view. It runs as an inline
// script at the end of the sidebar (OPEN_FILE_REVEAL_SCRIPT): hydration comes
// after the first paint, so only a script in the page itself can have that
// paint already scrolled. A sidebar that starts out closed is skipped there,
// and the Sidebar runs this once it first opens. The script is this
// function's own source text, so the function may use nothing but its
// argument and the browser's globals.
export function revealOpenFile(box: HTMLElement | null): void {
  const path = box?.dataset.openPath;
  // A closed sidebar has no width, and rows measured in it aren't where they
  // will be once it opens.
  if (!box || !path || box.clientWidth === 0) return;
  const rowFor = (p: string) => `[data-reveal-path="${CSS.escape(p)}"]`;
  const parentOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
  // The file's place in the tree first, then anywhere else it is listed (its
  // shortcut). A file the tree doesn't list (cut off by the scan limit, or in
  // a folder the tree leaves out) has the deepest folder row above it that is
  // showing stand in for it.
  let row =
    box.querySelector<HTMLElement>(`[data-tree-area] ${rowFor(path)}`) ??
    box.querySelector<HTMLElement>(rowFor(path));
  for (let dir = parentOf(path); !row && dir; dir = parentOf(dir)) {
    row = box.querySelector<HTMLElement>(`[data-tree-area] ${rowFor(dir)}`);
  }
  if (!row) return;
  const top = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  // Already in view: the scroll stays where it is.
  if (top >= box.scrollTop && top + row.offsetHeight <= box.scrollTop + box.clientHeight) return;
  box.scrollTop = top - (box.clientHeight - row.offsetHeight) / 2;
}

// Goes after everything else in the sidebar, footer included: until the
// parser has reached what sits below the scroll area, the area is measured
// taller than it ends up, and the row lands off-center.
export const OPEN_FILE_REVEAL_SCRIPT = `(${revealOpenFile.toString()})(document.querySelector("[data-sidebar-scroll]"))`;
