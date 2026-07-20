import "./globals.css";
import { DialogProvider } from "@/components/dialog-provider";
import { resolveTheme } from "@/lib/chameleon-live";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "html-editor",
  description: "Local browser-based HTML editor for personal notes",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Same theme resolution as saves (auto-update → live clone read, else the
  // bundled generated module) so the editor UI always matches the files it
  // writes, even before a `pnpm sync-theme`.
  const theme = await resolveTheme();
  return (
    <html lang="ja" data-theme="light" data-chameleon="v1" suppressHydrationWarning>
      <head>
        <meta name="chameleon" content={theme.contract} data-baked={theme.version} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: theme.css comes from our own theme repo (or the build-time generated module) — not user input. */}
        <style dangerouslySetInnerHTML={{ __html: theme.css }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: same trusted source as above. */}
        <script dangerouslySetInnerHTML={{ __html: theme.js }} />
      </head>
      <body className="bg-canvas">
        <DialogProvider>{children}</DialogProvider>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
