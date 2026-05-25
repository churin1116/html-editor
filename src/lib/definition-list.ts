import { Node } from "@tiptap/core";

// <dl>/<dt>/<dd> description-list nodes. Project Gutenberg classical
// editions use these for bibliographies, dramatis personae, glossaries,
// and indices (~6K occurrences in the translator corpus). Without these
// nodes, ProseMirror drops the wrappers and reduces dt/dd content to
// loose paragraphs, losing the list semantics on round-trip.

// class/id passthrough on the three nodes — gutenberg uses class="biblio"
// and similar markers on the wrappers (e.g. <dl class="biblio">) to scope
// per-list styling.
function passthroughClassId() {
  return {
    class: {
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute("class"),
      renderHTML: (attrs: Record<string, string | null>) =>
        attrs.class ? { class: attrs.class } : {},
    },
    id: {
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute("id"),
      renderHTML: (attrs: Record<string, string | null>) => (attrs.id ? { id: attrs.id } : {}),
    },
  };
}

export const DescriptionList = Node.create({
  name: "descriptionList",
  group: "block",
  // HTML5 allows alternating dt/dd pairs in any order; (dt|dd)+ matches
  // term-only entries (common in bibliographies) and term+definition pairs.
  content: "(descriptionTerm | descriptionDetail)+",
  addAttributes() {
    return passthroughClassId();
  },
  parseHTML() {
    return [{ tag: "dl" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["dl", HTMLAttributes, 0];
  },
});

export const DescriptionTerm = Node.create({
  name: "descriptionTerm",
  group: "block",
  // dt is typically a single line of inline content (the term itself,
  // possibly with <i> for titles or <cite> for works).
  content: "inline*",
  defining: true,
  addAttributes() {
    return passthroughClassId();
  },
  parseHTML() {
    return [{ tag: "dt" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["dt", HTMLAttributes, 0];
  },
});

export const DescriptionDetail = Node.create({
  name: "descriptionDetail",
  group: "block",
  // dd may contain multi-paragraph definitions, so allow block-level
  // children (paragraphs, lists, blockquotes).
  content: "block+",
  defining: true,
  addAttributes() {
    return passthroughClassId();
  },
  parseHTML() {
    return [{ tag: "dd" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["dd", HTMLAttributes, 0];
  },
});
