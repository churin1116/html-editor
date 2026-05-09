import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { PathNotAllowedError, resolveSafePath } from "@/lib/fs-safe";

export const dynamic = "force-dynamic";

export type TreeEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeEntry[];
};

async function walk(dir: string): Promise<TreeEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const result: TreeEntry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const children = await walk(full);
      if (children.length === 0) continue;
      result.push({ name: entry.name, path: full, type: "directory", children });
    } else if (entry.isFile() && /\.(html?|md|markdown)$/i.test(entry.name)) {
      result.push({ name: entry.name, path: full, type: "file" });
    }
  }
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return result;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rootPath = url.searchParams.get("root");
  if (!rootPath) {
    return NextResponse.json({ error: "Missing 'root' query param" }, { status: 400 });
  }
  try {
    const { absolute } = await resolveSafePath(rootPath);
    const s = await stat(absolute);
    if (!s.isDirectory()) {
      return NextResponse.json(
        { error: "Path is not a directory", path: absolute },
        { status: 400 },
      );
    }
    const tree = await walk(absolute);
    return NextResponse.json({ tree });
  } catch (err: unknown) {
    if (err instanceof PathNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return NextResponse.json(
        { error: "Allowed root does not exist on disk", path: rootPath },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }
}
