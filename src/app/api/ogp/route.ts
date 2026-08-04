import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/ogp?url=<external URL>
//
// Reads a page's OGP metadata (title / description / og:image / site name /
// favicon) server-side for the editor's link card. The result is baked into
// the card's data-* attributes at insert time, so opening a saved file never
// calls this route — it exists only while editing.
//
// The editor binds to localhost, but this route still turns "a URL in the
// document" into "a request the machine makes", so it keeps the usual guards:
// http(s) only, no private/loopback/link-local hosts (re-checked on every
// redirect hop), an 8s timeout and a 512KB read ceiling.

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 512 * 1024;
const USER_AGENT = "Mozilla/5.0 (compatible; html-editor link card)";

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  // IPv6 literals are rejected wholesale rather than classified (::1, fd00::/8,
  // IPv4-mapped forms) — public sites are reachable by hostname anyway.
  if (host.includes(":")) return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast / reserved
  }
  return false;
}

function validateUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (isPrivateHostname(url.hostname)) return null;
  return url;
}

// Redirects are followed by hand so every hop goes through validateUrl —
// `redirect: "follow"` would let a public URL bounce to 127.0.0.1 unchecked.
async function fetchWithGuards(startUrl: URL): Promise<{ res: Response; finalUrl: URL } | null> {
  let current = startUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      const next = validateUrl(new URL(location, current).toString());
      if (!next) return null;
      current = next;
      continue;
    }
    return { res, finalUrl: current };
  }
  return null;
}

async function readBodyLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  reader.cancel().catch(() => {});
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// Meta tags are matched in both attribute orders since neither is standard.
// Every attribute name is anchored on whitespace: without it, `content=`
// also matches inside `data-content=`, and the value of the wrong attribute
// comes back (GitHub's icon link carries a stale `data-base-href`, which is
// exactly how this bit us).
function extractMeta(html: string, key: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]*\\s(?:property|name)=["']${key}["'][^>]*\\scontent=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]*\\scontent=["']([^"']*)["'][^>]*\\s(?:property|name)=["']${key}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return null;
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1] ? decodeEntities(m[1].trim().replace(/\s+/g, " ")) : null;
}

function extractFavicon(html: string, baseUrl: URL): string {
  const m =
    html.match(/<link[^>]*\srel=["'](?:shortcut )?icon["'][^>]*\shref=["']([^"']+)["']/i) ||
    html.match(/<link[^>]*\shref=["']([^"']+)["'][^>]*\srel=["'](?:shortcut )?icon["']/i);
  try {
    if (m?.[1]) return new URL(decodeEntities(m[1]), baseUrl).toString();
  } catch {
    // Malformed href — fall through to the conventional location.
  }
  return new URL("/favicon.ico", baseUrl).toString();
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "Missing 'url' query param" }, { status: 400 });
  }
  const url = validateUrl(raw);
  if (!url) {
    return NextResponse.json({ error: "Unsupported or non-public URL" }, { status: 400 });
  }

  try {
    const fetched = await fetchWithGuards(url);
    if (!fetched || !fetched.res.ok) {
      return NextResponse.json({ error: "Failed to fetch URL" }, { status: 422 });
    }
    const base = fetched.finalUrl;
    const contentType = fetched.res.headers.get("content-type") ?? "";
    // A PDF or an image has no metadata to read; the card still gets a URL
    // and a host name to show.
    if (!contentType.includes("html")) {
      fetched.res.body?.cancel().catch(() => {});
      return NextResponse.json({
        url: base.toString(),
        title: null,
        description: null,
        image: null,
        siteName: base.hostname,
        favicon: new URL("/favicon.ico", base).toString(),
      });
    }

    const html = await readBodyLimited(fetched.res);
    let image = extractMeta(html, "og:image") ?? extractMeta(html, "twitter:image");
    if (image) {
      try {
        image = new URL(image, base).toString();
      } catch {
        image = null;
      }
    }

    return NextResponse.json({
      url: base.toString(),
      title: extractMeta(html, "og:title") ?? extractTitle(html),
      description: extractMeta(html, "og:description") ?? extractMeta(html, "description"),
      image,
      siteName: extractMeta(html, "og:site_name") ?? base.hostname,
      favicon: extractFavicon(html, base),
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch URL" }, { status: 422 });
  }
}
