// Table of contents for plain DOM documents — html-editor's designMode view of
// hand-written files, where there is no TipTap schema. Produces the same
// markup as the TipTap Toc node (toc-node.ts): keep the two in sync.
//
//   <nav data-toc class="toc" aria-label="目次">
//     <p class="toc-title">目次</p>
//     <ol class="toc-list"><li class="toc-h2"><a href="#id">…</a><ol>…h3…</ol></li></ol>
//   </nav>
//
// The list is derived from the document's h2/h3 and rebuilt whenever they
// change (the caller observes mutations), so the saved file always carries a
// current snapshot that works with no script. Headings get a stable id
// (h-xxxxxx) while the document has a TOC. In the live document the nav is
// contenteditable=false so its text can't be typed into; that attribute is
// editor-only and stripped on save (see stripTocEditingAttrs).

export const TOC_SELECTOR = "nav[data-toc]";

type Entry = { id: string; level: 2 | 3; text: string };

function headingsOf(doc: Document): HTMLElement[] {
  return Array.from(doc.body.querySelectorAll<HTMLElement>("h2, h3")).filter(
    (h) => !h.closest(`${TOC_SELECTOR}, [data-he-ui]`) && h.textContent?.trim(),
  );
}

function newHeadingId(doc: Document): string {
  let id: string;
  do {
    id = `h-${Math.random().toString(36).slice(2, 8)}`;
  } while (doc.getElementById(id));
  return id;
}

// Give every listed heading a unique id; a heading repeating an earlier
// heading's id (copy-paste, a split heading) gets a fresh one.
function ensureIds(doc: Document, headings: HTMLElement[]): Entry[] {
  const seen = new Set<string>();
  return headings.map((h) => {
    if (!h.id || seen.has(h.id)) h.id = newHeadingId(doc);
    seen.add(h.id);
    return {
      id: h.id,
      level: h.tagName === "H2" ? 2 : 3,
      text: (h.textContent ?? "").trim().replace(/\s+/g, " "),
    };
  });
}

function buildList(doc: Document, entries: Entry[]): HTMLOListElement {
  const list = doc.createElement("ol");
  list.className = "toc-list";
  let parentItem: HTMLLIElement | null = null;
  let sublist: HTMLOListElement | null = null;
  const item = (e: Entry) => {
    const li = doc.createElement("li");
    li.className = `toc-h${e.level}`;
    const a = doc.createElement("a");
    a.href = `#${e.id}`;
    a.textContent = e.text;
    li.appendChild(a);
    return li;
  };
  for (const e of entries) {
    if (e.level === 2) {
      parentItem = item(e);
      sublist = null;
      list.appendChild(parentItem);
    } else if (parentItem) {
      if (!sublist) {
        sublist = doc.createElement("ol");
        parentItem.appendChild(sublist);
      }
      sublist.appendChild(item(e));
    } else {
      list.appendChild(item(e));
    }
  }
  return list;
}

// Bring every TOC in the document up to date. Returns true when the DOM
// changed (so the caller can report an edit).
export function syncDomTocs(doc: Document): boolean {
  const navs = Array.from(doc.querySelectorAll<HTMLElement>(TOC_SELECTOR));
  if (navs.length === 0 || !doc.body) return false;
  const before = navs.map((n) => n.innerHTML).join("\n");
  const idsBefore = headingsOf(doc)
    .map((h) => h.id)
    .join(" ");
  const entries = ensureIds(doc, headingsOf(doc));
  const idsChanged = entries.map((e) => e.id).join(" ") !== idsBefore;
  for (const nav of navs) {
    nav.setAttribute("contenteditable", "false");
    const title = doc.createElement("p");
    title.className = "toc-title";
    title.textContent = "目次";
    const next = doc.createElement("div");
    next.append(title, buildList(doc, entries));
    if (nav.innerHTML !== next.innerHTML) nav.replaceChildren(...Array.from(next.childNodes));
  }
  return idsChanged || navs.map((n) => n.innerHTML).join("\n") !== before;
}

const LIST_ITEM = "li, dt, dd, td, th";
const LIST_BLOCK = "ul, ol, dl, table";
const BLOCK = "p, h1, h2, h3, h4, h5, h6, pre, blockquote, figure, details, hr";

// Insert a TOC beside the block holding the caret, never splitting it: an
// empty paragraph is replaced, a list/table item puts it after the whole
// list/table, anything else goes right after the block.
export function insertDomToc(doc: Document): void {
  const nav = doc.createElement("nav");
  nav.setAttribute("data-toc", "");
  nav.className = "toc";
  nav.setAttribute("aria-label", "目次");

  const sel = doc.getSelection();
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  const node = range?.startContainer ?? null;
  const el = node
    ? node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement
    : null;
  const block = el?.closest(LIST_ITEM) ? el.closest(LIST_BLOCK) : el?.closest(BLOCK);

  if (block && !block.closest(TOC_SELECTOR)) {
    const empty = block.matches("p") && !block.textContent?.trim() && !block.querySelector("img");
    if (empty) block.replaceWith(nav);
    else block.after(nav);
  } else if (range && el && doc.body.contains(el)) {
    range.collapse(true);
    range.insertNode(nav);
  } else {
    doc.body.appendChild(nav);
  }
  syncDomTocs(doc);
}

// Editor-only attributes on a TOC, removed from the serialized copy.
export function stripTocEditingAttrs(root: Element): void {
  for (const nav of root.querySelectorAll(TOC_SELECTOR)) nav.removeAttribute("contenteditable");
}
