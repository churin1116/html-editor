"use client";

import { DescriptionDetail, DescriptionList, DescriptionTerm } from "@/lib/definition-list";
import { Details, type DetailsDefaultState, Summary } from "@/lib/details-node";
import { applyHtmlAction } from "@/lib/editor-actions";
import { attachImageResizer } from "@/lib/image-resize";
import {
  Abbr,
  Cite,
  Del,
  HtmlMark,
  InlineQuote,
  Ins,
  Kbd,
  Small,
  Sub,
  Sup,
  Underline,
  Var_,
} from "@/lib/inline-marks";
import { fetchLinkCardMeta, isSingleUrl } from "@/lib/link-card";
import { LinkCard } from "@/lib/link-card-node";
import { Aside, Div, Figcaption, Figure, ParagraphClass, Span } from "@/lib/passthrough-nodes";
import { Rp, Rt, Ruby } from "@/lib/ruby-nodes";
import { loadScroll, saveScroll } from "@/lib/scroll-memory";
import { Section } from "@/lib/section-node";
import { type ToolbarButton, attachSelectionToolbar } from "@/lib/selection-toolbar";
import { Bold, Italic } from "@/lib/tag-preserving-marks";
import {
  DEFAULT_IMAGE_WIDTH,
  extractImageFilesFromDataTransfer,
  measureImageFile,
  stripImageExtension,
  uploadImage,
} from "@/lib/upload-image";
import { Dropcursor } from "@tiptap/extension-dropcursor";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, type Editor as TiptapEditor, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { type MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

export function Editor({
  content,
  onChange,
  editorRef,
  editable = true,
  path,
  previewCss,
}: {
  content: string;
  onChange: (html: string) => void;
  editorRef?: MutableRefObject<TiptapEditor | null>;
  editable?: boolean;
  path?: string;
  previewCss?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const restoredPathRef = useRef<string | null>(null);

  // 強調 (em / i) の表示切替用に内容の言語を判定する。CJK/かなを含む、または
  // Latin 文字を含まない場合は日本語扱い (傍点表示)。Latin 主体で日本語を
  // 含まないときだけ "other" とし、西洋式の斜体に切り替える。既定 (空・新規
  // ファイル含む) は日本語前提。
  const contentLang = useMemo(() => {
    // タグ名 (<p>, <span> 等) の Latin に惑わされないよう、要素を除いた本文で判定。
    const text = content.replace(/<[^>]*>/g, "");
    const hasCJK = /[぀-ヿ㐀-鿿豈-﫿]/.test(text);
    const hasLatin = /[A-Za-z]/.test(text);
    return hasCJK || !hasLatin ? "ja" : "other";
  }, [content]);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    detailsPos: number;
    current: DetailsDefaultState;
  } | null>(null);

  const editor = useEditor({
    extensions: [
      // Disable StarterKit's Italic and Bold; the tag-preserving variants
      // below replace them so <i>/<em> and <b>/<strong> round-trip without
      // being flattened to <em>/<strong>.
      StarterKit.configure({ italic: false, bold: false }),
      Italic,
      Bold,
      // Extend Link so anchor attributes used by translator-output content
      // (role="doc-noteref", data-note-id) round-trip cleanly. Configure
      // target=null to suppress Tiptap's default target="_blank" merge,
      // since internal anchors (href="#...") in these files should not gain
      // a target attr they didn't originally have.
      Link.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            role: {
              default: null,
              parseHTML: (el) => el.getAttribute("role"),
              renderHTML: (attrs) => (attrs.role ? { role: attrs.role } : {}),
            },
            "data-note-id": {
              default: null,
              parseHTML: (el) => el.getAttribute("data-note-id"),
              renderHTML: (attrs) =>
                attrs["data-note-id"] ? { "data-note-id": attrs["data-note-id"] } : {},
            },
          };
        },
      }).configure({
        openOnClick: false,
        // biome-ignore lint/suspicious/noExplicitAny: HTMLAttributes typing rejects null but Tiptap accepts it as "omit this attr".
        HTMLAttributes: { rel: null, target: null, class: null } as any,
      }),
      // Enable ProseMirror's native node DnD + cut/copy/paste move so users
      // can rearrange existing images within the document. The width attribute
      // (px) backs the corner-drag resizer and round-trips as an inline style
      // so saved files render at the chosen size outside the editor too.
      Image.extend({
        draggable: true,
        addAttributes() {
          return {
            ...this.parent?.(),
            width: {
              default: null,
              parseHTML: (el) => {
                const styleWidth = el.style?.width;
                if (styleWidth?.endsWith("px")) {
                  const n = Number.parseInt(styleWidth, 10);
                  if (Number.isFinite(n)) return n;
                }
                const attr = el.getAttribute("width");
                if (attr) {
                  const n = Number.parseInt(attr, 10);
                  if (Number.isFinite(n)) return n;
                }
                return null;
              },
              renderHTML: (attrs) =>
                attrs.width
                  ? { style: `width: ${attrs.width}px; max-width: 100%; height: auto` }
                  : {},
            },
          };
        },
      }),
      // Show a colored insertion line while dragging nodes (or external files)
      // between paragraphs/images so the drop target is visually obvious.
      Dropcursor.configure({ color: "var(--primary)", width: 2 }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Details,
      Summary,
      Section,
      // Must come before Div: both claim <div>, and the card's parse rule
      // wins on priority, not on order — but keeping it adjacent documents
      // the relationship.
      LinkCard,
      Div,
      Aside,
      Figure,
      Figcaption,
      Span,
      Ruby,
      Rt,
      Rp,
      // Tier 1: inline semantic tags with high gutenberg-corpus usage.
      Sup,
      Sub,
      Small,
      Cite,
      HtmlMark,
      // Tier 2: definition lists (dl > dt + dd) for bibliographies,
      // dramatis personae, glossaries.
      DescriptionList,
      DescriptionTerm,
      DescriptionDetail,
      // Tier 4: low-frequency inline tags.
      Ins,
      Del,
      Underline,
      Abbr,
      Var_,
      InlineQuote,
      Kbd,
      ParagraphClass,
    ],
    content,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
    editorProps: {
      attributes: { class: "prose-canvas tiptap" },
      // Native <details> click toggle is suppressed inside contenteditable
      // (ProseMirror consumes the click for caret placement). Reimplement
      // it: a single click on the left ~30 px of a summary (where the arrow
      // sits) toggles the parent details. Clicks anywhere else on the title
      // row fall through and place the caret so the user can edit the text.
      handleClick: (view, pos, event) => {
        if (event.detail > 1) return false;
        const target = event.target as HTMLElement;
        const summaryEl = target.closest?.("summary");
        if (!summaryEl) return false;
        const rect = summaryEl.getBoundingClientRect();
        if (event.clientX - rect.left > 30) return false;
        const $pos = view.state.doc.resolve(pos);
        for (let d = $pos.depth; d >= 0; d--) {
          if ($pos.node(d).type.name === "details") {
            const detailsPos = d === 0 ? 0 : $pos.before(d);
            const detailsNode = view.state.doc.nodeAt(detailsPos);
            if (!detailsNode || detailsNode.type.name !== "details") return false;
            const tr = view.state.tr.setNodeAttribute(detailsPos, "open", !detailsNode.attrs.open);
            view.dispatch(tr);
            return true;
          }
        }
        return false;
      },
      // Double-click on a <figure>'s <img> jumps the caret into the sibling
      // <figcaption> at the end of its text. Single click keeps ProseMirror's
      // default image-selection behaviour. Cheap shortcut for the common case
      // "I dropped an image — now I want to write the caption."
      handleDoubleClick: (view, _pos, event) => {
        const target = event.target as HTMLElement;
        if (target.tagName !== "IMG") return false;
        const figureEl = target.closest("figure");
        if (!figureEl) return false;
        const figcaptionEl = figureEl.querySelector(":scope > figcaption");
        if (!figcaptionEl) return false;
        try {
          const endPos = view.posAtDOM(figcaptionEl, figcaptionEl.childNodes.length);
          const $end = view.state.doc.resolve(endPos);
          const tr = view.state.tr.setSelection(TextSelection.near($end));
          view.dispatch(tr);
          view.focus();
          return true;
        } catch {
          return false;
        }
      },
      handlePaste: (view, event) => {
        const files = extractImageFilesFromDataTransfer(event.clipboardData);
        if (files.length > 0) {
          event.preventDefault();
          uploadAndInsert(view, files);
          return true;
        }
        // A bare URL pasted into an empty paragraph becomes a card. Pasting
        // into text, or over a selection, stays an ordinary paste — the user
        // is quoting a URL, not filing a link.
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!isSingleUrl(text)) return false;
        const { selection, schema } = view.state;
        if (!selection.empty) return false;
        const parent = selection.$from.parent;
        if (parent.type.name !== "paragraph" || parent.content.size > 0) return false;
        if (!schema.nodes.linkCard) return false;
        event.preventDefault();
        void insertLinkCardAt(view, text.trim());
        return true;
      },
      handleDrop: (view, event) => {
        const dt = (event as DragEvent).dataTransfer;
        const files = extractImageFilesFromDataTransfer(dt);
        if (files.length === 0) return false;
        event.preventDefault();
        const coords = view.posAtCoords({
          left: (event as DragEvent).clientX,
          top: (event as DragEvent).clientY,
        });
        uploadAndInsert(view, files, coords?.pos);
        return true;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const externalChange = editor.getHTML() !== content;
    if (externalChange) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
    if (!path) return;
    const el = scrollRef.current;
    if (!el) return;
    // Restore when path changes (file switch / first mount) or when content
    // was replaced externally (e.g., conflict-dialog "Reload from disk").
    // Don't restore during regular typing — restoredPathRef ensures we only
    // restore once per path unless an external change forces a reset.
    if (externalChange || restoredPathRef.current !== path) {
      restoredPathRef.current = path;
      const savedTop = loadScroll(path);
      const id = requestAnimationFrame(() => {
        el.scrollTop = savedTop;
      });
      return () => cancelAnimationFrame(id);
    }
  }, [content, editor, path]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `editor` is intentional — the scroll-container div only mounts after useEditor returns a non-null instance.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !path) return;
    let timer: number | null = null;
    const flush = () => {
      saveScroll(path, el.scrollTop);
      timer = null;
    };
    const onScroll = () => {
      if (timer != null) return;
      timer = window.setTimeout(flush, 200);
    };
    const onPageHide = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
      saveScroll(path, el.scrollTop);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onPageHide);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      if (timer != null) {
        window.clearTimeout(timer);
        saveScroll(path, el.scrollTop);
      }
    };
    // `editor` is in deps because the scroll-container <div> only mounts once
    // useEditor returns an instance; without it this effect would fire too
    // early (when the component renders null) and never re-run.
  }, [path, editor]);

  useEffect(() => {
    if (!editor) return;
    if (editor.isEditable !== editable) editor.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (!editorRef) return;
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  // Right-click on a summary opens a small menu that pins the parent
  // <details>'s open/closed default state per-instance. Listen at the
  // document capture phase because ProseMirror consumes contextmenu before
  // it bubbles up to React's onContextMenu handler.
  useEffect(() => {
    if (!editor) return;
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const summary = target.closest?.("summary");
      if (!summary) return;
      if (!editor.view.dom.contains(summary)) return;
      const coords = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (!coords) return;
      const $pos = editor.state.doc.resolve(coords.pos);
      let detailsPos = -1;
      for (let d = $pos.depth; d >= 0; d--) {
        if ($pos.node(d).type.name === "details") {
          detailsPos = d === 0 ? 0 : $pos.before(d);
          break;
        }
      }
      if (detailsPos < 0) return;
      const detailsNode = editor.state.doc.nodeAt(detailsPos);
      if (!detailsNode || detailsNode.type.name !== "details") return;
      e.preventDefault();
      e.stopPropagation();
      setMenu({
        x: e.clientX,
        y: e.clientY,
        detailsPos,
        current: (detailsNode.attrs.defaultState as DetailsDefaultState) ?? "preserve",
      });
    };
    document.addEventListener("contextmenu", onContextMenu, true);
    return () => document.removeEventListener("contextmenu", onContextMenu, true);
  }, [editor]);

  // Corner-drag resizing for images: click an <img> to show the handle, drag
  // to resize, and persist the final width into the node's width attribute so
  // it serializes into the saved HTML.
  useEffect(() => {
    if (!editor) return;
    return attachImageResizer({
      doc: document,
      isTarget: (img) => editor.isEditable && editor.view.dom.contains(img),
      onResizeEnd: (img, width) => {
        const view = editor.view;
        let pos: number;
        try {
          pos = view.posAtDOM(img, 0);
        } catch {
          return;
        }
        // posAtDOM may resolve to the position before or inside the leaf
        // node depending on the DOM structure; check both.
        let node = view.state.doc.nodeAt(pos);
        let nodePos = pos;
        if (!node || node.type.name !== "image") {
          nodePos = pos - 1;
          node = nodePos >= 0 ? view.state.doc.nodeAt(nodePos) : null;
        }
        if (!node || node.type.name !== "image") return;
        view.dispatch(view.state.tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, width }));
      },
    });
  }, [editor]);

  // Floating format toolbar on text selection (mirrors the designMode
  // iframe's toolbar; actions go through the shared applyHtmlAction).
  useEffect(() => {
    if (!editor) return;
    return attachSelectionToolbar({
      doc: document,
      buttons: tiptapToolbarButtons(editor),
      isEligible: (sel) => {
        if (!editor.isEditable) return false;
        const n = sel.anchorNode;
        return Boolean(n && editor.view.dom.contains(n));
      },
    });
  }, [editor]);

  // Hint that only the left ~30 px (the arrow) is the toggle hot zone:
  // pointer there, text caret everywhere else on the summary.
  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const onMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const summary = target.closest?.("summary");
      if (!summary || !root.contains(summary)) return;
      const rect = summary.getBoundingClientRect();
      summary.style.cursor = e.clientX - rect.left <= 30 ? "pointer" : "text";
    };
    root.addEventListener("mousemove", onMove);
    return () => root.removeEventListener("mousemove", onMove);
  }, [editor]);

  if (!editor) return null;

  return (
    <div
      ref={scrollRef}
      data-content-lang={contentLang}
      className="h-full overflow-y-auto bg-canvas preview-css-scope"
    >
      {previewCss ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: previewCss is server-scoped to .preview-css-scope via scopeCss.
        <style dangerouslySetInnerHTML={{ __html: previewCss }} />
      ) : null}
      <EditorContent editor={editor} className="fade-in" />
      {menu && (
        <DetailsDefaultMenu
          x={menu.x}
          y={menu.y}
          current={menu.current}
          onClose={() => setMenu(null)}
          onPick={(mode) => {
            applyDetailsMode(editor, menu.detailsPos, mode);
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}

function DetailsDefaultMenu({
  x,
  y,
  current,
  onClose,
  onPick,
}: {
  x: number;
  y: number;
  current: DetailsDefaultState;
  onClose: () => void;
  onPick: (mode: DetailsDefaultState) => void;
}) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.("[data-details-default-menu]")) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const MENU_W = 220;
  const MENU_H = 124;
  const left = Math.min(x, window.innerWidth - MENU_W - 8);
  const top = Math.min(y, window.innerHeight - MENU_H - 8);

  return (
    <div
      data-details-default-menu
      role="menu"
      className="fixed z-50 min-w-[200px] py-1.5 rounded-md fade-in"
      style={{
        left,
        top,
        background: "var(--surface)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)",
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="px-3 pt-0.5 pb-1.5 text-[10.5px] tracking-[0.08em] uppercase text-[var(--text-subtle)]">
        この details の初期状態
      </div>
      <DetailsMenuItem active={current === "on"} label="開く" onClick={() => onPick("on")} />
      <DetailsMenuItem active={current === "off"} label="閉じる" onClick={() => onPick("off")} />
      <DetailsMenuItem
        active={current === "preserve"}
        label="前回のまま"
        onClick={() => onPick("preserve")}
      />
    </div>
  );
}

function DetailsMenuItem({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
    >
      <span className="inline-flex w-3 justify-center text-[var(--primary)]" aria-hidden="true">
        {active ? "•" : ""}
      </span>
      <span>{label}</span>
    </button>
  );
}

// Apply the chosen mode to a specific <details> node. Updates defaultState
// (which is what gets serialized to data-default-state) and, for on/off,
// flips the live open attribute too so the change is visible immediately.
function applyDetailsMode(editor: TiptapEditor, detailsPos: number, mode: DetailsDefaultState) {
  const node = editor.state.doc.nodeAt(detailsPos);
  if (!node || node.type.name !== "details") return;
  const tr = editor.state.tr.setNodeAttribute(detailsPos, "defaultState", mode);
  if (mode === "on") tr.setNodeAttribute(detailsPos, "open", true);
  if (mode === "off") tr.setNodeAttribute(detailsPos, "open", false);
  editor.view.dispatch(tr);
}

// Selection-toolbar buttons for the Tiptap editor. Same lineup as the
// designMode iframe's toolbar; actions reuse the sidebar's applyHtmlAction
// dispatcher so behaviour stays in sync with the toolbar menu.
function tiptapToolbarButtons(editor: TiptapEditor): ToolbarButton[] {
  return [
    {
      label: "B",
      title: "太字",
      style: "font-weight: 700;",
      action: () => applyHtmlAction(editor, "bold"),
      isActive: () => editor.isActive("bold"),
    },
    {
      label: "I",
      title: "斜体",
      style: "font-style: italic; font-family: Georgia, serif;",
      action: () => applyHtmlAction(editor, "italic"),
      isActive: () => editor.isActive("italic"),
    },
    {
      label: "S",
      title: "取り消し線",
      style: "text-decoration: line-through;",
      action: () => applyHtmlAction(editor, "strike"),
      isActive: () => editor.isActive("strike"),
    },
    {
      label: "<>",
      title: "インラインコード",
      style: "font-family: ui-monospace, monospace; font-size: 11px;",
      action: () => applyHtmlAction(editor, "code"),
      isActive: () => editor.isActive("code"),
    },
    { type: "separator" },
    {
      label: "H2",
      title: "見出し2",
      action: () => applyHtmlAction(editor, "h2"),
      isActive: () => editor.isActive("heading", { level: 2 }),
    },
    {
      label: "H3",
      title: "見出し3",
      action: () => applyHtmlAction(editor, "h3"),
      isActive: () => editor.isActive("heading", { level: 3 }),
    },
    { type: "separator" },
    {
      label: "•",
      title: "箇条書きリスト",
      action: () => applyHtmlAction(editor, "list"),
      isActive: () => editor.isActive("bulletList"),
    },
    {
      label: "1.",
      title: "番号付きリスト",
      action: () => applyHtmlAction(editor, "numList"),
      isActive: () => editor.isActive("orderedList"),
    },
    {
      label: "❝",
      title: "引用",
      action: () => applyHtmlAction(editor, "quote"),
      isActive: () => editor.isActive("blockquote"),
    },
    { type: "separator" },
    {
      label: "リンク",
      title: "リンクを設定",
      action: () => applyHtmlAction(editor, "link"),
      isActive: () => editor.isActive("link"),
    },
    {
      label: "解除",
      title: "装飾を解除",
      action: () => applyHtmlAction(editor, "unlink"),
    },
  ];
}

async function uploadAndInsert(view: EditorView, files: File[], at?: number) {
  for (const file of files) {
    const toastId = toast.loading(`Uploading ${file.name || "image"}...`);
    try {
      const [url, size] = await Promise.all([uploadImage(file), measureImageFile(file)]);
      const { schema } = view.state;
      const altText = stripImageExtension(file.name);
      // Cap the initial display width; natural width wins for small images so
      // icons aren't blown up. Resizable afterwards via the corner handle.
      const width = size ? Math.min(size.width, DEFAULT_IMAGE_WIDTH) : DEFAULT_IMAGE_WIDTH;
      const imageNode = schema.nodes.image?.create({
        src: url,
        alt: altText || undefined,
        width,
      });
      if (!imageNode) {
        toast.error("Image node type not registered", { id: toastId });
        continue;
      }

      // Wrap the image in <figure class="figure"><img><figcaption></figcaption></figure>.
      // The figcaption starts empty by design — if the user types a caption,
      // the figure semantics are kept; if they don't, unwrapEmptyFigures
      // strips the wrapper on save (so dropped decorative images don't leak
      // an empty <figure> into the output). Falls back to a bare <img> if
      // the schema lacks figure (defensive — shouldn't happen now that
      // Figure/Figcaption are in the default extension list).
      const figureType = schema.nodes.figure;
      const figcaptionType = schema.nodes.figcaption;
      let nodeToInsert = imageNode;
      if (figureType && figcaptionType) {
        const figcaption = figcaptionType.create(null);
        nodeToInsert = figureType.create({ class: "figure" }, [imageNode, figcaption]);
      }

      const pos = at ?? view.state.selection.from;
      const tr = view.state.tr.insert(pos, nodeToInsert);
      view.dispatch(tr);
      toast.success("Image uploaded", { id: toastId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast.error(message, { id: toastId });
    }
  }
}

// Turns a pasted URL into a card. The node is inserted only after its
// metadata is in hand, so the document never holds a half-built card that a
// save could catch mid-flight — and the paste is one undo step, not two.
// A page that yields nothing still becomes a card showing its URL.
async function insertLinkCardAt(view: EditorView, url: string) {
  const toastId = toast.loading("リンク情報を取得中…");
  const meta = await fetchLinkCardMeta(url);
  if (meta.title) toast.dismiss(toastId);
  else toast("リンク情報を取得できませんでした（URL のみのカードにします）", { id: toastId });
  // The fetch takes seconds; the file may have been closed or switched in the
  // meantime, which tears this view down.
  if (view.isDestroyed) return;
  // The document may have moved on too; drop the card at the caret rather
  // than at a remembered position.
  const type = view.state.schema.nodes.linkCard;
  if (!type) return;
  const node = type.create(meta);
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  view.focus();
}
