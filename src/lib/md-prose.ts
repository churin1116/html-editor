// Obsidian-style "live" styling for the raw Markdown editor (CodeMirror).
// The document stays plain Markdown — nothing here rewrites text. We only
// style it so the editing view reads like the Chameleon prose output
// (prose-css.ts): real heading sizes, prose font, styled quotes/code/links,
// with the marker characters (#, **, >) kept visible but dimmed.
//
// Two layers:
//   1. mdProseHighlight — token-level styles (bold, emphasis, code, links,
//      markers) via a HighlightStyle over the lezer markdown tags.
//   2. mdProseLines — line-level decorations walked off the syntax tree
//      (heading sizes, blockquote border, code-block background, tables in
//      monospace), because token classes never cover a whole line — e.g.
//      the "#" marker sits outside the heading token, but should share the
//      heading's font size.
//   3. mdConceal — Obsidian-style live preview: marker characters are hidden
//      (## , > , **, `, ~~, link URLs) or replaced (- → •, [ ] → checkbox,
//      --- → drawn rule) unless the cursor is on that line (for line markers)
//      or inside that span (for inline markers), where the raw source
//      reappears for editing.
// A leading YAML frontmatter block is detected by hand (the lezer markdown
// parser has no frontmatter support, so `last_updated: x` + `---` would
// otherwise render as a giant setext heading) and shown as dimmed monospace.
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { PROSE_HEADING_SIZES, PROSE_MONO_FONT } from "./prose-css";

const mdProseHighlight = HighlightStyle.define([
  // Covers table headers; heading1-6 lines get their weight from the line
  // class, this just keeps token-level consistency.
  { tag: tags.heading, fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  // em renders as boten dots to match the saved Chameleon HTML (prose-css.ts).
  { tag: tags.emphasis, class: "cm-md-em" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.monospace, class: "cm-md-mono" },
  { tag: tags.link, class: "cm-md-link" },
  { tag: tags.url, color: "var(--text-subtle)" },
  { tag: tags.quote, color: "var(--text-muted)" },
  // Marker characters: #, **, >, -, ```, [], etc.
  { tag: tags.processingInstruction, color: "var(--text-subtle)" },
  { tag: tags.meta, color: "var(--text-subtle)" },
  { tag: tags.contentSeparator, color: "var(--text-subtle)" },
]);

const mdProseBaseTheme = EditorView.baseTheme({
  ...Object.fromEntries(
    PROSE_HEADING_SIZES.map((size, i) => [
      `.cm-md-h${i + 1}`,
      { fontSize: size, fontWeight: "600", lineHeight: "1.3", paddingTop: "1em" },
    ]),
  ),
  ".cm-md-blockquote": {
    borderLeft: "4px solid var(--border-strong)",
    paddingLeft: "1em",
    color: "var(--text-muted)",
  },
  ".cm-md-codeblock": {
    background: "var(--surface-2)",
    fontFamily: PROSE_MONO_FONT,
    fontSize: "0.9em",
    lineHeight: "1.6",
  },
  ".cm-md-table": {
    fontFamily: PROSE_MONO_FONT,
    fontSize: "0.9em",
  },
  ".cm-md-frontmatter": {
    fontFamily: PROSE_MONO_FONT,
    fontSize: "0.85em",
    color: "var(--text-subtle)",
    fontWeight: "normal",
  },
  ".cm-md-em": {
    WebkitTextEmphasisStyle: "filled dot",
    textEmphasisStyle: "filled dot",
  },
  ".cm-md-mono": {
    fontFamily: PROSE_MONO_FONT,
    background: "var(--surface-2)",
    padding: "0.05em 0.3em",
    borderRadius: "3px",
    fontSize: "0.9em",
  },
  // Inside a code block the line already paints the background; strip the
  // inline-code chip look so block code reads as one surface.
  ".cm-md-codeblock .cm-md-mono": {
    background: "none",
    padding: "0",
    borderRadius: "0",
    fontSize: "1em",
  },
  ".cm-md-link": {
    color: "var(--text)",
    textDecoration: "underline",
    textUnderlineOffset: "3px",
    textDecorationColor: "var(--border-strong)",
  },
  ".cm-md-bullet": {
    color: "var(--text-muted)",
  },
  ".cm-md-task": {
    color: "var(--text-muted)",
  },
  ".cm-md-hrline": {
    display: "inline-block",
    width: "100%",
    height: "1px",
    background: "var(--border)",
    verticalAlign: "middle",
  },
  // Rendered-table widget — mirrors .prose-canvas table in prose-css.ts.
  ".cm-md-tablewidget": {
    padding: "0.5em 4px",
  },
  ".cm-md-tablewidget table": {
    borderCollapse: "collapse",
    width: "100%",
  },
  ".cm-md-tablewidget th, .cm-md-tablewidget td": {
    border: "1px solid var(--border)",
    padding: "0.5em 0.75em",
    textAlign: "left",
    cursor: "text",
  },
  ".cm-md-tablewidget th": {
    background: "var(--surface)",
    fontWeight: "600",
  },
});

const LINE_CLASSES: Record<string, string> = {
  ATXHeading1: "cm-md-h1",
  ATXHeading2: "cm-md-h2",
  ATXHeading3: "cm-md-h3",
  ATXHeading4: "cm-md-h4",
  ATXHeading5: "cm-md-h5",
  ATXHeading6: "cm-md-h6",
  SetextHeading1: "cm-md-h1",
  SetextHeading2: "cm-md-h2",
  Blockquote: "cm-md-blockquote",
  FencedCode: "cm-md-codeblock",
  CodeBlock: "cm-md-codeblock",
  Table: "cm-md-table",
};

const lineDecoCache = new Map<string, Decoration>();
function lineDeco(cls: string): Decoration {
  let deco = lineDecoCache.get(cls);
  if (!deco) {
    deco = Decoration.line({ class: cls });
    lineDecoCache.set(cls, deco);
  }
  return deco;
}

// Returns the last line number of a leading YAML frontmatter block, or 0.
// Only scans the first 100 lines — real frontmatter is small, and an
// unterminated opening "---" should stay a horizontal rule.
function frontmatterEndLine(state: EditorState): number {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") return 0;
  const max = Math.min(doc.lines, 100);
  for (let n = 2; n <= max; n++) {
    const t = doc.line(n).text.trim();
    if (t === "---" || t === "...") return n;
  }
  return 0;
}

function buildLineDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const decos: Range<Decoration>[] = [];
  const fmEnd = frontmatterEndLine(view.state);
  for (let n = 1; n <= fmEnd; n++) {
    decos.push(lineDeco("cm-md-frontmatter").range(doc.line(n).from));
  }
  // A node can span two visibleRanges (entered once per range) and a line can
  // host nested nodes — dedup per (line, class).
  const seen = new Set<string>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const cls = LINE_CLASSES[node.name];
        if (!cls) return;
        const first = doc.lineAt(node.from).number;
        const last = doc.lineAt(node.to).number;
        for (let n = first; n <= last; n++) {
          if (n <= fmEnd) continue;
          const key = `${n}:${cls}`;
          if (seen.has(key)) continue;
          seen.add(key);
          decos.push(lineDeco(cls).range(doc.line(n).from));
        }
      },
    });
  }
  return Decoration.set(decos, true);
}

const mdProseLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLineDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = buildLineDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ---------------------------------------------------------------------------
// Marker concealment (Obsidian live preview)

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-bullet";
    span.textContent = "•";
    return span;
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: TaskWidget): boolean {
    return other.checked === this.checked;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-task";
    span.textContent = this.checked ? "☑" : "☐";
    return span;
  }
}

class HrWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-md-hrline";
    return span;
  }
}

const hideDeco = Decoration.replace({});
const bulletDeco = Decoration.replace({ widget: new BulletWidget() });
const taskDeco = Decoration.replace({ widget: new TaskWidget(false) });
const taskDoneDeco = Decoration.replace({ widget: new TaskWidget(true) });
const hrDeco = Decoration.replace({ widget: new HrWidget() });

function buildConcealDecorations(view: EditorView): DecorationSet {
  const state = view.state;
  const doc = state.doc;
  const fmEnd = frontmatterEndLine(state);
  const decos: Range<Decoration>[] = [];

  // Inclusive intersection: a cursor touching the edge of a span counts as
  // "inside", so markers reappear before the cursor would step onto them.
  const touches = (from: number, to: number): boolean =>
    state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  const touchesLineOf = (pos: number): boolean => {
    const line = doc.lineAt(pos);
    return touches(line.from, line.to);
  };
  const inFrontmatter = (pos: number): boolean => fmEnd > 0 && doc.lineAt(pos).number <= fmEnd;

  // Hide a marker together with the single space separating it from content
  // ("## title" hides "## ", "> quote" hides "> ").
  const hideWithSpace = (from: number, to: number) => {
    const end = to < doc.length && doc.sliceString(to, to + 1) === " " ? to + 1 : to;
    decos.push(hideDeco.range(from, end));
  };

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        switch (node.name) {
          case "HeaderMark": {
            // ATX only — setext underlines stay visible (hiding them would
            // leave a blank line that reads as a stray paragraph break).
            if (!node.node.parent?.name.startsWith("ATXHeading")) return;
            if (inFrontmatter(node.from) || touchesLineOf(node.from)) return;
            hideWithSpace(node.from, node.to);
            return;
          }
          case "QuoteMark": {
            if (inFrontmatter(node.from) || touchesLineOf(node.from)) return;
            hideWithSpace(node.from, node.to);
            return;
          }
          case "ListMark": {
            // Bullets become "•"; ordered-list numbers stay meaningful as-is.
            const listType = node.node.parent?.parent?.name;
            if (listType !== "BulletList") return;
            if (inFrontmatter(node.from) || touchesLineOf(node.from)) return;
            decos.push(bulletDeco.range(node.from, node.to));
            return;
          }
          case "TaskMarker": {
            if (inFrontmatter(node.from) || touchesLineOf(node.from)) return;
            const checked = /x/i.test(doc.sliceString(node.from, node.to));
            decos.push((checked ? taskDoneDeco : taskDeco).range(node.from, node.to));
            return;
          }
          case "EmphasisMark":
          case "StrikethroughMark":
          case "CodeMark": {
            // CodeMark also delimits fenced blocks; only conceal inline code.
            const parent = node.node.parent;
            if (!parent) return;
            if (node.name === "CodeMark" && parent.name !== "InlineCode") return;
            if (inFrontmatter(node.from) || touches(parent.from, parent.to)) return;
            decos.push(hideDeco.range(node.from, node.to));
            return;
          }
          case "LinkMark":
          case "URL":
          case "LinkTitle":
          case "LinkLabel": {
            // Collapse [text](url) to just the underlined text. Images keep
            // their raw syntax (we don't render them), as do autolinks.
            const parent = node.node.parent;
            if (parent?.name !== "Link") return;
            if (inFrontmatter(node.from) || touches(parent.from, parent.to)) return;
            decos.push(hideDeco.range(node.from, node.to));
            return;
          }
          case "HorizontalRule": {
            if (inFrontmatter(node.from) || touchesLineOf(node.from)) return;
            decos.push(hrDeco.range(node.from, node.to));
            return;
          }
        }
      },
    });
  }
  return Decoration.set(decos, true);
}

