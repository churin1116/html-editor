import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { detectFormat } from "@/lib/format";
import { PathNotAllowedError, resolveSafePath } from "@/lib/fs-safe";
import { formatBodyForSave, formatForSave } from "@/lib/html-pretty";
import {
  classifyHtml,
  joinFullDocument,
  splitFullDocument,
  wrapContent,
} from "@/lib/html-template";
import { loadFileFromDisk, readFileMaterializing } from "@/lib/load-file";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filePath = url.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "Missing 'path' query param" }, { status: 400 });
  }
  const result = await loadFileFromDisk(filePath);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result);
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
      const fresh = await loadFileFromDisk(filePath);
      const ok = !("error" in fresh);
      return NextResponse.json(
        {
          error: "conflict",
          message: "File was modified externally since it was opened.",
          currentMtimeMs,
          expectedMtimeMs,
          diskContent: ok ? fresh.content : null,
          diskTitle: ok ? fresh.title : null,
          diskShape: ok ? fresh.shape : null,
          diskManaged: ok ? fresh.managed : null,
          diskEditable: ok ? fresh.editable : null,
        },
        { status: 409 },
      );
    }

    const baseName = path.basename(absolute, path.extname(absolute));
    const safeTitle = title?.trim() || baseName;

    let toWrite: string;
    if (format === "html") {
      // Three shapes:
      //   managed       → has data-html-editor marker; rewrap with Chameleon shell
      //   fragment      → no doctype/html/head/body; save raw with pretty-print
      //   full-document → hand-authored full HTML; preserve head/doctype by
      //                   re-reading the on-disk wrap and replacing only the
      //                   body interior. Refuse the save if <body> tags are
      //                   missing (no safe place to stitch the edit back in).
      let shape: "managed" | "fragment" | "full-document" = "managed";
      let existingRaw: string | null = null;
      if (exists) {
        existingRaw = await readFileMaterializing(absolute);
        shape = classifyHtml(existingRaw);
      }
      if (shape === "full-document") {
        if (existingRaw === null) {
          return NextResponse.json(
            { error: "Cannot create new full-document files" },
            { status: 422 },
          );
        }
        const split = splitFullDocument(existingRaw);
        if (!split) {
          return NextResponse.json(
            {
              error: "read-only",
              message:
                "This full HTML document is missing <body> tags, so the editor cannot stitch edits back without risking head/doctype loss. Open it in a text editor instead.",
            },
            { status: 422 },
          );
        }
        toWrite = joinFullDocument(split, formatBodyForSave(content));
      } else {
        toWrite = shape === "managed" ? wrapContent(content, safeTitle) : formatForSave(content);
      }
    } else {
      toWrite = content;
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
