import { resolveTheme } from "@/lib/chameleon-live";
import { getSettings, updateSettings } from "@/lib/settings";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  // Resolved theme version is display-only context for the settings UI
  // ("what would be baked if I saved right now").
  const theme = await resolveTheme();
  return NextResponse.json({ settings, themeVersion: theme.version });
}

export async function PATCH(req: Request) {
  let body: { themeAutoUpdate?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof body.themeAutoUpdate !== "boolean") {
    return NextResponse.json({ error: "Missing 'themeAutoUpdate' boolean" }, { status: 400 });
  }
  const settings = await updateSettings({ themeAutoUpdate: body.themeAutoUpdate });
  const theme = await resolveTheme();
  return NextResponse.json({ settings, themeVersion: theme.version });
}
