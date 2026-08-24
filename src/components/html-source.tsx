"use client";

import { attachImageResizer } from "@/lib/image-resize";
import { isSingleUrl } from "@/lib/link-card";
import { attachMarkdownInputRules, formatBlockPreservingAttrs } from "@/lib/md-input-rules";
import { type ToolbarButton, attachSelectionToolbar } from "@/lib/selection-toolbar";
import {
  DEFAULT_IMAGE_WIDTH,
  extractImageFilesFromDataTransfer,
  measureImageFile,
  stripImageExtension,
  uploadImage,
} from "@/lib/upload-image";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

// Split a full document into the wrapper around <body>...</body>. Returns null
// when <body> can't be located (caller falls back to whole-doc serialization).
function computeWrap(src: string): { prefix: string; suffix: string } | null {
  const open = src.match(/<body[^>]*>/i);
  if (!open || open.index === undefined) return null;
  const start = open.index + open[0].length;
  const end = src.lastIndexOf("</body>");
  if (end < start) return null;
  return { prefix: src.slice(0, start), suffix: src.slice(end) };
}

// Runtime-injected nodes/attributes that scripts (the page's own and browser
// extensions') add to the live DOM. They must NOT be baked into the saved file,
// or e.g. the copy buttons would duplicate on every reopen.
//   - elements: our copy buttons, the image-resize overlay ([data-he-ui]),
//     Grammarly's injected custom elements.
//   - attributes: ad-filter / Grammarly / LanguageTool markers.
const INJECTED_ELEMENT_SELECTOR =
  "button.copy-btn, [data-he-ui], grammarly-extension, grammarly-desktop-integration";
const INJECTED_ATTR = /^(data-ab-filters|data-gr-|data-new-gr-|data-gramm|data-lt-)/i;
const INJECTED_ATTR_EXACT = new Set(["cz-shortcut-listen"]);

// Serialize the body's *authored* inner HTML — a clone with runtime-injected
// nodes/attributes stripped — so saves stay clean even with page scripts and
// extensions running in the preview.
function cleanBodyInnerHTML(body: HTMLElement): string {
  const clone = body.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll(INJECTED_ELEMENT_SELECTOR)) el.remove();
  for (const el of clone.querySelectorAll<HTMLElement>("*")) {
    for (const name of el.getAttributeNames()) {
      if (INJECTED_ATTR.test(name) || INJECTED_ATTR_EXACT.has(name)) el.removeAttribute(name);
    }
  }
  // U+200B: caret anchors left behind by the markdown inline-code input rule
  // (see md-input-rules.ts) — editing aids, never authored content.
  return clone.innerHTML.replace(/\u200B/g, "");
}

