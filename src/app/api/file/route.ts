import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { detectFormat, htmlToMd, mdToHtml } from "@/lib/format";
import { PathNotAllowedError, resolveSafePath } from "@/lib/fs-safe";
import { isManagedHtml, unwrapContent, wrapContent } from "@/lib/html-template";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filePath = url.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "Missing 'path' query param" }, { status: 400 });
  }

  try {
    const { absolute } = await resolveSafePath(filePath);
    const format = detectFormat(absolute);
    if (!format) {
      return NextResponse.json(
        { error: "Unsupported file extension (expected .html or .md)" },
        { status: 400 },
      );
    }
    const raw = await readFile(absolute, "utf8");
    const s = await stat(absolute);
    const baseName = path.basename(absolute, path.extname(absolute));

    let content: string;
    let title: string;
    let managed = true;
    if (format === "html") {
      const unwrapped = unwrapContent(raw);
      content = unwrapped.content;
      title = unwrapped.title || baseName;
      managed = isManagedHtml(raw);
    } else {
      content = mdToHtml(raw);
      title = baseName;
    }

    return NextResponse.json({
      path: absolute,
      format,
      content,
      title,
      mtimeMs: s.mtimeMs,
      managed,
    });
  } catch (err: unknown) {
    if (err instanceof PathNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  let body: { path?: string; content?: string; title?: string; expectedMtimeMs?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { path: filePath, content, title, expectedMtimeMs } = body;
  if (!filePath || content === undefined) {
    return NextResponse.json({ error: "Missing 'path' or 'content'" }, { status: 400 });
  }

  try {
    const { absolute } = await resolveSafePath(filePath);
    const format = detectFormat(absolute);
    if (!format) {
      return NextResponse.json({ error: "Unsupported file extension" }, { status: 400 });
    }

    let exists = true;
    let currentMtimeMs = 0;
    try {
      const s = await stat(absolute);
      currentMtimeMs = s.mtimeMs;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        exists = false;
      } else {
        throw err;
      }
    }

    if (exists && expectedMtimeMs !== undefined && Math.abs(currentMtimeMs - expectedMtimeMs) > 1) {
      return NextResponse.json(
        {
          error: "conflict",
          message: "File was modified externally since it was opened.",
          currentMtimeMs,
          expectedMtimeMs,
        },
        { status: 409 },
      );
    }

    const baseName = path.basename(absolute, path.extname(absolute));
    const safeTitle = title?.trim() || baseName;

    let toWrite: string;
    if (format === "html") {
      toWrite = wrapContent(content, safeTitle);
    } else {
      toWrite = htmlToMd(content);
      if (!toWrite.endsWith("\n")) toWrite += "\n";
    }

    await writeFile(absolute, toWrite, "utf8");
    const after = await stat(absolute);
    return NextResponse.json({ ok: true, mtimeMs: after.mtimeMs });
  } catch (err: unknown) {
    if (err instanceof PathNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const e = err as NodeJS.ErrnoException;
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { dir?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { dir, name } = body;
  if (!dir || !name) {
    return NextResponse.json({ error: "Missing 'dir' or 'name'" }, { status: 400 });
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
  }

  try {
    const finalName = name.toLowerCase().endsWith(".html") ? name : `${name}.html`;
    const target = path.join(dir, finalName);
    const { absolute } = await resolveSafePath(target);

    try {
      await stat(absolute);
      return NextResponse.json({ error: "File already exists" }, { status: 409 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    const baseName = path.basename(absolute, ".html");
    const initialContent = `<h1>${escapeHtml(baseName)}</h1>\n<p></p>`;
    const fullHtml = wrapContent(initialContent, baseName);
    await writeFile(absolute, fullHtml, "utf8");
    const s = await stat(absolute);
    return NextResponse.json({ ok: true, path: absolute, mtimeMs: s.mtimeMs });
  } catch (err: unknown) {
    if (err instanceof PathNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const e = err as NodeJS.ErrnoException;
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
