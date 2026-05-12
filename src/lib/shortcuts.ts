import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type Shortcut = {
  path: string;
};

export type ShortcutWithStatus = Shortcut & { exists: boolean };

type Config = {
  shortcuts: Shortcut[];
};

const CONFIG_DIR = path.join(homedir(), ".config", "html-editor");
const CONFIG_PATH = path.join(CONFIG_DIR, "shortcuts.json");

export async function loadShortcuts(): Promise<Shortcut[]> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Config;
    return (parsed.shortcuts ?? []).map((s) => ({
      path: path.resolve(s.path),
    }));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function saveShortcuts(shortcuts: Shortcut[]): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const config: Config = { shortcuts };
  const json = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(CONFIG_PATH, json, "utf8");
}

export function getShortcutsPath(): string {
  return CONFIG_PATH;
}

export async function loadShortcutsWithStatus(): Promise<ShortcutWithStatus[]> {
  const shortcuts = await loadShortcuts();
  return Promise.all(
    shortcuts.map(async (s) => {
      try {
        const st = await stat(s.path);
        return { ...s, exists: st.isFile() };
      } catch {
        return { ...s, exists: false };
      }
    }),
  );
}
