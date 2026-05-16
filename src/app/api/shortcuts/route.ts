import { stat } from "node:fs/promises";
import { expandPath } from "@/lib/allowed-roots";
import { detectFormat } from "@/lib/format";
import {
  type MoveSource,
  addFileToTree,
  addFolderToTree,
  fileExistsInTree,
  findFolder,
  loadShortcutTree,
  loadShortcutTreeWithStatus,
  moveNodeInTree,
  newFolder,
  removeFileFromTree,
  removeFolderFromTree,
  saveShortcutTree,
  setFileAliasInTree,
  setFolderCssInTree,
} from "@/lib/shortcuts";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const shortcuts = await loadShortcutTreeWithStatus();
  return NextResponse.json({ shortcuts });
}

type PostBody = {
  kind?: "file" | "folder";
  path?: string;
  name?: string;
  parentId?: string | null;
};

export async function POST(req: Request) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Backward compatibility: { path } without kind ⇒ kind "file"
  const kind: "file" | "folder" = body.kind ?? (body.path ? "file" : body.name ? "folder" : "file");
  const parentId = body.parentId ?? null;

  const tree = await loadShortcutTree();
  if (parentId !== null && !findFolder(tree, parentId)) {
    return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
  }

  if (kind === "folder") {
    const rawName = body.name?.trim();
    if (!rawName) {
      return NextResponse.json({ error: "Missing 'name'" }, { status: 400 });
    }
    const folder = newFolder(rawName);
    const { tree: next, ok } = addFolderToTree(tree, folder, parentId);
    if (!ok) {
      return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
    }
    await saveShortcutTree(next);
    return NextResponse.json({
      shortcuts: await loadShortcutTreeWithStatus(),
    });
  }

  const rawPath = body.path?.trim();
  if (!rawPath) {
    return NextResponse.json({ error: "Missing 'path'" }, { status: 400 });
  }
  const absolute = expandPath(rawPath);

  if (!detectFormat(absolute)) {
    return NextResponse.json(
      {
        error: "Unsupported file extension (expected .html or .md)",
        path: absolute,
      },
      { status: 400 },
    );
  }

  try {
    const s = await stat(absolute);
    if (!s.isFile()) {
      return NextResponse.json({ error: "Path is not a file", path: absolute }, { status: 400 });
    }
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return NextResponse.json({ error: "File does not exist", path: absolute }, { status: 400 });
    }
    if (e.code === "EACCES") {
      return NextResponse.json({ error: "Permission denied", path: absolute }, { status: 400 });
    }
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }

  if (fileExistsInTree(tree, absolute)) {
    return NextResponse.json(
      { error: "This path is already registered", path: absolute },
      { status: 409 },
    );
  }

  const { tree: next, ok } = addFileToTree(tree, absolute, parentId);
  if (!ok) {
    return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
  }
  await saveShortcutTree(next);
  return NextResponse.json({ shortcuts: await loadShortcutTreeWithStatus() });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const target = url.searchParams.get("path");
  const folderId = url.searchParams.get("folderId");

  if (folderId) {
    const tree = await loadShortcutTree();
    const { tree: next, removed } = removeFolderFromTree(tree, folderId);
    if (!removed) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    await saveShortcutTree(next);
    return NextResponse.json({
      shortcuts: await loadShortcutTreeWithStatus(),
    });
  }

  if (!target) {
    return NextResponse.json(
      { error: "Missing 'path' or 'folderId' query param" },
      { status: 400 },
    );
  }
  const absolute = expandPath(target);
  const tree = await loadShortcutTree();
  const { tree: next, removed } = removeFileFromTree(tree, absolute);
  if (!removed) {
    return NextResponse.json({ error: "Shortcut not found", path: absolute }, { status: 404 });
  }
  await saveShortcutTree(next);
  return NextResponse.json({ shortcuts: await loadShortcutTreeWithStatus() });
}

type PatchBody = {
  action?: "move" | "rename" | "setFolderCss";
  source?: MoveSource;
  targetFolderId?: string | null;
  path?: string;
  alias?: string;
  folderId?: string;
  cssPath?: string | null;
};

export async function PATCH(req: Request) {
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action === "rename") {
    const rawPath = body.path?.trim();
    if (!rawPath) {
      return NextResponse.json({ error: "Missing 'path'" }, { status: 400 });
    }
    const absolute = expandPath(rawPath);
    const alias = typeof body.alias === "string" && body.alias.trim() ? body.alias.trim() : null;
    const tree = await loadShortcutTree();
    const { tree: next, ok } = setFileAliasInTree(tree, absolute, alias);
    if (!ok) {
      return NextResponse.json({ error: "Shortcut not found", path: absolute }, { status: 404 });
    }
    await saveShortcutTree(next);
    return NextResponse.json({
      shortcuts: await loadShortcutTreeWithStatus(),
    });
  }

  if (body.action === "setFolderCss") {
    const folderId = body.folderId?.trim();
    if (!folderId) {
      return NextResponse.json({ error: "Missing 'folderId'" }, { status: 400 });
    }
    const raw = body.cssPath;
    const cssPath = typeof raw === "string" && raw.trim() ? expandPath(raw.trim()) : null;
    const tree = await loadShortcutTree();
    const { tree: next, ok } = setFolderCssInTree(tree, folderId, cssPath);
    if (!ok) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    await saveShortcutTree(next);
    return NextResponse.json({
      shortcuts: await loadShortcutTreeWithStatus(),
    });
  }

  if (body.action !== "move") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }
  const source = body.source;
  if (
    !source ||
    (source.kind !== "file" && source.kind !== "folder") ||
    (source.kind === "file" && !source.path) ||
    (source.kind === "folder" && !source.id)
  ) {
    return NextResponse.json({ error: "Invalid 'source'" }, { status: 400 });
  }
  const targetFolderId = body.targetFolderId ?? null;

  const tree = await loadShortcutTree();
  const { tree: next, ok, reason } = moveNodeInTree(tree, source, targetFolderId);
  if (!ok) {
    return NextResponse.json({ error: reason ?? "Move failed" }, { status: 400 });
  }
  await saveShortcutTree(next);
  return NextResponse.json({ shortcuts: await loadShortcutTreeWithStatus() });
}
