import { Mark, markInputRule } from "@tiptap/core";

// Markdown-style typing shortcuts, same regexes as Tiptap's stock Bold/
// Italic (which these marks replace — replacing them dropped the stock
// input rules, so they're re-declared here).
const boldStarInput = /(?:^|\s)(\*\*(?!\s+\*\*)((?:[^*]+))\*\*(?!\s+\*\*))$/;
const boldUnderscoreInput = /(?:^|\s)(__(?!\s+__)((?:[^_]+))__(?!\s+__))$/;
const italicStarInput = /(?:^|\s)(\*(?!\s+\*)((?:[^*]+))\*(?!\s+\*))$/;
const italicUnderscoreInput = /(?:^|\s)(_(?!\s+_)((?:[^_]+))_(?!\s+_))$/;

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
  addInputRules() {
    return [
      markInputRule({ find: italicStarInput, type: this.type }),
      markInputRule({ find: italicUnderscoreInput, type: this.type }),
    ];
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
  addInputRules() {
    return [
      markInputRule({ find: boldStarInput, type: this.type }),
      markInputRule({ find: boldUnderscoreInput, type: this.type }),
    ];
  },
});
