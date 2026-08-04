// Shared helpers for the link card block (see link-card-node.ts and
// /api/ogp). Kept free of React and Node APIs so both the editor and the
// route handler can use them.

export type LinkCardMeta = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
};

// "The pasted text is one bare URL" — the trigger for turning a paste into a
// card. Anything with whitespace is ordinary text and stays a normal paste.
export function isSingleUrl(text: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  return /^https?:\/\/\S+$/i.test(t);
}

// Display fallback when a site gives no og:site_name: its hostname without
// the www prefix. Returns the raw string when it isn't parseable.
export function hostLabel(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, "");
  } catch {
    return rawUrl;
  }
}

// Fetches the card metadata for a URL. Failure is not exceptional — a card
// with nothing but its URL is still a usable card — so the caller always gets
// an object back and never has to handle a rejection.
export async function fetchLinkCardMeta(url: string): Promise<LinkCardMeta> {
  const fallback: LinkCardMeta = {
    url,
    title: null,
    description: null,
    image: null,
    siteName: null,
    favicon: null,
  };
  try {
    const res = await fetch(`/api/ogp?url=${encodeURIComponent(url)}`);
    if (!res.ok) return fallback;
    const data = (await res.json()) as Partial<LinkCardMeta>;
    return {
      url: data.url || url,
      title: data.title ?? null,
      description: data.description ?? null,
      image: data.image ?? null,
      siteName: data.siteName ?? null,
      favicon: data.favicon ?? null,
    };
  } catch {
    return fallback;
  }
}
