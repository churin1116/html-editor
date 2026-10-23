import { Extension, type Editor as TiptapEditor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// Find & replace inside the open HTML document (find-bar.tsx is the UI). Two
// engines behind one interface: the Tiptap editor's (positions, decorations,
// transactions) and the rendered full-document view's (DOM ranges in the
// designMode iframe, CSS highlights, execCommand). Markdown files don't come
// here — CodeMirror brings its own search panel.
//
// A match can run across formatting (a bold word, a link) but not across a
// block: the search runs over each paragraph, heading, list item… on its own.

export type FindState = {
  count: number;
  // Index of the current match; -1 when there is none.
  current: number;
};

export type FindEngine = {
  // Finds every match and makes the first one at or after the caret current.
  search: (query: string, caseSensitive: boolean) => FindState;
  // Moves to the next (1) or previous (-1) match, wrapping around.
  step: (dir: 1 | -1) => FindState;
  // Replaces the current match and moves on to the next one.
  replace: (text: string) => FindState;
  // Replaces every match; returns how many were replaced.
  replaceAll: (text: string) => number;
  // Finds again after the document changed under the matches.
  refresh: () => FindState;
  // Removes the highlights (the bar was closed).
  clear: () => void;
  // Calls back on every edit to the document; returns the unsubscribe.
  onChange: (callback: () => void) => () => void;
  // The selected text, to start a search from (empty when it spans lines).
  selectedText: () => string;
  // Hands focus back to the document, the current match still selected.
  focus: () => void;
};

function pattern(query: string, caseSensitive: boolean): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
}

// ---- Tiptap -------------------------------------------------------------

type TextMatch = { from: number; to: number };
type FindMeta = { matches: TextMatch[]; current: number };

const findKey = new PluginKey<DecorationSet>("findReplace");

// Paints the matches as decorations (never written into the document). The
// engine hands it the matches in a transaction's meta; edits in between just
// carry the marks along until the engine finds again.
export const FindHighlight = Extension.create({
  name: "findHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: findKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(findKey) as FindMeta | undefined;
            if (meta) {
              return DecorationSet.create(
                tr.doc,
                meta.matches.map((m, i) =>
                  Decoration.inline(m.from, m.to, {
                    class: i === meta.current ? "find-match find-match-current" : "find-match",
                  }),
                ),
              );
            }
            return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
          },
        },
        props: {
          decorations: (state) => findKey.getState(state),
        },
      }),
    ];
  },
});

// Every match in the document, in order. Within a textblock, adjacent text
// nodes form one run (marks split the text, not the positions); any other
// inline node — a line break, an image — ends the run.
function findInDoc(doc: PmNode, query: string, caseSensitive: boolean): TextMatch[] {
  const matches: TextMatch[] = [];
  if (!query) return matches;
  const re = pattern(query, caseSensitive);
  doc.descendants((block, blockPos) => {
    if (!block.isTextblock) return true;
    let run = "";
    let runStart = 0;
    const flush = () => {
      for (const m of run.matchAll(re)) {
        const from = runStart + (m.index ?? 0);
        matches.push({ from, to: from + m[0].length });
      }
      run = "";
    };
    block.forEach((child, offset) => {
      const at = blockPos + 1 + offset;
      if (!child.isText) {
        flush();
        return;
      }
      if (run && runStart + run.length !== at) flush();
      if (!run) runStart = at;
      run += child.text ?? "";
    });
    flush();
    return false;
  });
  return matches;
}

