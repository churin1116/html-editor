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
//
// The root carries data-he-ui so HtmlSource's save-time cleaner strips it
// from serialized output (same convention as the image-resize overlay).

export type ToolbarButton =
  | { type: "separator" }
  | {
      type?: "button";
      label: string;
      title: string;
      style?: string;
      action: () => void;
      isActive?: () => boolean;
    };

const ACCENT = "#4f7cf7";
const GAP = 8;

export function attachSelectionToolbar(opts: {
  doc: Document;
  buttons: ToolbarButton[];
  isEligible: (sel: Selection) => boolean;
}): () => void {
  const { doc, buttons, isEligible } = opts;
  const win = doc.defaultView;
  if (!win) return () => {};

  const bar = doc.createElement("div");
  bar.setAttribute("data-he-ui", "");
  bar.setAttribute("contenteditable", "false");
  bar.style.cssText =
    "position: fixed; display: none; z-index: 2147483647; background: #fff; border: 1px solid #e2e2e2; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.06); padding: 3px; white-space: nowrap; font-family: -apple-system, BlinkMacSystemFont, sans-serif; user-select: none;";

  const actionButtons: { el: HTMLButtonElement; isActive?: () => boolean }[] = [];
  for (const b of buttons) {
    if (b.type === "separator") {
      const sep = doc.createElement("div");
      sep.style.cssText =
        "display: inline-block; width: 1px; height: 16px; background: #e2e2e2; margin: 0 3px; vertical-align: middle;";
      bar.appendChild(sep);
      continue;
    }
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.textContent = b.label;
    btn.title = b.title;
    btn.style.cssText = `display: inline-block; min-width: 26px; height: 26px; padding: 0 6px; margin: 0 1px; border: none; border-radius: 5px; background: transparent; color: #333; font-size: 12.5px; line-height: 26px; cursor: pointer; vertical-align: middle; ${b.style ?? ""}`;
    btn.addEventListener("mouseenter", () => {
      if (btn.dataset.active !== "1") btn.style.background = "#f2f2f2";
    });
    btn.addEventListener("mouseleave", () => {
      if (btn.dataset.active !== "1") btn.style.background = "transparent";
    });
    // preventDefault keeps the selection alive through the click.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => {
      b.action();
      refreshActive();
      update();
    });
    actionButtons.push({ el: btn, isActive: b.isActive });
    bar.appendChild(btn);
  }

  const refreshActive = () => {
    for (const { el, isActive } of actionButtons) {
      const on = isActive ? isActive() : false;
      el.dataset.active = on ? "1" : "0";
      el.style.background = on ? "#e8eefc" : "transparent";
      el.style.color = on ? ACCENT : "#333";
    }
  };

  let pointerDown = false;

  const hide = () => {
    bar.style.display = "none";
  };

  const update = () => {
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
    if (!bar.isConnected) doc.body.appendChild(bar);
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
    const top = rect.top - bh - GAP >= GAP ? rect.top - bh - GAP : rect.bottom + GAP;
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    bar.style.visibility = "visible";
    refreshActive();
  };

  const onSelectionChange = () => update();
  const onMouseDown = (e: MouseEvent) => {
    if (bar.contains(e.target as Node)) return;
    pointerDown = true;
    hide();
  };
  const onMouseUp = () => {
    pointerDown = false;
    // Selection is final after mouseup; re-evaluate on the next tick.
    win.setTimeout(update, 0);
  };
  const onScroll = () => {
    if (bar.style.display !== "none") update();
  };

  doc.addEventListener("selectionchange", onSelectionChange);
  doc.addEventListener("mousedown", onMouseDown);
  doc.addEventListener("mouseup", onMouseUp);
  doc.addEventListener("scroll", onScroll, true);
  win.addEventListener("resize", onScroll);

  return () => {
    doc.removeEventListener("selectionchange", onSelectionChange);
    doc.removeEventListener("mousedown", onMouseDown);
    doc.removeEventListener("mouseup", onMouseUp);
    doc.removeEventListener("scroll", onScroll, true);
    win.removeEventListener("resize", onScroll);
    bar.remove();
  };
}
