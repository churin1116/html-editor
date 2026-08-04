import { promptDialog } from "@/lib/dialogs";
import { fetchLinkCardMeta, isSingleUrl } from "@/lib/link-card";
import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type { Editor as TiptapEditor } from "@tiptap/react";
import { toast } from "sonner";

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
  | "linkCard"
  | "unlink"
  | "table"
  | "details"
  | "hr"
  | "ruby"
  | "sup"
  | "sub"
  | "mark"
  | "cite"
  | "small"
  | "ins"
  | "del"
  | "underline"
  | "abbr"
  | "dl"
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
  { id: "italic", label: "斜体 *…*", hint: "⌘+I", supports: ["html", "md"] },
  { id: "strike", label: "取り消し線 ~~…~~", supports: ["html", "md"] },
  { id: "underline", label: "下線 <u>", supports: ["html"] },
  { id: "code", label: "インラインコード `…`", supports: ["html", "md"] },
  { id: "sup", label: "上付き <sup>", supports: ["html"] },
  { id: "sub", label: "下付き <sub>", supports: ["html"] },
  { id: "mark", label: "ハイライト <mark>", supports: ["html"] },
  { id: "cite", label: "書名 <cite>", supports: ["html"] },
  { id: "small", label: "細字 <small>", supports: ["html"] },
  { id: "ins", label: "補入 <ins>", supports: ["html"] },
  { id: "del", label: "削除線 <del>", supports: ["html"] },
  { id: "abbr", label: "略語 <abbr title>", supports: ["html"] },
  { id: "ruby", label: "ルビ <ruby>", hint: "⌘+Shift+I", supports: ["html", "md"] },
  { id: "list", label: "- リスト", supports: ["html", "md"] },
  { id: "numList", label: "1. 番号付きリスト", supports: ["html", "md"] },
  { id: "dl", label: "定義リスト <dl>", supports: ["html"] },
  { id: "quote", label: "> 引用", supports: ["html", "md"] },
  { id: "codeBlock", label: "``` コードブロック ```", supports: ["html", "md"] },
  { id: "link", label: "リンク", hint: "⌘+K", supports: ["html", "md"] },
  { id: "linkCard", label: "リンクカード", supports: ["html"] },
  { id: "unlink", label: "装飾を解除", supports: ["html"] },
  { id: "table", label: "テーブル", icon: "table", supports: ["html", "md"] },
  { id: "details", label: "▾ 折りたたみ", supports: ["html", "md"] },
  { id: "hr", label: "--- 区切り線", supports: ["html", "md"] },
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

function wrap(view: EditorView, before: string, after: string, placeholder = "") {
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

function insertDetailsMd(view: EditorView) {
  // Blank lines around the inner content are important: marked / GFM
  // processors only re-enter Markdown parsing inside raw HTML if separated
  // by blank lines. Inserted open so the body is immediately editable; the
  // user can right-click the summary in the HTML editor to pin it to open /
  // closed / preserve later on.
  const text = "<details open>\n<summary>タイトル</summary>\n\n本文\n\n</details>";
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
    case "details":
      insertDetailsMd(view);
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
    // HTML-only actions are no-ops in Markdown mode.
    case "linkCard":
    case "unlink":
    case "underline":
    case "sup":
    case "sub":
    case "mark":
    case "cite":
    case "small":
    case "ins":
    case "del":
    case "abbr":
    case "dl":
      break;
  }
  view.focus();
}

/* ============================================================
   HTML (Tiptap) dispatcher
   ============================================================ */

// Insert ruby at the current selection. Requires a non-empty selection: the
// selected text becomes the ruby base, the prompt result becomes the rt
// annotation. Empty selection no-ops so the user doesn't end up with
// dangling placeholder text inside a ruby node they'll have to clean up.
async function insertRuby(editor: TiptapEditor) {
  const sel = editor.state.selection;
  if (sel.empty) {
    toast.error("ルビを付けたいテキストを選択してから操作してください。");
    return;
  }
  const ruby = await promptDialog({
    title: "ルビ",
    placeholder: "rt の中身",
    confirmLabel: "挿入",
  });
  if (!ruby) return;
  const base = editor.state.doc.textBetween(sel.from, sel.to);
  editor
    .chain()
    .focus()
    .deleteSelection()
    .insertContent({
      type: "ruby",
      content: [
        { type: "text", text: base },
        { type: "rt", content: [{ type: "text", text: ruby }] },
      ],
    })
    .run();
}

