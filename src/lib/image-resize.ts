// Click-to-select, corner-drag image resizer shared by the Tiptap editor and
// the designMode iframe (HtmlSource). Framework-free so it can attach to
// either document.
//
// Interaction: click an <img> → a selection box with a drag handle on each
// corner appears; drag any handle to resize (inline style width in px, height
// auto); click anywhere else to dismiss. Handles are clamped into the
// viewport so an image larger than the screen still shows reachable handles
// without scrolling to its far corners. The overlay carries data-he-ui so
// HtmlSource's save-time cleaner strips it from serialized output — it never
// leaks into the saved file.

const MIN_WIDTH = 40;
const HANDLE_SIZE = 14;
// Keep clamped handles this far inside the viewport edge.
const EDGE_MARGIN = 10;
const ACCENT = "#4f7cf7";

type Corner = { h: "left" | "right"; v: "top" | "bottom"; cursor: string };

const CORNERS: Corner[] = [
  { h: "left", v: "top", cursor: "nwse-resize" },
  { h: "right", v: "top", cursor: "nesw-resize" },
  { h: "left", v: "bottom", cursor: "nesw-resize" },
  { h: "right", v: "bottom", cursor: "nwse-resize" },
];

export function attachImageResizer(opts: {
  doc: Document;
  // Restrict which images are resizable (e.g. only those inside the editor
  // DOM, and only while the editor is editable).
  isTarget: (img: HTMLImageElement) => boolean;
  // Fired once per completed drag with the final width in px. The img's
  // inline style is already updated; use this to persist (emit change /
  // dispatch a ProseMirror transaction).
  onResizeEnd: (img: HTMLImageElement, widthPx: number) => void;
}): () => void {
  const { doc, isTarget, onResizeEnd } = opts;
  const win = doc.defaultView;
  if (!win) return () => {};

  let selected: HTMLImageElement | null = null;
  // sign: +1 when dragging a right-edge handle (width grows with +dx),
  // -1 for a left-edge handle.
  let dragging: { startX: number; startWidth: number; sign: 1 | -1 } | null = null;

  const box = doc.createElement("div");
  box.setAttribute("data-he-ui", "");
  box.setAttribute("contenteditable", "false");
  box.style.cssText = `position: fixed; display: none; pointer-events: none; border: 2px solid ${ACCENT}; box-sizing: border-box; z-index: 2147483646;`;

  const handles = CORNERS.map((corner) => {
    const el = doc.createElement("div");
    el.style.cssText = `position: absolute; width: ${HANDLE_SIZE}px; height: ${HANDLE_SIZE}px; background: #fff; border: 2px solid ${ACCENT}; border-radius: 50%; box-shadow: 0 1px 4px rgba(0,0,0,0.25); box-sizing: border-box; pointer-events: auto; cursor: ${corner.cursor};`;
    box.appendChild(el);
    return { el, corner };
  });
  const handleEls = new Set(handles.map((h) => h.el));

  const hide = () => {
    selected = null;
    box.style.display = "none";
  };

  const reposition = () => {
    if (!selected) return;
    if (!selected.isConnected) {
      hide();
      return;
    }
    const r = selected.getBoundingClientRect();
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    box.style.display = "block";
    // Place each handle on its corner, then clamp into the viewport so
    // oversized images keep all handles reachable. Coordinates are relative
    // to the box (whose origin sits at r.left/r.top).
    // clientWidth/Height exclude scrollbars, so clamped handles never hide
    // under them (innerWidth/Height include the scrollbar gutter).
    const viewW = doc.documentElement.clientWidth || win.innerWidth;
    const viewH = doc.documentElement.clientHeight || win.innerHeight;
    const clampX = (x: number) => Math.min(Math.max(x, EDGE_MARGIN), viewW - EDGE_MARGIN);
    const clampY = (y: number) => Math.min(Math.max(y, EDGE_MARGIN), viewH - EDGE_MARGIN);
    for (const { el, corner } of handles) {
      const cornerX = corner.h === "left" ? r.left : r.right;
      const cornerY = corner.v === "top" ? r.top : r.bottom;
      el.style.left = `${clampX(cornerX) - r.left - HANDLE_SIZE / 2}px`;
      el.style.top = `${clampY(cornerY) - r.top - HANDLE_SIZE / 2}px`;
    }
  };

  const select = (img: HTMLImageElement) => {
    selected = img;
    if (!box.isConnected) doc.body.appendChild(box);
    reposition();
  };

  const onClick = (e: MouseEvent) => {
    if (dragging) return;
    const t = e.target as HTMLElement;
    if (handleEls.has(t as HTMLDivElement)) return;
    if (t.tagName === "IMG" && isTarget(t as HTMLImageElement)) {
      select(t as HTMLImageElement);
    } else {
      hide();
    }
  };

  const onMouseDown = (e: MouseEvent) => {
    if (!selected) return;
    const hit = handles.find((h) => h.el === e.target);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = {
      startX: e.clientX,
      startWidth: selected.getBoundingClientRect().width,
      sign: hit.corner.h === "right" ? 1 : -1,
    };
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging || !selected) return;
    e.preventDefault();
    const dx = (e.clientX - dragging.startX) * dragging.sign;
    const w = Math.round(Math.max(MIN_WIDTH, dragging.startWidth + dx));
    selected.style.width = `${w}px`;
    selected.style.height = "auto";
    selected.style.maxWidth = "100%";
    reposition();
  };

  const onMouseUp = () => {
    if (!dragging || !selected) {
      dragging = null;
      return;
    }
    dragging = null;
    const w = Math.round(selected.getBoundingClientRect().width);
    onResizeEnd(selected, w);
    // Persisting may re-render the node (Tiptap replaces the <img> DOM);
    // dismiss rather than track the stale element.
    hide();
  };

  // Keep the fixed-position box glued to the image while scrolling any
  // container (capture catches scrolls of inner overflow elements too).
  const onScroll = () => reposition();
  const onInput = () => reposition();

  doc.addEventListener("click", onClick);
  doc.addEventListener("mousedown", onMouseDown, true);
  doc.addEventListener("mousemove", onMouseMove);
  doc.addEventListener("mouseup", onMouseUp);
  doc.addEventListener("scroll", onScroll, true);
  doc.addEventListener("input", onInput);
  win.addEventListener("resize", onScroll);

  return () => {
    doc.removeEventListener("click", onClick);
    doc.removeEventListener("mousedown", onMouseDown, true);
    doc.removeEventListener("mousemove", onMouseMove);
    doc.removeEventListener("mouseup", onMouseUp);
    doc.removeEventListener("scroll", onScroll, true);
    doc.removeEventListener("input", onInput);
    win.removeEventListener("resize", onScroll);
    box.remove();
  };
}