// Full-document HTML editor that edits the *rendered* page directly.
//
// The file is loaded into a same-origin iframe with scripts ENABLED, so it
// renders and behaves exactly as when opened normally (copy buttons, theme.js,
// CSS tabs). The document is put into designMode so the user types straight
// onto the rendered content. On save we reassemble original-wrapper +
// cleaned-body (see cleanBodyInnerHTML / computeWrap): the <head>/doctype/
// scripts come verbatim from the source and only the edited <body> is written
// back, with script-/extension-injected nodes stripped — so structural markup
// the WYSIWYG/Tiptap path would drop (<script>, inline styles, data-*
// attributes, tab radios) survives and runtime cruft never accumulates.
export function HtmlSource({
  content,
  onChange,
  onSave,
  path,
}: {
  content: string;
  onChange: (html: string) => void;
  onSave?: (html: string) => void;
  path?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  // Last HTML we emitted upward (so the echo coming back as `content` doesn't
  // trigger a reload that would reset the caret).
  const lastEmittedRef = useRef<string>("");
  // Last HTML we loaded into the iframe (to dedupe external reloads).
  const loadedRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const reloadRef = useRef<(html: string) => void>(() => {});
  // The original document's wrapper (everything up to and including <body ...>,
  // and from </body> on). Captured from the source we load so saves keep the
  // pristine <head>/<html> — never the live DOM's, which browser extensions
  // pollute with stray attributes/nodes even when page scripts are disabled.
  const wrapRef = useRef<{ prefix: string; suffix: string } | null>(null);

  // Set up the iframe once per file (path). Reading content via refs keeps the
  // listeners stable so keystrokes never tear down and re-attach them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally keyed on `path` so the document reloads only when the open file changes, not on every keystroke.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let detach: (() => void) | null = null;

    const attach = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      try {
        doc.designMode = "on";
      } catch {
        // designMode unavailable — fall back to a contentEditable body.
        if (doc.body) doc.body.contentEditable = "true";
      }
      // Reassemble as original-wrapper + edited-body so the saved file keeps
      // the source's exact <head>/<html>/<doctype> and only the visible body
      // reflects edits. Falls back to whole-document serialization if the
      // source had no locatable <body>.
      const serialize = () => {
        const wrap = wrapRef.current;
        if (wrap && doc.body) {
          return wrap.prefix + cleanBodyInnerHTML(doc.body) + wrap.suffix;
        }
        return (doc.doctype ? "<!DOCTYPE html>\n" : "") + doc.documentElement.outerHTML;
      };
      lastEmittedRef.current = serialize();
      const onInput = () => {
        const html = serialize();
        lastEmittedRef.current = html;
        onChangeRef.current(html);
      };
      // Keyboard shortcuts. designMode gives us ⌘B/⌘I/⌘U/⌘Z for free, but
      // Chrome's bold/italic produce <b>/<i> while the toolbar normalizes them
      // to <strong>/<em> — so those two are taken over here and routed through
      // the same commands the toolbar uses. The rest mirror the Tiptap
      // editor's bindings (headings, lists, quote, strike, inline code) so the
      // two HTML editors feel the same. Digits are read off e.code because the
      // shifted character depends on the layout.
      const cmd = docCommands(doc, onInput);
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.isComposing) return;
        if (!(e.metaKey || e.ctrlKey)) return;
        const key = e.key.toLowerCase();

        // App-wide shortcuts belong to the shell, which never sees keystrokes
        // made inside this iframe — hand them up to it.
        if (!e.altKey && (key === "p" || key === "\\" || e.code === "Backslash")) {
          e.preventDefault();
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: e.key,
              code: e.code,
              metaKey: e.metaKey,
              ctrlKey: e.ctrlKey,
              shiftKey: e.shiftKey,
              altKey: e.altKey,
            }),
          );
          return;
        }

        if (e.altKey) {
          // ⌘⌥0 → paragraph, ⌘⌥1–6 → heading, as in Tiptap.
          const digit = /^Digit([0-6])$/.exec(e.code);
          if (!digit) return;
          e.preventDefault();
          const level = Number(digit[1]);
          if (level === 0) cmd.setBlock("p");
          else cmd.toggleHeading(`h${level}`);
          return;
        }

        if (e.shiftKey) {
          if (e.code === "Digit7") {
            e.preventDefault();
            cmd.exec("insertOrderedList");
            return;
          }
          if (e.code === "Digit8") {
            e.preventDefault();
            cmd.exec("insertUnorderedList");
            return;
          }
          if (key === "b") {
            e.preventDefault();
            cmd.toggleBlockquote();
            return;
          }
          if (key === "s") {
            e.preventDefault();
            cmd.execInline("strikeThrough", "strike", "s");
            return;
          }
          // Anything else (⌘⇧Z redo…) stays with the browser.
        }

        if (key === "b") {
          e.preventDefault();
          cmd.execInline("bold", "b", "strong");
          return;
        }
        if (key === "i") {
          e.preventDefault();
          cmd.execInline("italic", "i", "em");
          return;
        }
        if (key === "e") {
          e.preventDefault();
          cmd.toggleCode();
          return;
        }
        if (key === "k") {
          e.preventDefault();
          applyLinkInDoc(doc, onInput);
          return;
        }
        if (key === "s") {
          e.preventDefault();
          const html = serialize();
          lastEmittedRef.current = html;
          onChangeRef.current(html);
          onSaveRef.current?.(html);
        }
      };
      // Image insertion: paste or drop an image file → upload to R2 → insert
      // an <img> at the caret/drop point. Without these handlers designMode
      // silently ignores pasted image files and a drop navigates the iframe
      // to the local file, blowing away the document.
      const onPaste = (e: ClipboardEvent) => {
        const files = extractImageFilesFromDataTransfer(e.clipboardData);
        if (files.length > 0) {
          e.preventDefault();
          const sel = doc.getSelection();
          const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
          void uploadAndInsertIntoDoc(doc, files, range, onInput);
          return;
        }
        // A URL pasted over selected text links that text instead of
        // replacing it. Anywhere else it stays an ordinary paste.
        const text = e.clipboardData?.getData("text/plain") ?? "";
        if (!isSingleUrl(text)) return;
        const sel = doc.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
        e.preventDefault();
        applyLinkInDoc(doc, onInput, text);
      };
      const onDragOver = (e: DragEvent) => {
        if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
      };
      const onDrop = (e: DragEvent) => {
        const files = extractImageFilesFromDataTransfer(e.dataTransfer);
        if (files.length === 0) return;
        e.preventDefault();
        const range = doc.caretRangeFromPoint?.(e.clientX, e.clientY) ?? null;
        void uploadAndInsertIntoDoc(doc, files, range, onInput);
      };
      // Click an image → corner handle → drag to resize (inline style width,
      // which serializes straight into the saved body).
      const detachResizer = attachImageResizer({
        doc,
        isTarget: () => true,
        onResizeEnd: () => onInput(),
      });
      // Markdown-style typing shortcuts ("### " → <h3>, "**b**" → <strong>…).
      const detachMdRules = attachMarkdownInputRules(doc);
      // Floating format toolbar on text selection (bold/heading/list/link…).
      const detachToolbar = attachSelectionToolbar({
        doc,
        buttons: buildToolbarButtons(doc, onInput),
        isEligible: () => true,
      });
      doc.addEventListener("input", onInput);
      doc.addEventListener("keydown", onKeyDown);
      doc.addEventListener("paste", onPaste);
      doc.addEventListener("dragover", onDragOver);
      doc.addEventListener("drop", onDrop);
      detach = () => {
        detachResizer();
        detachMdRules();
        detachToolbar();
        doc.removeEventListener("input", onInput);
        doc.removeEventListener("keydown", onKeyDown);
        doc.removeEventListener("paste", onPaste);
        doc.removeEventListener("dragover", onDragOver);
        doc.removeEventListener("drop", onDrop);
      };
    };

    const reload = (html: string) => {
      detach?.();
      detach = null;
      loadedRef.current = html;
      wrapRef.current = computeWrap(html);
      iframe.addEventListener("load", attach, { once: true });
      iframe.srcdoc = html;
    };
    reloadRef.current = reload;

    reload(contentRef.current);

    return () => {
      iframe.removeEventListener("load", attach);
      detach?.();
    };
  }, [path]);

  // External replacement of the document (e.g. conflict reload from disk):
  // reload the iframe, but ignore our own edit echoes and the value we just
  // loaded.
  useEffect(() => {
    if (content === lastEmittedRef.current) return;
    if (content === loadedRef.current) return;
    reloadRef.current(content);
  }, [content]);

  return (
    <div className="h-full overflow-hidden bg-white">
      <iframe
        ref={iframeRef}
        title="editable document"
        className="w-full h-full border-0"
        // Same-origin with scripts enabled so the preview behaves like the real
        // file (copy buttons, theme.js, CSS tabs). Saves stay clean via
        // cleanBodyInnerHTML, which strips runtime-injected nodes/attributes.
        sandbox="allow-scripts allow-same-origin allow-popups allow-modals allow-forms"
      />
    </div>
  );
}