// Wrap selected text in <abbr title="...">. Title is the expansion; without
// it the <abbr> is semantically useless, so an empty title cancels.
async function insertAbbr(editor: TiptapEditor) {
  const sel = editor.state.selection;
  if (sel.empty) {
    toast.error("略語にしたいテキストを選択してから操作してください。");
    return;
  }
  const title = await promptDialog({
    title: "略語の説明",
    placeholder: "title 属性",
    confirmLabel: "設定",
  });
  if (!title) return;
  editor.chain().focus().setMark("abbr", { title }).run();
}

// Prompt for a URL and set a link on the current selection. Uses a fresh chain
// created after the prompt resolves (the outer chain is stale by then).
async function insertLink(editor: TiptapEditor) {
  const url = await promptDialog({ title: "リンク", placeholder: "URL", confirmLabel: "設定" });
  if (url) editor.chain().focus().setLink({ href: url }).run();
}

// The card is inserted only once its metadata is in hand, so what lands in the
// document is already final — nothing is fetched later, and a save that
// happens right after the insert can't race an in-flight request. A page that
// gives us nothing still becomes a card showing its URL.
async function insertLinkCard(editor: TiptapEditor) {
  const raw = await promptDialog({
    title: "リンクカード",
    description: "OGP（タイトル・説明・画像）を取得してカードとして挿入します。",
    placeholder: "https://example.com/article",
    confirmLabel: "挿入",
  });
  const url = raw?.trim();
  if (!url) return;
  if (!isSingleUrl(url)) {
    toast.error("http(s) の URL を入力してください");
    return;
  }
  const meta = await fetchLinkCardMeta(url);
  if (!meta.title) toast("リンク情報を取得できませんでした（URL のみのカードにします）");
  editor.chain().focus().setLinkCard(meta).run();
}

// Insert an empty <dl><dt>用語</dt><dd><p>説明</p></dd></dl> structure so
// the user can immediately tab into the placeholders and fill in the term
// and definition.
function insertDescriptionList(editor: TiptapEditor) {
  editor
    .chain()
    .focus()
    .insertContent({
      type: "descriptionList",
      content: [
        { type: "descriptionTerm", content: [{ type: "text", text: "用語" }] },
        {
          type: "descriptionDetail",
          content: [{ type: "paragraph", content: [{ type: "text", text: "説明" }] }],
        },
      ],
    })
    .run();
}

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
    // The tag-preserving Bold/Italic replacements (tag-preserving-marks.ts)
    // don't register toggleBold/toggleItalic commands; toggle the marks
    // generically instead.
    case "bold":
      chain.toggleMark("bold").run();
      break;
    case "italic":
      chain.toggleMark("italic").run();
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
    case "link":
      void insertLink(editor);
      break;
    case "linkCard":
      void insertLinkCard(editor);
      break;
    // Generic "remove all inline marks at cursor". Subsumes the old
    // "unlink" behaviour: anything wrapped around the current selection
    // (link, italic, bold, sup, sub, mark, cite, small, ins, del, u, abbr,
    // q, kbd, var) is stripped in one shot, so users don't need a separate
    // menu entry per mark type.
    case "unlink":
      chain.unsetAllMarks().run();
      break;
    case "table":
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      break;
    case "details":
      chain
        .insertContent({
          type: "details",
          attrs: { open: true, defaultState: "preserve" },
          // Leave both inner nodes empty so CSS-based placeholders
          // ("タイトル" / "本文") show until the user types something.
          content: [{ type: "summary" }, { type: "paragraph" }],
        })
        .run();
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
    // Inline annotation marks added for translator-output preservation.
    // toggleMark works uniformly: applies if absent on selection, removes
    // if present. The unusual internal name "highlight" matches the
    // <mark> extension declared in inline-marks.ts.
    case "sup":
    case "sub":
    case "small":
    case "cite":
    case "ins":
    case "del":
    case "underline":
      chain.toggleMark(id).run();
      break;
    case "mark":
      chain.toggleMark("highlight").run();
      break;
    case "abbr":
      void insertAbbr(editor);
      break;
    case "ruby":
      void insertRuby(editor);
      break;
    case "dl":
      insertDescriptionList(editor);
      break;
  }
}
