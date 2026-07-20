"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type ConfirmOptions, type PromptOptions, registerDialogImpl } from "@/lib/dialogs";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

export function DialogProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const [promptState, setPromptState] = useState<PromptOptions | null>(null);
  const [promptValue, setPromptValue] = useState("");

  // Held separately from state so a resolution can only happen once, regardless
  // of whether it comes from a button click or an Escape/overlay dismissal.
  const confirmResolve = useRef<((v: boolean) => void) | null>(null);
  const promptResolve = useRef<((v: string | null) => void) | null>(null);

  const settleConfirm = useCallback((value: boolean) => {
    const resolve = confirmResolve.current;
    confirmResolve.current = null;
    setConfirmState(null);
    resolve?.(value);
  }, []);

  const settlePrompt = useCallback((value: string | null) => {
    const resolve = promptResolve.current;
    promptResolve.current = null;
    setPromptState(null);
    resolve?.(value);
  }, []);

  useEffect(() => {
    registerDialogImpl({
      confirm: (opts) =>
        new Promise<boolean>((resolve) => {
          confirmResolve.current = resolve;
          setConfirmState(opts);
        }),
      prompt: (opts) =>
        new Promise<string | null>((resolve) => {
          promptResolve.current = resolve;
          setPromptValue(opts.defaultValue ?? "");
          setPromptState(opts);
        }),
    });
    return () => registerDialogImpl(null);
  }, []);

  return (
    <>
      {children}

      <AlertDialog
        open={confirmState !== null}
        onOpenChange={(open) => {
          if (!open) settleConfirm(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.title ?? "確認"}</AlertDialogTitle>
            {confirmState?.description && (
              <AlertDialogDescription>{confirmState.description}</AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settleConfirm(false)}>
              {confirmState?.cancelLabel ?? "キャンセル"}
            </AlertDialogCancel>
            <AlertDialogAction
              destructive={confirmState?.destructive}
              onClick={() => settleConfirm(true)}
            >
              {confirmState?.confirmLabel ?? "OK"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={promptState !== null}
        onOpenChange={(open) => {
          if (!open) settlePrompt(null);
        }}
      >
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              settlePrompt(promptValue);
            }}
          >
            <DialogHeader>
              <DialogTitle>{promptState?.title ?? "入力"}</DialogTitle>
              {promptState?.description && (
                <DialogDescription>{promptState.description}</DialogDescription>
              )}
            </DialogHeader>
            <div className="px-5 pt-1 pb-1">
              {/* Radix moves focus to the first focusable element (this input) on open. */}
              <input
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                placeholder={promptState?.placeholder}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--text)] outline-none focus:border-[var(--text-subtle)]"
              />
            </div>
            <DialogFooter>
              <button
                type="button"
                onClick={() => settlePrompt(null)}
                className="text-[12px] px-3 py-1.5 rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
              >
                {promptState?.cancelLabel ?? "キャンセル"}
              </button>
              <button
                type="submit"
                className="text-[12px] px-3 py-1.5 rounded-md bg-[var(--text)] text-[var(--surface)] transition-opacity hover:opacity-90"
              >
                {promptState?.confirmLabel ?? "OK"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
