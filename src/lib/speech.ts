import { promptDialog } from "@/lib/dialogs";
import { extractImageFilesFromDataTransfer, uploadImage } from "@/lib/upload-image";
import { toast } from "sonner";

// Speech bubbles — an avatar beside a named bubble, for interviews and
// dialogues (xnote's interview block, rebuilt for files read on their own).
// Shared by the TipTap node (speech-node.ts) and the designMode helpers
// (speech-dom.ts), which both produce this markup — keep them in sync:
//
//   <div class="speech" data-speech data-side="right">     (data-side only when right)
//     <div class="speech-avatar"><img src="…" alt=""></div> (img only when set)
//     <div class="speech-body">
//       <div class="speech-name">名前</div>
//       <div class="speech-bubble"><p>…</p></div>
//     </div>
//   </div>
//
// The look comes from the Chameleon theme (theme.css, [data-speech]), so a
// saved file renders it with no script. The avatar is a plain <img>: its src
// is the only copy of the URL, and alt="" makes a failed load show the
// theme's silhouette instead of a broken-image glyph.
//
// Icon and side belong to the speaker, not the single bubble: changing them
// from the menu applies to every bubble with the same (non-empty) name, so an
// interview's icons are set once per person.
//
// Speakers are also remembered in this browser (localStorage — nothing leaves
// the machine): a new bubble starts as the speaker last worked on, in any
// file, and name + icon pairs are kept as saved speakers the menu offers to
// switch to, one per name. Typing only moves "last worked on"; a pair is
// saved when it is set from the menu or when a new bubble starts from it,
// so a name typed a letter at a time never leaves its half-typed stages in
// the list.

export const SPEECH_SELECTOR = "[data-speech]";
const AVATAR_SELECTOR = `${SPEECH_SELECTOR} > .speech-avatar`;

export type SpeechSide = "left" | "right";
export type Speaker = { name: string; avatar: string | null; side: SpeechSide };

// Same toast timing as editor.tsx: an update of a loading toast must state
// its own duration or it never goes away.
const TOAST_MS = 4000;

const LAST_KEY = "htmlEditor.speechLastSpeaker";
const SAVED_KEY = "htmlEditor.speechSpeakers";
const MAX_SAVED = 12;
const BLANK: Speaker = { name: "", avatar: null, side: "left" };

function isSpeaker(v: unknown): v is Speaker {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.name === "string" &&
    (s.avatar === null || typeof s.avatar === "string") &&
    (s.side === "left" || s.side === "right")
  );
}

function readStore(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStore(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — drop silently.
  }
}

export function savedSpeakers(): Speaker[] {
  const list = readStore(SAVED_KEY);
  return Array.isArray(list) ? list.filter(isSpeaker) : [];
}

// Typing in a bubble makes its speaker the last worked on once the typing
// pauses (flushed early if a bubble is inserted first).
let pending: Speaker | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
function flushPending() {
  clearTimeout(pendingTimer);
  if (pending) writeStore(LAST_KEY, pending);
  pending = null;
}
export function rememberSpeakerSoon(speaker: Speaker): void {
  pending = speaker;
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(flushPending, 600);
}

// Makes `speaker` the last worked on and, when it has both a name and an
// icon, (re)saves it at the head of the list. Supersedes any pending typing:
// a menu change to one bubble redraws the document, which the typing watch
// would otherwise credit to whichever bubble holds the caret.
function rememberSpeaker(speaker: Speaker): void {
  clearTimeout(pendingTimer);
  pending = null;
  writeStore(LAST_KEY, speaker);
  if (!speaker.name || !speaker.avatar) return;
  const rest = savedSpeakers().filter((s) => s.name !== speaker.name);
  writeStore(SAVED_KEY, [speaker, ...rest].slice(0, MAX_SAVED));
}

function forgetSpeaker(name: string): void {
  writeStore(
    SAVED_KEY,
    savedSpeakers().filter((s) => s.name !== name),
  );
}

// Who speaks in a newly inserted bubble: the speaker last worked on, which
// is saved to the list as it is reused.
export function speakerForNewBubble(): Speaker {
  flushPending();
  const last = readStore(LAST_KEY);
  const speaker = isSpeaker(last) ? last : BLANK;
  rememberSpeaker(speaker);
  return speaker;
}

export function speechNameOf(speech: Element): string {
  return speech.querySelector(":scope > .speech-body > .speech-name")?.textContent?.trim() ?? "";
}

// The speaker of a bubble as rendered (either editor).
export function speakerFromDom(speech: Element): Speaker {
  return {
    name: speechNameOf(speech),
    avatar: speech.querySelector(":scope > .speech-avatar img")?.getAttribute("src") || null,
    side: speech.getAttribute("data-side") === "right" ? "right" : "left",
  };
}

