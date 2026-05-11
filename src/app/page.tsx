import { EditorShell } from "@/components/editor-shell";
import { loadFileFromDisk } from "@/lib/load-file";
import { cookies } from "next/headers";

export default async function Page() {
  const cookieStore = await cookies();
  const raw = cookieStore.get("lastSelectedPath")?.value ?? "";
  let initialSelected: string | null = null;
  if (raw) {
    try {
      initialSelected = decodeURIComponent(raw);
    } catch {
      initialSelected = null;
    }
  }

  let initialFile = null;
  if (initialSelected) {
    const result = await loadFileFromDisk(initialSelected);
    if ("error" in result) {
      initialSelected = null;
    } else {
      initialFile = result;
    }
  }

  const initialSidebarOpen = cookieStore.get("sidebarOpen")?.value !== "0";

  return (
    <EditorShell
      initialSelected={initialSelected}
      initialFile={initialFile}
      initialSidebarOpen={initialSidebarOpen}
    />
  );
}
