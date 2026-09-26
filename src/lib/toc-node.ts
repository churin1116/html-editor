import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

// A note-style table of contents block: lists the document's h2/h3 headings
// as links, and keeps itself current while the document is edited.
//
// Like the link card, the saved file carries the *rendered* list, so it works
// read on its own (file://, no editor, no script). The node is an atom: the
// list inside is thrown away on parse and regenerated from the headings.
// The entries live in a non-rendered attribute that a plugin recomputes on
// every document change (and once on load), so renderHTML — which only sees
// the node, never the document — can still emit them.
//
// Links need anchors, so while a document contains a TOC every h2/h3 gets a
// stable id (assigned once, then saved with the heading; duplicates from
// copy-paste or a mid-heading split are reassigned). Documents without a TOC
// are left untouched.

export type TocEntry = { id: string; level: 2 | 3; text: string };

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    toc: {
      insertToc: () => ReturnType;
    };
  }
}

const TOC_LEVELS = new Set([2, 3]);
const tocKey = new PluginKey("toc");

function newHeadingId(taken: Set<string>): string {
  let id: string;
  do {
    id = `h-${Math.random().toString(36).slice(2, 8)}`;
  } while (taken.has(id));
  return id;
}

// Assign missing/duplicate ids and recompute every TOC node's entries.
// Returns null when nothing changed.
function syncToc(doc: PmNode, tr: Transaction): Transaction | null {
  const tocs: number[] = [];
  const headings: { pos: number; node: PmNode }[] = [];
  const taken = new Set<string>();
  doc.descendants((node, pos) => {
    if (node.type.name === "toc") tocs.push(pos);
    if (node.type.name === "heading") {
      headings.push({ pos, node });
      if (!TOC_LEVELS.has(node.attrs.level) && node.attrs.id) taken.add(node.attrs.id);
    }
  });
  if (tocs.length === 0) return null;

  let changed = false;
  const entries: TocEntry[] = [];
  for (const { pos, node } of headings) {
    if (!TOC_LEVELS.has(node.attrs.level)) continue;
    let id = node.attrs.id as string | null;
    if (!id || taken.has(id)) {
      id = newHeadingId(taken);
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, id });
      changed = true;
    }
    taken.add(id);
    const text = node.textContent.trim();
    if (text) entries.push({ id, level: node.attrs.level, text });
  }

  const serialized = JSON.stringify(entries);
  for (const pos of tocs) {
    const node = tr.doc.nodeAt(pos);
    if (!node || JSON.stringify(node.attrs.entries) === serialized) continue;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, entries });
    changed = true;
  }
  return changed ? tr : null;
}

function entriesToSpec(entries: TocEntry[]): DOMOutputSpec[] {
  const items: DOMOutputSpec[] = [];
  let parent: { link: DOMOutputSpec; children: DOMOutputSpec[] } | null = null;
  const flush = () => {
    if (!parent) return;
    const li: DOMOutputSpec[] = [parent.link];
    if (parent.children.length) li.push(["ol", {}, ...parent.children]);
    items.push(["li", { class: "toc-h2" }, ...li] as DOMOutputSpec);
    parent = null;
  };
  for (const e of entries) {
    const link: DOMOutputSpec = ["a", { href: `#${e.id}` }, e.text];
    if (e.level === 2) {
      flush();
      parent = { link, children: [] };
    } else if (parent) {
      parent.children.push(["li", { class: "toc-h3" }, link]);
    } else {
      items.push(["li", { class: "toc-h3" }, link]);
    }
  }
  flush();
  return items;
}

export const Toc = Node.create({
  name: "toc",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      entries: {
        default: [] as TocEntry[],
        rendered: false,
        // Regenerated from the headings; the saved list is only a snapshot.
        parseHTML: () => [],
      },
    };
  },

  parseHTML() {
    return [{ tag: "nav[data-toc]", priority: 100 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "nav",
      mergeAttributes(HTMLAttributes, { "data-toc": "", class: "toc", "aria-label": "目次" }),
      ["p", { class: "toc-title" }, "目次"],
      ["ol", { class: "toc-list" }, ...entriesToSpec(node.attrs.entries as TocEntry[])],
    ] as DOMOutputSpec;
  },

  addCommands() {
    return {
      // Beside the current block, never splitting it: an empty paragraph is
      // replaced, a caret at a block's start inserts before it, anywhere
      // else after it.
      insertToc:
        () =>
        ({ state, commands }) => {
          const { $from } = state.selection;
          const block = $from.parent;
          if ($from.depth === 0 || !block.isTextblock) {
            return commands.insertContent({ type: this.name });
          }
          if (block.content.size === 0) {
            return commands.insertContentAt(
              { from: $from.before(), to: $from.after() },
              { type: this.name },
            );
          }
          const at = $from.parentOffset === 0 ? $from.before() : $from.after();
          return commands.insertContentAt(at, { type: this.name });
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: tocKey,
        appendTransaction: (transactions, _old, state) => {
          const relevant = transactions.some((t) => t.docChanged || t.getMeta(tocKey));
          if (!relevant) return null;
          const tr = syncToc(state.doc, state.tr);
          // Derived bookkeeping, not an edit of its own: keep it out of undo.
          return tr ? tr.setMeta("addToHistory", false) : null;
        },
        // Parsed TOCs start empty; fill them once the view exists. Deferred
        // because dispatching during view construction is not allowed.
        view: (view) => {
          queueMicrotask(() => {
            if (!view.isDestroyed) {
              view.dispatch(view.state.tr.setMeta(tocKey, true).setMeta("preventUpdate", true));
            }
          });
          return {};
        },
        props: {
          // In the editor, follow a TOC link by scrolling the heading into
          // view instead of navigating the editor page's own URL hash.
          handleDOMEvents: {
            click: (view, event) => {
              const a = (event.target as HTMLElement).closest?.("nav[data-toc] a");
              if (!a) return false;
              event.preventDefault();
              const id = decodeURIComponent((a.getAttribute("href") ?? "").slice(1));
              const target = id ? view.dom.querySelector(`[id="${CSS.escape(id)}"]`) : null;
              target?.scrollIntoView({ behavior: "smooth", block: "start" });
              return true;
            },
          },
        },
      }),
    ];
  },
});