export function createTiptapFindEngine(editor: TiptapEditor): FindEngine {
  let query = "";
  let caseSensitive = false;
  let matches: TextMatch[] = [];
  let current = -1;

  const state = (): FindState => ({ count: matches.length, current });
  // Shows the matches; with `select`, also selects the current one and
  // scrolls it into view.
  const show = (select: boolean) => {
    let tr = editor.state.tr.setMeta(findKey, { matches, current } satisfies FindMeta);
    const m = matches[current];
    if (select && m) {
      tr = tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView();
    }
    editor.view.dispatch(tr);
  };
  // Finds again; the current match becomes the first one at or after `near`.
  const recompute = (near: number) => {
    matches = findInDoc(editor.state.doc, query, caseSensitive);
    const at = matches.findIndex((m) => m.from >= near);
    current = matches.length === 0 ? -1 : at === -1 ? 0 : at;
  };

  return {
    search(q, cs) {
      query = q;
      caseSensitive = cs;
      recompute(editor.state.selection.from);
      show(current >= 0);
      return state();
    },
    step(dir) {
      if (matches.length > 0) {
        current = (current + dir + matches.length) % matches.length;
        show(true);
      }
      return state();
    },
    replace(text) {
      // Found again first: the document may have changed since the last
      // search, and stale positions would replace the wrong text.
      recompute(matches[current]?.from ?? editor.state.selection.from);
      const m = matches[current];
      if (!m) {
        show(false);
        return state();
      }
      editor.view.dispatch(editor.state.tr.insertText(text, m.from, m.to));
      recompute(m.from + text.length);
      show(current >= 0);
      return state();
    },
    replaceAll(text) {
      recompute(0);
      const count = matches.length;
      if (count === 0) return 0;
      // Back to front, in one transaction: one undo step, and positions ahead
      // of each replacement stay valid.
      let tr = editor.state.tr;
      for (const m of [...matches].reverse()) tr = tr.insertText(text, m.from, m.to);
      editor.view.dispatch(tr);
      recompute(0);
      show(false);
      return count;
    },
    refresh() {
      recompute(matches[current]?.from ?? editor.state.selection.from);
      show(false);
      return state();
    },
    clear() {
      query = "";
      matches = [];
      current = -1;
      if (!editor.isDestroyed) show(false);
    },
    onChange(callback) {
      // Tiptap fires "update" only when the document changed — not for the
      // engine's own decoration-only transactions, which would loop.
      editor.on("update", callback);
      return () => {
        editor.off("update", callback);
      };
    },
    selectedText() {
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from, to, "\n");
      return text.includes("\n") ? "" : text;
    },
    focus() {
      if (!editor.isDestroyed) editor.view.focus();
    },
  };
}

// ---- Rendered full document (designMode iframe) --------------------------

// Where a text node's run of text ends: a match can cross inline elements but
// not one of these.
const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "BODY",
  "CAPTION",
  "DD",
  "DETAILS",
  "DIV",
  "DL",
  "DT",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "SUMMARY",
  "TABLE",
  "TD",
  "TH",
  "TR",
  "UL",
]);
const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA"]);
const HIGHLIGHT = "he-find";
const HIGHLIGHT_CURRENT = "he-find-current";

function blockOf(node: Node): Element | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (BLOCK_TAGS.has(el.tagName)) return el;
  }
  return null;
}

// Every visible match in the body, as ranges in document order. Text the
// editor itself injects ([data-he-ui]) and text nobody can see (a closed
// <details>, an inactive tab) are left out — there would be nothing to show.
function findInDom(doc: Document, query: string, caseSensitive: boolean): Range[] {
  const ranges: Range[] = [];
  if (!query || !doc.body) return ranges;
  const re = pattern(query, caseSensitive);
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || SKIPPED_TAGS.has(parent.tagName) || parent.closest("[data-he-ui]")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let block: Element | null = null;
  let nodes: Text[] = [];
  const flush = () => {
    if (nodes.length === 0) return;
    const text = nodes.map((n) => n.data).join("");
    // Where each node's text starts in `text`.
    const starts: number[] = [];
    let acc = 0;
    for (const n of nodes) {
      starts.push(acc);
      acc += n.data.length;
    }
    const locate = (offset: number, end: boolean): [Text, number] => {
      // An end offset belongs to the node it closes, not the next one.
      let i = nodes.length - 1;
      while (i > 0 && (end ? starts[i] >= offset : starts[i] > offset)) i--;
      return [nodes[i], offset - starts[i]];
    };
    for (const m of text.matchAll(re)) {
      const from = m.index ?? 0;
      const range = doc.createRange();
      range.setStart(...locate(from, false));
      range.setEnd(...locate(from + m[0].length, true));
      // checkVisibility, not client rects: Chrome still lays out the inside
      // of a closed <details>, and a match there can't be shown or edited.
      if (range.startContainer.parentElement?.checkVisibility()) ranges.push(range);
    }
    nodes = [];
  };
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const b = blockOf(node);
    if (b !== block) {
      flush();
      block = b;
    }
    nodes.push(node as Text);
  }
  flush();
  return ranges;
}

