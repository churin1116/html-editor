import "./globals.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "html-editor",
  description: "Local browser-based HTML editor for personal notes",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" data-theme="light">
      <head>
        <meta name="chameleon" content="v1" />
        <link
          rel="stylesheet"
          href="https://churin1116.github.io/html-chameleon/theme/v1/theme.css"
        />
        <script
          src="https://churin1116.github.io/html-chameleon/theme/v1/theme.js"
          async={false}
        />
      </head>
      <body className="bg-canvas">
        {children}
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
