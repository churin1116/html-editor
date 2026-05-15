import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { detectFormat } from "@/lib/format";
import { PathNotAllowedError, resolveSafePath } from "@/lib/fs-safe";
import { preserveBlankLines } from "@/lib/html-pretty";
import { type HtmlShape, classifyHtml, isManagedHtml, unwrapContent } from "@/lib/html-template";

export type LoadedFile = {
  path: string;
  format: "html" | "md";
  content: string;
  title: string;
  mtimeMs: number;
  managed: boolean;
  shape: HtmlShape | null;
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
    if (format === "html") {
      const unwrapped = unwrapContent(raw);
      content = preserveBlankLines(unwrapped.content);
      title = unwrapped.title || baseName;
      managed = isManagedHtml(raw);
      shape = classifyHtml(raw);
    } else {
      content = raw;
      title = baseName;
    }

    return {
      path: absolute,
      format,
      content,
      title,
      mtimeMs: s.mtimeMs,
      managed,
      shape,
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
