import {
  type Speaker,
  type SpeechMenuActions,
  type SpeechSide,
  rememberSpeakerSoon,
  speakerForNewBubble,
} from "@/lib/speech";
import { type Editor, Node, mergeAttributes } from "@tiptap/core";
import type { DOMOutputSpec, Node as PmNode, ResolvedPos } from "@tiptap/pm/model";
import { NodeSelection, Plugin, Selection, TextSelection } from "@tiptap/pm/state";

// Speech bubble block (markup and rationale in speech.ts). The bubble text
// and the speaker's name are ordinary editable content — the name is typed in
// place like a <summary> — while the icon and the side are attributes, set
// from the avatar menu. The avatar is drawn by a node view that keeps it out
// of the editable flow; the saved markup comes from renderHTML.

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    speech: {
      insertSpeech: () => ReturnType;
    };
  }
}

function avatarFromDom(el: HTMLElement): string | null {
  return el.querySelector(":scope > .speech-avatar img")?.getAttribute("src") || null;
}

function speakerOf(node: PmNode): Speaker {
  return {
    name: node.firstChild?.textContent.trim() ?? "",
    avatar: node.attrs.avatar as string | null,
    side: node.attrs.side as SpeechSide,
  };
}

// Depth of the outermost speech around $pos, or -1.
function outerSpeechDepth($pos: ResolvedPos): number {
  for (let d = 1; d <= $pos.depth; d++) {
    if ($pos.node(d).type.name === "speech") return d;
  }
  return -1;
}

function isEmptySpeech(node: PmNode): boolean {
  const bubble = node.lastChild;
  return (
    node.firstChild?.content.size === 0 &&
    bubble?.childCount === 1 &&
    Boolean(bubble.firstChild?.isTextblock) &&
    bubble.firstChild?.content.size === 0
  );
}

export const SpeechName = Node.create({
  name: "speechName",
  content: "inline*",
  defining: true,
  parseHTML() {
    // Only inside a speech; anywhere else the generic div passthrough keeps it.
    return [{ tag: "div.speech-name", context: "speech/", priority: 100 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ class: "speech-name" }, HTMLAttributes), 0];
  },
});

export const SpeechBubble = Node.create({
  name: "speechBubble",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: "div.speech-bubble", context: "speech/", priority: 100 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ class: "speech-bubble" }, HTMLAttributes), 0];
  },
});

