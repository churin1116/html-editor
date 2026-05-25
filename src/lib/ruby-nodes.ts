import { Node } from "@tiptap/core";

// Preserve <ruby>/<rt>/<rp> furigana annotations through the load → edit →
// save round-trip. Without these extensions, Tiptap's ProseMirror schema
// treats the tags as unknown and silently drops them, flattening
// "<ruby>神霊<rt>ダイモニオン</rt></ruby>" into "神霊ダイモニオン" on save —
// a destructive transformation for translated classical texts (Plato,
// Shakespeare, etc.) where furigana carries the original-language reading.

export const Ruby = Node.create({
  name: "ruby",
  group: "inline",
  inline: true,
  // Mixed content: base text plus rt/rp annotation children. The HTML spec
  // allows split ruby (e.g. <ruby>神<rt>かん</rt>霊<rt>れい</rt></ruby>), so
  // the expression accepts any sequence of text and rt/rp nodes.
  content: "(text | rt | rp)*",
  parseHTML() {
    return [{ tag: "ruby" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ruby", HTMLAttributes, 0];
  },
});

export const Rt = Node.create({
  name: "rt",
  group: "inline",
  inline: true,
  content: "text*",
  // rt only makes sense inside <ruby>; defining prevents ProseMirror from
  // promoting orphan <rt>s when content is pasted at the document root.
  defining: true,
  parseHTML() {
    return [{ tag: "rt" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["rt", HTMLAttributes, 0];
  },
});

export const Rp = Node.create({
  name: "rp",
  group: "inline",
  inline: true,
  content: "text*",
  defining: true,
  parseHTML() {
    return [{ tag: "rp" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["rp", HTMLAttributes, 0];
  },
});
