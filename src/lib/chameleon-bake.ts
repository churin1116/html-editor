// Surgical theme baking for non-managed chameleon HTML (skill-generated full
// documents, hand-authored pages): swap only the hosted theme <link>/<script>
// — or a previously baked block — for the given inline theme, preserving the
// rest of the document verbatim. Shared by the save API (auto-update mode)
// and scripts/rebake.ts.

import type { ChameleonTheme } from "./chameleon-live";

// Hosted copies this tool knows how to replace with the baked theme.
export const HOSTED_CSS_RE =
  /<link[^>]*href="https:\/\/churin1116\.github\.io\/html-chameleon\/[^"]*theme\.css"[^>]*>/;
export const HOSTED_JS_RE =
  /<script[^>]*src="https:\/\/churin1116\.github\.io\/html-chameleon\/[^"]*theme\.js"[^>]*><\/script>/;
export const BAKED_CSS_RE = /<style data-chameleon-theme>[\s\S]*?<\/style>/;
// Inner `</script` sequences are escaped to `<\/script` at sync time, so the
// first real `</script>` is the block's own closer.
export const BAKED_JS_RE = /<script data-chameleon-theme>[\s\S]*?<\/script>/;

const META_RE = /<meta name="chameleon" content="([^"]*)"(?:\s+data-baked="([^"]*)")?/;

export type BakePolicy = {
  policy: string; // "^1", legacy "v1", or an exact version = pinned
  baked: string | null; // version currently baked into the file, if stamped
  pinned: boolean;
  major: string | null; // the major the file agreed to track (null = any)
};

export function getBakePolicy(raw: string): BakePolicy {
  const meta = raw.match(META_RE);
  const policy = meta?.[1] ?? "^1"; // no meta yet: default to tracking major 1
  return {
    policy,
    baked: meta?.[2] ?? null,
    pinned: /^\d/.test(policy),
    major: policy.match(/^[\^v]?(\d+)/)?.[1] ?? null,
  };
}

// True when the document references the Chameleon theme in a form this module
// can re-bake (hosted tags or a previously baked block).
export function hasBakeableTheme(raw: string): boolean {
  return BAKED_CSS_RE.test(raw) || HOSTED_CSS_RE.test(raw);
}

// Swap the theme in a non-managed chameleon document. Returns the updated
// document, or null when nothing swappable was found. Policy (pins, major
// tracking) is NOT checked here — callers decide via getBakePolicy().
export function bakeThemeIntoDocument(raw: string, theme: ChameleonTheme): string | null {
  // Refresh an existing baked block, else swap the hosted reference — never
  // both: the baked theme's own header comment quotes the hosted URL, so
  // trying the hosted pattern on an already-baked file would match inside
  // the baked block and nest a second copy into it.
  // Function replacements: the theme source may contain `$&`-style sequences
  // that a string replacement would expand.
  let next = BAKED_CSS_RE.test(raw)
    ? raw.replace(BAKED_CSS_RE, () => `<style data-chameleon-theme>${theme.css}</style>`)
    : raw.replace(HOSTED_CSS_RE, () => `<style data-chameleon-theme>${theme.css}</style>`);
  next = BAKED_JS_RE.test(next)
    ? next.replace(BAKED_JS_RE, () => `<script data-chameleon-theme>${theme.js}</script>`)
    : next.replace(HOSTED_JS_RE, () => `<script data-chameleon-theme>${theme.js}</script>`);
  if (!BAKED_CSS_RE.test(next)) return null; // nothing swappable found

  const { policy } = getBakePolicy(raw);
  const stamped = `<meta name="chameleon" content="${policy === "v1" ? "^1" : policy}" data-baked="${theme.version}"`;
  if (META_RE.test(next)) {
    next = next.replace(META_RE, stamped);
  } else {
    // Files that carried only the hosted <link>/<script>: add the meta so
    // the policy/version are tracked and future runs take the update path.
    next = next.replace(
      /<style data-chameleon-theme>/,
      () => `${stamped}>\n<style data-chameleon-theme>`,
    );
  }
  return next;
}
