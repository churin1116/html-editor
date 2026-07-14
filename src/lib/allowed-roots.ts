import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AllowedRoot = {
  label: string;
  path: string;
};

type Config = {
  roots: AllowedRoot[];
};

const CONFIG_DIR = path.join(homedir(), ".config", "html-editor");
const CONFIG_PATH = path.join(CONFIG_DIR, "allowed-roots.json");
const LEGACY_CONFIG_PATH = path.resolve(process.cwd(), "config/allowed-roots.json");

async function migrateLegacyIfPresent(): Promise<void> {
  // If the new-location file already exists, nothing to do.
  try {
    await stat(CONFIG_PATH);
    return;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return;
  }
  // New location missing — fall back to legacy if present.
  try {
    await stat(LEGACY_CONFIG_PATH);
  } catch {
    return;
  }
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    await rename(LEGACY_CONFIG_PATH, CONFIG_PATH);
  } catch {
    /* ignore — user can re-add manually */
  }
}

export function expandPath(input: string): string {
  let p = input.trim();
  // A pasted file:// URL (e.g. dragged from Finder/browser) → real path.
  // fileURLToPath also decodes percent-encoding (%20 → space, etc.).
  if (/^file:\/\//i.test(p)) {
    try {
      p = fileURLToPath(p);
    } catch {
      // Malformed URL — fall through and let path.resolve do its best.
    }
  }
  if (p === "~") return homedir();
  if (p.startsWith("~/")) p = path.join(homedir(), p.slice(2));
  return path.resolve(p);
}

export async function loadAllowedRoots(): Promise<AllowedRoot[]> {
  await migrateLegacyIfPresent();
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Config;
    return parsed.roots.map((r) => ({
      label: r.label,
      path: path.resolve(r.path),
    }));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function saveAllowedRoots(roots: AllowedRoot[]): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const config: Config = { roots };
  const json = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(CONFIG_PATH, json, "utf8");
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
