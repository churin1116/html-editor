import { hostLabel } from "@/lib/link-card";
import { Node, mergeAttributes } from "@tiptap/core";
import type { DOMOutputSpec } from "@tiptap/pm/model";

// A link rendered as a card: title, description, site name and thumbnail,
// wrapped in one anchor.
//
// Unlike the app this pattern comes from, saved files here are read on their
// own — over file://, with no editor and no network calls of their own. So the
// node renders the *whole card* into the saved HTML rather than an empty
// placeholder that a runtime script fills in. The metadata still lives in the
// data-* attributes, which stay the single source of truth: the node is an
// atom, so the visible markup inside is thrown away on parse and regenerated
// from those attributes on every save. (Editing the inner markup by hand
// therefore doesn't stick — change the attributes, or re-insert the card.)
//
// Everything is styled from the Chameleon variables in PROSE_CSS, so a card
// follows the reader's theme like the rest of the document.

export type LinkCardAttrs = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    linkCard: {
      setLinkCard: (attrs: Partial<LinkCardAttrs> & { url: string }) => ReturnType;
    };
  }
}

// Image URLs come from someone else's page, so both the thumbnail and the
// favicon are held to http(s) — a page is free to hand us `javascript:` or
// `data:` in its <link rel="icon">, and neither belongs in a file we write.
// A card renders fine with either image missing.
function httpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

// The thumbnail is painted as a CSS background rather than an <img>: the
// image is decorative, and the URL points at someone else's server, so it
// will sometimes 404, rate-limit, or simply be unreachable when the file is
// read offline. A background degrades to the empty placeholder; an <img>
// would leave a broken-image glyph in the middle of the card.
//
// The quote and backslash escapes keep a hostile value from closing url("…")
// and appending its own declarations to the style attribute.
function cssBackgroundUrl(raw: string): string | null {
  const url = httpUrl(raw);
  return url ? url.replace(/["\\]/g, encodeURIComponent) : null;
}

// Round-trips one attribute through a data-* attribute of the same name.
function dataAttr(dataName: string) {
  return {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => el.getAttribute(`data-${dataName}`),
    renderHTML: (attrs: Record<string, unknown>) => {
      const key = dataName.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      const value = attrs[key];
      if (value === null || value === undefined || value === "") return {};
      return { [`data-${dataName}`]: value };
    },
  };
}

export const LinkCard = Node.create({
  name: "linkCard",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      url: dataAttr("url"),
      title: dataAttr("title"),
      description: dataAttr("description"),
      image: dataAttr("image"),
      siteName: dataAttr("site-name"),
      favicon: dataAttr("favicon"),
    };
  },

  parseHTML() {
    // Priority beats the generic `div` passthrough node (default 50), which
    // would otherwise claim the card and turn it into an ordinary block.
    return [{ tag: "div[data-link-card]", priority: 100 }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const url = String(node.attrs.url ?? "");
    const title = node.attrs.title as string | null;
    const description = node.attrs.description as string | null;
    const image = node.attrs.image as string | null;
    const siteName = node.attrs.siteName as string | null;
    const favicon = node.attrs.favicon as string | null;

    const site: DOMOutputSpec[] = [];
    const faviconUrl = favicon ? httpUrl(favicon) : null;
    if (faviconUrl) {
      site.push(["img", { class: "link-card-favicon", src: faviconUrl, alt: "" }]);
    }
    site.push(["span", {}, siteName || hostLabel(url)]);

    const text: DOMOutputSpec[] = [["span", { class: "link-card-title" }, title || url]];
    if (description) {
      text.push(["span", { class: "link-card-desc" }, description]);
    }
    text.push(["span", { class: "link-card-site" }, ...site]);

    const body: DOMOutputSpec[] = [["span", { class: "link-card-text" }, ...text]];
    const thumb = image ? cssBackgroundUrl(image) : null;
    if (thumb) {
      body.push(["span", { class: "link-card-thumb", style: `background-image:url("${thumb}")` }]);
    }

    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-link-card": "", class: "link-card" }),
      [
        "a",
        { class: "link-card-body", href: url, target: "_blank", rel: "noopener noreferrer" },
        ...body,
      ],
    ] as DOMOutputSpec;
  },

  addCommands() {
    return {
      setLinkCard:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
