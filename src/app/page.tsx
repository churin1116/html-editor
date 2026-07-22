import { EditorShell } from "@/components/editor-shell";
import type { SidebarCollapse } from "@/components/sidebar";
import { loadAllowedRoots } from "@/lib/allowed-roots";
import { loadFileFromDisk } from "@/lib/load-file";
import { loadShortcutTreeWithStatus } from "@/lib/shortcuts";
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
  const initialTrees: Record<string, TreeEntry[]> = {};
  const initialRootErrors: Record<string, string> = {};
  await Promise.all(
    visibleRoots.map(async (root) => {
      const result = await loadTreeForRoot(root.path);
      if ("error" in result) initialRootErrors[root.path] = result.error;
      else initialTrees[root.path] = result.tree;
    }),
  );

  const initialShortcuts = await loadShortcutTreeWithStatus();

  // Collapse state (roots / shortcut folders / tree directories) is stored in
  // a cookie as compact arrays of collapsed keys, so the first paint renders
  // folders already closed instead of collapsing them after hydration.
  const initialCollapse: SidebarCollapse = {
    roots: {},
    folders: {},
    dirs: {},
    dirDefaultClosed: [],
    shortcuts: false,
  };
  const rawCollapse = cookieStore.get("sidebarCollapse")?.value ?? "";
  if (rawCollapse) {
    try {
      const parsed = JSON.parse(decodeURIComponent(rawCollapse)) as {
        r?: string[];
        f?: string[];
        d?: string[];
        o?: string[];
        dd?: string[];
        s?: 0 | 1;
      };
      for (const k of parsed.r ?? []) initialCollapse.roots[k] = true;
      for (const k of parsed.f ?? []) initialCollapse.folders[k] = true;
      for (const k of parsed.d ?? []) initialCollapse.dirs[k] = true;
      for (const k of parsed.o ?? []) initialCollapse.dirs[k] = false;
      initialCollapse.dirDefaultClosed = parsed.dd ?? [];
      initialCollapse.shortcuts = parsed.s === 1;
    } catch {
      // Corrupt cookie — fall back to the default all-open state.
    }
  }

  return (
    <EditorShell
      initialSelected={initialSelected}
      initialFile={initialFile}
      initialSidebarOpen={initialSidebarOpen}
      initialRoots={roots}
      initialTrees={initialTrees}
      initialRootErrors={initialRootErrors}
      initialShortcuts={initialShortcuts}
      initialWorkspace={activeRoot?.path ?? null}
      initialCollapse={initialCollapse}
    />
  );
}
