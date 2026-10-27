// "台本をコピー" — a video script (a document with an h2 「台本」, or the
// question box's 「今回の質問」/「今回の噂」) as plain text that pastes straight
// into Apple Notes, where the teleprompter app (~/MyApps/261005-teleprompter)
// picks it up:
//
//   line 1                          the h1 — Notes makes it the note's name,
//                                   and the teleprompter drops it
//   blocks split by a blank line    one press of the remote each
//   オオカミ：…                     a wolf speech bubble, one block per
//                                   paragraph in the bubble, on one line
//
// What counts as the script follows the video editor's importer
// (261009-video-editor src/lib/server/script-import.ts): paragraphs and speech
// bubbles, struck text dropped, up to the first <hr> or the first reference
// chapter — an h2, or a chapter folded into a <details> whose summary carries
// the heading. Unlike the importer, the cold open before the heading is kept — it
// is filmed too. Headings, tables, blockquotes (【字幕】/【画面】 notes for the
// edit), notes to the author (p.note) and blank spacers (p.blank) aren't read
// aloud and are left out.

// 「台本」 is ミナミナ's and the older question-box scripts'; the question box
// now opens its script with 「今回の質問」 (a 定番 episode) or 「今回の噂」 (a 話題 one).
const SCRIPT_HEADINGS = new Set(["台本", "今回の質問", "今回の噂"]);
// 「タイトル」 is the question box's title-ideas section (renamed from
// 「YouTubeのタイトル案」 on 2026-10-27).
const NOT_SCRIPT = /^(狼のサブクエスチョン|資料|引用|YouTube|参考|メモ|タイトル)/;
const WOLF_NAMES = new Set(["オオカミ", "狼"]);
const WOLF_PREFIX = "オオカミ：";

// HTML's collapsible whitespace, plus nbsp. Not the ideographic space (U+3000),
// which is part of the text.
const SPACES = /[ \t\n\r\f ]+/g;
const H2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;

function collapse(text: string): string {
  return text.replace(SPACES, " ").trim();
}

/** Whether the document has a script heading. A scan of the serialized HTML, cheap enough to run on every edit. */
export function hasScriptHeading(html: string): boolean {
  if (![...SCRIPT_HEADINGS].some((heading) => html.includes(heading))) return false;
  for (const match of html.matchAll(H2)) {
    const text = match[1].replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ");
    if (SCRIPT_HEADINGS.has(collapse(text))) return true;
  }
  return false;
}

export type ScriptCopy = { text: string; blocks: number };

/** The script as Notes text; null when the document has no script heading. */
export function scriptToNotesText(html: string, fallbackTitle: string): ScriptCopy | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const heading = Array.from(doc.querySelectorAll("h2")).find((h) =>
    SCRIPT_HEADINGS.has(collapse(h.textContent ?? "")),
  );
  // The script is the heading's siblings — from the first one, so the cold open is included.
  const root = heading?.parentElement;
  if (!root) return null;

  const blocks: string[] = [];
  for (const node of Array.from(root.children)) {
    const tag = node.tagName.toLowerCase();
    if (tag === "hr") break;
    if (tag === "h2" && NOT_SCRIPT.test(collapse(node.textContent ?? ""))) break;
    if (
      tag === "details" &&
      NOT_SCRIPT.test(collapse(node.querySelector("summary")?.textContent ?? ""))
    )
      break;
    if (tag === "p") {
      if (node.classList.contains("blank") || node.classList.contains("note")) continue;
      const text = paragraphText(node, "\n");
      if (text) blocks.push(text);
    } else if (node.matches(".speech, [data-speech]")) {
      const name = collapse(node.querySelector(".speech-name")?.textContent ?? "");
      const prefix = WOLF_NAMES.has(name) ? WOLF_PREFIX : name ? `${name}：` : "";
      for (const paragraph of Array.from(node.querySelectorAll(".speech-bubble p"))) {
        const text = paragraphText(paragraph, " ");
        if (text) blocks.push(prefix + text);
      }
    }
  }

  const title = collapse(doc.querySelector("h1")?.textContent ?? "") || fallbackTitle.trim();
  return { text: `${[title, ...blocks].join("\n\n")}\n`, blocks: blocks.length };
}

// A paragraph's text with struck text dropped. <br> breaks the line; the lines
// are joined back with `lineBreak` (a newline, or a space for a speech line).
function paragraphText(paragraph: Element, lineBreak: string): string {
  const copy = paragraph.cloneNode(true) as Element;
  for (const struck of Array.from(copy.querySelectorAll("s, del, strike"))) struck.remove();
  let text = "";
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) text += (child.textContent ?? "").replace(SPACES, " ");
      else if (child.nodeName === "BR") text += "\n";
      else walk(child);
    }
  };
  walk(copy);
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(lineBreak);
}
