"use client";

import { useEffect, useRef } from "react";

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
//   - elements: our copy buttons, Grammarly's injected custom elements.
//   - attributes: ad-filter / Grammarly / LanguageTool markers.
const INJECTED_ELEMENT_SELECTOR =
  "button.copy-btn, grammarly-extension, grammarly-desktop-integration";
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
  return clone.innerHTML;
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
      const onKeyDown = (e: KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          const html = serialize();
          lastEmittedRef.current = html;
          onChangeRef.current(html);
          onSaveRef.current?.(html);
        }
      };
      doc.addEventListener("input", onInput);
      doc.addEventListener("keydown", onKeyDown);
      detach = () => {
        doc.removeEventListener("input", onInput);
        doc.removeEventListener("keydown", onKeyDown);
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
