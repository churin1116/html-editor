"use client";

import type { FindEngine, FindState } from "@/lib/find-replace";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// The ⌘F bar over an open HTML document: find as you type, step through the
// matches, replace one or all (the engines are in lib/find-replace). It floats
// at the top right of the document — over the script-copy button while open.
//
// `seed` is a fresh object for every ⌘F, so pressing it again refocuses the
// field and picks up the newly selected text.
export function FindBar({
  engine,
  seed,
  canReplace,
  onClose,
}: {
  engine: FindEngine;
  seed: { text: string };
  canReplace: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(seed.text);
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<FindState>({ count: 0, current: -1 });
  const findRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (seed.text) setQuery(seed.text);
    findRef.current?.focus();
    findRef.current?.select();
  }, [seed]);

  useEffect(() => {
    setResult(engine.search(query, caseSensitive));
  }, [engine, query, caseSensitive]);

  // Typing in the document while the bar is open moves the matches.
  useEffect(() => {
    let timer = 0;
    const off = engine.onChange(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setResult(engine.refresh()), 150);
    });
    return () => {
      window.clearTimeout(timer);
      off();
    };
  }, [engine]);

  // The highlights go with the bar.
  useEffect(() => () => engine.clear(), [engine]);

  const close = () => {
    onClose();
    engine.focus();
  };
  const step = (dir: 1 | -1) => setResult(engine.step(dir));
  // Replacing focuses the document (the rendered view needs it for the edit
  // to register), so the field takes focus back for the next one.
  const replaceOne = () => {
    setResult(engine.replace(replacement));
    replaceRef.current?.focus();
  };
  const replaceAll = () => {
    const n = engine.replaceAll(replacement);
    setResult(engine.refresh());
    toast(n > 0 ? `${n} 件を置き換えました` : "置き換えるものがありません");
    replaceRef.current?.focus();
  };

  const status = !query
    ? ""
    : result.count === 0
      ? "見つかりません"
      : `${result.current + 1} / ${result.count}`;
  const field =
    "h-7 min-w-0 flex-1 rounded px-2 text-[12px] bg-[var(--canvas)] text-[var(--text)] border border-[var(--border-subtle)] outline-none focus:border-[var(--primary)]";
  const iconBtn =
    "inline-flex items-center justify-center h-7 min-w-7 px-1.5 rounded text-[12px] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-40 disabled:pointer-events-none transition-colors";

  return (
    <section
      aria-label="検索と置換"
      className="absolute top-3 right-5 z-40 w-[360px] max-w-[calc(100%-2.5rem)] p-2 flex flex-col gap-1.5 rounded-md fade-in"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)",
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          close();
        }
      }}
    >
      <div className="flex items-center gap-1">
        <input
          ref={findRef}
          type="text"
          value={query}
          placeholder="検索"
          aria-label="検索"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Enter belongs to the IME while it is converting.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            }
          }}
          className={field}
        />
        <button
          type="button"
          onClick={() => setCaseSensitive((v) => !v)}
          title="大文字と小文字を区別"
          aria-pressed={caseSensitive}
          className={`${iconBtn} ${caseSensitive ? "text-[var(--primary)] bg-[var(--surface-2)]" : ""}`}
        >
          Aa
        </button>
        <span className="w-[76px] text-center text-[11px] tabular-nums text-[var(--text-subtle)] truncate">
          {status}
        </span>
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={result.count === 0}
          title="前へ（⇧Enter）"
          aria-label="前へ"
          className={iconBtn}
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={result.count === 0}
          title="次へ（Enter）"
          aria-label="次へ"
          className={iconBtn}
        >
          ↓
        </button>
        <button
          type="button"
          onClick={close}
          title="閉じる（Esc）"
          aria-label="閉じる"
          className={iconBtn}
        >
          ×
        </button>
      </div>
      {canReplace && (
        <div className="flex items-center gap-1">
          <input
            ref={replaceRef}
            type="text"
            value={replacement}
            placeholder="置換"
            aria-label="置換"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") {
                e.preventDefault();
                replaceOne();
              }
            }}
            className={field}
          />
          <button
            type="button"
            onClick={replaceOne}
            disabled={result.count === 0}
            title="置換（Enter）"
            className={iconBtn}
          >
            置換
          </button>
          <button
            type="button"
            onClick={replaceAll}
            disabled={result.count === 0}
            className={iconBtn}
          >
            すべて置換
          </button>
        </div>
      )}
    </section>
  );
}