export const Speech = Node.create({
  name: "speech",
  group: "block",
  content: "speechName speechBubble",
  defining: true,

  addAttributes() {
    return {
      avatar: {
        default: null as string | null,
        // Rendered as the avatar <img>, not as an attribute of the root.
        rendered: false,
        parseHTML: (el) => avatarFromDom(el as HTMLElement),
      },
      side: {
        default: "left" as SpeechSide,
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute("data-side") === "right" ? "right" : "left",
        renderHTML: (attrs) => (attrs.side === "right" ? { "data-side": "right" } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-speech]",
        // Beats the generic `div` passthrough node (default 50).
        priority: 100,
        contentElement: (el) =>
          (el as HTMLElement).querySelector<HTMLElement>(":scope > .speech-body") ??
          (el as HTMLElement),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const avatar = node.attrs.avatar as string | null;
    const avatarSpec: DOMOutputSpec = avatar
      ? ["div", { class: "speech-avatar" }, ["img", { src: avatar, alt: "" }]]
      : ["div", { class: "speech-avatar" }];
    return [
      "div",
      mergeAttributes({ class: "speech", "data-speech": "" }, HTMLAttributes),
      avatarSpec,
      ["div", { class: "speech-body" }, 0],
    ] as DOMOutputSpec;
  },

  // Same DOM as renderHTML, but the avatar is contenteditable=false and its
  // events are left to the avatar menu (speech.ts), so the caret never lands
  // in it and a click there doesn't move the selection.
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "speech";
      dom.setAttribute("data-speech", "");
      const avatar = document.createElement("div");
      avatar.className = "speech-avatar";
      avatar.contentEditable = "false";
      const body = document.createElement("div");
      body.className = "speech-body";
      dom.append(avatar, body);

      let current = node;
      const render = (n: PmNode) => {
        if (n.attrs.side === "right") dom.setAttribute("data-side", "right");
        else dom.removeAttribute("data-side");
        const src = n.attrs.avatar as string | null;
        const img = avatar.querySelector("img");
        if (!src) {
          avatar.replaceChildren();
        } else if (img?.getAttribute("src") !== src) {
          const next = document.createElement("img");
          next.src = src;
          next.alt = "";
          next.draggable = false;
          avatar.replaceChildren(next);
        }
      };
      render(node);

      return {
        dom,
        contentDOM: body,
        update: (n) => {
          if (n.type !== current.type) return false;
          current = n;
          render(n);
          return true;
        },
        stopEvent: (e) => avatar.contains(e.target as globalThis.Node),
        // The avatar and the root's attributes are ours; any other change
        // (a child added or removed) must reach ProseMirror.
        ignoreMutation: (m) => {
          if (m.type === "selection") return false;
          if (avatar.contains(m.target)) return true;
          return m.type === "attributes" && m.target === dom;
        },
      };
    };
  },

  addCommands() {
    return {
      // Beside the current block, like the TOC: an empty paragraph is
      // replaced, otherwise it goes after the block — or after the bubble,
      // when the caret is in one. The speaker is the one last worked on
      // (speech.ts); the caret lands in the bubble when the name is already
      // known, in the name otherwise.
      insertSpeech:
        () =>
        ({ state, tr, dispatch }) => {
          const { schema } = state;
          const { $from } = state.selection;
          let from: number;
          let to: number;
          const speechDepth = outerSpeechDepth($from);
          if (speechDepth > 0) {
            from = to = $from.after(speechDepth);
          } else if (state.selection instanceof NodeSelection) {
            // A selected block (say, a bubble picked with Backspace) stays.
            from = to = state.selection.to;
          } else if ($from.depth > 0 && $from.parent.isTextblock) {
            // Only where the container allows it: a list item, say, must
            // keep the paragraph it starts with.
            const index = $from.index(-1);
            const fits = (start: number, end: number) =>
              $from.node(-1).canReplaceWith(start, end, schema.nodes.speech);
            const empty = $from.parent.content.size === 0 && $from.parent.type.name === "paragraph";
            if (empty && fits(index, index + 1)) {
              from = $from.before();
              to = $from.after();
            } else if ($from.parentOffset === 0 && !empty && fits(index, index)) {
              from = to = $from.before();
            } else {
              from = to = $from.after();
            }
          } else {
            from = state.selection.from;
            to = state.selection.to;
          }

          // Past the dry-run check: picking the speaker saves it (speech.ts).
          if (!dispatch) return true;
          const speaker = speakerForNewBubble();
          const speech = schema.nodes.speech.create(
            { avatar: speaker.avatar, side: speaker.side },
            [
              schema.nodes.speechName.create(null, speaker.name ? schema.text(speaker.name) : null),
              schema.nodes.speechBubble.create(null, schema.nodes.paragraph.create()),
            ],
          );
          tr.replaceWith(from, to, speech);
          // Leave somewhere to type after a bubble that ends the document.
          if (tr.doc.lastChild?.type.name === "speech") {
            tr.insert(tr.doc.content.size, schema.nodes.paragraph.create());
          }
          const nameStart = from + 2;
          const bubbleText = from + 1 + speech.child(0).nodeSize + 2;
          tr.setSelection(TextSelection.create(tr.doc, speaker.name ? bubbleText : nameStart));
          tr.scrollIntoView();
          return true;
        },
    };
  },

  // Typing in a bubble (its name or its text) makes its speaker the one the
  // next bubble starts as.
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: () => ({
          update: (view, prev) => {
            if (view.state.doc.eq(prev.doc)) return;
            const { $from } = view.state.selection;
            const depth = outerSpeechDepth($from);
            if (depth > 0) rememberSpeakerSoon(speakerOf($from.node(depth)));
          },
        }),
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // In the name: on to the bubble (a name is one line). In an empty last
      // paragraph of a multi-paragraph bubble: leave the bubble, the way a
      // second Enter leaves a quote elsewhere.
      Enter: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const { $from } = selection;
        if ($from.parent.type.name === "speechName") {
          const sel = Selection.findFrom(state.doc.resolve($from.after() + 1), 1, true);
          if (sel) view.dispatch(state.tr.setSelection(sel).scrollIntoView());
          return true;
        }
        if ($from.depth < 3 || $from.node(-1).type.name !== "speechBubble") return false;
        const bubble = $from.node(-1);
        const isLast = $from.index(-1) === bubble.childCount - 1;
        if ($from.parent.content.size > 0 || !isLast || bubble.childCount < 2) return false;
        const speechEnd = $from.after(-2);
        const tr = state.tr.delete($from.before(), $from.after());
        const at = tr.mapping.map(speechEnd);
        tr.insert(at, state.schema.nodes.paragraph.create());
        tr.setSelection(TextSelection.create(tr.doc, at + 1));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      // At the very start of a bubble: back into the name rather than a join
      // across the two. At the start of the name: an empty bubble goes away,
      // anything else is selected whole, so a second Backspace deletes it.
      Backspace: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const { $from } = selection;
        if ($from.parentOffset !== 0) return false;
        if ($from.parent.type.name === "speechName") {
          const speechPos = $from.before(-1);
          const speech = $from.node(-1);
          if (isEmptySpeech(speech)) {
            const tr = state.tr.replaceWith(
              speechPos,
              speechPos + speech.nodeSize,
              state.schema.nodes.paragraph.create(),
            );
            tr.setSelection(TextSelection.create(tr.doc, speechPos + 1));
            view.dispatch(tr);
          } else {
            view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, speechPos)));
          }
          return true;
        }
        if (
          $from.depth >= 3 &&
          $from.node(-1).type.name === "speechBubble" &&
          $from.index(-1) === 0
        ) {
          const nameEnd = $from.before(-1) - 1;
          view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, nameEnd)));
          return true;
        }
        return false;
      },
      // At the end of the name: on into the bubble, not a join.
      Delete: ({ editor }) => {
        const { state, view } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const { $from } = selection;
        if ($from.parent.type.name !== "speechName") return false;
        if ($from.parentOffset !== $from.parent.content.size) return false;
        const sel = Selection.findFrom(state.doc.resolve($from.after() + 1), 1, true);
        if (sel) view.dispatch(state.tr.setSelection(sel));
        return true;
      },
    };
  },
});

