import { NextResponse } from "next/server";
import { loadAllowedRoots } from "@/lib/allowed-roots";

export const dynamic = "force-dynamic";

export async function GET() {
  const roots = await loadAllowedRoots();
  return NextResponse.json({ roots });
}
