import path from "node:path";
import { marked } from "marked";
import TurndownService from "turndown";

export type FileFormat = "html" | "md";

export function detectFormat(filePath: string): FileFormat | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".md" || ext === ".markdown") return "md";
  return null;
}

marked.setOptions({ gfm: true, breaks: false });

export function mdToHtml(md: string): string {
  return marked.parse(md, { async: false }) as string;
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
});

turndown.addRule("strikethrough", {
  filter: ["s", "strike"] as unknown as Array<keyof HTMLElementTagNameMap>,
  replacement: (content) => `~~${content}~~`,
});

turndown.addRule("tableCell", {
  filter: ["th", "td"],
  replacement: (content, node) => {
    const cell = node as Element;
    const isHeader = cell.tagName === "TH";
    const text = content.trim().replace(/\|/g, "\\|").replace(/\n/g, " ");
    return ` ${text} |${isHeader ? "" : ""}`;
  },
});

turndown.addRule("tableRow", {
  filter: "tr",
  replacement: (content, node) => {
    const row = node as Element;
    const hasHeader = row.querySelector("th") !== null;
    let result = `|${content}\n`;
    if (hasHeader) {
      const cells = row.querySelectorAll("th").length;
      result += `|${" --- |".repeat(cells)}\n`;
    }
    return result;
  },
});

turndown.addRule("table", {
  filter: "table",
  replacement: (content) => `\n${content}\n`,
});

export function htmlToMd(html: string): string {
  return turndown.turndown(html);
}
