// Speech bubbles for plain DOM documents — html-editor's designMode view of
// hand-written files, where there is no TipTap schema. Produces the same
// markup as the TipTap node (speech-node.ts; documented in speech.ts): keep
// the two in sync.
//
// In designMode the name and the bubble are typed into directly. Two
// editor-only touches, both kept out of the saved file: the avatar is
// contenteditable=false (stripped by stripSpeechEditingAttrs), and an empty
// name shows a placeholder so it can still be clicked into — the theme hides
// an empty name otherwise (SPEECH_EDITING_CSS, a constructed sheet).

import {
  SPEECH_SELECTOR,
  type Speaker,
  type SpeechMenuActions,
  type SpeechSide,
  pickNextSpeaker,
  speechNameOf,
} from "@/lib/speech";

export const SPEECH_EDITING_CSS = `
[data-speech] > .speech-avatar { cursor: pointer; }
[data-speech] > .speech-avatar img { -webkit-user-drag: none; }
[data-speech] .speech-name:empty { display: block; min-height: 1.5em; }
[data-speech] .speech-name:empty::before { content: "名前"; color: var(--text-subtle); pointer-events: none; }
`;

const LIST_ITEM = "li, dt, dd, td, th";
const LIST_BLOCK = "ul, ol, dl, table";
const BLOCK = "p, h1, h2, h3, h4, h5, h6, pre, blockquote, figure, details, hr";

function speakerOf(el: HTMLElement): Speaker {
  return {
    name: speechNameOf(el),
    avatar: el.querySelector(":scope > .speech-avatar img")?.getAttribute("src") || null,
    side: el.getAttribute("data-side") === "right" ? "right" : "left",
  };
}

function setAvatar(speech: HTMLElement, url: string | null) {
  const avatar = speech.querySelector<HTMLElement>(":scope > .speech-avatar");
  if (!avatar) return;
  if (!url) {
    avatar.replaceChildren();
    return;
  }
  const img = speech.ownerDocument.createElement("img");
  img.setAttribute("src", url);
  img.setAttribute("alt", "");
  avatar.replaceChildren(img);
}

function setSide(speech: HTMLElement, side: SpeechSide) {
  if (side === "right") speech.setAttribute("data-side", "right");
  else speech.removeAttribute("data-side");
}

// Every bubble sharing this one's name (just this one when it has none).
function sameSpeaker(doc: Document, speech: HTMLElement): HTMLElement[] {
  const name = speechNameOf(speech);
  if (!name) return [speech];
  return Array.from(doc.querySelectorAll<HTMLElement>(SPEECH_SELECTOR)).filter(
    (s) => speechNameOf(s) === name,
  );
}

// Make every avatar uneditable — on load, and for a bubble just inserted.
export function prepareDomSpeeches(doc: Document): void {
  for (const avatar of doc.querySelectorAll(`${SPEECH_SELECTOR} > .speech-avatar`)) {
    avatar.setAttribute("contenteditable", "false");
  }
}

// Insert a bubble beside the block holding the caret, by the same rule as
// insertDomToc (an empty paragraph is replaced, a list/table item puts it
// after the whole list/table, anything else goes right after the block) —
// and after the enclosing bubble when the caret is in one. The speaker
// alternates (pickNextSpeaker); the caret lands in the bubble when the name
// is already known, in the name otherwise.
export function insertDomSpeech(doc: Document): void {
  const speech = doc.createElement("div");
  speech.className = "speech";
  speech.setAttribute("data-speech", "");
  const avatar = doc.createElement("div");
  avatar.className = "speech-avatar";
  const body = doc.createElement("div");
  body.className = "speech-body";
  const name = doc.createElement("div");
  name.className = "speech-name";
  const bubble = doc.createElement("div");
  bubble.className = "speech-bubble";
  const p = doc.createElement("p");
  p.appendChild(doc.createElement("br"));
  bubble.appendChild(p);
  body.append(name, bubble);
  speech.append(avatar, body);

  const sel = doc.getSelection();
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  const node = range?.startContainer ?? null;
  const el = node
    ? node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement
    : null;
  let outer: Element | null = el?.closest(SPEECH_SELECTOR) ?? null;
  for (let up = outer?.parentElement?.closest(SPEECH_SELECTOR); up; ) {
    outer = up;
    up = up.parentElement?.closest(SPEECH_SELECTOR);
  }
  const block = el?.closest(LIST_ITEM) ? el.closest(LIST_BLOCK) : el?.closest(BLOCK);

  if (outer) {
    outer.after(speech);
  } else if (block) {
    const empty = block.matches("p") && !block.textContent?.trim() && !block.querySelector("img");
    if (empty) block.replaceWith(speech);
    else block.after(speech);
  } else if (range && el && doc.body.contains(el)) {
    range.collapse(true);
    range.insertNode(speech);
  } else {
    doc.body.appendChild(speech);
  }

  const previous = Array.from(doc.querySelectorAll<HTMLElement>(SPEECH_SELECTOR))
    .filter((s) => s.compareDocumentPosition(speech) & Node.DOCUMENT_POSITION_FOLLOWING)
    .map(speakerOf);
  const speaker = pickNextSpeaker(previous);
  setSide(speech, speaker.side);
  setAvatar(speech, speaker.avatar);
  name.textContent = speaker.name;
  prepareDomSpeeches(doc);

  const caret = doc.createRange();
  caret.setStart(speaker.name ? p : name, 0);
  caret.collapse(true);
  sel?.removeAllRanges();
  sel?.addRange(caret);
  speech.scrollIntoView({ block: "nearest" });
}

// Enter in a bubble's name moves on to the bubble instead of breaking the
// name into lines. Returns true when it handled the key.
export function handleSpeechNameEnter(doc: Document): boolean {
  const sel = doc.getSelection();
  const node = sel?.anchorNode;
  const el = node
    ? node.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node.parentElement
    : null;
  const name = el?.closest(`${SPEECH_SELECTOR} .speech-name`);
  const bubble = name?.parentElement?.querySelector(":scope > .speech-bubble");
  if (!sel || !bubble) return false;
  const first = bubble.firstElementChild ?? bubble;
  const r = doc.createRange();
  r.setStart(first, 0);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  return true;
}

// The avatar menu's actions for a designMode document. Icon and side apply
// to every bubble with the same name (speech.ts), delete to this one only.
export function domSpeechActions(doc: Document, emit: () => void): SpeechMenuActions {
  return {
    setAvatar: (speech, url) => {
      for (const s of sameSpeaker(doc, speech)) setAvatar(s, url);
      emit();
    },
    swapSide: (speech) => {
      const side: SpeechSide = speech.getAttribute("data-side") === "right" ? "left" : "right";
      for (const s of sameSpeaker(doc, speech)) setSide(s, side);
      emit();
    },
    remove: (speech) => {
      speech.remove();
      emit();
    },
  };
}

// Editor-only state on bubbles, removed from the serialized copy: the
// avatar's contenteditable, and the <br> designMode leaves in a name that
// was emptied (the theme hides only a truly empty name).
export function stripSpeechEditingAttrs(root: Element): void {
  for (const speech of root.querySelectorAll(SPEECH_SELECTOR)) {
    speech.querySelector(":scope > .speech-avatar")?.removeAttribute("contenteditable");
    const name = speech.querySelector(":scope > .speech-body > .speech-name");
    if (name && !name.textContent?.trim() && !name.querySelector("img")) name.replaceChildren();
  }
}
