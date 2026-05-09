import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type AllowedRoot = {
  label: string;
  path: string;
};

type Config = {
  roots: AllowedRoot[];
};

const CONFIG_PATH = path.resolve(process.cwd(), "config/allowed-roots.json");

export function expandPath(input: string): string {
  let p = input.trim();
  if (p === "~") return homedir();
  if (p.startsWith("~/")) p = path.join(homedir(), p.slice(2));
  return path.resolve(p);
}

export async function loadAllowedRoots(): Promise<AllowedRoot[]> {
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
  const config: Config = { roots };
  const json = `${JSON.stringify(config, null, 2)}\n`;
  await writeFile(CONFIG_PATH, json, "utf8");
}
