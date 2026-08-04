import { rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { PathNotAllowedError, resolveSafePath } from "@/lib/fs-safe";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Deleting from the sidebar means "move to the Trash", never an unlink: the
// entry sits in ~/.Trash until the Trash is emptied, so a mis-click costs a
// drag back out rather than the file. (Finder's "Put Back" needs restore info
// only Finder writes, so it stays greyed out — dragging out still works.)
// This also keeps the route from being a general delete primitive.
export async function POST(req: Request) {
  let body: { path?: string; paths?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const targets = (body.paths ?? (body.path ? [body.path] : []))
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter(Boolean);
  if (targets.length === 0) {
    return NextResponse.json({ error: "Missing 'paths'" }, { status: 400 });
  }

  const results: { path: string; trashedTo: string }[] = [];
  const errors: { path: string; error: string; code?: string; status: number }[] = [];
  for (const target of targets) {
    const outcome = await trashOne(target);
    if ("trashedTo" in outcome) results.push({ path: target, trashedTo: outcome.trashedTo });
    else errors.push({ path: target, ...outcome });
  }
  return NextResponse.json({ ok: errors.length === 0, results, errors });
}

type TrashOutcome = { trashedTo: string } | { error: string; code?: string; status: number };

async function trashOne(target: string): Promise<TrashOutcome> {
  try {
    const { absolute } = await resolveSafePath(target);
    const current = await stat(absolute).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (!current) return { error: "Path no longer exists", status: 404 };

    const trashDir = path.join(homedir(), ".Trash");
    const trashStat = await stat(trashDir).catch(() => null);
    if (!trashStat?.isDirectory()) {
      return { error: "No Trash folder on this system", code: "no-trash", status: 501 };
    }

    const destination = await freeTrashName(trashDir, path.basename(absolute));
    try {
      await rename(absolute, destination);
    } catch (err) {
      // The Trash lives on the home volume; anything on another volume (a
      // network mount, an external disk) can't be renamed into it. Removing
      // it outright would be unrecoverable, so the delete is refused instead.
      if ((err as NodeJS.ErrnoException).code === "EXDEV") {
        return { error: "Cannot move to Trash across volumes", code: "cross-volume", status: 409 };
      }
      throw err;
    }

    return { trashedTo: destination };
  } catch (err: unknown) {
    if (err instanceof PathNotAllowedError) {
      return { error: err.message, status: 403 };
    }
    const e = err as NodeJS.ErrnoException;
    return { error: e.message ?? "Unknown error", status: 500 };
  }
}

// Finder-style disambiguation: "notes.html", then "notes 2.html", ...
async function freeTrashName(trashDir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  for (let n = 1; n < 1000; n++) {
    const candidate = path.join(trashDir, n === 1 ? name : `${base} ${n}${ext}`);
    const exists = await stat(candidate).then(
      () => true,
      () => false,
    );
    if (!exists) return candidate;
  }
  // Absurdly unlikely; a timestamp is still better than overwriting.
  return path.join(trashDir, `${base} ${Date.now()}${ext}`);
}
