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
// Two kinds of files are handled:
//   - managed (data-html-editor="1", this editor's output): full head rewrap
//   - other chameleon files (<meta name="chameleon">, e.g. skill-generated
//     docs with custom theme blocks): surgical swap of the hosted
//     <link>/<script> (or a previously baked block) only — everything else,
//     including custom [data-theme] overrides, is preserved verbatim.
// Files without either marker are skipped.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import {
  CHAMELEON_CSS,
  CHAMELEON_JS,
  CHAMELEON_VERSION,
} from "../src/lib/chameleon-theme.generated";
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

type Outcome = "rebaked" | "up-to-date" | "pinned" | "major-blocked" | "not-chameleon";

// Hosted copies this tool knows how to replace with the baked theme.
const HOSTED_CSS_RE =
  /<link[^>]*href="https:\/\/churin1116\.github\.io\/html-chameleon\/[^"]*theme\.css"[^>]*>/;
const HOSTED_JS_RE =
  /<script[^>]*src="https:\/\/churin1116\.github\.io\/html-chameleon\/[^"]*theme\.js"[^>]*><\/script>/;
const BAKED_CSS_RE = /<style data-chameleon-theme>[\s\S]*?<\/style>/;
// Inner `</script` sequences are escaped to `<\/script` at sync time, so the
// first real `</script>` is the block's own closer.
const BAKED_JS_RE = /<script data-chameleon-theme>[\s\S]*?<\/script>/;

function rebakeFile(path: string): Outcome {
  const raw = readFileSync(path, "utf8");

  const meta = raw.match(/<meta name="chameleon" content="([^"]*)"(?:\s+data-baked="([^"]*)")?/);

  // Managed files (this editor's output) get a full head rewrap. Other
  // chameleon files — e.g. skill-generated full documents with their own
  // custom theme blocks — get a surgical swap: only the hosted <link>/<script>
  // (or a previously baked block) is replaced; everything else is preserved.
  const managed = classifyHtml(raw) === "managed";
  // A hosted theme reference (or an existing baked block) also qualifies:
  // some generated files carry the <link>/<script> without the meta tag.
  const hasTheme = BAKED_CSS_RE.test(raw) || HOSTED_CSS_RE.test(raw);
  if (!managed && !meta && !hasTheme) return "not-chameleon";

  const policy = meta?.[1] ?? "^1"; // pre-meta managed files: default to tracking major 1
  if (!force) {
    if (/^\d/.test(policy)) return "pinned";
    // "^1" / legacy "v1" → the major the file agreed to track.
    const policyMajor = policy.match(/^[\^v]?(\d+)/)?.[1];
    if (policyMajor && policyMajor !== currentMajor) return "major-blocked";
  }

  let next: string;
  if (managed) {
    const { content, title } = unwrapContent(raw);
    next = wrapContent(content, title);
  } else {
    // Refresh an existing baked block, else swap the hosted reference —
    // never both: the baked theme's own header comment quotes the hosted
    // URL, so trying the hosted pattern on an already-baked file would
    // match inside the baked block and nest a second copy into it.
    // Function replacements: the theme source may contain `$&`-style
    // sequences that a string replacement would expand.
    next = BAKED_CSS_RE.test(raw)
      ? raw.replace(BAKED_CSS_RE, () => `<style data-chameleon-theme>${CHAMELEON_CSS}</style>`)
      : raw.replace(HOSTED_CSS_RE, () => `<style data-chameleon-theme>${CHAMELEON_CSS}</style>`);
    next = BAKED_JS_RE.test(next)
      ? next.replace(BAKED_JS_RE, () => `<script data-chameleon-theme>${CHAMELEON_JS}</script>`)
      : next.replace(HOSTED_JS_RE, () => `<script data-chameleon-theme>${CHAMELEON_JS}</script>`);
    if (!BAKED_CSS_RE.test(next)) return "not-chameleon"; // nothing swappable found
    if (meta) {
      next = next.replace(
        /<meta name="chameleon" content="[^"]*"(?:\s+data-baked="[^"]*")?/,
        `<meta name="chameleon" content="${policy === "v1" ? "^1" : policy}" data-baked="${CHAMELEON_VERSION}"`,
      );
    } else {
      // Files that carried only the hosted <link>/<script>: add the meta so
      // the policy/version are tracked and future runs take the update path.
      next = next.replace(
        /<style data-chameleon-theme>/,
        () =>
          `<meta name="chameleon" content="^1" data-baked="${CHAMELEON_VERSION}">\n<style data-chameleon-theme>`,
      );
    }
  }

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
    `[theme ${CHAMELEON_VERSION}]`,
);
