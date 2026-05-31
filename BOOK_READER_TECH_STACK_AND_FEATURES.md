# Book Reader Website: Tech Stack and Detailed Features

## 1) Tech Stack

### Frontend
- HTML5 (`reader/index.html`)
- CSS3 (`reader/styles.css`)
- Vanilla JavaScript (ES6, `reader/app.js`)

### Content and Rendering
- Markdown chapter files (`eng-episodes/**/*.md`, `burmese-episodes/**/*.md`)
- `marked` (Local Vendor) to parse Markdown into HTML
- `DOMPurify` (Local Vendor) to sanitize rendered HTML before display

### Storage and Client State
- `localStorage` for:
  - Reader settings (theme, font, typography, filters)
  - Last opened chapter
  - Per-chapter scroll position
  - Bookmarks
  - Read status progress
- Browser Cache Storage API for offline chapter caching

### PWA / Offline
- Service Worker (`reader/sw.js`) for:
  - App shell caching
  - Markdown request caching
  - Offline fallback from cache
- Web App Manifest (`reader/app-manifest.json`) for installable app behavior

### Content Indexing / Tooling
- Python 3 script (`reader/generate_manifest.py`) to build `reader/manifest.json`
  - Scans `eng-episodes` and `burmese-episodes`
  - Extracts episode numbers
  - Sorts episodes and emits metadata
- PowerShell launcher (`reader/run_reader.ps1`)
  - Regenerates manifest
  - Starts local HTTP server from repo root

### Hosting / Delivery
- Static hosting model (GitHub Pages compatible)
- No backend server or database required

## 2) Detailed Feature Set

### Library and Discovery
- Loads all chapters from generated `manifest.json`
- Search by title/path/group
- Source filters:
  - `All`
  - Per language/source (`eng-episodes`, `burmese-episodes`)
  - `Bookmarks`
  - `Available Offline`
- Grouped chapter list by `source / folder`

### Reading Experience
- Opens Markdown chapters and renders them into a clean article view
- Previous/Next chapter navigation
- Keyboard shortcuts:
  - `ArrowLeft` previous chapter
  - `ArrowRight` next chapter
  - `Escape` close open modals
- Scroll-to-top floating action button
- Immersive mode that auto-hides header/tab UI while reading
- Auto-scroll with adjustable speed controls (Play/Pause, speed slider)

### Personalization
- Theme options:
  - Light
  - E-Ink (Standard, Warm, High Contrast, Night)
  - Dark
  - Sepia
- Font family selection including Myanmar-friendly options
- Adjustable typography controls:
  - Font size
  - Line height
  - Text width
- Dynamic browser `theme-color` updates for mobile chrome/safe-area fit

### Reading Progress and Status
- Remembers last opened chapter
- Saves and restores per-chapter scroll position
- Tracks read ratio by chapter
- Visual status in library:
  - Unread
  - In progress
  - Completed
- Per-chapter progress strip in chapter list

### Bookmarks
- One-tap save/remove bookmark for current chapter
- Bookmark filter view in library
- Bookmark indicator shown in chapter list

### Reading Stats
- Settings panel shows:
  - Completed chapters
  - In-progress chapters
  - Total indexed chapters

### Offline Support
- "Download Next 100 Episodes" from current chapter
- Batched download strategy (5 concurrent requests per batch)
- Download progress toast with live progress bar
- Offline availability indicator per chapter
- Offline-only filter for quick access to downloaded chapters

### Mobile-First App UX
- iOS-style tab bar and modal UX
- Safe-area handling for notches and device insets
- Responsive desktop mode with side floating navigation and panel-style modals

## 3) Current Architecture Notes

- App is intentionally backend-less: content is filesystem-based Markdown plus generated manifest.
- Suitable for local use, Codespaces, and static deployment.
- Manifest regeneration is required after adding/removing chapter files.
