import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { PathNotAllowedError, resolveSafePath } from "@/lib/fs-safe";
import { renameNode } from "@/lib/rename";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Creates one directory inside an allowed root. Deliberately non-recursive:
// the sidebar only ever creates a single folder under an existing one, and a
// recursive mkdir would silently accept a mistyped nested path.
export async function POST(req: Request) {
  let body: { dir?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { dir, name } = body;
  const rawName = name?.trim();
  if (!dir || !rawName) {
    return NextResponse.json({ error: "Missing 'dir' or 'name'" }, { status: 400 });
  }
  if (rawName.includes("/") || rawName.includes("\\") || rawName.includes("..")) {
    return NextResponse.json({ error: "Invalid folder name" }, { status: 400 });
  }

  try {
    const { absolute } = await resolveSafePath(path.join(dir, rawName));

    // Pre-checked so an existing *file* of that name reports the same clear
    // conflict an existing folder would, instead of a raw EEXIST.
    try {
      await stat(absolute);
      return NextResponse.json({ error: "Folder already exists" }, { status: 409 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    await mkdir(absolute);
    return NextResponse.json({ ok: true, path: absolute });
  } catch (err: unknown) {
    if (err instanceof PathNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EEXIST") {
      return NextResponse.json({ error: "Folder already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }
}

// Rename a folder in place.
export async function PATCH(req: Request) {
  let body: { path?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = await renameNode(body.path ?? "", body.name ?? "", "directory");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, path: result.path });
}
