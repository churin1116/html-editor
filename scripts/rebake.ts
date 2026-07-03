// Re-bake managed HTML files with the currently synced Chameleon theme.
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
// Only files carrying data-html-editor="1" (this editor's own output) are
// touched; hand-authored full documents and fragments are skipped.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { CHAMELEON_VERSION } from "../src/lib/chameleon-theme.generated";
import { classifyHtml, unwrapContent, wrapContent } from "../src/lib/html-template";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const target = args.find((a) => !a.startsWith("--"));

if (!target) {
  console.error("Usage: pnpm rebake <dir-or-file> [--dry-run] [--force]");
  process.exit(1);
}

const currentMajor = CHAMELEON_VERSION.match(/^(\d+)\./)?.[1];
if (!currentMajor) {
  console.error(`Bad CHAMELEON_VERSION "${CHAMELEON_VERSION}" — re-run pnpm sync-theme.`);
  process.exit(1);
}

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

type Outcome = "rebaked" | "up-to-date" | "pinned" | "major-blocked" | "not-managed";

function rebakeFile(path: string): Outcome {
  const raw = readFileSync(path, "utf8");
  if (classifyHtml(raw) !== "managed") return "not-managed";

  const meta = raw.match(/<meta name="chameleon" content="([^"]*)"(?:\s+data-baked="([^"]*)")?/);
  const policy = meta?.[1] ?? "^1"; // pre-meta files: default to tracking major 1

  if (!force) {
    if (/^\d/.test(policy)) return "pinned";
    // "^1" / legacy "v1" → the major the file agreed to track.
    const policyMajor = policy.match(/^[\^v]?(\d+)/)?.[1];
    if (policyMajor && policyMajor !== currentMajor) return "major-blocked";
  }

  const { content, title } = unwrapContent(raw);
  const next = wrapContent(content, title);
  if (next === raw) return "up-to-date";
  if (!dryRun) writeFileSync(path, next);
  return "rebaked";
}

const files = collectHtmlFiles(resolve(target));
const counts: Record<Outcome, number> = {
  rebaked: 0,
  "up-to-date": 0,
  pinned: 0,
  "major-blocked": 0,
  "not-managed": 0,
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
    `${counts["major-blocked"]} major-blocked, ${counts["not-managed"]} not managed ` +
    `[theme ${CHAMELEON_VERSION}]`,
);
