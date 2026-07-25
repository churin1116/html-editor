import { loadTreeForRoot } from "@/lib/tree";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export type { TreeEntry } from "@/lib/tree";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rootPath = url.searchParams.get("root");
  if (!rootPath) {
    return NextResponse.json({ error: "Missing 'root' query param" }, { status: 400 });
  }
  const result = await loadTreeForRoot(rootPath);
  if ("error" in result) {
    return NextResponse.json({ error: result.error, path: rootPath }, { status: result.status });
  }
  return NextResponse.json({ tree: result.tree, truncated: result.truncated });
}
