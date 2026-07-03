// Re-bake chameleon HTML files with the current theme.
//
// Saved files inline the theme (see html-template.ts), so theme updates are
// distributed by explicitly rewriting files — npm-style semantics, resolved
// here instead of at load time:
//
//   <meta name="chameleon" content="^1" data-baked="1.0.0">
//     content="^1"    → upgrade freely within major 1 (default)
//     content="1.0.0" → pinned; never touched without --force
//     content="v1"    → legacy external-link files; treated as "^1"
//
// Usage:
//   pnpm rebake <dir-or-file> [--dry-run] [--force]
//
// Two kinds of files are handled (logic shared with the save API via
// src/lib/chameleon-bake.ts):
//   - managed (data-html-editor="1", this editor's output): full head rewrap
//   - other chameleon files (meta tag, hosted <link>/<script>, or a baked
//     block): surgical swap of the theme only — everything else, including
//     custom [data-theme] overrides, is preserved verbatim.
// Files without either marker are skipped.
//
// The theme is resolved the same way the editor resolves it (auto-update
// setting → live clone read, else the last-synced generated module), so
// rebake and saves always bake the same version.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { bakeThemeIntoDocument, getBakePolicy, hasBakeableTheme } from "../src/lib/chameleon-bake";
import { type ChameleonTheme, resolveTheme } from "../src/lib/chameleon-live";
import { classifyHtml, unwrapContent, wrapContent } from "../src/lib/html-template";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const target = args.find((a) => !a.startsWith("--"));

if (!target) {
  console.error("Usage: pnpm rebake <dir-or-file> [--dry-run] [--force]");
  process.exit(1);
}

let theme: ChameleonTheme;
let currentMajor: string;

function collectHtmlFiles(path: string): string[] {
  const st = statSync(path);
  if (st.isFile()) return extname(path) === ".html" ? [path] : [];
  return readdirSync(path, { withFileTypes: true })
    .filter((e) => !e.name.startsWith(".") && e.name !== "node_modules")
    .flatMap((e) => {
      const full = join(path, e.name);
      if (e.isDirectory()) return collectHtmlFiles(full);
      return e.isFile() && extname(e.name) === ".html" ? [full] : [];
    });
}

type Outcome = "rebaked" | "up-to-date" | "pinned" | "major-blocked" | "not-chameleon";

function rebakeFile(path: string): Outcome {
  const raw = readFileSync(path, "utf8");

  const managed = classifyHtml(raw) === "managed";
  const { pinned, major } = getBakePolicy(raw);
  if (!managed && !hasBakeableTheme(raw)) return "not-chameleon";

  if (!force) {
    if (pinned) return "pinned";
    // "^1" / legacy "v1" → the major the file agreed to track.
    if (major && major !== currentMajor) return "major-blocked";
  }

  let next: string;
  if (managed) {
    const { content, title } = unwrapContent(raw);
    next = wrapContent(content, title, theme);
  } else {
    const baked = bakeThemeIntoDocument(raw, theme);
    if (baked === null) return "not-chameleon";
    next = baked;
  }

  if (next === raw) return "up-to-date";
  if (!dryRun) writeFileSync(path, next);
  return "rebaked";
}

async function main() {
  theme = await resolveTheme();
  const major = theme.version.match(/^(\d+)\./)?.[1];
  if (!major) {
    console.error(`Bad theme version "${theme.version}" — re-run pnpm sync-theme.`);
    process.exit(1);
  }
  currentMajor = major;

  // `target` is checked above; non-null here.
  const files = collectHtmlFiles(resolve(target as string));
  const counts: Record<Outcome, number> = {
    rebaked: 0,
    "up-to-date": 0,
    pinned: 0,
    "major-blocked": 0,
    "not-chameleon": 0,
  };

  for (const file of files) {
    const outcome = rebakeFile(file);
    counts[outcome]++;
    if (outcome === "rebaked") console.log(`${dryRun ? "[dry-run] " : ""}rebaked  ${file}`);
    else if (outcome === "pinned") console.log(`pinned   ${file} (use --force to override)`);
    else if (outcome === "major-blocked")
      console.log(`skipped  ${file} (tracks a different major; migrate manually)`);
  }

  console.log(
    `\n${files.length} .html file(s) → ${counts.rebaked} rebaked${dryRun ? " (dry-run)" : ""}, ` +
      `${counts["up-to-date"]} up-to-date, ${counts.pinned} pinned, ` +
      `${counts["major-blocked"]} major-blocked, ${counts["not-chameleon"]} not chameleon ` +
      `[theme ${theme.version}]`,
  );
}

main();
