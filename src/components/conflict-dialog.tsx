"use client";

import { type DiffLine, type DiffResult, lineDiff } from "@/lib/line-diff";
import { useEffect, useMemo, useRef, useState } from "react";

export type ConflictResolution = "overwrite" | "reload" | "cancel";

export function ConflictDialog({
  open,
  draft,
  diskContent,
  onResolve,
}: {
  open: boolean;
  draft: string;
  diskContent: string;
  onResolve: (action: ConflictResolution) => void;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    if (!open) setShowDiff(false);
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    function onCancel(e: Event) {
      e.preventDefault();
      onResolve("cancel");
    }
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, [onResolve]);

  const diff = useMemo<DiffResult | null>(
    () => (showDiff ? lineDiff(diskContent, draft) : null),
    [showDiff, diskContent, draft],
  );

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="conflict-title"
      className="bg-[var(--surface)] border border-[var(--border-subtle)] rounded-lg shadow-xl p-0 backdrop:bg-black/40"
      style={{
        width: showDiff ? "min(1100px, 95vw)" : "min(520px, 92vw)",
        maxHeight: "88vh",
      }}
    >
      <div className="flex flex-col max-h-[88vh]">
        <header className="px-5 pt-4 pb-3 border-b border-[var(--border-subtle)]">
          <h2 id="conflict-title" className="text-[14px] font-medium text-[var(--text)]">
            File changed on disk
          </h2>
          <p className="mt-1 text-[12px] text-[var(--text-muted)] leading-relaxed">
            This file was modified externally since you opened it. Choose how to resolve.
          </p>
        </header>

        {showDiff && diff && (
          <div className="flex-1 overflow-auto border-b border-[var(--border-subtle)] bg-[var(--surface-2)]">
            {diff.ok ? (
              <DiffView diff={diff.lines} />
            ) : (
              <DiffTooLarge aLines={diff.aLines} bLines={diff.bLines} limit={diff.limit} />
            )}
          </div>
        )}

        <footer className="px-5 py-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowDiff((v) => !v)}
            className="text-[12px] px-3 py-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
          >
            {showDiff ? "Hide diff" : "Compare"}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onResolve("cancel")}
              className="text-[12px] px-3 py-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onResolve("reload")}
              className="text-[12px] px-3 py-1.5 rounded-md border border-[var(--border-subtle)] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
              title="Discard your local edits and load the disk version"
            >
              Reload from disk
            </button>
            <button
              type="button"
              onClick={() => onResolve("overwrite")}
              className="text-[12px] px-3 py-1.5 rounded-md bg-[var(--text)] text-[var(--surface)] hover:opacity-90 transition-opacity"
              title="Replace the disk version with your local edits"
            >
              Overwrite
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

function DiffView({ diff }: { diff: DiffLine[] }) {
  return (
    <div className="font-mono text-[11.5px] leading-[1.6]">
      <div className="px-4 py-2 sticky top-0 bg-[var(--surface-2)] border-b border-[var(--border-subtle)] text-[10.5px] uppercase tracking-wider text-[var(--text-subtle)] flex gap-6">
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-red-500/60 mr-1.5 align-middle" />
          Disk
        </span>
        <span>
          <span className="inline-block w-2 h-2 rounded-sm bg-green-500/60 mr-1.5 align-middle" />
          Your edits
        </span>
      </div>
      <div>
        {diff.map((line, idx) => {
          const bg =
            line.type === "add" ? "bg-green-500/10" : line.type === "del" ? "bg-red-500/10" : "";
          const marker = line.type === "add" ? "+" : line.type === "del" ? "−" : " ";
          const markerColor =
            line.type === "add"
              ? "text-green-600 dark:text-green-400"
              : line.type === "del"
                ? "text-red-600 dark:text-red-400"
                : "text-[var(--text-subtle)]";
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: diff order is the identity here
              key={idx}
              className={`flex ${bg}`}
            >
              <span
                className={`shrink-0 w-7 text-right pr-1 select-none ${markerColor} text-[var(--text-subtle)]`}
              >
                {line.aLine ?? ""}
              </span>
              <span
                className={`shrink-0 w-7 text-right pr-2 select-none ${markerColor} text-[var(--text-subtle)]`}
              >
                {line.bLine ?? ""}
              </span>
              <span className={`shrink-0 w-4 text-center select-none ${markerColor}`}>
                {marker}
              </span>
              <span className="whitespace-pre-wrap break-all pr-4 text-[var(--text)]">
                {line.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DiffTooLarge({
  aLines,
  bLines,
  limit,
}: {
  aLines: number;
  bLines: number;
  limit: number;
}) {
  return (
    <div className="px-5 py-6 text-[12.5px] text-[var(--text-muted)] leading-relaxed">
      <p className="font-medium text-[var(--text)] mb-1">Diff too large to display</p>
      <p>
        Disk has {aLines.toLocaleString()} lines, your draft has {bLines.toLocaleString()} lines —
        diffing files larger than {limit.toLocaleString()} lines is disabled to avoid blocking the
        UI. Use <code className="px-1 rounded bg-[var(--surface)]">git diff</code> or another
        external tool to compare.
      </p>
    </div>
  );
}
