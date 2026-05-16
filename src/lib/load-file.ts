import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { scopeCss } from "@/lib/css-scope";
import { detectFormat } from "@/lib/format";
import { PathNotAllowedError, resolveSafePath } from "@/lib/fs-safe";
import { preserveBlankLines } from "@/lib/html-pretty";
import {
  type HtmlShape,
  classifyHtml,
  isManagedHtml,
  splitFullDocument,
  unwrapContent,
} from "@/lib/html-template";
import { findFolderCssForPath, loadShortcutTree } from "@/lib/shortcuts";

export const PREVIEW_CSS_SCOPE_CLASS = "preview-css-scope";

export type LoadedFile = {
  path: string;
  format: "html" | "md";
  content: string;
  title: string;
  mtimeMs: number;
  managed: boolean;
  shape: HtmlShape | null;
  // Whether the editor should allow editing this file. Always true for
  // managed/fragment HTML and for markdown. For full-document HTML, true
  // when we can locate <body>...</body> tags (so head/doctype are
  // preserved on save); false when the wrap is unparseable.
  editable: boolean;
  // Preview-only CSS scoped to the editor (.preview-css-scope). Empty when
  // no shortcut folder for this file declared a cssPath, or when reading
  // the CSS file failed. Never written into the saved HTML.
  previewCss: string;
};

export type LoadFileError = {
  error: string;
  status: number;
};

export async function loadFileFromDisk(filePath: string): Promise<LoadedFile | LoadFileError> {
  try {
    const { absolute } = await resolveSafePath(filePath);
    const format = detectFormat(absolute);
    if (!format) {
      return {
        error: "Unsupported file extension (expected .html or .md)",
        status: 400,
      };
    }
    const raw = await readFile(absolute, "utf8");
    const s = await stat(absolute);
    const baseName = path.basename(absolute, path.extname(absolute));

    let content: string;
    let title: string;
    let managed = true;
    let shape: HtmlShape | null = null;
    let editable = true;
    if (format === "html") {
      shape = classifyHtml(raw);
      managed = isManagedHtml(raw);
      if (shape === "full-document") {
        const split = splitFullDocument(raw);
        if (split) {
          // Keep bodyContent's leading newlines intact: preserveBlankLines
          // converts blank lines (\n\n+) into <p></p> placeholders so the
          // body-leading blank line that follows <body> survives the
          // round-trip through Tiptap.
          content = preserveBlankLines(split.bodyContent);
          const titleMatch = split.prefix.match(/<title>([\s\S]*?)<\/title>/i);
          title = titleMatch ? unescapeHtmlEntities(titleMatch[1].trim()) : baseName;
        } else {
          // <body> tags missing — keep current read-only fallback.
          const unwrapped = unwrapContent(raw);
          content = preserveBlankLines(unwrapped.content);
          title = unwrapped.title || baseName;
          editable = false;
        }
      } else {
        const unwrapped = unwrapContent(raw);
        content = preserveBlankLines(unwrapped.content);
        title = unwrapped.title || baseName;
      }
    } else {
      content = raw;
      title = baseName;
    }

    const previewCss = await loadPreviewCss(absolute);

    return {
      path: absolute,
      format,
      content,
      title,
      mtimeMs: s.mtimeMs,
      managed,
      shape,
      editable,
      previewCss,
    };
  } catch (err: unknown) {
    if (err instanceof PathNotAllowedError) {
      return { error: err.message, status: 403 };
    }
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return { error: "File not found", status: 404 };
    }
    return { error: e.message ?? "Unknown error", status: 500 };
  }
}

// Resolve the CSS file declared on the nearest enclosing shortcut folder
// (if any), read it, and scope every rule to .preview-css-scope so it can't
// leak into the editor chrome. Failures are swallowed: a missing or
// unreadable CSS file just means no preview styling, not a load error.
//
// cssPath is user-controlled via ~/.config/html-editor/shortcuts.json — the
// same trust boundary as the file paths in shortcuts. We skip resolveSafePath
// here because the CSS is only embedded inside a scoped <style> tag in the
// preview (no script execution path).
async function loadPreviewCss(absolutePath: string): Promise<string> {
  try {
    const tree = await loadShortcutTree();
    const cssPath = findFolderCssForPath(tree, absolutePath);
    if (!cssPath) return "";
    const raw = await readFile(cssPath, "utf8");
    return scopeCss(raw, `.${PREVIEW_CSS_SCOPE_CLASS}`);
  } catch {
    return "";
  }
}

function unescapeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
