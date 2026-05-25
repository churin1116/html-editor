import { Mark } from "@tiptap/core";

// Replace StarterKit's Italic and Bold so the original tag identity
// (<i> vs <em>, <b> vs <strong>) survives the round-trip. The default
// ProseMirror marks parse both pairs but always serialize as <em>/<strong>,
// which silently flattens scholarly distinctions: HTML5 reserves <i> for
// "alternate voice" (foreign words, work titles in non-cite contexts,
// technical terms) and <em> for stress emphasis. Project Gutenberg
// classical editions rely on this distinction in ~1.8K places.
//
// Use by disabling StarterKit's defaults: StarterKit.configure({
//   italic: false, bold: false }) and adding Italic, Bold to the
// extensions array.

// Stores the source tag as an attribute (htmlTag), then renders that tag
// on serialization. The attribute itself is never written to DOM — it
// only drives the tag choice.

export const Italic = Mark.create({
  name: "italic",
  addAttributes() {
    return {
      htmlTag: {
        default: "em",
        parseHTML: (el) => (el as HTMLElement).tagName.toLowerCase(),
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "em" }, { tag: "i" }];
  },
  renderHTML({ mark, HTMLAttributes }) {
    const tag = (mark.attrs as { htmlTag?: string }).htmlTag === "i" ? "i" : "em";
    return [tag, HTMLAttributes, 0];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-i": () => this.editor.commands.toggleMark(this.name),
    };
  },
});

export const Bold = Mark.create({
  name: "bold",
  addAttributes() {
    return {
      htmlTag: {
        default: "strong",
        parseHTML: (el) => (el as HTMLElement).tagName.toLowerCase(),
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: "strong" }, { tag: "b" }];
  },
  renderHTML({ mark, HTMLAttributes }) {
    const tag = (mark.attrs as { htmlTag?: string }).htmlTag === "b" ? "b" : "strong";
    return [tag, HTMLAttributes, 0];
  },
  addKeyboardShortcuts() {
    return {
      "Mod-b": () => this.editor.commands.toggleMark(this.name),
    };
  },
});
