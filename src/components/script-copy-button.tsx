"use client";

import { hasScriptHeading, scriptToNotesText } from "@/lib/script-copy";
import { useMemo } from "react";
import { toast } from "sonner";

// Top-right of the document area, shown only while the open HTML is a video
// script (has an h2 「台本」, 「今回の質問」 or 「今回の噂」). Copies from the
// editor's current HTML, so unsaved edits are included. See script-copy.ts for
// the format.
export function ScriptCopyButton({
  html,
  title,
  path,
}: {
  html: string;
  title: string;
  path: string;
}) {
  const isScript = useMemo(() => hasScriptHeading(html), [html]);
  if (!isScript) return null;

  const copy = async () => {
    const fallbackTitle = title || (path.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
    const script = scriptToNotesText(html, fallbackTitle);
    if (!script) return;
    try {
      await navigator.clipboard.writeText(script.text);
    } catch {
      // Clipboard can be unavailable (insecure context) or blocked by policy.
      toast.error("台本をコピーできませんでした");
      return;
    }
    toast.success(`台本をコピーしました（${script.blocks} か所）。メモ App に貼り付けてください`);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="script-copy-button absolute top-3 right-5 z-30 inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors bg-[var(--surface)] border border-[var(--border-subtle)] shadow-sm"
      title="メモ App にそのまま貼れる形でコピー（プロンプター用）"
    >
      <CopyIcon />
      台本をコピー
    </button>
  );
}

function CopyIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5.8" y="5.8" width="8" height="8" rx="1.2" />
      <path d="M10.2 3.4V3.2c0-.55-.45-1-1-1H3.2c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h.2" />
    </svg>
  );
}