// Chrome's inline execCommands emit presentational tags (<b>/<i>/<strike>).
// After a toggle-on, rename the elements the command touched to the semantic
// tags the markdown input rules produce, so saved files carry one consistent
// vocabulary (<strong>/<em>/<s>). Scoped to elements intersecting the
// selection inside its block, so authored tags elsewhere stay untouched.
function normalizeInlineTags(doc: Document, from: string, to: string) {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const saved = {
    sc: range.startContainer,
    so: range.startOffset,
    ec: range.endContainer,
    eo: range.endOffset,
  };
  const anchor = range.commonAncestorContainer;
  const anchorEl = anchor instanceof HTMLElement ? anchor : anchor.parentElement;
  const root =
    anchorEl?.closest("p, div, li, blockquote, h1, h2, h3, h4, h5, h6, pre, body") ?? doc.body;
  let changed = false;
  for (const el of Array.from(root.querySelectorAll(from))) {
    if (!range.intersectsNode(el)) continue;
    const repl = doc.createElement(to);
    for (const name of el.getAttributeNames()) repl.setAttribute(name, el.getAttribute(name) ?? "");
    while (el.firstChild) repl.appendChild(el.firstChild);
    el.replaceWith(repl);
    changed = true;
  }
  if (!changed) return;
  // The moved text nodes survive intact, so the pre-mutation boundaries can
  // usually be restored verbatim; best-effort otherwise.
  try {
    const r = doc.createRange();
    r.setStart(saved.sc, saved.so);
    r.setEnd(saved.ec, saved.eo);
    sel.removeAllRanges();
    sel.addRange(r);
  } catch {
    /* keep whatever selection the mutation left */
  }
}

