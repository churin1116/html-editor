import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type { Editor as TiptapEditor } from "@tiptap/react";

export type ActionId =
  | "h1"
  | "h2"
  | "h3"
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "list"
  | "numList"
  | "quote"
  | "codeBlock"
  | "link"
  | "unlink"
  | "table"
  | "hr"
  | "ruby"
  | "undo"
  | "redo";

export type EditorMode = "html" | "md";

export type ActionIcon = "table";

export type ActionDef = {
  id: ActionId;
  label: string;
  hint?: string;
  icon?: ActionIcon;
  supports: ReadonlyArray<EditorMode>;
};

export const ACTIONS: ActionDef[] = [
  { id: "h1", label: "# 見出し1", supports: ["html", "md"] },
  { id: "h2", label: "## 見出し2", supports: ["html", "md"] },
  { id: "h3", label: "### 小見出し", supports: ["html", "md"] },
  { id: "bold", label: "強調 **…**", hint: "⌘+B", supports: ["html", "md"] },
  { id: "italic", label: "斜体 *…*", supports: ["html", "md"] },
  { id: "strike", label: "取り消し線 ~~…~~", supports: ["html", "md"] },
  { id: "code", label: "インラインコード `…`", supports: ["html", "md"] },
  { id: "list", label: "- リスト", supports: ["html", "md"] },
  { id: "numList", label: "1. 番号付きリスト", supports: ["html", "md"] },
  { id: "quote", label: "> 引用", supports: ["html", "md"] },
  { id: "codeBlock", label: "``` コードブロック ```", supports: ["html", "md"] },
  { id: "link", label: "リンク", hint: "⌘+K", supports: ["html", "md"] },
  { id: "unlink", label: "リンク解除", supports: ["html"] },
  { id: "table", label: "テーブル", icon: "table", supports: ["html", "md"] },
  { id: "hr", label: "--- 区切り線", supports: ["html", "md"] },
  { id: "ruby", label: "|ルビ《るび》", hint: "⌘+Shift+I", supports: ["md"] },
  { id: "undo", label: "取り消す", hint: "⌘+Z", supports: ["html", "md"] },
  { id: "redo", label: "やり直す", hint: "⌘+Shift+Z", supports: ["html", "md"] },
];

/* ============================================================
   Markdown (CodeMirror) dispatchers
   ============================================================ */

function addLinePrefix(view: EditorView, prefix: string) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const startLine = state.doc.lineAt(from);
  const endLine = state.doc.lineAt(to);
  const changes: { from: number; insert: string }[] = [];
  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = state.doc.line(i);
    changes.push({ from: line.from, insert: prefix });
  }
  view.dispatch({ changes, userEvent: "input.linePrefix" });
}

function insertBlock(view: EditorView, text: string) {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const prefix = line.text.length === 0 ? "" : "\n";
  const insert = `${prefix}${text}\n`;
  view.dispatch({
    changes: { from: line.to, to: line.to, insert },
    selection: { anchor: line.to + insert.length },
    userEvent: "input.insert",
  });
}

function wrap(
  view: EditorView,
  before: string,
  after: string,
  placeholder = "",
) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const selected = state.sliceDoc(from, to);
  const body = selected.length > 0 ? selected : placeholder;
  const insert = `${before}${body}${after}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: {
      anchor: from + before.length,
      head: from + before.length + body.length,
    },
    userEvent: "input.wrap",
  });
}

function insertCodeBlock(view: EditorView) {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);
  const prefix = line.text.length === 0 ? "" : "\n";
  const insert = `${prefix}\`\`\`\n\n\`\`\`\n`;
  const cursor = line.to + prefix.length + 4; // after "```\n"
  view.dispatch({
    changes: { from: line.to, to: line.to, insert },
    selection: { anchor: cursor },
    userEvent: "input.insert",
  });
}

function insertTable(view: EditorView) {
  const text = "| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|     |     |     |";
  insertBlock(view, text);
}

export function applyMdAction(view: EditorView, id: ActionId) {
  switch (id) {
    case "h1":
      addLinePrefix(view, "# ");
      break;
    case "h2":
      addLinePrefix(view, "## ");
      break;
    case "h3":
      addLinePrefix(view, "### ");
      break;
    case "bold":
      wrap(view, "**", "**", "強調");
      break;
    case "italic":
      wrap(view, "*", "*", "斜体");
      break;
    case "strike":
      wrap(view, "~~", "~~", "取り消し線");
      break;
    case "code":
      wrap(view, "`", "`", "code");
      break;
    case "list":
      addLinePrefix(view, "- ");
      break;
    case "numList":
      addLinePrefix(view, "1. ");
      break;
    case "quote":
      addLinePrefix(view, "> ");
      break;
    case "codeBlock":
      insertCodeBlock(view);
      break;
    case "link":
      wrap(view, "[", "](url)", "text");
      break;
    case "table":
      insertTable(view);
      break;
    case "hr":
      insertBlock(view, "---");
      break;
    case "ruby":
      wrap(view, "|", "《るび》", "本文");
      break;
    case "undo":
      undo(view);
      break;
    case "redo":
      redo(view);
      break;
    case "unlink":
      break;
  }
  view.focus();
}

/* ============================================================
   HTML (Tiptap) dispatcher
   ============================================================ */

export function applyHtmlAction(editor: TiptapEditor, id: ActionId) {
  const chain = editor.chain().focus();
  switch (id) {
    case "h1":
      chain.toggleHeading({ level: 1 }).run();
      break;
    case "h2":
      chain.toggleHeading({ level: 2 }).run();
      break;
    case "h3":
      chain.toggleHeading({ level: 3 }).run();
      break;
    case "bold":
      chain.toggleBold().run();
      break;
    case "italic":
      chain.toggleItalic().run();
      break;
    case "strike":
      chain.toggleStrike().run();
      break;
    case "code":
      chain.toggleCode().run();
      break;
    case "list":
      chain.toggleBulletList().run();
      break;
    case "numList":
      chain.toggleOrderedList().run();
      break;
    case "quote":
      chain.toggleBlockquote().run();
      break;
    case "codeBlock":
      chain.toggleCodeBlock().run();
      break;
    case "link": {
      const url = window.prompt("URL");
      if (url) chain.setLink({ href: url }).run();
      break;
    }
    case "unlink":
      chain.unsetLink().run();
      break;
    case "table":
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      break;
    case "hr":
      chain.setHorizontalRule().run();
      break;
    case "undo":
      chain.undo().run();
      break;
    case "redo":
      chain.redo().run();
      break;
    case "ruby":
      break;
  }
}
