import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PathNotAllowedError, resolveSafePath } from "@/lib/fs-safe";

export const dynamic = "force-dynamic";

// A file on disk, as is, for a browser tab to view: /api/view/<absolute path>.
// A link with target="_blank" to a local page opens here (link-open.ts) — a
// localhost page can't open file:// itself. The path is the URL's own path, so
// the page's relative links (images, styles, another page beside it) resolve
// back to this route, the way they would when the file is opened on its own.
// Read-only, and only under the allowed roots, like every other file API.

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".markdown": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const segments = (await params).path;
  const requested = `/${segments.map(decodeSegment).join("/")}`;
  let absolute: string;
  try {
    ({ absolute } = await resolveSafePath(requested));
  } catch (err) {
    if (err instanceof PathNotAllowedError) {
      return new Response("このファイルは開けません（登録したフォルダの外です）", {
        status: 403,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    throw err;
  }
  try {
    const s = await stat(absolute);
    if (!s.isFile()) return notFound();
    const body = await readFile(absolute);
    return new Response(body, {
      headers: {
        "Content-Type": TYPES[path.extname(absolute).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return notFound();
    throw err;
  }
}

// Next hands catch-all segments over decoded already; a stray "%" in a name
// must not throw on a second pass.
function decodeSegment(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function notFound(): Response {
  return new Response("ファイルが見つかりません", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