const mdConceal = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildConcealDecorations(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.state) !== syntaxTree(update.startState)
      ) {
        this.decorations = buildConcealDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ---------------------------------------------------------------------------
// Table rendering (Obsidian live preview)
//
// A GFM table whose lines the cursor is not touching is replaced by a real
// <table> widget; clicking a cell moves the cursor to that cell's source,
// which reveals the raw pipes (in monospace, via .cm-md-table) for editing.
// Block replace decorations may not come from a ViewPlugin (plugins can't
// affect vertical layout), hence the StateField.

type TableCell = { text: string; pos: number };

// Split one table row into cells. Returns each cell's trimmed text plus the
// doc position of its content start (for click-to-edit). `\|` escapes a pipe.
function splitTableRow(raw: string, base: number): TableCell[] {
  const cells: TableCell[] = [];
  // GFM permits leading whitespace before the opening pipe.
  const indent = raw.length - raw.trimStart().length;
  let start = raw[indent] === "|" ? indent + 1 : indent;
  let i = start;
  const push = (from: number, to: number) => {
    const segment = raw.slice(from, to);
    const leading = segment.length - segment.trimStart().length;
    cells.push({
      text: segment.trim().replace(/\\\|/g, "|"),
      pos: base + from + leading,
    });
  };
  while (i < raw.length) {
    if (raw[i] === "\\" && raw[i + 1] === "|") {
      i += 2;
      continue;
    }
    if (raw[i] === "|") {
      push(start, i);
      start = i + 1;
    }
    i++;
  }
  // Trailing segment; with a closing "|" it's empty and dropped.
  if (raw.slice(start).trim() !== "") push(start, raw.length);
  return cells;
}

function delimiterAligns(raw: string): (string | null)[] | null {
  const cells = splitTableRow(raw, 0);
  if (cells.length === 0) return null;
  const aligns: (string | null)[] = [];
  for (const c of cells) {
    if (!/^:?-+:?$/.test(c.text)) return null;
    const left = c.text.startsWith(":");
    const right = c.text.endsWith(":");
    aligns.push(left && right ? "center" : right ? "right" : null);
  }
  return aligns;
}

// Render a cell's inline markdown (code/bold/em/strike/link) into `el` using
// only createElement/textContent — cell text never becomes HTML.
const INLINE_RE = /`([^`]+)`|\*\*([^*]+?)\*\*|\*([^*]+?)\*|~~([^~]+?)~~|\[([^\]]+)\]\(([^)]*)\)/g;
function renderCellInline(el: HTMLElement, text: string) {
  INLINE_RE.lastIndex = 0;
  let last = 0;
  let m = INLINE_RE.exec(text);
  while (m) {
    if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
    let child: HTMLElement;
    if (m[1] !== undefined) {
      child = document.createElement("code");
      child.className = "cm-md-mono";
      child.textContent = m[1];
    } else if (m[2] !== undefined) {
      child = document.createElement("strong");
      child.textContent = m[2];
    } else if (m[3] !== undefined) {
      child = document.createElement("span");
      child.className = "cm-md-em";
      child.textContent = m[3];
    } else if (m[4] !== undefined) {
      child = document.createElement("del");
      child.textContent = m[4];
    } else {
      // Display-only: the raw source (a click away) is where links are edited.
      child = document.createElement("span");
      child.className = "cm-md-link";
      child.textContent = m[5];
    }
    el.appendChild(child);
    last = m.index + m[0].length;
    m = INLINE_RE.exec(text);
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

class TableWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly offset: number,
  ) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.source === this.source && other.offset === this.offset;
  }

  toDOM(view: EditorView): HTMLElement {
    const lines = this.source.split("\n");
    let lineBase = this.offset;
    const rows: TableCell[][] = [];
    for (const line of lines) {
      rows.push(splitTableRow(line, lineBase));
      lineBase += line.length + 1;
    }
    const aligns = lines.length > 1 ? (delimiterAligns(lines[1]) ?? []) : [];

    const wrap = document.createElement("div");
    wrap.className = "cm-md-tablewidget";
    const table = document.createElement("table");
    wrap.appendChild(table);

    const makeRow = (cells: TableCell[], tag: "th" | "td") => {
      const tr = document.createElement("tr");
      cells.forEach((cell, i) => {
        const el = document.createElement(tag);
        const align = aligns[i];
        if (align) el.style.textAlign = align;
        renderCellInline(el, cell.text);
        el.addEventListener("mousedown", (e) => {
          e.preventDefault();
          view.dispatch({ selection: { anchor: cell.pos } });
          view.focus();
        });
        tr.appendChild(el);
      });
      return tr;
    };

    if (rows.length > 0) {
      const thead = document.createElement("thead");
      thead.appendChild(makeRow(rows[0], "th"));
      table.appendChild(thead);
    }
    const tbody = document.createElement("tbody");
    // Row 1 is the |---|---| delimiter — never rendered.
    for (let r = 2; r < rows.length; r++) tbody.appendChild(makeRow(rows[r], "td"));
    table.appendChild(tbody);
    return wrap;
  }
}

function buildTableDecorations(state: EditorState): DecorationSet {
  const doc = state.doc;
  const fmEnd = frontmatterEndLine(state);
  const decos: Range<Decoration>[] = [];
  const touches = (from: number, to: number): boolean =>
    state.selection.ranges.some((r) => r.from <= to && r.to >= from);

  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "Table") return;
      const first = doc.lineAt(node.from);
      const last = doc.lineAt(node.to);
      if (fmEnd > 0 && first.number <= fmEnd) return false;
      // Nested tables (inside blockquotes/lists) keep the monospace source
      // view — a block replace must span whole lines, prefixes included.
      if (node.from !== first.from) return false;
      if (touches(first.from, last.to)) return false;
      const source = doc.sliceString(first.from, last.to);
      decos.push(
        Decoration.replace({ widget: new TableWidget(source, first.from), block: true }).range(
          first.from,
          last.to,
        ),
      );
      return false;
    },
  });
  return Decoration.set(decos, true);
}

const mdTables = StateField.define<DecorationSet>({
  create: buildTableDecorations,
  update(deco, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return buildTableDecorations(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const mdProse = [
  syntaxHighlighting(mdProseHighlight),
  mdProseBaseTheme,
  mdProseLines,
  mdConceal,
  mdTables,
];
