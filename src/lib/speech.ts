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
// theme's empty circle instead of a broken-image glyph.
//
// Icon and side belong to the speaker, not the single bubble: changing them
// from the menu applies to every bubble with the same (non-empty) name, so an
// interview's icons are set once per person.

export const SPEECH_SELECTOR = "[data-speech]";
const AVATAR_SELECTOR = `${SPEECH_SELECTOR} > .speech-avatar`;

export type SpeechSide = "left" | "right";
export type Speaker = { name: string; avatar: string | null; side: SpeechSide };

// Same toast timing as editor.tsx: an update of a loading toast must state
// its own duration or it never goes away.
const TOAST_MS = 4000;

function speakerKey(s: Speaker): string {
  if (s.name) return `n:${s.name}`;
  if (s.avatar) return `a:${s.avatar}`;
  return `s:${s.side}`;
}

// Who speaks in a newly inserted bubble, given the bubbles before it in
// document order. Interviews alternate, so it is whoever spoke before the
// latest speaker; with only one speaker so far, a new unnamed one on the
// other side; with none, an unnamed one on the left.
export function pickNextSpeaker(previous: Speaker[]): Speaker {
  const last = previous.at(-1);
  if (!last) return { name: "", avatar: null, side: "left" };
  const lastKey = speakerKey(last);
  for (let i = previous.length - 2; i >= 0; i--) {
    if (speakerKey(previous[i]) !== lastKey) return previous[i];
  }
  return { name: "", avatar: null, side: last.side === "left" ? "right" : "left" };
}

export function speechNameOf(speech: Element): string {
  return speech.querySelector(":scope > .speech-body > .speech-name")?.textContent?.trim() ?? "";
}

// What the menu does, implemented per editor: TipTap transactions or plain
// DOM edits. `speech` is the bubble's root element as rendered.
export type SpeechMenuActions = {
  setAvatar: (speech: HTMLElement, url: string | null) => void;
  swapSide: (speech: HTMLElement) => void;
  remove: (speech: HTMLElement) => void;
};

// Clicking a bubble's avatar opens a small menu (change / remove the icon,
// swap sides, delete the bubble); dropping an image file onto the avatar
// uploads it as the icon. Framework-free so the same menu serves the TipTap
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
      if (speech.isConnected) actions.setAvatar(speech, url);
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
    actions.setAvatar(speech, raw.trim() || null);
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

    if (name) {
      const header = doc.createElement("div");
      header.textContent = `「${name}」の吹き出しすべてに反映`;
      header.style.cssText =
        "padding: 2px 12px 6px; font-size: 10.5px; letter-spacing: 0.04em; color: var(--text-subtle, #999);";
      root.appendChild(header);
    }
    const item = (label: string, run: () => void) => {
      const btn = doc.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      btn.textContent = label;
      btn.style.cssText =
        "display: block; width: 100%; padding: 6px 12px; border: none; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;";
      btn.addEventListener("mouseenter", () => {
        btn.style.background = "var(--surface-2, #f2f2f2)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.background = "transparent";
      });
      btn.addEventListener("click", () => {
        close();
        run();
      });
      root.appendChild(btn);
    };
    const separator = () => {
      const sep = doc.createElement("div");
      sep.style.cssText = "height: 1px; margin: 5px 0; background: var(--border-subtle, #eee);";
      root.appendChild(sep);
    };

    item("画像をアップロード…", () => pickFile(speech));
    item("画像の URL を指定…", () => void askUrl(speech, current));
    if (current) item("アイコンを外す", () => actions.setAvatar(speech, null));
    item("左右を入れ替え", () => actions.swapSide(speech));
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
