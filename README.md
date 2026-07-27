# html-editor

A local-first WYSIWYG editor for `.html` and `.md` files anywhere on your disk. Run `pnpm dev`, point your browser at `localhost:26509`, and edit files from any directory you whitelist — without opening a code editor.

Built because viewing/editing personal Markdown notes from a code editor felt heavy when all you wanted was a bookmarkable URL and rich-text editing.

## Features

- **Hybrid HTML / Markdown** — `.html` files are edited directly and stay viewable via `file://` (Chameleon-themed; switch theme without re-saving). `.md` files are edited as raw Markdown with Obsidian-style Live Preview: real heading sizes, prose font, styled bold/quotes/code/links, and concealed markers — `#`/`**`/`>` are hidden, `-` becomes a bullet, `---` draws a rule, `[text](url)` collapses to the text — reappearing as raw source on the line/span under the cursor. The document itself is never rewritten — saves write your keystrokes verbatim, so `.md` notes stay `git diff`-friendly.
- **Chameleon-compatible saved files** — Every saved `.html` follows the [Chameleon v1 theme contract](https://github.com/churin1116/html-chameleon), so a single theme switch (Chrome extension, `localStorage`, or `data-theme` attribute) repaints every file at once. The editor UI itself uses the same variables for visual parity.
- **WYSIWYG editing** — TipTap 3.x with headings, lists, tables, links, code blocks, and more. Used for editor-created (`managed`) and fragment `.html`. (`.md` files use the CodeMirror-based Markdown editor above instead.)
- **Rendered editing for full documents** — Hand-authored full HTML (with `<!doctype>`/`<html>`/`<head>`/`<body>`, e.g. inline `<style>`, `<script>`, data-attributes, radio-driven tabs) is **not** flowed through TipTap (which would strip everything outside its schema). Instead it opens as its own rendered page in an editable iframe: you type straight onto the rendered content, and on save the original `<head>`/doctype/scripts are preserved verbatim while only the edited `<body>` is written back. Page scripts don't run in the edit view (so the serialized output stays free of script- or extension-injected nodes); CSS-only interactivity like tabs still works.
- **Image uploads to Cloudflare R2** — Drag-and-drop or paste images into any editor mode (TipTap, full-document rendered view, Markdown); the file is uploaded to your R2 bucket and the public URL is inserted (as `<img>` in HTML, `![](url)` in Markdown). New images land at a readable default width (natural width, capped at 670 px). Optional — image uploads stay disabled until you configure R2 (see [Image uploads](#image-uploads)).
- **Image resizing** — In the HTML editing modes, click an image to show a selection box and drag any corner handle (handles stay clamped inside the viewport, so oversized images remain resizable). The width is written as an inline style, so saved files render at the chosen size everywhere.
- **Selection toolbar** — In both HTML editing modes, selecting text pops a floating toolbar (bold / italic / strike / inline code / H2 / H3 / lists / quote / link / clear formatting), so common formatting never requires the sidebar menu.
- **Markdown typing shortcuts** — In both HTML editing modes, markdown markers convert to HTML as you type: `#`–`######` + space → headings, `-` / `1.` → lists, `>` → blockquote, `---` + Enter → horizontal rule, ` ``` ` + Enter → code block, and inline `**bold**` / `*italic*` / `` `code` `` / `~~strike~~`. (The Markdown editor is Markdown already.)
- **Absolute paths via whitelist** — Edit files anywhere on disk. Allowed roots are managed from the sidebar (or directly in `config/allowed-roots.json`); arbitrary paths are rejected by the API. Supports `~/...` paths.
- **External-edit conflict detection** — Captures `mtime` on open and rejects writes that would clobber concurrent changes (e.g., from VS Code or `git pull`).
- **New file creation** — Sidebar `+ New` button creates an `.html` file under the chosen root.
- **Workspaces** — When two or more roots are registered, a switcher at the top of the sidebar scopes the tree to a single root (VS Code-style project view) or shows all. The choice persists across reloads, and `?ws=<path-or-label>` in the URL pins a workspace per tab/bookmark.
- **Name search** — A borderless search box in the sidebar footer finds files and folders by *name* (contents are never searched, and a term that only appears in the surrounding path doesn't match). Enter opens the best match — files open in the editor, folders expand — and the sidebar scrolls to it, unfolding parents and switching workspace as needed. Ambiguous queries float their candidates above the box (↑/↓ + Enter). Slash-shaped queries split into folder + name, so `reviews/index`, `~/notes/todo.md` and full absolute paths all work.
- **Copy path** — Hovering any tree row (file, folder, or shortcut) reveals a copy icon at its right edge that puts the row's absolute path on the clipboard without opening the file or toggling the folder.
- **Sidebar state persistence** — The active workspace and every fold (roots, tree directories, shortcut folders) are stored in cookies, and the sidebar — roots, trees, shortcuts — is rendered server-side, so the first paint already shows the exact last state with no flash or refetch. Newly added roots start with all folders collapsed; folders you open stay open across reloads.

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

### First 60 seconds

1. **Add a root** — sidebar "+ add" → give any folder a label and an absolute path (`~/notes` works). Its `.html`/`.md` files appear as a tree.
2. **Click a file and type** — WYSIWYG editing, straight onto the rendered page. `⌘S` saves. New file: hover a root → `+`.
3. **Everything saved is a normal `.html`** — self-contained ([Chameleon theme baked in](#theme-baking)), opens in any browser via `file://`, offline, forever. `.md` files stay Markdown on disk.
4. **Theme** — switch light/dark/etc. per-viewer with the [Chameleon Chrome extension](https://github.com/churin1116/html-chameleon) (or `localStorage`); files don't need re-saving. The gear button (sidebar footer) holds editor settings such as [theme auto-update](#theme-baking).

Tip: `/chameleon null` in Claude Code drops an empty editor-ready `.html` into `~/Downloads` — add Downloads as a root (or a shortcut) and start typing.

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

Saved as a self-contained document that conforms to the [Chameleon v1 theme contract](https://github.com/churin1116/html-chameleon), so they render directly in any browser — offline, via `file://`, forever — and respond to any installed Chameleon theme switcher (Chrome extension, etc.):

```html
<!doctype html>
<html lang="ja" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="chameleon" content="^1" data-baked="1.0.0">
  <title>...</title>
  <style data-chameleon-theme>/* Chameleon theme.css, baked in */</style>
  <script data-chameleon-theme>/* Chameleon theme.js, baked in */</script>
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

#### Theme baking

The Chameleon theme is **baked (inlined) into every saved file** rather than referenced from the hosted copy, so files never depend on a network fetch and never restyle themselves when the hosted theme moves.

**Auto-update mode** (default ON, toggle via the gear button in the sidebar footer, persisted in `~/.config/html-editor/settings.json`): every save reads the theme freshly from the local html-chameleon clone, so theme updates flow into files as you save — no manual sync step. The clone location defaults to `~/MyApps/_chrome/260509-html-chameleon` and can be changed via the `chameleonDir` key in the same settings file. When the clone is missing or unreadable, saves silently fall back to the last-synced bundled copy. Turn it OFF to freeze saves at the bundled version.

Explicit, npm-style distribution still works alongside (and is how you update many files at once):

```bash
pnpm sync-theme            # local html-chameleon clone → src/lib/chameleon-theme.generated.ts
pnpm rebake <dir>          # re-bake chameleon files with the resolved theme
pnpm rebake <dir> --dry-run
```

The `<meta name="chameleon">` tag carries the update policy and the exact baked version — `content="^1"` means "rebake may move this file to any newer 1.x, never across majors"; change it to an exact version (e.g. `content="1.0.0"`) to pin a file so `rebake` skips it. Files saved by older editor versions (external `<link>`) migrate automatically on their next save or rebake. Theme *switching* (light / dark / etc.) still works offline — the baked `theme.js` reads `localStorage` / `data-theme` at load, exactly like the hosted one.

### `.md` files

Stored and edited as plain Markdown — there is no HTML conversion step, so saves are byte-faithful to what you typed. The editor (CodeMirror 6 with GFM parsing) styles the source in place as an Obsidian-style Live Preview, matching the Chameleon prose look of saved `.html` files:

- Headings render at their real sizes (same scale as the saved-HTML prose CSS), `**bold**` is bold, `*emphasis*` shows as boten dots (matching the Japanese-prose convention in saved files), `~~strike~~` strikes through.
- Blockquote lines get a left border, fenced code blocks a monospace surface, inline `` `code` `` a chip background.
- GFM tables render as real tables (borders, header row, cell alignment, inline formatting inside cells) while the cursor is elsewhere; click a cell and the raw pipe source reappears — in monospace — with the cursor in that cell.
- Markers are concealed while you read and reappear where you edit: `#`/`>`/`**`/`` ` ``/`~~` are hidden, `- ` becomes a `•` bullet, `- [ ]` a checkbox, `---` a drawn horizontal rule, and `[text](url)` collapses to just the underlined text. Put the cursor on the line (for line markers) or inside the span (for inline markers) and the raw source shows again. Ordered-list numbers, fenced-code ` ``` ` delimiters, and image syntax stay visible.
- A leading YAML frontmatter block is shown as dimmed monospace instead of being misparsed as headings.

## Image uploads

Drag an image onto any editor mode (or paste from the clipboard) and it is uploaded to your own Cloudflare R2 bucket. The returned public URL is inserted into the document as `<img src="...">` (HTML) or `![](...)` (Markdown), so saved files reference the cloud copy and stay in sync across devices.

Inserted images default to their natural width capped at 670 px (`width` inline style). In the HTML modes (TipTap and the full-document rendered view), click any image — including ones attached earlier — and drag a corner handle to resize; the new width persists into the saved file.

This is the only cloud dependency in the app — it is fully optional. If you skip setup, the editor still works; pastes/drops of images will surface a toast saying `/api/upload-image` is not configured.

### Why R2

- Free tier covers 10 GB storage — generous for personal notes.
- Egress is free, so re-viewing the same images costs nothing regardless of how often you open the note.
- S3-compatible API, so the implementation is a thin wrapper around `@aws-sdk/client-s3`.

### Setup

**1. Create the bucket.** On the Cloudflare dashboard, R2 → Create bucket → e.g. `html-editor-images`.

**2. Allow public access.** Bucket → Settings → Public Access → "R2.dev subdomain" → Allow Access. Copy the `https://pub-xxxxxxxxxxxx.r2.dev` URL it shows.

**3. Create a scoped API token.** R2 → Manage R2 API Tokens → Create **Account** API Token:

- Permissions: `Object Read & Write`
- Specify bucket: only `html-editor-images` (least privilege)
- TTL: Forever

Copy the Access Key ID and Secret Access Key. The secret is shown once.

**4. Store the three secrets in macOS Keychain.** Namespaced with `HTML_EDITOR_` so they do not collide with R2 credentials used by other projects:

```bash
security add-generic-password -a "$USER" -s "R2_ACCOUNT_ID" -w 'your-account-id' -U
security add-generic-password -a "$USER" -s "HTML_EDITOR_R2_ACCESS_KEY_ID" -w 'your-access-key-id' -U
security add-generic-password -a "$USER" -s "HTML_EDITOR_R2_SECRET_ACCESS_KEY" -w 'your-secret-access-key' -U
```

`R2_ACCOUNT_ID` is the same Cloudflare account ID across projects, so it stays un-namespaced. If you already have it in Keychain from another project, skip that line.

**5. Add the non-secret values to `.env.local`.** Copy `.env.example` to `.env.local` and fill in your bucket name and the public URL from step 2:

```
R2_BUCKET_NAME=html-editor-images
R2_PUBLIC_URL=https://pub-xxxxxxxxxxxx.r2.dev
```

**6. Run `pnpm dev`.** The `dev` script runs through `scripts/with-r2-secrets.sh`, which reads the three Keychain entries and exports them as env vars before launching Next.js. Nothing sensitive ever touches disk in the repo.

### How it works under the hood

| File | Role |
|------|------|
| `scripts/with-r2-secrets.sh` | Reads Keychain via `security find-generic-password`, exports env vars, execs the wrapped command. |
| `src/app/api/upload-image/route.ts` | POST endpoint; validates MIME / 25 MB max; uploads to R2; returns the public URL. |
| `src/lib/r2.ts` | S3 client + `uploadImageToR2(bytes, mime)` helper. Generates `images/YYYY/MM/{uuid}.{ext}` keys with a 1-year immutable `Cache-Control`. |
| `src/lib/upload-image.ts` | Client-side fetch wrapper, natural-size measurement, DataTransfer → `File[]` helper, shared by all editors. |
| `src/lib/image-resize.ts` | Click-to-select corner-drag resizer overlay, shared by the TipTap editor and the full-document iframe. |
| `src/components/editor.tsx` | TipTap `handlePaste` / `handleDrop` → insert `image` node (width attr backs the resizer). |
| `src/components/html-source.tsx` | Full-document rendered view: `paste` / `drop` on the iframe document → insert styled `<img>` at the caret / drop point. |
| `src/components/md-editor.tsx` | CodeMirror `domEventHandlers` → insert `![alt](url)` at the drop / caret position. |

### Allowed MIME types

`image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/svg+xml`, `image/avif`. SVG is allowed because this tool is local-only — if you ever deploy it for multi-user use, narrow this list in `src/lib/r2.ts` first.

### launchd note

If you run the editor as a `launchd` agent (see [Always-on setup](#always-on-setup-macos)), the wrapper script is what `pnpm dev` invokes. It calls `/usr/bin/security` with a hardcoded path, so launchd's stripped PATH does not break Keychain lookups. No extra config is needed beyond the plist already documented below.

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
- **HTML editor**: TipTap 3.x with StarterKit + Link/Image/Table extensions
- **Markdown editor**: CodeMirror 6 (`@codemirror/lang-markdown`, GFM) with Chameleon-styled live decorations
- **Styling**: Tailwind CSS v4
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
│   ├── editor.tsx            TipTap editor + toolbar (HTML)
│   └── md-editor.tsx         CodeMirror Markdown editor
└── lib/
    ├── allowed-roots.ts      Config loader (cached)
    ├── fs-safe.ts            Path-traversal guard
    ├── format.ts             File-extension → format detection
    ├── md-prose.ts           Markdown Live Preview (styling + marker concealment)
    ├── prose-css.ts          Shared prose CSS (saved HTML + editors)
    └── html-template.ts      Self-contained HTML wrap/unwrap
```

## Limitations

- No bookmark / recent-files panel inside the app (browser bookmarks are the intended UX).
- No full-text search.
- New files can only be created at the root of an allowed directory; sub-directory creation is not yet wired up.
- The Markdown Live Preview does not render images inline or hide fenced-code ` ``` ` delimiters; task-list checkboxes are display-only (click the line to edit `[ ]`/`[x]` as text).

## Contributing

Issues and PRs welcome. There is no contribution checklist beyond:

1. `pnpm install`
2. `pnpm exec tsc --noEmit` should pass
3. `pnpm lint` should pass

## License

[MIT](./LICENSE) © churin
