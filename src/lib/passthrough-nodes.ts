import { Extension, Mark, Node } from "@tiptap/core";

// Preserve hand-authored HTML structure that StarterKit otherwise unwraps:
// <div>/<aside> block wrappers, <span> inline wrappers with class/id, and
// class/id on <p>. Used when editing files outside the Chameleon-managed
// pipeline (e.g. translator-output content.html) so structural markers
// survive the load → edit → save round-trip.

type AttrName = "class" | "id" | "data-section" | "data-type" | "role";

function passthroughAttrs(names: AttrName[]) {
  const out: Record<string, unknown> = {};
  for (const name of names) {
    out[name] = {
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute(name),
      renderHTML: (attrs: Record<string, string | null>) =>
        attrs[name] ? { [name]: attrs[name] } : {},
    };
  }
  return out;
}

// Order chosen to match how translator-output content.html files lay out
// attributes (e.g. <aside class="note" data-type="..." id="..." role="..."
// and <div class="section" data-section="..." ...), so edited files diff
// cleanly against the source.
const BLOCK_ATTRS: AttrName[] = ["class", "data-type", "id", "role", "data-section"];
const INLINE_ATTRS: AttrName[] = ["class", "id"];

export const Div = Node.create({
  name: "div",
  group: "block",
  content: "block+",
  addAttributes() {
    return passthroughAttrs(BLOCK_ATTRS);
  },
  parseHTML() {
    return [{ tag: "div" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", HTMLAttributes, 0];
  },
});

export const Aside = Node.create({
  name: "aside",
  group: "block",
  content: "block+",
  addAttributes() {
    return passthroughAttrs(BLOCK_ATTRS);
  },
  parseHTML() {
    return [{ tag: "aside" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["aside", HTMLAttributes, 0];
  },
});

// <figure> + <figcaption> for image-with-caption blocks. Without these, Tiptap
// drops the <figure> wrapper on load (the <img> becomes a bare block and the
// <figcaption> becomes a plain <p>), which loses the editorial semantics on
// every round-trip. Pairs with the figure-aware uploadAndInsert in editor.tsx.
export const Figure = Node.create({
  name: "figure",
  group: "block",
  // Allow any block-level content so existing patterns work:
  //   <figure><img><figcaption>...</figcaption></figure>
  //   <figure><pre>...</pre><figcaption>...</figcaption></figure>
  content: "block+",
  addAttributes() {
    return passthroughAttrs(BLOCK_ATTRS);
  },
  parseHTML() {
    return [{ tag: "figure" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figure", HTMLAttributes, 0];
  },
});

export const Figcaption = Node.create({
  name: "figcaption",
  // Sit alongside other blocks inside <figure>. Inline content only —
  // captions are short single-line strings, not paragraphs.
  group: "block",
  content: "inline*",
  // Captions belong inside <figure>; declaring this prevents Tiptap from
  // promoting orphan <figcaption>s to top-level blocks on paste.
  defining: true,
  addAttributes() {
    return passthroughAttrs(INLINE_ATTRS);
  },
  parseHTML() {
    return [{ tag: "figcaption" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["figcaption", HTMLAttributes, 0];
  },
});

// Add class/id passthrough to StarterKit's paragraph and heading nodes so
// `<p class="poem">` and `<h2 class="...">` round-trip without losing their
// class. Uses addGlobalAttributes to extend the existing node attribute set
// rather than replacing the node definition.
export const ParagraphClass = Extension.create({
  name: "paragraphClassAttribute",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          class: {
            default: null,
            parseHTML: (el) => el.getAttribute("class"),
            renderHTML: (attrs) => (attrs.class ? { class: attrs.class } : {}),
          },
          id: {
            default: null,
            parseHTML: (el) => el.getAttribute("id"),
            renderHTML: (attrs) => (attrs.id ? { id: attrs.id } : {}),
          },
        },
      },
    ];
  },
});

// Inline <span> wrapper. Only matches spans that actually carry preservable
// attributes — without this filter Tiptap would wrap every bit of inline
// text in a no-op span on round-trip, polluting the serialized output.
export const Span = Mark.create({
  name: "span",
  addAttributes() {
    return passthroughAttrs(INLINE_ATTRS);
  },
  parseHTML() {
    return [
      {
        tag: "span",
        getAttrs: (node) => {
          const el = node as HTMLElement;
          if (el.hasAttribute("class") || el.hasAttribute("id")) return {};
          return false;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  },
});