export function createDomFindEngine(doc: Document): FindEngine {
  const win = doc.defaultView;
  // Highlights are painted by the CSS Custom Highlight API: nothing is added
  // to the DOM, so nothing can end up in a save. The colors live in a
  // constructed sheet for the same reason.
  const registry = win?.CSS.highlights;
  if (win) {
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync(
      `::highlight(${HIGHLIGHT}) { background-color: color-mix(in srgb, var(--warning, #e8a400) 35%, transparent); }` +
        `::highlight(${HIGHLIGHT_CURRENT}) { background-color: color-mix(in srgb, var(--warning, #e8a400) 75%, transparent); }`,
    );
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
  }

  let query = "";
  let caseSensitive = false;
  let ranges: Range[] = [];
  let current = -1;

  const state = (): FindState => ({ count: ranges.length, current });
  const paint = () => {
    if (!registry || !win) return;
    registry.set(HIGHLIGHT, new win.Highlight(...ranges));
    const cur = ranges[current];
    if (cur) registry.set(HIGHLIGHT_CURRENT, new win.Highlight(cur));
    else registry.delete(HIGHLIGHT_CURRENT);
  };
  // Scrolls the current match to the middle of the view. It isn't selected
  // until the bar closes: a selection here pops up the formatting toolbar.
  const reveal = () => {
    const cur = ranges[current];
    if (!cur || !win) return;
    const rect = cur.getBoundingClientRect();
    win.scrollBy({ top: rect.top - win.innerHeight / 2 });
  };
  const recompute = (near: Range | null) => {
    ranges = findInDom(doc, query, caseSensitive);
    const at = near
      ? ranges.findIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, near) >= 0)
      : -1;
    current = ranges.length === 0 ? -1 : at === -1 ? 0 : at;
  };
  const caret = (): Range | null => {
    const sel = doc.getSelection();
    return sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  };
  // Through execCommand so the browser records it for ⌘Z and fires the
  // `input` event the view saves from. execCommand acts on the focused
  // document, so the iframe takes focus for it; the bar takes it back.
  const replaceRange = (range: Range, text: string) => {
    win?.focus();
    const sel = doc.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    if (text) doc.execCommand("insertText", false, text);
    else doc.execCommand("delete");
  };

  return {
    search(q, cs) {
      query = q;
      caseSensitive = cs;
      // Typing on in the field keeps going from the match already reached;
      // the first search starts from the caret.
      recompute(ranges[current] ?? caret());
      paint();
      reveal();
      return state();
    },
    step(dir) {
      if (ranges.length > 0) {
        current = (current + dir + ranges.length) % ranges.length;
        paint();
        reveal();
      }
      return state();
    },
    replace(text) {
      // Found again first: an edit since the last search may have changed
      // what the range holds.
      recompute(ranges[current] ?? caret());
      const cur = ranges[current];
      if (!cur) {
        paint();
        return state();
      }
      replaceRange(cur, text);
      // The caret now sits right after the replacement.
      recompute(caret());
      paint();
      reveal();
      return state();
    },
    replaceAll(text) {
      recompute(null);
      const count = ranges.length;
      // Back to front, so the ranges still ahead stay where they were.
      for (const range of [...ranges].reverse()) replaceRange(range, text);
      recompute(null);
      paint();
      return count;
    },
    refresh() {
      recompute(ranges[current] ?? caret());
      paint();
      return state();
    },
    clear() {
      query = "";
      ranges = [];
      current = -1;
      registry?.delete(HIGHLIGHT);
      registry?.delete(HIGHLIGHT_CURRENT);
    },
    onChange(callback) {
      doc.addEventListener("input", callback);
      return () => doc.removeEventListener("input", callback);
    },
    selectedText() {
      const text = doc.getSelection()?.toString() ?? "";
      return text.includes("\n") ? "" : text;
    },
    focus() {
      const cur = ranges[current];
      if (cur) {
        const sel = doc.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(cur.cloneRange());
      }
      win?.focus();
    },
  };
}
