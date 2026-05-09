"use client";

import { Image } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { useEffect } from "react";

export function Editor({
  content,
  onChange,
}: {
  content: string;
  onChange: (html: string) => void;
}) {
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
    ],
    content,
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== content) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  if (!editor) return null;

  return (
    <div className="h-full overflow-y-auto bg-canvas">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="fade-in" />
    </div>
  );
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null;

  const TextBtn = ({
    onClick,
    active,
    label,
    glyph,
  }: {
    onClick: () => void;
    active?: boolean;
    label: string;
    glyph?: "bold" | "italic" | "strike";
  }) => (
    <button
      type="button"
      onClick={onClick}
      data-glyph={glyph}
      className={`tb-btn ${active ? "is-active" : ""}`}
    >
      {label}
    </button>
  );

  const IconBtn = ({
    onClick,
    active,
    title,
    children,
  }: {
    onClick: () => void;
    active?: boolean;
    title: string;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`tb-btn ${active ? "is-active" : ""}`}
    >
      {children}
    </button>
  );

  return (
    <div className="sticky top-0 z-10 flex items-center px-5 py-2.5 border-b border-[var(--border-subtle)] bg-canvas">
      <TextBtn
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive("heading", { level: 1 })}
        label="H1"
      />
      <TextBtn
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive("heading", { level: 2 })}
        label="H2"
      />
      <TextBtn
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive("heading", { level: 3 })}
        label="H3"
      />
      <span className="tb-divider" />
      <TextBtn
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
        glyph="bold"
        label="B"
      />
      <TextBtn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
        glyph="italic"
        label="I"
      />
      <TextBtn
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
        glyph="strike"
        label="S"
      />
      <IconBtn
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
        title="Inline code"
      >
        <InlineCodeIcon />
      </IconBtn>
      <span className="tb-divider" />
      <IconBtn
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
        title="Bullet list"
      >
        <BulletListIcon />
      </IconBtn>
      <IconBtn
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
        title="Numbered list"
      >
        <OrderedListIcon />
      </IconBtn>
      <IconBtn
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
        title="Blockquote"
      >
        <QuoteIcon />
      </IconBtn>
      <IconBtn
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive("codeBlock")}
        title="Code block"
      >
        <CodeBlockIcon />
      </IconBtn>
      <span className="tb-divider" />
      <IconBtn
        onClick={() => {
          const url = window.prompt("URL");
          if (url) editor.chain().focus().setLink({ href: url }).run();
        }}
        title="Add link"
      >
        <LinkIcon />
      </IconBtn>
      <IconBtn
        onClick={() => editor.chain().focus().unsetLink().run()}
        title="Remove link"
      >
        <UnlinkIcon />
      </IconBtn>
      <IconBtn
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
        title="Insert table"
      >
        <TableIcon />
      </IconBtn>
      <IconBtn
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
      >
        <RuleIcon />
      </IconBtn>
    </div>
  );
}

/* ============================================================
   Toolbar icons (16x16 viewBox, stroke-based)
   ============================================================ */

function BulletListIcon() {
  return (
    <svg viewBox="0 0 16 16" className="tb-icon">
      <circle cx="3" cy="4.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="3" cy="8" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="3" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <path d="M6 4.5h7M6 8h7M6 11.5h7" />
    </svg>
  );
}

function OrderedListIcon() {
  return (
    <svg viewBox="0 0 16 16" className="tb-icon">
      <path d="M6 4.5h7M6 8h7M6 11.5h7" />
      <text
        x="2"
        y="5.6"
        fontSize="3.6"
        fontWeight="600"
        fill="currentColor"
        stroke="none"
        fontFamily="ui-monospace, monospace"
      >
        1
      </text>
      <text
        x="2"
        y="9.1"
        fontSize="3.6"
        fontWeight="600"
        fill="currentColor"
        stroke="none"
        fontFamily="ui-monospace, monospace"
      >
        2
      </text>
      <text
        x="2"
        y="12.6"
        fontSize="3.6"
        fontWeight="600"
        fill="currentColor"
        stroke="none"
        fontFamily="ui-monospace, monospace"
      >
        3
      </text>
    </svg>
  );
}

function QuoteIcon() {
  return (
    <svg viewBox="0 0 16 16" className="tb-icon">
      <path d="M3.5 5v6M3.5 5h2.5v3H3.5M9 5v6M9 5h2.5v3H9" />
    </svg>
  );
}

function InlineCodeIcon() {
  return (
    <svg viewBox="0 0 16 16" className="tb-icon">
      <path d="M5.5 5L2.5 8l3 3M10.5 5l3 3-3 3" />
    </svg>
  );
}

function CodeBlockIcon() {
  return (
    <svg viewBox="0 0 16 16" className="tb-icon">
      <rect x="2" y="3.5" width="12" height="9" rx="1.2" />
      <path d="M6 7l-1.5 1.5L6 10M10 7l1.5 1.5L10 10" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" className="tb-icon">
      <path d="M7 9.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l2-2a2.5 2.5 0 0 1 3.5 0" />
      <path d="M9 6.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-2 2a2.5 2.5 0 0 1-3.5 0" />
    </svg>
  );
}

function UnlinkIcon() {
  return (
    <svg viewBox="0 0 16 16" className="tb-icon">
      <path d="M7 9.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1" />
      <path d="M9 6.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1" />
      <path d="M2 14L14 2" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg viewBox="0 0 16 16" className="tb-icon">
      <rect x="2" y="3.5" width="12" height="9" rx="0.8" />
      <path d="M2 7h12M2 10h12M6 3.5v9M10 3.5v9" />
    </svg>
  );
}

function RuleIcon() {
  return (
    <svg viewBox="0 0 16 16" className="tb-icon">
      <path d="M2 8h12" strokeWidth="1.8" />
      <circle cx="3" cy="4" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="13" cy="12" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
