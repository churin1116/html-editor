# html-editor

A local-first WYSIWYG editor for `.html` and `.md` files anywhere on your disk. Run `pnpm dev`, point your browser at `localhost:26509`, and edit files from any directory you whitelist — without opening a code editor.

Built because viewing/editing personal Markdown notes from a code editor felt heavy when all you wanted was a bookmarkable URL and rich-text editing.

## Features

- **Hybrid HTML / Markdown** — `.html` files are edited directly and stay viewable via `file://` (Chameleon-themed; switch theme without re-saving). `.md` files are converted to HTML on read and back to Markdown on save, so existing `.md` notes keep their format and remain `git diff`-friendly.
- **Chameleon-compatible saved files** — Every saved `.html` follows the [Chameleon v1 theme contract](https://github.com/churin1116/html-chameleon), so a single theme switch (Chrome extension, `localStorage`, or `data-theme` attribute) repaints every file at once. The editor UI itself uses the same variables for visual parity.
- **WYSIWYG editing** — TipTap 3.x with headings, lists, tables, links, code blocks, and more.
- **Absolute paths via whitelist** — Edit files anywhere on disk. Allowed roots are managed from the sidebar (or directly in `config/allowed-roots.json`); arbitrary paths are rejected by the API. Supports `~/...` paths.
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
# Open http://localhost:26509 (and bookmark it)
```

Requires Node.js 20+ and pnpm 9+.

## Always-on setup (macOS)

For one-click daily access, run the editor as a background `launchd` agent that auto-starts on login and restarts if it crashes. After setup, just double-click the desktop shortcut.

The `dev` / `start` scripts default to port **`26509`** (chosen to avoid conflicts with common dev ports). Change in `package.json` if you want a different port.

### 1. Create the launchd agent

Save the following as `~/Library/LaunchAgents/com.<you>.html-editor.plist`, replacing paths and `<you>` to match your setup. Get your pnpm path with `which pnpm`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.you.html-editor</string>
  <key>ProgramArguments</key>
  <array>
    <string>/absolute/path/to/pnpm</string>
    <string>dev</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/absolute/path/to/this/repo</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>/Users/YOU/Library/Logs/html-editor/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/YOU/Library/Logs/html-editor/stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/dir/containing/pnpm:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>/Users/YOU</string>
  </dict>
</dict>
</plist>
```

### 2. Load and verify

```bash
mkdir -p ~/Library/Logs/html-editor
launchctl load -w ~/Library/LaunchAgents/com.you.html-editor.plist
launchctl list | grep html-editor                            # shows a PID + exit code 0
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:26509/   # prints 200
```

### 3. Desktop shortcut

Save as `~/Desktop/HTML Editor.webloc`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>URL</key>
  <string>http://localhost:26509</string>
</dict>
</plist>
```

Drag the `.webloc` onto the Dock (right side, near the Trash) for a permanent one-click launcher.

### Operations

```bash
# Stop the agent
launchctl unload ~/Library/LaunchAgents/com.you.html-editor.plist

# Start it again
launchctl load -w ~/Library/LaunchAgents/com.you.html-editor.plist

# Restart (e.g., dev server got sluggish)
launchctl kickstart -k gui/$(id -u)/com.you.html-editor

# Tail logs
tail -f ~/Library/Logs/html-editor/stderr.log
```

Since the agent runs `pnpm dev`, code changes hot-reload automatically — no `pnpm build` step needed in normal use.

## Configuration

There are two ways to register the directories the editor can read or write:

**Via the GUI (recommended).** When you start with no roots configured, the sidebar shows an "Add your first root" button. Once you have at least one root, an "+ Add root" link appears next to the heading; the × button on each root removes it. The path field accepts both absolute paths and `~`-prefixed paths (`~/notes` → `/Users/you/notes`). The server validates that the path exists and is a directory before saving.

**Via the JSON file directly.** Roots persist to `~/.config/html-editor/allowed-roots.json` (XDG-style, outside the project tree so a `git clean` or fresh clone never wipes your roots):

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
- The file is per-user, never tracked by git. An example template ships at `config/allowed-roots.example.json`.
- Legacy installs (older versions stored the file at `<repo>/config/allowed-roots.json`) are migrated to the new location on first launch.

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
- There is no authentication. The dev server binds to `localhost:26509` — do not bind it to a public interface or expose it via a tunnel without adding auth.
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
