import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { PathNotAllowedError, resolveSafePath } from "@/lib/fs-safe";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const EDITABLE_EXT_RE = /\.(html?|md|markdown)$/i;
// Notes, not media: a stray multi-hundred-MB drop should be refused rather
// than buffered into memory.
const MAX_BYTES = 10 * 1024 * 1024;

// Copies files dropped from the OS (Finder, Explorer) into a directory inside
// an allowed root. Each file is reported separately so one refusal doesn't
// hide the ones that landed.
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const targetDir = String(form.get("targetDir") ?? "").trim();
  const files = form.getAll("files").filter((v): v is File => v instanceof File);
  if (!targetDir || files.length === 0) {
    return NextResponse.json({ error: "Missing 'targetDir' or 'files'" }, { status: 400 });
  }

  let absoluteDir: string;
  try {
    const resolved = await resolveSafePath(targetDir);
    absoluteDir = resolved.absolute;
    const s = await stat(absoluteDir);
    if (!s.isDirectory()) {
      return NextResponse.json({ error: "Destination is not a directory" }, { status: 400 });
    }
  } catch (err: unknown) {
    if (err instanceof PathNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return NextResponse.json({ error: "Destination does not exist" }, { status: 404 });
    }
    return NextResponse.json({ error: e.message ?? "Unknown error" }, { status: 500 });
  }

  const imported: string[] = [];
  const errors: { name: string; error: string }[] = [];

  for (const file of files) {
    // Browsers send a bare filename, but treat it as untrusted anyway.
    const name = path.basename(file.name ?? "").trim();
    if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".")) {
      errors.push({ name: file.name ?? "(no name)", error: "Invalid file name" });
      continue;
    }
    if (!EDITABLE_EXT_RE.test(name)) {
      errors.push({ name, error: "Only .html and .md files can be imported" });
      continue;
    }
    if (file.size > MAX_BYTES) {
      errors.push({ name, error: "File is too large" });
      continue;
    }
    try {
      const { absolute } = await resolveSafePath(path.join(absoluteDir, name));
      try {
        await stat(absolute);
        errors.push({ name, error: "A file with that name already exists" });
        continue;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      await writeFile(absolute, Buffer.from(await file.arrayBuffer()));
      imported.push(absolute);
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      errors.push({ name, error: e.message ?? "Unknown error" });
    }
  }

  return NextResponse.json({ ok: errors.length === 0, imported, errors });
}
