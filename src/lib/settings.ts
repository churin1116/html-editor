// Editor-wide settings, persisted next to allowed-roots.json in
// ~/.config/html-editor/settings.json. Missing file / missing keys fall back
// to defaults, so the file only ever needs to contain overrides.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type EditorSettings = {
  // When true (default), every save bakes the theme freshly read from the
  // local html-chameleon clone — theme updates flow into files without a
  // manual `pnpm sync-theme`. When false, saves use the version last synced
  // into src/lib/chameleon-theme.generated.ts.
  themeAutoUpdate: boolean;
  // Local html-chameleon clone the live theme is read from.
  chameleonDir: string;
};

const CONFIG_DIR = path.join(homedir(), ".config", "html-editor");
const SETTINGS_PATH = path.join(CONFIG_DIR, "settings.json");

export const DEFAULT_SETTINGS: EditorSettings = {
  themeAutoUpdate: true,
  chameleonDir: path.join(homedir(), "MyApps/_chrome/260509-html-chameleon"),
};

export async function getSettings(): Promise<EditorSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<EditorSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function updateSettings(partial: Partial<EditorSettings>): Promise<EditorSettings> {
  const next = { ...(await getSettings()), ...partial };
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
