// Floating formatting toolbar that appears above a non-empty text selection
// (xnote's document-editor bubble menu, rebuilt framework-free so it works in
// both the Tiptap editor and the designMode iframe).
//
// The host supplies the buttons; this module owns presentation and
// show/hide/positioning:
//   - shows on selectionchange when the selection has visible text and the
//     host's isEligible() approves; hides while the mouse button is down so
//     it never sits under an in-progress drag-selection
//   - positions above the selection rect (falls back to below near the top
//   - of the viewport), clamped to the viewport
//   - buttons preventDefault on mousedown so clicking never collapses the
//     selection; active states refresh after every action
//   - right-click (inside isTargetEligible) opens it too, replacing the
//     browser's context menu — above the selection when the click lands on
//     it, otherwise at the pointer with the caret moved there. It stays until
//     the next click elsewhere, keystroke, scroll or window blur.
//     Shift+right-click still gets the native menu (copy/paste, spelling).
//   - resting the pointer on a button for TOOLTIP_DELAY shows a borderless
//     tooltip with its name and shortcut. It stands in for the native title
//     tooltip, which has a border, comes up sooner and has no room for the key.
//
// The root carries data-he-ui so HtmlSource's save-time cleaner strips it
// from serialized output (same convention as the image-resize overlay).

// contextOnly: shown only when the bar was opened by right-click — for
// block insertions that make sense at a pointed-at spot, not on a selection.
// shortcut: the key that does the same, shown in the hover tooltip.
export type ToolbarButton =
  | { type: "separator"; contextOnly?: boolean }
  | {
      type?: "button";
      label: string;
      title: string;
      shortcut?: string;
      style?: string;
      action: () => void;
      isActive?: () => boolean;
      contextOnly?: boolean;
    };

// The keys both HTML editors bind for the toolbar's actions: Tiptap's
// (StarterKit's defaults, with the overrides in editor.tsx and
// tag-preserving-marks.ts) and their designMode mirror (html-source.tsx's
// keydown handler). Change a binding there and its label here together.
export const TOOLBAR_SHORTCUTS = {
  bold: "⌘+B",
  italic: "⌘+I",
  strike: "⌘+Shift+X",
  code: "⌘+Shift+E",
  h2: "⌘+Option+2",
  h3: "⌘+Option+3",
  list: "⌘+Shift+8",
  numList: "⌘+Shift+7",
  quote: "⌘+Shift+B",
  link: "⌘+K",
} as const;

type Rect = { left: number; top: number; bottom: number; width: number; height: number };

const ACCENT = "#4f7cf7";
const GAP = 8;
const TOOLTIP_DELAY = 2000;

