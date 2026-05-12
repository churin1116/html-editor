import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { expandPath } from "@/lib/allowed-roots";
import { detectFormat } from "@/lib/format";
import {
  loadShortcuts,
  loadShortcutsWithStatus,
  saveShortcuts,
} from "@/lib/shortcuts";

export const dynamic = "force-dynamic";

export async function GET() {
  const shortcuts = await loadShortcutsWithStatus();
  return NextResponse.json({ shortcuts });
}

export async function POST(req: Request) {
  let body: { path?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { path: rawPath } = body;
  if (!rawPath?.trim()) {
    return NextResponse.json({ error: "Missing 'path'" }, { status: 400 });
  }

  const absolute = expandPath(rawPath);

  if (!detectFormat(absolute)) {
    return NextResponse.json(
      { error: "Unsupported file extension (expected .html or .md)", path: absolute },
      { status: 400 },
    );
  }

  try {
    const s = await stat(absolute);
    if (!s.isFile()) {
      return NextResponse.json(
        { error: "Path is not a file", path: absolute },
        { status: 400 },
      );
    }
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return NextResponse.json(
        { error: "File does not exist", path: absolute },
        { status: 400 },
      );
    }
    if (e.code === "EACCES") {
      return NextResponse.json(
        { error: "Permission denied", path: absolute },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }

  const shortcuts = await loadShortcuts();
  if (shortcuts.some((s) => s.path === absolute)) {
    return NextResponse.json(
      { error: "This path is already registered", path: absolute },
      { status: 409 },
    );
  }

  const next = [...shortcuts, { path: absolute }];
  await saveShortcuts(next);
  return NextResponse.json({ shortcuts: await loadShortcutsWithStatus() });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("path");
  if (!target) {
    return NextResponse.json({ error: "Missing 'path' query param" }, { status: 400 });
  }
  const absolute = expandPath(target);
  const shortcuts = await loadShortcuts();
  const next = shortcuts.filter((s) => s.path !== absolute);
  if (next.length === shortcuts.length) {
    return NextResponse.json({ error: "Shortcut not found", path: absolute }, { status: 404 });
  }
  await saveShortcuts(next);
  return NextResponse.json({ shortcuts: await loadShortcutsWithStatus() });
}
