import { EditorShell } from "@/components/editor-shell";
import { loadAllowedRoots } from "@/lib/allowed-roots";
import { loadFileFromDisk } from "@/lib/load-file";
import { type ShortcutNodeWithStatus, loadShortcutTreeWithStatus } from "@/lib/shortcuts";
import { loadSidebarCollapse } from "@/lib/sidebar-collapse";
import { unfoldToOpenFile } from "@/lib/sidebar-reveal";
import { type TreeEntry, loadTreeForRoot } from "@/lib/tree";
import { cookies } from "next/headers";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string }>;
}) {
  const cookieStore = await cookies();
  const raw = cookieStore.get("lastSelectedPath")?.value ?? "";
  let initialSelected: string | null = null;
  if (raw) {
    try {
      initialSelected = decodeURIComponent(raw);
    } catch {
      initialSelected = null;
    }
  }

  let initialFile = null;
  if (initialSelected) {
    const result = await loadFileFromDisk(initialSelected);
    if ("error" in result) {
      initialSelected = null;
    } else {
      initialFile = result;
    }
  }

  const initialSidebarOpen = cookieStore.get("sidebarOpen")?.value !== "0";

  // Sidebar data is loaded server-side so the first paint shows real content
  // instead of flashing the empty state while the client refetches.
  const roots = await loadAllowedRoots();

  // Workspace scoping: `?ws=` URL param wins, then the persisted cookie.
  // The value may be a root path or label; no match falls back to all roots.
  const { ws } = await searchParams;
  let wsCookie: string | null = null;
  const rawWsCookie = cookieStore.get("workspace")?.value ?? "";
  if (rawWsCookie) {
    try {
      wsCookie = decodeURIComponent(rawWsCookie);
    } catch {
      wsCookie = null;
    }
  }
  const wsRequested = ws ?? wsCookie;
  const activeRoot = wsRequested
    ? (roots.find((r) => r.path === wsRequested || r.label === wsRequested) ?? null)
    : null;

  const visibleRoots = activeRoot ? [activeRoot] : roots;
  const initialShortcuts = await loadShortcutTreeWithStatus();

  // Folders listed as shortcuts show what is inside them too. Their trees go
  // in the same maps as the roots', keyed by path.
  const dirShortcuts: string[] = [];
  const collectDirs = (nodes: ShortcutNodeWithStatus[]) => {
    for (const n of nodes) {
      if (n.type === "dir") dirShortcuts.push(n.path);
      else if (n.type === "folder") collectDirs(n.children);
    }
  };
  collectDirs(initialShortcuts);

  const initialTrees: Record<string, TreeEntry[]> = {};
  const initialRootErrors: Record<string, string> = {};
  const initialTreeTruncated: Record<string, boolean> = {};
  const treePaths = new Set([...visibleRoots.map((r) => r.path), ...dirShortcuts]);
  await Promise.all(
    [...treePaths].map(async (treePath) => {
      const result = await loadTreeForRoot(treePath);
      if ("error" in result) initialRootErrors[treePath] = result.error;
      else {
        initialTrees[treePath] = result.tree;
        if (result.truncated) initialTreeTruncated[treePath] = true;
      }
    }),
  );

  // Which folders are closed is read here so the first paint renders them
  // already closed instead of collapsing them after hydration. Until its first
  // save it still comes from the cookie it used to live in.
  const savedCollapse = await loadSidebarCollapse(cookieStore.get("sidebarCollapse")?.value);
  // The folders hiding the open file are rendered open, so its row is there
  // on the first paint too; the Sidebar then saves them as opened.
  const initialCollapse = unfoldToOpenFile(
    savedCollapse,
    initialSelected,
    visibleRoots.map((r) => r.path),
    initialTrees,
    initialShortcuts,
  );

  return (
    <EditorShell
      initialSelected={initialSelected}
      initialFile={initialFile}
      initialSidebarOpen={initialSidebarOpen}
      initialRoots={roots}
      initialTrees={initialTrees}
      initialRootErrors={initialRootErrors}
      initialTreeTruncated={initialTreeTruncated}
      initialShortcuts={initialShortcuts}
      initialWorkspace={activeRoot?.path ?? null}
      initialCollapse={initialCollapse}
      savedCollapse={savedCollapse}
    />
  );
}
