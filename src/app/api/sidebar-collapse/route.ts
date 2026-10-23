import { parseSidebarCollapsePatch, patchSidebarCollapse } from "@/lib/sidebar-collapse";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// The sidebar sends what changed in its open/closed state after each change,
// and it is merged into what was saved.
export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const patch = parseSidebarCollapsePatch(body);
  if (!patch) {
    return NextResponse.json({ error: "Invalid sidebar state change" }, { status: 400 });
  }
  try {
    await patchSidebarCollapse(patch);
  } catch (err: unknown) {
    return NextResponse.json({ error: (err as Error).message ?? "Unknown error" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
