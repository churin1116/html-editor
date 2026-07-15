import { Node } from "@tiptap/core";

// Minimal node extensions for the native <details>/<summary> pair. Keeps the
// editor's HTML output the same as what a hand-written file would contain, so
// saved files stay valid standalone HTML and the same toggle behavior shows up
// when opened directly in a browser.
//
// Each details also carries a per-instance `defaultState` attribute, serialized
// as `data-default-state="on" | "off"` on disk (omitted when "preserve"). On
// load, this attribute overrides the `open` attribute so the user can pin a
// specific block to always-open or always-closed without it leaking to other
// blocks.

export type DetailsDefaultState = "on" | "off" | "preserve";

function readDefaultState(el: HTMLElement): DetailsDefaultState {
  const v = el.getAttribute("data-default-state");
  if (v === "on" || v === "off") return v;
  return "preserve";
}

export const Details = Node.create({
  name: "details",
  group: "block",
  content: "summary block+",
  defining: true,
  addAttributes() {
    return {
      open: {
        default: false,
        parseHTML: (el) => {
          const mode = readDefaultState(el as HTMLElement);
          if (mode === "on") return true;
          if (mode === "off") return false;
          return el.hasAttribute("open");
        },
        renderHTML: (attrs) => (attrs.open ? { open: "" } : {}),
      },
      defaultState: {
        default: "preserve" as DetailsDefaultState,
        parseHTML: (el) => readDefaultState(el as HTMLElement),
        renderHTML: (attrs) => {
          const v = attrs.defaultState as DetailsDefaultState | undefined;
          if (v === "on" || v === "off") return { "data-default-state": v };
          return {};
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: "details" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["details", HTMLAttributes, 0];
  },
});

export const Summary = Node.create({
  name: "summary",
  group: "block",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "summary" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["summary", HTMLAttributes, 0];
  },
  addKeyboardShortcuts() {
    return {
      // Default Enter would split the summary into two — which violates the
      // `details: summary block+` schema and produces malformed HTML. Move the
      // caret to the first sibling block inside details instead.
      Enter: () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        if ($from.parent.type.name !== this.name) return false;
        const afterSummary = $from.after();
        if (afterSummary >= state.doc.content.size) return false;
        return this.editor
          .chain()
          .setTextSelection(afterSummary + 1)
          .focus()
          .run();
      },
    };
  },
});