// Set (or edit, or clear) a link in the designMode document — shared by the
// toolbar's リンク button, ⌘+K, and pasting a URL over a selection. Mirrors the
// Tiptap editor's insertLink: a caret inside a link targets that whole anchor
// and prefills its URL, selected text becomes the link, a caret in plain text
// gets the URL inserted as its own link text, and an empty URL unlinks.
// execCommand is used throughout so the change lands on the native undo stack.
function applyLinkInDoc(doc: Document, emit: () => void, presetUrl?: string) {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const node = sel.anchorNode;
  const el = node instanceof HTMLElement ? node : node?.parentElement;
  const existing = el?.closest("a") ?? null;
  if (sel.isCollapsed && existing) {
    const range = doc.createRange();
    range.selectNodeContents(existing);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  const raw = presetUrl ?? doc.defaultView?.prompt("URL", existing?.getAttribute("href") ?? "");
  // Cancelled (or no window to prompt from) — leave the document alone.
  if (raw == null) return;
  const href = raw.trim();
  if (!href) {
    if (existing) {
      doc.execCommand("unlink");
      emit();
    }
    return;
  }
  if (sel.isCollapsed) {
    doc.execCommand("insertHTML", false, `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`);
  } else {
    doc.execCommand("createLink", false, href);
  }
  emit();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// The designMode editing primitives, shared by the selection toolbar and the
// keyboard shortcuts so both produce identical markup — the toolbar's B has
// always normalized Chrome's <b> to <strong>, and ⌘B has to do the same or the
// saved tags would depend on which one the user reached for. Formatting goes
// through execCommand (undo-friendly, same as the markdown input rules);
// inline code is DOM surgery because Chrome's engine has no code command and
// its insertHTML sanitizer rewrites <code> (see md-input-rules.ts).
function docCommands(doc: Document, emit: () => void) {
  const exec = (cmd: string, val?: string) => {
    doc.execCommand(cmd, false, val);
    emit();
  };
  // Inline toggle + semantic-tag cleanup (only after a toggle-on; a
  // toggle-off leaves nothing new to rename).
  const execInline = (cmd: string, from: string, to: string) => {
    doc.execCommand(cmd, false);
    if (doc.queryCommandState(cmd)) normalizeInlineTags(doc, from, to);
    emit();
  };
  const state = (cmd: string) => {
    try {
      return doc.queryCommandState(cmd);
    } catch {
      return false;
    }
  };
  const blockValue = () => {
    try {
      return String(doc.queryCommandValue("formatBlock")).toLowerCase();
    } catch {
      return "";
    }
  };
  const anchorEl = (): HTMLElement | null => {
    const n = doc.getSelection()?.anchorNode;
    return n ? (n instanceof HTMLElement ? n : n.parentElement) : null;
  };
  const inTag = (selector: string) => Boolean(anchorEl()?.closest(selector));
  const setBlock = (tag: string) => {
    formatBlockPreservingAttrs(doc, tag);
    emit();
  };
  const toggleHeading = (tag: string) => {
    formatBlockPreservingAttrs(doc, blockValue() === tag ? "p" : tag);
    emit();
  };
  const toggleBlockquote = () => {
    if (inTag("blockquote")) {
      exec("outdent");
    } else {
      setBlock("blockquote");
    }
  };
  const toggleCode = () => {
    const existing = anchorEl()?.closest("code");
    if (existing?.parentNode) {
      const parent = existing.parentNode;
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
      existing.remove();
      emit();
      return;
    }
    const sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const code = doc.createElement("code");
    code.appendChild(range.extractContents());
    range.insertNode(code);
    const r = doc.createRange();
    r.selectNodeContents(code);
    sel.removeAllRanges();
    sel.addRange(r);
    emit();
  };
  return {
    exec,
    execInline,
    state,
    blockValue,
    inTag,
    setBlock,
    toggleHeading,
    toggleBlockquote,
    toggleCode,
  };
}

// Buttons for the selection toolbar in designMode.
function buildToolbarButtons(doc: Document, emit: () => void): ToolbarButton[] {
  const {
    exec,
    execInline,
    state,
    blockValue,
    inTag,
    toggleHeading,
    toggleBlockquote,
    toggleCode,
  } = docCommands(doc, emit);
  return [
    {
      label: "B",
      title: "太字",
      style: "font-weight: 700;",
      action: () => execInline("bold", "b", "strong"),
      isActive: () => state("bold"),
    },
    {
      label: "I",
      title: "斜体",
      style: "font-style: italic; font-family: Georgia, serif;",
      action: () => execInline("italic", "i", "em"),
      isActive: () => state("italic"),
    },
    {
      label: "S",
      title: "取り消し線",
      style: "text-decoration: line-through;",
      action: () => execInline("strikeThrough", "strike", "s"),
      isActive: () => state("strikeThrough"),
    },
    {
      label: "<>",
      title: "インラインコード",
      style: "font-family: ui-monospace, monospace; font-size: 11px;",
      action: toggleCode,
      isActive: () => inTag("code"),
    },
    { type: "separator" },
    {
      label: "H2",
      title: "見出し2",
      action: () => toggleHeading("h2"),
      isActive: () => blockValue() === "h2",
    },
    {
      label: "H3",
      title: "見出し3",
      action: () => toggleHeading("h3"),
      isActive: () => blockValue() === "h3",
    },
    { type: "separator" },
    {
      label: "•",
      title: "箇条書きリスト",
      action: () => exec("insertUnorderedList"),
      isActive: () => state("insertUnorderedList"),
    },
    {
      label: "1.",
      title: "番号付きリスト",
      action: () => exec("insertOrderedList"),
      isActive: () => state("insertOrderedList"),
    },
    {
      label: "❝",
      title: "引用",
      action: toggleBlockquote,
      isActive: () => inTag("blockquote"),
    },
    { type: "separator" },
    {
      label: "リンク",
      title: "リンクを設定",
      action: () => applyLinkInDoc(doc, emit),
      isActive: () => inTag("a"),
    },
    {
      label: "解除",
      title: "装飾を解除",
      action: () => {
        doc.execCommand("removeFormat");
        doc.execCommand("unlink");
        emit();
      },
    },
  ];
}

// Upload each file to R2 and insert an <img> into the designMode document at
// `range` (falls back to the current selection, then end of body). The width
// is capped at DEFAULT_IMAGE_WIDTH so large photos don't land full-bleed;
// the resizer handle adjusts it afterwards.
async function uploadAndInsertIntoDoc(
  doc: Document,
  files: File[],
  range: Range | null,
  emitChange: () => void,
) {
  for (const file of files) {
    const toastId = toast.loading(`Uploading ${file.name || "image"}...`);
    try {
      const [url, size] = await Promise.all([uploadImage(file), measureImageFile(file)]);
      const img = doc.createElement("img");
      img.src = url;
      const alt = stripImageExtension(file.name);
      if (alt) img.alt = alt;
      const width = size ? Math.min(size.width, DEFAULT_IMAGE_WIDTH) : DEFAULT_IMAGE_WIDTH;
      img.style.width = `${width}px`;
      img.style.maxWidth = "100%";
      img.style.height = "auto";

      let target = range;
      if (!target) {
        const sel = doc.getSelection();
        target = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      }
      if (target) {
        target.collapse(false);
        target.insertNode(img);
        // Insert subsequent files after this image, in order.
        target.setStartAfter(img);
        target.collapse(true);
      } else {
        doc.body.appendChild(img);
      }
      emitChange();
      toast.success("Image uploaded", { id: toastId });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast.error(message, { id: toastId });
    }
  }
}