export function attachSelectionToolbar(opts: {
  doc: Document;
  buttons: ToolbarButton[];
  isEligible: (sel: Selection) => boolean;
  // Where a right-click may open the toolbar (default: anywhere in doc).
  isTargetEligible?: (target: Node) => boolean;
}): () => void {
  const { doc, buttons, isEligible, isTargetEligible = () => true } = opts;
  const win = doc.defaultView;
  if (!win) return () => {};

  const bar = doc.createElement("div");
  bar.setAttribute("data-he-ui", "");
  bar.setAttribute("contenteditable", "false");
  bar.style.cssText =
    "position: fixed; display: none; z-index: 2147483647; background: #fff; border: none; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.06); padding: 3px; white-space: nowrap; font-family: -apple-system, BlinkMacSystemFont, sans-serif; user-select: none;";

  // Lives inside the bar, so it hides with it and inherits data-he-ui.
  const tip = doc.createElement("div");
  tip.setAttribute("role", "tooltip");
  tip.style.cssText =
    "position: fixed; display: none; background: rgba(28,28,28,0.92); color: #fff; border: none; border-radius: 6px; padding: 4px 8px; font-size: 11.5px; line-height: 16px; pointer-events: none;";
  let tipTimer = 0;
  // Which side of its anchor the bar sits on; the tooltip goes on the far
  // side of the bar so it covers neither the selection nor the buttons.
  let barBelow = false;

  const hideTip = () => {
    win.clearTimeout(tipTimer);
    tip.style.display = "none";
  };

  const showTip = (btn: HTMLElement, title: string, shortcut?: string) => {
    tip.replaceChildren(title);
    if (shortcut) {
      const key = doc.createElement("span");
      key.textContent = shortcut;
      key.style.cssText = "margin-left: 8px; color: rgba(255,255,255,0.62);";
      tip.appendChild(key);
    }
    tip.style.visibility = "hidden";
    tip.style.display = "block";
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const b = btn.getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    const viewW = doc.documentElement.clientWidth || win.innerWidth;
    const viewH = doc.documentElement.clientHeight || win.innerHeight;
    const left = Math.min(
      Math.max(b.left + b.width / 2 - tw / 2, GAP),
      Math.max(viewW - tw - GAP, GAP),
    );
    const above = r.top - th - GAP;
    const below = r.bottom + GAP;
    let top = barBelow ? below : above;
    if (barBelow && below + th > viewH - GAP) top = above;
    if (!barBelow && above < GAP) top = below;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.style.visibility = "";
  };

  const actionButtons: { el: HTMLButtonElement; isActive?: () => boolean }[] = [];
  const contextOnly: HTMLElement[] = [];
  for (const b of buttons) {
    if (b.type === "separator") {
      const sep = doc.createElement("div");
      sep.style.cssText =
        "display: inline-block; width: 1px; height: 16px; background: #e2e2e2; margin: 0 3px; vertical-align: middle;";
      if (b.contextOnly) contextOnly.push(sep);
      bar.appendChild(sep);
      continue;
    }
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.textContent = b.label;
    // No title attribute: the tooltip below replaces the native one.
    btn.setAttribute("aria-label", b.shortcut ? `${b.title} ${b.shortcut}` : b.title);
    btn.style.cssText = `display: inline-block; min-width: 26px; height: 26px; padding: 0 6px; margin: 0 1px; border: none; border-radius: 5px; background: transparent; color: #333; font-size: 12.5px; line-height: 26px; cursor: pointer; vertical-align: middle; ${b.style ?? ""}`;
    btn.addEventListener("mouseenter", () => {
      if (btn.dataset.active !== "1") btn.style.background = "#f2f2f2";
      hideTip();
      tipTimer = win.setTimeout(() => showTip(btn, b.title, b.shortcut), TOOLTIP_DELAY);
    });
    btn.addEventListener("mouseleave", () => {
      if (btn.dataset.active !== "1") btn.style.background = "transparent";
      hideTip();
    });
    // preventDefault keeps the selection alive through the click.
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      hideTip();
    });
    btn.addEventListener("click", () => {
      b.action();
      refreshActive();
      update();
    });
    actionButtons.push({ el: btn, isActive: b.isActive });
    if (b.contextOnly) contextOnly.push(btn);
    bar.appendChild(btn);
  }
  bar.appendChild(tip);

  const refreshActive = () => {
    for (const { el, isActive } of actionButtons) {
      const on = isActive ? isActive() : false;
      el.dataset.active = on ? "1" : "0";
      el.style.background = on ? "#e8eefc" : "transparent";
      el.style.color = on ? ACCENT : "#333";
    }
  };

  let pointerDown = false;
  // Set while opened by right-click: the anchor rect the bar sits against.
  // Kept fixed so actions that move the selection don't make it jump.
  let pinned: Rect | null = null;

  const hide = () => {
    pinned = null;
    hideTip();
    bar.style.display = "none";
  };

  const place = (rect: Rect) => {
    if (!bar.isConnected) doc.body.appendChild(bar);
    for (const el of contextOnly) el.style.display = pinned ? "inline-block" : "none";
    // Measure invisibly before positioning.
    bar.style.visibility = "hidden";
    bar.style.display = "block";
    const bw = bar.offsetWidth;
    const bh = bar.offsetHeight;
    const viewW = doc.documentElement.clientWidth || win.innerWidth;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - bw / 2, GAP),
      Math.max(viewW - bw - GAP, GAP),
    );
    barBelow = rect.top - bh - GAP < GAP;
    const top = barBelow ? rect.bottom + GAP : rect.top - bh - GAP;
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    bar.style.visibility = "visible";
    refreshActive();
  };

  const update = () => {
    if (pinned) {
      place(pinned);
      return;
    }
    const sel = doc.getSelection();
    if (
      !sel ||
      sel.isCollapsed ||
      sel.rangeCount === 0 ||
      pointerDown ||
      sel.toString().trim().length === 0 ||
      !isEligible(sel)
    ) {
      hide();
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      hide();
      return;
    }
    place(rect);
  };

  const onContextMenu = (e: MouseEvent) => {
    const target = e.target as Node;
    if (bar.contains(target)) {
      e.preventDefault();
      return;
    }
    if (e.shiftKey || !isTargetEligible(target)) return;
    e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;
    const sel = doc.getSelection();
    let anchor: Rect = { left: x, top: y, bottom: y, width: 0, height: 0 };
    const range = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null;
    const r = range?.getBoundingClientRect();
    if (r && sel?.toString().trim() && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      anchor = r; // right-clicked the selection: act on it
    } else {
      // Act where the user pointed, not wherever the caret happened to be.
      const caret = doc.caretRangeFromPoint?.(x, y);
      if (caret && sel) {
        sel.removeAllRanges();
        sel.addRange(caret);
      }
    }
    pinned = anchor;
    place(anchor);
  };
  const onSelectionChange = () => update();
  const onMouseDown = (e: MouseEvent) => {
    if (bar.contains(e.target as Node)) return;
    pointerDown = true;
    hide();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    // Modifiers alone keep the tooltip up while its shortcut is being pressed.
    if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
    hideTip();
    if (pinned) hide();
  };
  const onBlur = () => {
    hideTip();
    // Clicks outside an iframe never reach its document — blur does.
    if (pinned) hide();
  };
  const onMouseUp = () => {
    pointerDown = false;
    // Selection is final after mouseup; re-evaluate on the next tick.
    win.setTimeout(update, 0);
  };
  const onScroll = () => {
    hideTip();
    if (pinned) hide();
    else if (bar.style.display !== "none") update();
  };

  doc.addEventListener("selectionchange", onSelectionChange);
  doc.addEventListener("mousedown", onMouseDown);
  doc.addEventListener("mouseup", onMouseUp);
  // Bubble phase: the details-summary menu (editor.tsx) claims its right-clicks
  // in the capture phase and stops them before they get here.
  doc.addEventListener("contextmenu", onContextMenu);
  doc.addEventListener("keydown", onKeyDown);
  doc.addEventListener("scroll", onScroll, true);
  win.addEventListener("resize", onScroll);
  win.addEventListener("blur", onBlur);

  return () => {
    doc.removeEventListener("selectionchange", onSelectionChange);
    doc.removeEventListener("mousedown", onMouseDown);
    doc.removeEventListener("mouseup", onMouseUp);
    doc.removeEventListener("contextmenu", onContextMenu);
    doc.removeEventListener("keydown", onKeyDown);
    doc.removeEventListener("scroll", onScroll, true);
    win.removeEventListener("resize", onScroll);
    win.removeEventListener("blur", onBlur);
    win.clearTimeout(tipTimer);
    bar.remove();
  };
}
