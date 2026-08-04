import { moveNode } from "@/lib/rename";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Moves one or more files/folders into another directory, all inside allowed
// roots. The sidebar's drag-and-drop is the only caller; a multi-row drag
// sends several paths, and each is reported separately so one refusal (a name
// collision, say) doesn't hide the moves that did happen.
export async function POST(req: Request) {
  let body: { path?: string; paths?: string[]; targetDir?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const paths = (body.paths ?? (body.path ? [body.path] : [])).filter(
    (p): p is string => typeof p === "string" && p.trim() !== "",
  );
  const targetDir = body.targetDir ?? "";
  if (paths.length === 0 || !targetDir.trim()) {
    return NextResponse.json({ error: "Missing 'paths' or 'targetDir'" }, { status: 400 });
  }

  const results: { from: string; to: string }[] = [];
  const errors: { path: string; error: string; status: number }[] = [];
  // Sequential: two moves into the same directory can collide with each other,
  // and the per-entry result is what the sidebar reports.
  for (const p of paths) {
    const result = await moveNode(p, targetDir);
    if (result.ok) results.push({ from: p, to: result.path });
    else errors.push({ path: p, error: result.error, status: result.status });
  }

  return NextResponse.json({ ok: errors.length === 0, results, errors });
}
