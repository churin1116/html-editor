import { lookup } from "node:dns/promises";
import type { LinkCardMeta } from "@/lib/link-card";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET /api/ogp?url=<external URL>
//
// Reads a page's OGP metadata (title / description / og:image / site name /
// favicon) server-side for the editor's link card. The result is baked into
// the card's data-* attributes at insert time, so opening a saved file never
// calls this route — it exists only while editing. YouTube video links are
// the exception: they are read from YouTube's oEmbed instead (youtubeCard).
//
// The editor binds to localhost, but this route still turns "a URL in the
// document" into "a request the machine makes", so it keeps the usual guards:
// http(s) only, no private/loopback/link-local hosts (re-checked on every
// redirect hop), an 8s timeout and a read ceiling (512KB; 2MB for YouTube).

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 512 * 1024;
const USER_AGENT = "Mozilla/5.0 (compatible; html-editor link card)";

function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/%.*$/, ""); // drop any zone id
  if (!addr.includes(":")) return isPrivateIPv4(addr);
  if (addr === "::1" || addr === "::") return true;
  // ::ffff:127.0.0.1 and friends carry an IPv4 address in the tail.
  const mapped = addr.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (/^f[cd]/.test(addr)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(addr)) return true; // fe80::/10 link-local
  return false;
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  // A bracketed IPv6 literal arrives here unbracketed.
  if (host.includes(":")) return isPrivateAddress(host);
  return isPrivateIPv4(host);
}

// A hostname check alone is not enough: a perfectly public name can carry an
// A record pointing at 127.0.0.1 or 10.x. Every address the name resolves to
// has to be public, and the check is repeated for each redirect hop.
//
// This still isn't airtight — the name is resolved a second time when the
// socket connects, so a DNS server answering with a short TTL could return a
// different address for that second lookup. Closing that window needs a
// custom connect/lookup hook (an undici Agent), which would mean taking on
// undici as a direct dependency; for an editor bound to localhost, and a
// response that is only mined for meta tags, this is where it stops.
async function resolvesToPublicAddress(hostname: string): Promise<boolean> {
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) return false;
    return addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false; // unresolvable — nothing to fetch anyway
  }
}

// Syntax and literal-address checks only; call resolvesToPublicAddress before
// actually connecting.
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
    if (!(await resolvesToPublicAddress(current.hostname))) return null;
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

async function readBodyLimited(res: Response, maxBytes = MAX_BODY_BYTES): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
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

// YouTube's pages carry their OGP tags about 800KB into a 1.2–2MB document —
// past the usual read ceiling — so its links came back with neither a title
// nor an image. Video links are answered from YouTube's oEmbed endpoint
// instead, a small JSON with the title and the channel. Other pages (a
// channel, a playlist) have no oEmbed; the generic path reads them up to
// this larger ceiling.
const YOUTUBE_MAX_BODY_BYTES = 2 * 1024 * 1024;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "youtu.be",
]);
// The icon a YouTube page links to sits under a build-versioned path that
// moves with every deploy; this one stays put.
const YOUTUBE_FAVICON = "https://www.youtube.com/favicon.ico";

function isYouTube(url: URL): boolean {
  return YOUTUBE_HOSTS.has(url.hostname.replace(/^www\./, ""));
}

// watch?v=, youtu.be/, /shorts/, /live/ and /embed/ all name the video by its
// 11-character id.
function youtubeVideoId(url: URL): string | null {
  if (!isYouTube(url)) return null;
  let id: string | null | undefined;
  if (url.hostname === "youtu.be") {
    id = url.pathname.split("/")[1];
  } else if (url.pathname === "/watch") {
    id = url.searchParams.get("v");
  } else {
    id = url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1];
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

// Whether a URL answers 200. The body is dropped unread.
async function respondsOk(target: URL): Promise<boolean> {
  try {
    const fetched = await fetchWithGuards(target);
    fetched?.res.body?.cancel().catch(() => {});
    return fetched?.res.ok ?? false;
  } catch {
    return false;
  }
}

async function youtubeOEmbed(id: string): Promise<{ title?: string; author_name?: string } | null> {
  const watch = `https://www.youtube.com/watch?v=${id}`;
  try {
    const fetched = await fetchWithGuards(
      new URL(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`),
    );
    if (!fetched?.res.ok) {
      fetched?.res.body?.cancel().catch(() => {});
      return null;
    }
    return JSON.parse(await readBodyLimited(fetched.res));
  } catch {
    return null;
  }
}

// The card keeps the URL as given, so a `t=` timestamp still opens the video
// at that point. oEmbed refuses some videos (embedding turned off by the
// owner, private, removed); the card then still gets the thumbnail and the
// site, with the URL standing in for the title.
//
// The thumbnail is built from the id rather than taken from oEmbed, whose
// hqdefault.jpg is 4:3 with black bands above and below a 16:9 frame — bands
// the card's narrow thumbnail would show. maxresdefault.jpg (HD uploads only)
// and mqdefault.jpg (always there, 320px wide) are both 16:9.
//
// The channel goes where a page's description would: oEmbed has none, and the
// channel is what tells a reader whose video it is.
async function youtubeCard(url: URL, id: string): Promise<LinkCardMeta> {
  const [oembed, hasMaxres] = await Promise.all([
    youtubeOEmbed(id),
    respondsOk(new URL(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`)),
  ]);
  return {
    url: url.toString(),
    title: oembed?.title || null,
    description: oembed?.author_name || null,
    image: `https://i.ytimg.com/vi/${id}/${hasMaxres ? "maxresdefault" : "mqdefault"}.jpg`,
    siteName: "YouTube",
    favicon: YOUTUBE_FAVICON,
  };
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
  const videoId = youtubeVideoId(url);
  if (videoId) return NextResponse.json(await youtubeCard(url, videoId));

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

    const youtube = isYouTube(base);
    const html = await readBodyLimited(
      fetched.res,
      youtube ? YOUTUBE_MAX_BODY_BYTES : MAX_BODY_BYTES,
    );
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
      // A YouTube page with no description of its own (a playlist, say) leaves
      // og:description empty, and its plain description meta is then the
      // site's tagline, which says nothing about the page.
      description:
        extractMeta(html, "og:description") ?? (youtube ? null : extractMeta(html, "description")),
      image,
      siteName: extractMeta(html, "og:site_name") ?? base.hostname,
      favicon: youtube ? YOUTUBE_FAVICON : extractFavicon(html, base),
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch URL" }, { status: 422 });
  }
}
