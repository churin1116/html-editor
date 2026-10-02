import { toast } from "sonner";

// ⌘+click (Ctrl+click elsewhere) follows a link from inside either HTML
// editor. A plain click stays an editing gesture — it puts the caret in the
// link text or selects a link card — so leaving the spot being edited always
// takes the modifier, as in VS Code / Obsidian. Shared by the Tiptap editor
// (editor.tsx) and the rendered full-document view (html-source.tsx).

export type LinkTarget =
  | { kind: "external"; url: string }
  | { kind: "anchor"; id: string }
  | { kind: "file"; path: string }
  | { kind: "unsupported"; href: string };

export function isLinkOpenClick(e: MouseEvent): boolean {
  return e.button === 0 && (e.metaKey || e.ctrlKey);
}

// The href of the link under a click. A link card counts as a link anywhere
// on the card: the Tiptap view sets its anchor to pointer-events: none (the
// card is a block to select and drag), so the click lands on the wrapper.
export function linkHrefAt(target: EventTarget | null): string | null {
  const el = target as Element | null;
  if (!el?.closest) return null;
  const a = el.closest("a[href]") ?? el.closest("[data-link-card]")?.querySelector("a[href]");
  return a?.getAttribute("href") ?? null;
}

const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
// The extensions the editor opens (format.ts has the same list, but it is
// server-only — node:path).
const EDITABLE_EXT = /\.(html?|md|markdown)$/i;

function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Resolve an href the way the saved file would when opened on its own:
// relative to the file's own location on disk, not to the editor's localhost
// URL. Links into another .html/.md open that file in the editor; anything
// else on disk (a PDF, an image) has no way to open from here.
export function resolveLinkHref(href: string, currentPath: string | undefined): LinkTarget {
  const raw = href.trim();
  if (raw.startsWith("#")) return { kind: "anchor", id: decode(raw.slice(1)) };
  // Segment-wise encoding so a "#" or "?" in a folder name stays part of the path.
  const base = currentPath
    ? `file://${currentPath.split("/").map(encodeURIComponent).join("/")}`
    : undefined;
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return { kind: "unsupported", href: raw };
  }
  if (EXTERNAL_PROTOCOLS.has(url.protocol)) return { kind: "external", url: url.href };
  if (url.protocol !== "file:") return { kind: "unsupported", href: raw };
  const path = decode(url.pathname);
  if (path === currentPath && url.hash) return { kind: "anchor", id: decode(url.hash.slice(1)) };
  return EDITABLE_EXT.test(path) ? { kind: "file", path } : { kind: "unsupported", href: raw };
}

// The element an in-page link points at: an id, or an old-style <a name>.
function findAnchorTarget(root: ParentNode, id: string): Element | null {
  if (!id) return null;
  return (
    root.querySelector(`[id="${CSS.escape(id)}"]`) ??
    root.querySelector(`a[name="${CSS.escape(id)}"]`)
  );
}

// Act on a resolved link: a web URL opens in a new browser tab, an in-page
// anchor scrolls `root`'s document, another note opens in the editor.
export function followLink(
  target: LinkTarget,
  { root, openFile }: { root: ParentNode; openFile?: (path: string) => void },
) {
  switch (target.kind) {
    case "external":
      window.open(target.url, "_blank", "noopener,noreferrer");
      return;
    case "anchor": {
      const el = findAnchorTarget(root, target.id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else toast.error(`リンク先 #${target.id} が見つかりません`);
      return;
    }
    case "file":
      if (openFile) openFile(target.path);
      else toast.error("このリンクはエディタから開けません");
      return;
    case "unsupported":
      toast.error(`このリンクはエディタから開けません: ${target.href}`);
  }
}

// Report whether the modifier is held, so links can look clickable while it
// is. Mouse events carry the modifier state too, so holding ⌘ before the
// pointer enters the editor (focus elsewhere) still shows it.
export function trackLinkModifier(doc: Document, onHeld: (held: boolean) => void): () => void {
  const win = doc.defaultView;
  let held = false;
  const set = (next: boolean) => {
    if (next === held) return;
    held = next;
    onHeld(next);
  };
  const sync = (e: KeyboardEvent | MouseEvent) => set(e.metaKey || e.ctrlKey);
  const clear = () => set(false);
  doc.addEventListener("keydown", sync, true);
  doc.addEventListener("keyup", sync, true);
  doc.addEventListener("mousemove", sync, true);
  win?.addEventListener("blur", clear);
  return () => {
    doc.removeEventListener("keydown", sync, true);
    doc.removeEventListener("keyup", sync, true);
    doc.removeEventListener("mousemove", sync, true);
    win?.removeEventListener("blur", clear);
    clear();
  };
}
