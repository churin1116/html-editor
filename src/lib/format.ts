import path from "node:path";

export type FileFormat = "html" | "md";

export function detectFormat(filePath: string): FileFormat | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".md" || ext === ".markdown") return "md";
  return null;
}
