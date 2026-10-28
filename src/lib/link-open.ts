import { toast } from "sonner";

// Following a link from inside either HTML editor. Shared by the Tiptap
// editor (editor.tsx) and the rendered full-document view (html-source.tsx).
//
// A click on a text link follows it — no modifier needed. Its text is edited
// by putting the caret in the plain text beside it and moving in with the
// arrow keys. Shift / Option clicks stay editing gestures (extend the
// selection). A link card is a block to select and drag, so a plain click
// still selects it and ⌘+click (Ctrl+click elsewhere) follows it.
//
// A link to a page on disk opens in the editor, unless it says
// target="_blank": then the page opens read-only in a new browser tab
// (/api/view), the way a reference page beside a script is meant to be read.

export type LinkTarget =
  | { kind: "external"; url: string }
  | { kind: "anchor"; id: string }
  | { kind: "file"; path: string }
  | { kind: "view"; url: string }
  | { kind: "unsupported"; href: string };

export type LinkToOpen = { href: string; newTab: boolean };

// The link a click should follow, or null to leave the click to the editor.
// A link card counts anywhere on the card: the Tiptap view sets its anchor to
// pointer-events: none, so the click lands on the wrapper. An href that goes
// nowhere ("#", javascript:) belongs to a page script, which keeps the click.
export function linkHrefToOpen(e: MouseEvent): LinkToOpen | null {
  if (e.button !== 0 || e.shiftKey || e.altKey) return null;
  const el = e.target as Element | null;
  if (!el?.closest) return null;
  const card = el.closest("[data-link-card]");
  const a = card
    ? e.metaKey || e.ctrlKey
      ? card.querySelector("a[href]")
      : null
    : el.closest("a[href]");
  const href = a?.getAttribute("href")?.trim();
  if (!href || href === "#" || /^javascript:/i.test(href)) return null;
  return { href, newTab: a?.getAttribute("target") === "_blank" };
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
// else on disk (a PDF, an image) has no way to open from here — unless the
// link asks for a new tab, which shows any file under the roots as it is.
export function resolveLinkHref(
  { href, newTab }: LinkToOpen,
  currentPath: string | undefined,
): LinkTarget {
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
  if (newTab) return { kind: "view", url: `/api/view${url.pathname}${url.hash}` };
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
// anchor jumps `root`'s document there instantly (long scripts link the top
// and the far end, where a smooth scroll only makes you wait), another note
// opens in the editor, and a page asked for in a new tab opens there to read.
export function followLink(
  target: LinkTarget,
  { root, openFile }: { root: ParentNode; openFile?: (path: string) => void },
) {
  switch (target.kind) {
    case "external":
      window.open(target.url, "_blank", "noopener,noreferrer");
      return;
    case "view":
      window.open(target.url, "_blank", "noopener,noreferrer");
      return;
    case "anchor": {
      const el = findAnchorTarget(root, target.id);
      if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
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

// Report whether the modifier is held, so link cards can look clickable while
// it is. Mouse events carry the modifier state too, so holding ⌘ before the
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
