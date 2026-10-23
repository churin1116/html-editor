// Which sidebar folders are open or closed, persisted in
// ~/.config/html-editor/sidebar-collapse.json. The page reads it on the
// server, so the first paint already shows the saved layout.
//
// This used to live in a cookie. Cookies cap at ~4KB, and with absolute paths
// only about twenty closed folders fit; past that the trim dropped the most
// recently closed ones, which then reopened on the next load. A file has no
// such limit.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type SidebarCollapse = {
  // Shortcut folders, keyed by id (true = closed).
  folders: Record<string, boolean>;
  // Directories inside a root's file tree, keyed by absolute path. An entry
  // is an explicit user choice (true = closed, false = open); directories
  // without one fall back to their root's default (see dirDefaultClosed).
  dirs: Record<string, boolean>;
  // Roots whose tree directories default to collapsed — set when a root is
  // added, so a freshly registered tree starts fully closed. Only the dirs
  // the user then opens are stored (as explicit `false` entries).
  dirDefaultClosed: string[];
  // The whole Shortcuts section.
  shortcuts: boolean;
};

// What one save changes. The sidebar sends only this, never its whole state,
// so a tab (or browser) that loaded earlier can't undo another one's folds.
// In `folders` and `dirs`, null removes the entry.
export type SidebarCollapsePatch = {
  folders?: Record<string, boolean | null>;
  dirs?: Record<string, boolean | null>;
  dirDefaultClosed?: { add: string[]; remove: string[] };
  shortcuts?: boolean;
};

// On disk only the exceptions are kept: a directory whose entry matches its
// root's default anyway is left out.
type StoredCollapse = {
  closedDirs: string[];
  openedDirs: string[];
  dirDefaultClosed: string[];
  closedShortcutFolders: string[];
  shortcutsClosed: boolean;
};

const CONFIG_DIR = path.join(homedir(), ".config", "html-editor");
const COLLAPSE_PATH = path.join(CONFIG_DIR, "sidebar-collapse.json");

function emptyCollapse(): SidebarCollapse {
  return { folders: {}, dirs: {}, dirDefaultClosed: [], shortcuts: false };
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function changeMap(v: unknown): Record<string, boolean | null> | null {
  if (!isObject(v)) return null;
  const out: Record<string, boolean | null> = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "boolean" || val === null) out[k] = val;
  }
  return out;
}

// Validates a patch the sidebar sent; null when the body isn't one.
export function parseSidebarCollapsePatch(raw: unknown): SidebarCollapsePatch | null {
  if (!isObject(raw)) return null;
  const patch: SidebarCollapsePatch = {};
  for (const key of ["folders", "dirs"] as const) {
    if (raw[key] === undefined) continue;
    const changes = changeMap(raw[key]);
    if (!changes) return null;
    patch[key] = changes;
  }
  if (raw.dirDefaultClosed !== undefined) {
    const d = raw.dirDefaultClosed;
    if (!isObject(d) || !Array.isArray(d.add) || !Array.isArray(d.remove)) return null;
    patch.dirDefaultClosed = { add: strings(d.add), remove: strings(d.remove) };
  }
  if (raw.shortcuts !== undefined) {
    if (typeof raw.shortcuts !== "boolean") return null;
    patch.shortcuts = raw.shortcuts;
  }
  return patch;
}

function applyChanges(
  current: Record<string, boolean>,
  changes: Record<string, boolean | null> | undefined,
): Record<string, boolean> {
  if (!changes) return current;
  const next: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(current)) if (!Object.hasOwn(changes, k)) next[k] = v;
  for (const [k, v] of Object.entries(changes)) if (v !== null) next[k] = v;
  return next;
}

function toStored(state: SidebarCollapse): StoredCollapse {
  const underDefaultClosedRoot = (p: string) =>
    state.dirDefaultClosed.some((root) => p === root || p.startsWith(`${root}/`));
  const dirs = Object.keys(state.dirs);
  return {
    // "Closed" under a default-open root, "opened" under a default-closed one.
    closedDirs: dirs.filter((k) => state.dirs[k] && !underDefaultClosedRoot(k)),
    openedDirs: dirs.filter((k) => !state.dirs[k] && underDefaultClosedRoot(k)),
    dirDefaultClosed: state.dirDefaultClosed,
    closedShortcutFolders: Object.keys(state.folders).filter((k) => state.folders[k]),
    shortcutsClosed: state.shortcuts,
  };
}

function fromStored(raw: unknown): SidebarCollapse {
  const s = isObject(raw) ? raw : {};
  const state = emptyCollapse();
  for (const k of strings(s.closedDirs)) state.dirs[k] = true;
  for (const k of strings(s.openedDirs)) state.dirs[k] = false;
  for (const k of strings(s.closedShortcutFolders)) state.folders[k] = true;
  state.dirDefaultClosed = strings(s.dirDefaultClosed);
  state.shortcuts = s.shortcutsClosed === true;
  return state;
}

// The old cookie's compact payload: d = closed dirs, o = opened dirs,
// dd = default-closed roots, f = closed shortcut folders, s = Shortcuts closed.
function fromLegacyCookie(value: string): SidebarCollapse | null {
  try {
    const p = JSON.parse(decodeURIComponent(value)) as Record<string, unknown>;
    return fromStored({
      closedDirs: p.d,
      openedDirs: p.o,
      dirDefaultClosed: p.dd,
      closedShortcutFolders: p.f,
      shortcutsClosed: p.s === 1,
    });
  } catch {
    return null;
  }
}

async function readSaved(): Promise<SidebarCollapse | null> {
  try {
    return fromStored(JSON.parse(await readFile(COLLAPSE_PATH, "utf8")));
  } catch {
    return null;
  }
}

// `legacyCookie` is the old `sidebarCollapse` cookie, used until the first
// save has moved its contents into the file (the sidebar then deletes it).
export async function loadSidebarCollapse(legacyCookie?: string): Promise<SidebarCollapse> {
  return (
    (await readSaved()) ?? (legacyCookie ? fromLegacyCookie(legacyCookie) : null) ?? emptyCollapse()
  );
}

// Patches are applied one at a time, so two arriving together (from two
// tabs) can't both read the old file and lose one of the changes.
let queue: Promise<unknown> = Promise.resolve();

export function patchSidebarCollapse(patch: SidebarCollapsePatch): Promise<void> {
  const run = queue.then(async () => {
    const state = (await readSaved()) ?? emptyCollapse();
    state.folders = applyChanges(state.folders, patch.folders);
    state.dirs = applyChanges(state.dirs, patch.dirs);
    if (patch.dirDefaultClosed) {
      const { add, remove } = patch.dirDefaultClosed;
      const kept = state.dirDefaultClosed.filter((r) => !remove.includes(r));
      state.dirDefaultClosed = [...kept, ...add.filter((r) => !kept.includes(r))];
    }
    if (patch.shortcuts !== undefined) state.shortcuts = patch.shortcuts;
    await writeSaved(state);
  });
  queue = run.catch(() => {});
  return run;
}

// Writes a temp file and renames it over the old one, so a page rendering
// mid-save never reads half a file and shows every folder open.
async function writeSaved(state: SidebarCollapse): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const tmp = `${COLLAPSE_PATH}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(toStored(state), null, 2)}\n`, "utf8");
    await rename(tmp, COLLAPSE_PATH);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
