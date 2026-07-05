// Markdown-style input shortcuts for the designMode iframe (HtmlSource).
// Typing markdown markers converts to real HTML elements, mirroring what
// Tiptap's input rules do in the WYSIWYG editor:
//
//   Block (trigger: Space after the marker at the start of a paragraph)
//     #..######  → h1..h6
//     - * +      → unordered list
//     1.         → ordered list
//     >          → blockquote
//   Block (trigger: Enter on a marker-only paragraph)
//     ---  ***  ___ → horizontal rule
//     ```           → code block (pre)
//   Inline (trigger: typing the closing marker character)
//     **bold**   → <strong>    *italic*   → <em>
//     `code`     → <code>      ~~strike~~ → <s>
//
// Mutations go through execCommand so the browser's undo stack stays intact
// (Cmd+Z reverts the conversion, then the marker text). Exception: inline
// code is built via direct DOM insertion because Chrome's insertHTML
// sanitizer rewrites <code> to a styled <span>.

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "BODY",
]);

function closestBlock(node: Node | null): HTMLElement | null {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  while (el && !BLOCK_TAGS.has(el.tagName)) el = el.parentElement;
  return el;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// execCommand("formatBlock") builds a fresh element, dropping the source
// block's attributes (class/id/data-*). Capture them before the conversion
// and graft them onto the resulting block, so e.g. <p class="poem"> keeps its
// class when it becomes a heading. Shared with the selection toolbar.
export function formatBlockPreservingAttrs(doc: Document, tag: string) {
  const sel = doc.getSelection();
  const before = closestBlock(sel?.anchorNode ?? null);
  const attrs =
    before && before.tagName !== "BODY"
      ? before.getAttributeNames().map((n) => [n, before.getAttribute(n) ?? ""] as const)
      : [];
  doc.execCommand("formatBlock", false, `<${tag}>`);
  const after = closestBlock(doc.getSelection()?.anchorNode ?? null);
  if (!after || after === before || after.tagName === "BODY") return;
  for (const [name, value] of attrs) {
    if (!after.hasAttribute(name)) after.setAttribute(name, value);
  }
}

// Inline patterns, tried in order. Each must anchor at the end of the text
// including the character just typed (which is not in the DOM yet).
const INLINE_RULES: { key: string; re: RegExp; tag: string; cmd?: string }[] = [
  // (?<![*\w]) rejects the first closing star of a ** pair and mid-word stars.
  { key: "*", re: /\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, tag: "strong", cmd: "bold" },
  { key: "*", re: /(?<![*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/, tag: "em", cmd: "italic" },
  { key: "`", re: /`([^`]+)`$/, tag: "code" },
  { key: "~", re: /~~([^~\s](?:[^~]*[^~\s])?)~~$/, tag: "s", cmd: "strikeThrough" },
];

export function attachMarkdownInputRules(doc: Document): () => void {
  const exec = (command: string, value?: string) => {
    doc.execCommand(command, false, value);
  };

  // Select [from, to) inside a single text node.
  const selectRange = (node: Node, from: number, to: number) => {
    const sel = doc.getSelection();
    if (!sel) return false;
    const range = doc.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // isComposing: Space/Enter drive IME conversion while composing Japanese
    // input — never treat those as markdown triggers.
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const sel = doc.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return;
    const anchor = sel.anchorNode;
    if (!anchor) return;
    const block = closestBlock(anchor);
    if (!block) return;
    // Never transform inside code contexts.
    if (block.tagName === "PRE" || (anchor.parentElement?.closest("code, pre") ?? null)) return;

    if (e.key === " ") {
      // Only convert plain paragraphs; leave headings/lists/quotes alone.
      if (block.tagName !== "P" && block.tagName !== "DIV" && block.tagName !== "BODY") return;
      const toCaret = doc.createRange();
      toCaret.setStart(block, 0);
      toCaret.setEnd(anchor, sel.anchorOffset);
      const marker = toCaret.toString();

      let apply: (() => void) | null = null;
      const heading = marker.match(/^(#{1,6})$/);
      if (heading) {
        const level = heading[1].length;
        apply = () => formatBlockPreservingAttrs(doc, `h${level}`);
      } else if (/^[-*+]$/.test(marker)) {
        apply = () => exec("insertUnorderedList");
      } else if (/^\d{1,9}\.$/.test(marker)) {
        apply = () => exec("insertOrderedList");
      } else if (marker === ">") {
        apply = () => formatBlockPreservingAttrs(doc, "blockquote");
      }
      if (!apply) return;

      e.preventDefault();
      sel.removeAllRanges();
      sel.addRange(toCaret);
      exec("delete");
      apply();
      return;
    }

    if (e.key === "Enter") {
      const text = block.textContent ?? "";
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(text)) {
        e.preventDefault();
        const all = doc.createRange();
        all.selectNodeContents(block);
        sel.removeAllRanges();
        sel.addRange(all);
        exec("delete");
        exec("insertHorizontalRule");
        return;
      }
      if (/^```/.test(text)) {
        e.preventDefault();
        const all = doc.createRange();
        all.selectNodeContents(block);
        sel.removeAllRanges();
        sel.addRange(all);
        exec("delete");
        formatBlockPreservingAttrs(doc, "pre");
        return;
      }
      return;
    }

    // Inline rules: the typed character completes the closing marker. The
    // whole pattern must live in one text node (true for normally typed text).
    if (e.key === "*" || e.key === "`" || e.key === "~") {
      if (anchor.nodeType !== Node.TEXT_NODE) return;
      const offset = sel.anchorOffset;
      const candidate = (anchor.textContent ?? "").slice(0, offset) + e.key;
      for (const rule of INLINE_RULES) {
        if (rule.key !== e.key) continue;
        const m = candidate.match(rule.re);
        if (!m || m.index === undefined) continue;
        e.preventDefault();
        // Replace the marked span (sans the never-inserted final char).
        if (!selectRange(anchor, m.index, offset)) return;
        if (rule.tag === "code") {
          // Chrome's insertHTML sanitizer rewrites <code> to a styled <span>;
          // build the element directly instead. (Not on the undo stack, but
          // the semantic tag matters more for saved files.)
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const el = doc.createElement("code");
          el.textContent = m[1];
          range.insertNode(el);
          // A bare caret after </code> binds back inside the element, so
          // subsequent typing would extend the code span. Park the caret in
          // a zero-width-space text node instead; the serializer strips
          // U+200B on save (see cleanBodyInnerHTML).
          const anchorText = doc.createTextNode("\u200B");
          el.after(anchorText);
          const after = doc.createRange();
          after.setStart(anchorText, 1);
          after.collapse(true);
          sel.removeAllRanges();
          sel.addRange(after);
          // Manual DOM surgery doesn't fire an input event; emit one so the
          // host serializes the change.
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          exec("insertHTML", `<${rule.tag}>${escapeHtml(m[1])}</${rule.tag}>`);
          // Chrome keeps the inline format "sticky" for the next characters
          // typed after the inserted element; toggle it back off.
          if (rule.cmd && doc.queryCommandState(rule.cmd)) exec(rule.cmd);
        }
        return;
      }
    }
  };

  doc.addEventListener("keydown", onKeyDown);
  return () => doc.removeEventListener("keydown", onKeyDown);
}
