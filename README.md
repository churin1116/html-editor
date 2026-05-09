# html-editor

A local-first WYSIWYG editor for `.html` and `.md` files anywhere on your disk. Run `pnpm dev`, point your browser at `localhost:3000`, and edit files from any directory you whitelist — without opening a code editor.

Built because viewing/editing personal Markdown notes from a code editor felt heavy when all you wanted was a bookmarkable URL and rich-text editing.

## Features

- **Hybrid HTML / Markdown** — `.html` files are edited directly and stay viewable via `file://` (Chameleon-themed; switch theme without re-saving). `.md` files are converted to HTML on read and back to Markdown on save, so existing `.md` notes keep their format and remain `git diff`-friendly.
- **Chameleon-compatible saved files** — Every saved `.html` follows the [Chameleon v1 theme contract](https://github.com/churin1116/html-chameleon), so a single theme switch (Chrome extension, `localStorage`, or `data-theme` attribute) repaints every file at once. The editor UI itself uses the same variables for visual parity.
- **WYSIWYG editing** — TipTap 3.x with headings, lists, tables, links, code blocks, and more.
- **Absolute paths via whitelist** — Edit files anywhere on disk. Allowed roots are explicitly listed in `config/allowed-roots.json`; arbitrary paths are rejected by the API.
- **External-edit conflict detection** — Captures `mtime` on open and rejects writes that would clobber concurrent changes (e.g., from VS Code or `git pull`).
- **New file creation** — Sidebar `+ New` button creates an `.html` file under the chosen root.

## Quick start

```bash
git clone https://github.com/<your-account>/html-editor.git
cd html-editor
pnpm install

# Register the directories you want to edit
cp config/allowed-roots.example.json config/allowed-roots.json
# Edit config/allowed-roots.json with absolute paths

pnpm dev
# Open http://localhost:3000 (and bookmark it)
```

Requires Node.js 20+ and pnpm 9+.

## Configuration

`config/allowed-roots.json` lists every directory the editor can read or write:

```json
{
  "roots": [
    {
      "label": "Notes",
      "path": "/absolute/path/to/your/notes"
    },
    {
      "label": "Project docs",
      "path": "/another/absolute/path"
    }
  ]
}
```

- `label` — display name in the sidebar
- `path` — absolute path; only files under this directory (recursively) can be opened or saved
- The file is per-machine and is `.gitignore`d. An example template ships at `config/allowed-roots.example.json`.

## How files are stored

### `.html` files

Saved as a self-contained document that conforms to the [Chameleon v1 theme contract](https://github.com/churin1116/html-chameleon), so they render directly in any browser and respond to any installed Chameleon theme switcher (Chrome extension, etc.):

```html
<!doctype html>
<html lang="ja" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="chameleon" content="v1">
  <title>...</title>
  <link rel="stylesheet" href="https://churin1116.github.io/html-chameleon/theme/v1/theme.css">
  <script src="https://churin1116.github.io/html-chameleon/theme/v1/theme.js"></script>
  <style>/* prose typography only — colors come from Chameleon variables */</style>
</head>
<body class="bg-canvas">
  <article id="content" data-html-editor="1">
    <!-- TipTap output goes here -->
  </article>
</body>
</html>
```

Only the inner `<article id="content">` is editable; the surrounding template is regenerated on every save. The prose CSS uses Chameleon variables (`var(--canvas)`, `var(--text)`, `var(--border)`, etc.), so light / dark / sunset / forest / midnight themes all work out of the box.

### `.md` files

Stored as plain Markdown. Round-trip uses [`marked`](https://marked.js.org/) for read and [`turndown`](https://github.com/mixmark-io/turndown) for write. GFM features (tables, strikethrough, fenced code) are preserved; richer in-editor formatting that has no Markdown equivalent may be simplified.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘S` / `Ctrl+S` | Save |
| `⌘B` / `Ctrl+B` | Bold |
| `⌘I` / `Ctrl+I` | Italic |
| `⌘Z` / `Ctrl+Z` | Undo |

For links, use the **Link** button in the toolbar (it opens a URL prompt). Other standard TipTap shortcuts apply.

## Security model

This is a **local-only** tool. It is deliberately not safe to expose on a network.

- File access is gated by `config/allowed-roots.json`. The API resolves every requested path with `path.resolve` and verifies it lives under one of the allowed roots; anything else returns `403`.
- There is no authentication. The dev server binds to `localhost:3000` — do not bind it to a public interface or expose it via a tunnel without adding auth.
- The user-specific `config/allowed-roots.json` is `.gitignore`d so paths never leak into the repo.

## Architecture

- **Framework**: Next.js 15 (App Router) + React 19
- **Editor**: TipTap 3.x with StarterKit + Link/Image/Table extensions
- **Styling**: Tailwind CSS v4
- **Markdown round-trip**: marked (MD → HTML) + turndown (HTML → MD)
- **Lint/format**: Biome

```
src/
├── app/
│   ├── layout.tsx, page.tsx, globals.css
│   └── api/
│       ├── roots/route.ts    GET allowed roots
│       ├── tree/route.ts     GET file tree under a root
│       └── file/route.ts     GET / PUT / POST file ops
├── components/
│   ├── sidebar.tsx           Tree + "+ New" button
│   └── editor.tsx            TipTap editor + toolbar
└── lib/
    ├── allowed-roots.ts      Config loader (cached)
    ├── fs-safe.ts            Path-traversal guard
    ├── format.ts             MD ↔ HTML conversion
    └── html-template.ts      Self-contained HTML wrap/unwrap
```

## Limitations

- No bookmark / recent-files panel inside the app (browser bookmarks are the intended UX).
- No full-text search.
- New files can only be created at the root of an allowed directory; sub-directory creation is not yet wired up.
- HTML → Markdown conversion is lossy for advanced TipTap features (cell coloring, custom node attributes) — round-trip on `.md` files focuses on common GFM constructs.

## Contributing

Issues and PRs welcome. There is no contribution checklist beyond:

1. `pnpm install`
2. `pnpm exec tsc --noEmit` should pass
3. `pnpm lint` should pass

## License

[MIT](./LICENSE) © churin