// What the menu does, implemented per editor: TipTap transactions or plain
// DOM edits. `speech` is the bubble's root element as rendered.
export type SpeechMenuActions = {
  // This bubble only: it is now someone else speaking.
  setSpeaker: (speech: HTMLElement, speaker: Speaker) => void;
  setAvatar: (speech: HTMLElement, url: string | null) => void;
  swapSide: (speech: HTMLElement) => void;
  remove: (speech: HTMLElement) => void;
};

// Clicking a bubble's avatar opens a small menu (switch to a saved speaker,
// change / remove the icon, swap sides, delete the bubble); dropping an image
// file onto the avatar uploads it as the icon. Framework-free so the same menu serves the TipTap
// editor and the designMode iframe. The menu carries data-he-ui, so
// HtmlSource's save-time cleaner never writes it into the file.
export function attachSpeechMenu(opts: {
  doc: Document;
  isTarget: (el: Element) => boolean;
  actions: SpeechMenuActions;
}): () => void {
  const { doc, isTarget, actions } = opts;
  const win = doc.defaultView;
  if (!win) return () => {};

  let menu: HTMLElement | null = null;
  let menuAvatar: HTMLElement | null = null;
  const close = () => {
    menu?.remove();
    menu = null;
    menuAvatar = null;
  };

  // A change made from the menu makes the bubble's speaker the remembered
  // one. Both editors have redrawn the bubble by the time `run` returns.
  const act = (speech: HTMLElement, run: () => void) => {
    run();
    if (speech.isConnected) rememberSpeaker(speakerFromDom(speech));
  };

  const avatarAt = (target: EventTarget | null): HTMLElement | null => {
    const el = (target as Element | null)?.closest?.<HTMLElement>(AVATAR_SELECTOR);
    return el && isTarget(el) ? el : null;
  };

  const upload = async (speech: HTMLElement, file: File) => {
    const toastId = toast.loading("アイコンをアップロード中…");
    try {
      const url = await uploadImage(file);
      toast.success("アイコンを設定しました", { id: toastId, duration: TOAST_MS });
      // The bubble may have been deleted (or the file closed) meanwhile.
      if (speech.isConnected) act(speech, () => actions.setAvatar(speech, url));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      toast.error(message, { id: toastId, duration: TOAST_MS });
    }
  };

  const pickFile = (speech: HTMLElement) => {
    const input = doc.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void upload(speech, file);
    });
    input.click();
  };

  const askUrl = async (speech: HTMLElement, current: string) => {
    const raw = await promptDialog({
      title: "アイコン画像の URL",
      description:
        "空にするとアイコンを外します。画像ファイルをアイコンにドロップしてもアップロードできます。",
      defaultValue: current,
      placeholder: "https://…",
      confirmLabel: "設定",
    });
    if (raw === null || !speech.isConnected) return;
    act(speech, () => actions.setAvatar(speech, raw.trim() || null));
  };

  const open = (avatar: HTMLElement) => {
    close();
    const speech = avatar.parentElement;
    if (!speech) return;
    const current = avatar.querySelector("img")?.getAttribute("src") ?? "";
    const name = speechNameOf(speech);

    const root = doc.createElement("div");
    root.setAttribute("data-he-ui", "");
    root.setAttribute("contenteditable", "false");
    root.setAttribute("role", "menu");
    root.style.cssText =
      "position: fixed; z-index: 2147483647; min-width: 200px; padding: 6px 0; border-radius: 8px; background: var(--surface, #fff); box-shadow: 0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06); font: 12px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; color: var(--text, #222); user-select: none;";

    const caption = (text: string) => {
      const el = doc.createElement("div");
      el.textContent = text;
      el.style.cssText =
        "padding: 2px 12px 6px; font-size: 10.5px; letter-spacing: 0.04em; color: var(--text-subtle, #999);";
      root.appendChild(el);
    };
    const hoverable = (el: HTMLElement) => {
      el.addEventListener("mouseenter", () => {
        el.style.background = "var(--surface-2, #f2f2f2)";
      });
      el.addEventListener("mouseleave", () => {
        el.style.background = "transparent";
      });
    };
    const button = (label: string, css: string, run: () => void) => {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      btn.textContent = label;
      btn.style.cssText = `border: none; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; ${css}`;
      btn.addEventListener("click", run);
      return btn;
    };
    const item = (label: string, run: () => void) => {
      const btn = button(label, "display: block; width: 100%; padding: 6px 12px;", () => {
        close();
        run();
      });
      hoverable(btn);
      root.appendChild(btn);
    };
    const separator = () => {
      const sep = doc.createElement("div");
      sep.style.cssText = "height: 1px; margin: 5px 0; background: var(--border-subtle, #eee);";
      root.appendChild(sep);
    };
    // A saved speaker: thumbnail + name switches this bubble to them; × drops
    // them from the list (the menu is redrawn in place).
    const speakerRow = (s: Speaker) => {
      const row = doc.createElement("div");
      row.style.cssText = "display: flex; align-items: center; padding-right: 4px;";
      hoverable(row);
      const pick = button(
        "",
        "flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 5px 12px;",
        () => {
          close();
          act(speech, () => actions.setSpeaker(speech, s));
        },
      );
      const thumb = doc.createElement("span");
      thumb.style.cssText =
        "flex: none; width: 20px; height: 20px; border-radius: 50%; background: var(--surface-2, #eee) center / cover no-repeat;";
      thumb.style.backgroundImage = `url(${JSON.stringify(s.avatar)})`;
      const label = doc.createElement("span");
      label.textContent = s.name;
      label.style.cssText = "overflow: hidden; white-space: nowrap; text-overflow: ellipsis;";
      if (s.avatar === current && s.name === name) label.style.fontWeight = "600";
      pick.append(thumb, label);
      const forget = button(
        "×",
        "flex: none; padding: 2px 8px; color: var(--text-subtle, #999);",
        () => {
          forgetSpeaker(s.name);
          open(avatar);
        },
      );
      forget.title = "一覧から外す";
      row.append(pick, forget);
      root.appendChild(row);
    };

    const saved = savedSpeakers();
    if (saved.length > 0) {
      caption("話者を切り替え");
      for (const s of saved) speakerRow(s);
      separator();
    }
    if (name) caption(`「${name}」の吹き出しすべてに反映`);
    item("画像をアップロード…", () => pickFile(speech));
    item("画像の URL を指定…", () => void askUrl(speech, current));
    if (current) item("アイコンを外す", () => act(speech, () => actions.setAvatar(speech, null)));
    item("左右を入れ替え", () => act(speech, () => actions.swapSide(speech)));
    separator();
    item("この吹き出しを削除", () => actions.remove(speech));

    doc.body.appendChild(root);
    menu = root;
    menuAvatar = avatar;
    // Below the avatar, clamped into the viewport.
    const rect = avatar.getBoundingClientRect();
    const viewW = doc.documentElement.clientWidth || win.innerWidth;
    const viewH = doc.documentElement.clientHeight || win.innerHeight;
    const left = Math.min(Math.max(rect.left, 8), Math.max(viewW - root.offsetWidth - 8, 8));
    const below = rect.bottom + 6;
    const top =
      below + root.offsetHeight <= viewH - 8
        ? below
        : Math.max(rect.top - root.offsetHeight - 6, 8);
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  };

  // Capture phase, ahead of ProseMirror / designMode: a press on the avatar
  // must not move the caret. Any press outside the open menu closes it.
  const onMouseDown = (e: MouseEvent) => {
    if (menu?.contains(e.target as Node)) {
      e.preventDefault();
      return;
    }
    const avatar = e.button === 0 ? avatarAt(e.target) : null;
    if (!avatar) {
      close();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    // A second press on the same avatar toggles the menu shut.
    if (menuAvatar === avatar) close();
    else open(avatar);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (menu && e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };
  const onDragOver = (e: DragEvent) => {
    if (!avatarAt(e.target) || !e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (e: DragEvent) => {
    const avatar = avatarAt(e.target);
    if (!avatar?.parentElement) return;
    const [file] = extractImageFilesFromDataTransfer(e.dataTransfer);
    if (!file) return;
    // Claimed before the editor's own drop handler, which would insert the
    // image into the document at the drop point.
    e.preventDefault();
    e.stopPropagation();
    void upload(avatar.parentElement, file);
  };

  doc.addEventListener("mousedown", onMouseDown, true);
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("dragover", onDragOver, true);
  doc.addEventListener("drop", onDrop, true);
  doc.addEventListener("scroll", close, true);
  win.addEventListener("resize", close);
  win.addEventListener("blur", close);

  return () => {
    close();
    doc.removeEventListener("mousedown", onMouseDown, true);
    doc.removeEventListener("keydown", onKeyDown, true);
    doc.removeEventListener("dragover", onDragOver, true);
    doc.removeEventListener("drop", onDrop, true);
    doc.removeEventListener("scroll", close, true);
    win.removeEventListener("resize", close);
    win.removeEventListener("blur", close);
  };
}
