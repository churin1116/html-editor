import { Mark } from "@tiptap/core";

// Round-trip-safe wrappers for inline semantic tags that ProseMirror's
// default schema would otherwise drop. Each Mark just parses the tag and
// renders it back unchanged. Used by translator-output content.html where
// these tags carry editorial meaning (footnote markers, citations, fine
// print, highlights, etc.) that must survive the load → edit → save cycle.

// Bare tag passthrough — name == tag.
const bareMark = (tag: string) =>
  Mark.create({
    name: tag,
    parseHTML() {
      return [{ tag }];
    },
    renderHTML() {
      return [tag, 0];
    },
  });

// Tier 1: high-frequency tags (37K+ occurrences in the gutenberg corpus).
export const Sup = bareMark("sup");
export const Sub = bareMark("sub");
export const Small = bareMark("small");
export const Cite = bareMark("cite");

// <mark> highlight. Internal name is "highlight" to avoid colliding with
// ProseMirror's Mark base class naming.
export const HtmlMark = Mark.create({
  name: "highlight",
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML() {
    return ["mark", 0];
  },
});

// Tier 4: low-frequency but semantically meaningful.
export const Ins = bareMark("ins");
export const Del = bareMark("del");
export const Underline = Mark.create({
  name: "underline",
  parseHTML() {
    return [{ tag: "u" }];
  },
  renderHTML() {
    return ["u", 0];
  },
});
export const Var_ = bareMark("var");
export const InlineQuote = bareMark("q");
export const Kbd = bareMark("kbd");

// <abbr> carries semantic value primarily through its title attribute
// (the expansion of the abbreviation), so preserve title in round-trip.
export const Abbr = Mark.create({
  name: "abbr",
  addAttributes() {
    return {
      title: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("title"),
        renderHTML: (attrs) => (attrs.title ? { title: attrs.title } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "abbr" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["abbr", HTMLAttributes, 0];
  },
});
