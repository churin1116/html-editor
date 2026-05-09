import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import {
  expandPath,
  loadAllowedRoots,
  saveAllowedRoots,
} from "@/lib/allowed-roots";

export const dynamic = "force-dynamic";

export async function GET() {
  const roots = await loadAllowedRoots();
  return NextResponse.json({ roots });
}

export async function POST(req: Request) {
  let body: { label?: string; path?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { label, path: rawPath } = body;
  if (!label?.trim() || !rawPath?.trim()) {
    return NextResponse.json({ error: "Missing 'label' or 'path'" }, { status: 400 });
  }

  const absolute = expandPath(rawPath);
  try {
    const s = await stat(absolute);
    if (!s.isDirectory()) {
      return NextResponse.json(
        { error: "Path is not a directory", path: absolute },
        { status: 400 },
      );
    }
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return NextResponse.json(
        { error: "Path does not exist", path: absolute },
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

  const roots = await loadAllowedRoots();
  if (roots.some((r) => r.path === absolute)) {
    return NextResponse.json(
      { error: "This path is already registered", path: absolute },
      { status: 409 },
    );
  }

  const next = [...roots, { label: label.trim(), path: absolute }];
  await saveAllowedRoots(next);
  return NextResponse.json({ roots: next });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("path");
  if (!target) {
    return NextResponse.json({ error: "Missing 'path' query param" }, { status: 400 });
  }
  const absolute = expandPath(target);
  const roots = await loadAllowedRoots();
  const next = roots.filter((r) => r.path !== absolute);
  if (next.length === roots.length) {
    return NextResponse.json({ error: "Root not found", path: absolute }, { status: 404 });
  }
  await saveAllowedRoots(next);
  return NextResponse.json({ roots: next });
}
