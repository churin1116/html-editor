import { readFile } from "node:fs/promises";
import path from "node:path";

export type AllowedRoot = {
  label: string;
  path: string;
};

type Config = {
  roots: AllowedRoot[];
};

const CONFIG_PATH = path.resolve(process.cwd(), "config/allowed-roots.json");

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