// The avatar menu's actions for the TipTap editor, each on the clicked
// bubble only (speech.ts).
export function tiptapSpeechActions(editor: Editor): SpeechMenuActions {
  const locate = (el: HTMLElement): number => {
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
      if (found >= 0) return false;
      if (node.type.name === "speech" && editor.view.nodeDOM(pos) === el) found = pos;
      return true;
    });
    return found;
  };
  return {
    setSpeaker: (el, speaker) => {
      const pos = locate(el);
      const node = pos >= 0 ? editor.state.doc.nodeAt(pos) : null;
      const name = node?.firstChild;
      if (!node || !name) return;
      const { schema } = editor.state;
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        avatar: speaker.avatar,
        side: speaker.side,
      });
      tr.replaceWith(
        pos + 2,
        pos + 2 + name.content.size,
        speaker.name ? schema.text(speaker.name) : [],
      );
      editor.view.dispatch(tr);
    },
    setAvatar: (el, url) => {
      const pos = locate(el);
      if (pos < 0) return;
      editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, "avatar", url));
    },
    swapSide: (el) => {
      const pos = locate(el);
      if (pos < 0) return;
      const side = editor.state.doc.nodeAt(pos)?.attrs.side === "right" ? "left" : "right";
      editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, "side", side));
    },
    remove: (el) => {
      const pos = locate(el);
      const node = pos >= 0 ? editor.state.doc.nodeAt(pos) : null;
      if (!node) return;
      editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
      editor.view.focus();
    },
  };
}
