// Resolve which Chameleon theme to bake at save time.
//
// Auto-update mode ON (default): read theme.css/theme.js live from the local
// html-chameleon clone, so theme updates flow into saved files without a
// manual `pnpm sync-theme`. Falls back to the last-synced generated module
// whenever the clone is missing or unreadable — saving must never fail
// because of the theme source.
//
// Auto-update mode OFF: always the generated module (frozen at last sync).

import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  CHAMELEON_CONTRACT,
  CHAMELEON_CSS,
  CHAMELEON_JS,
  CHAMELEON_VERSION,
} from "./chameleon-theme.generated";
import { getSettings } from "./settings";

const execFileAsync = promisify(execFile);

export type ChameleonTheme = {
  css: string;
  js: string;
  version: string;
  contract: string;
};

export const GENERATED_THEME: ChameleonTheme = {
  css: CHAMELEON_CSS,
  js: CHAMELEON_JS,
  version: CHAMELEON_VERSION,
  contract: CHAMELEON_CONTRACT,
};

// Live reads are cached per (css mtime, js mtime); a theme edit in the clone
// invalidates naturally on the next save.
let cache: { key: string; theme: ChameleonTheme } | null = null;

export async function resolveTheme(): Promise<ChameleonTheme> {
  const settings = await getSettings();
  if (!settings.themeAutoUpdate) return GENERATED_THEME;
  return (await readLiveTheme(settings.chameleonDir)) ?? GENERATED_THEME;
}

async function readLiveTheme(cloneDir: string): Promise<ChameleonTheme | null> {
  const cssPath = path.join(cloneDir, "theme/v1/theme.css");
  const jsPath = path.join(cloneDir, "theme/v1/theme.js");
  try {
    const [cssStat, jsStat] = await Promise.all([stat(cssPath), stat(jsPath)]);
    const key = `${cssStat.mtimeMs}:${jsStat.mtimeMs}`;
    if (cache?.key === key) return cache.theme;

    const [css, jsRaw] = await Promise.all([readFile(cssPath, "utf8"), readFile(jsPath, "utf8")]);
    // `</style` inside CSS cannot be escaped for an inline block — treat the
    // live copy as unusable and fall back rather than emit a broken file.
    if (/<\/style/i.test(css)) return null;
    const js = jsRaw.replace(/<\/script/gi, "<\\/script");

    let version = GENERATED_THEME.version;
    try {
      const { stdout } = await execFileAsync("git", [
        "-C",
        cloneDir,
        "describe",
        "--tags",
        "--abbrev=7",
      ]);
      version = stdout.trim().replace(/^v/, "");
    } catch {
      /* untagged clone — keep the generated version as the best label */
    }
    const major = version.match(/^(\d+)\./)?.[1];
    const theme: ChameleonTheme = {
      css,
      js,
      version,
      contract: major ? `^${major}` : GENERATED_THEME.contract,
    };
    cache = { key, theme };
    return theme;
  } catch {
    return null;
  }
}
