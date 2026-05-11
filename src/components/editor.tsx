"use client";

import { Details, type DetailsDefaultState, Summary } from "@/lib/details-node";
import { extractImageFilesFromDataTransfer, uploadImage } from "@/lib/upload-image";
import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, type Editor as TiptapEditor, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { type MutableRefObject, useEffect, useState } from "react";
import { toast } from "sonner";

export function Editor({
  content,
  onChange,
  editorRef,
}: {
  content: string;
  onChange: (html: string) => void;
  editorRef?: MutableRefObject<TiptapEditor | null>;
}) {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    detailsPos: number;
    current: DetailsDefaultState;
  } | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer" },
      }),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Details,
      Summary,
    ],
    content,
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
      handlePaste: (view, event) => {
        const files = extractImageFilesFromDataTransfer(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        uploadAndInsert(view, files);
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
    if (editor.getHTML() !== content) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

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
    <div className="h-full overflow-y-auto bg-canvas">
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
function applyDetailsMode(
  editor: TiptapEditor,
  detailsPos: number,
  mode: DetailsDefaultState,
) {
  const node = editor.state.doc.nodeAt(detailsPos);
  if (!node || node.type.name !== "details") return;
  const tr = editor.state.tr.setNodeAttribute(detailsPos, "defaultState", mode);
  if (mode === "on") tr.setNodeAttribute(detailsPos, "open", true);
  if (mode === "off") tr.setNodeAttribute(detailsPos, "open", false);
  editor.view.dispatch(tr);
}

async function uploadAndInsert(view: EditorView, files: File[], at?: number) {
  for (const file of files) {
    const toastId = toast.loading(`Uploading ${file.name || "image"}...`);
    try {
      const url = await uploadImage(file);
      const { schema } = view.state;
      const node = schema.nodes.image?.create({ src: url, alt: file.name || undefined });
      if (!node) {
        toast.error("Image node type not registered", { id: toastId });
        continue;
      }
      const pos = at ?? view.state.selection.from;
      const tr = view.state.tr.insert(pos, node);
      view.dispatch(tr);
      toast.success("Image uploaded", { id: toastId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast.error(message, { id: toastId });
    }
  }
}
