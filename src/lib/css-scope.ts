// Rewrite a stylesheet so every rule applies only inside the editor preview
// (the element carrying `scope`). Hand-written CSS authored for full-page
// rendering — like the gutenberg-translator epub.css — uses `body`, `p`,
// `h1`, etc. as bare selectors; without scoping these would leak out and
// restyle the sidebar and chrome.
//
// The walker is brace-aware (not regex-based) so nested at-rules like
// @media / @supports are scoped recursively, while @keyframes / @font-face /
// @page / @charset pass through untouched (their inner "selectors" aren't
// element selectors). @import is dropped: it would trigger network fetches
// from an inline <style> we control.

const NESTED_AT_RULES = new Set(["media", "supports", "document", "layer", "container"]);
const SELF_AT_RULES = new Set(["keyframes", "font-face", "page", "charset", "namespace"]);

export function scopeCss(css: string, scope: string): string {
  return walk(css, scope);
}

function walk(css: string, scope: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    // Preserve whitespace.
    const wsStart = i;
    while (i < css.length && /\s/.test(css[i])) i++;
    out += css.slice(wsStart, i);
    if (i >= css.length) break;

    // Preserve block comments.
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) {
        out += css.slice(i);
        break;
      }
      out += css.slice(i, end + 2);
      i = end + 2;
      continue;
    }

    // Read prelude up to `{` or `;` (at-rules can terminate with `;`).
    const preludeStart = i;
    while (i < css.length && css[i] !== "{" && css[i] !== ";") {
      // Skip strings to avoid mis-detecting braces inside them.
      if (css[i] === '"' || css[i] === "'") {
        const quote = css[i];
        i++;
        while (i < css.length && css[i] !== quote) {
          if (css[i] === "\\" && i + 1 < css.length) i += 2;
          else i++;
        }
      }
      i++;
    }
    if (i >= css.length) {
      out += css.slice(preludeStart);
      break;
    }

    if (css[i] === ";") {
      const prelude = css.slice(preludeStart, i).trim();
      // Drop @import — would fetch arbitrary resources from inline <style>.
      if (!/^@import\b/i.test(prelude)) {
        out += css.slice(preludeStart, i + 1);
      }
      i++;
      continue;
    }

    // We're at `{`. Read body with brace tracking.
    const prelude = css.slice(preludeStart, i).trim();
    let depth = 1;
    const bodyStart = i + 1;
    i++;
    while (i < css.length && depth > 0) {
      if (css[i] === "/" && css[i + 1] === "*") {
        const ce = css.indexOf("*/", i + 2);
        if (ce === -1) {
          i = css.length;
          break;
        }
        i = ce + 2;
        continue;
      }
      if (css[i] === '"' || css[i] === "'") {
        const quote = css[i];
        i++;
        while (i < css.length && css[i] !== quote) {
          if (css[i] === "\\" && i + 1 < css.length) i += 2;
          else i++;
        }
        i++;
        continue;
      }
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    const bodyEnd = i - 1; // exclude the closing `}`
    const body = css.slice(bodyStart, bodyEnd);

    if (prelude.startsWith("@")) {
      const name = prelude.slice(1).match(/^[\w-]+/i)?.[0]?.toLowerCase() ?? "";
      if (NESTED_AT_RULES.has(name)) {
        out += `${prelude} {${walk(body, scope)}}`;
      } else if (SELF_AT_RULES.has(name)) {
        out += `${prelude} {${body}}`;
      } else {
        // Unknown at-rule — pass through unchanged.
        out += `${prelude} {${body}}`;
      }
    } else {
      const scopedSelector = prelude
        .split(",")
        .map((s) => scopeSelector(s.trim(), scope))
        .filter((s) => s.length > 0)
        .join(",\n");
      out += `${scopedSelector} {${body}}`;
    }
  }
  return out;
}

function scopeSelector(sel: string, scope: string): string {
  if (!sel) return "";
  // Root-level selectors collapse to the scope element itself: rules written
  // for `body { ... }` should apply to whatever element carries the scope
  // class, not to a descendant.
  if (sel === "body" || sel === "html" || sel === ":root") return scope;
  // `body.foo` / `html[lang]` etc. — strip the body/html prefix and graft
  // remaining qualifiers onto the scope.
  const stripped = sel.replace(/^(?:body|html)(?=[\s.#:[>~+,]|$)/, "");
  if (stripped !== sel) {
    return `${scope}${stripped}`;
  }
  return `${scope} ${sel}`;
}
