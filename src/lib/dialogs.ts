// Imperative, promise-based dialog API backed by the shadcn/ui dialogs rendered
// in <DialogProvider>. Any module — React component or plain lib like
// editor-actions.ts — can `await confirmDialog(...)` / `await promptDialog(...)`
// instead of using the blocking window.confirm / window.prompt.

export type ConfirmOptions = {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  // Renders the confirm button in the danger color (for destructive actions).
  destructive?: boolean;
};

export type PromptOptions = {
  title?: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type DialogImpl = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
};

let impl: DialogImpl | null = null;

// Called by <DialogProvider> on mount/unmount.
export function registerDialogImpl(next: DialogImpl | null) {
  impl = next;
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (impl) return impl.confirm(opts);
  // Fallback so a confirmation is never silently skipped if the provider isn't
  // mounted (e.g. during tests or SSR edge cases).
  if (typeof window !== "undefined") {
    return Promise.resolve(window.confirm(opts.description ?? opts.title ?? ""));
  }
  return Promise.resolve(false);
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  if (impl) return impl.prompt(opts);
  if (typeof window !== "undefined") {
    return Promise.resolve(
      window.prompt(opts.description ?? opts.title ?? "", opts.defaultValue ?? ""),
    );
  }
  return Promise.resolve(null);
}
