import { Node } from "@tiptap/core";

// Preserve <section> wrappers (e.g. pandoc-generated `section.level1`) so that
// fragment HTML round-trips through the editor without losing structural
// containers. The id/class attributes are kept verbatim.

export const Section = Node.create({
  name: "section",
  group: "block",
  content: "block+",
  // No `defining: true`: with it, ProseMirror propagates Enter-key splits up
  // to the section ancestor, producing two adjacent <section> elements when
  // the user adds a paragraph inside. Plain wrapper semantics keep Enter
  // limited to the immediate paragraph.
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("id"),
        renderHTML: (attrs) => (attrs.id ? { id: attrs.id } : {}),
      },
      class: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("class"),
        renderHTML: (attrs) => (attrs.class ? { class: attrs.class } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "section" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["section", HTMLAttributes, 0];
  },
});
