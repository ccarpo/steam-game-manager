# Steam Game Manager

A local-first game library manager built with Next.js. Sync your Steam wishlist and owned games, organize with a flexible tag system, browse with rich media, and filter your collection with powerful sidebar controls.

Everything runs on your machine — SQLite database, locally cached images, no cloud dependency.

**[Live Demo](https://ksrikanthcnc.github.io/steam-game-manager/)** — read-only static version with sample data

![Card View](docs/screenshots/card-view.png)
![List View](docs/screenshots/list-view.png)
![Inspector](docs/screenshots/inspector.png)

---

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and head to **Settings** to configure your Steam credentials:

1. **Steam ID** — Your 64-bit Steam ID (find yours at [steamid.io](https://steamid.io))
2. **API Key** — Register at [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey)

Then use the sync buttons to pull your library.

---

## Features

### Steam Integration

- **Wishlist sync** — Imports all wishlist items with their wishlisted dates. Detects games removed from your wishlist and tags them accordingly.
- **Owned games sync** — Pulls your full owned library including free-to-play titles.
- **Metadata fetch** — Downloads app details, review data, and community tags from Steam for every game. Resumable sessions — if interrupted, pick up where you left off.
- **Image sync** — Downloads header images, screenshots (thumbnail and/or full HD), and movie thumbnails. Configurable concurrency and per-type toggles.
- **Ignored games import** — Paste your `dynamicstore/userdata` JSON to import "not interested" and "played elsewhere" flags.

### Browsing

- **Card view** — Grid of game cards with header images, tags, genres, community tags, and score badges. Adjustable column count via slider (2–8 columns). Hover slideshow cycles through screenshots.
- **List view** — Spreadsheet-style table with 20+ columns. Fully customizable: show/hide columns, drag to reorder, resize widths, multi-column sort (shift-click). Sticky header row. Adjustable row height with image scaling.
- **Inspector** — Click any game to open a detailed two-panel inspector. Left side shows header image and a media grid of all screenshots and videos. Right side shows description, metadata grid (score, reviews, Metacritic, SteamDB score, sentiment, dates, developer, publisher), and a 2×2 tag panel (your tags, genres, community tags, features). Fully resizable panels with drag handles. Layout persists across sessions. Clicking any screenshot or video in the media grid opens a full-screen lightbox with arrow-key navigation, auto-playing videos with configurable delay, and HLS streaming support.
- **Similar games** — Inspector shows similar games as clickable purple pills, based on shared genres, tags, and community tags. Similarity scores are pre-computed and can be recalculated from Settings. Clicking a similar game opens a stacked inspector.
- **Shuffle / Randomize** — 🎲 button in the top bar randomizes the game list using a seeded Fisher-Yates shuffle. Click again to unshuffle. Changing filters or sort automatically clears the shuffle.
- **Keyboard navigation** — Arrow keys to move through games, Enter/Space to open inspector, Escape to close (priority chain: edit modal → similar stack → inspector → selected → search). Works in both card and list views.

### Tags & Organization

- **Hierarchical tags** — Create top-level tags (e.g. "co-op", "indie", "backlog") with custom colors. Each tag can have subtags of two types: genre subtags and meta subtags (displayed differently).
- **Tag management** — Full CRUD in Settings. Create, rename, recolor, delete tags and subtags. Subtags can be genre-type or meta-type.
- **Quick tagging** — Click any tag/genre/feature pill in any view to filter by it. Right-click to exclude. Works everywhere: cards, list rows, inspector, sidebar.
- **Steam auto-tags** — Synced games automatically get a "steam" tag with subtags: wishlist, owned, removed_from_wishlist, ignored, played_elsewhere.
- **Release year tags** — Auto-generates a "release" tag with year subtags (2014, 2025, TBA, etc.) parsed from Steam release dates. Handles exact dates, "Q3 2026", "Coming soon", and "To be announced". Runs automatically on metadata fetch, or manually via Settings.

### Filtering & Search

- **Sidebar filters** — Collapsible sidebar with sections for:
  - Custom tags (include/exclude, AND/OR mode, with subtag expansion)
  - Genres, features, community tags (include/exclude, sorted by count or name)
  - Developers and publishers (include/exclude)
  - Quick filters: untagged games, games with notes, curated-only mode
  - Active filter count badge and one-click clear
- **Fuzzy search** — Search bar matches against game names with tiered ranking (starts-with → contains → fuzzy). Supports prefix searches: `note:keyword`, `dev:studio`, `appid:12345`.
- **Steam search** — When searching, also queries Steam's store API to find and add new games. Direct "Add" button on each result skips the preview and opens the edit modal immediately. Preview button (👁) available for checking before adding.
- **Filter chips** — Active filters shown as removable chips at the top. "Clear all" resets to configurable defaults (set your preferred excludes as default via "Set default" button). Smooth scroll-to-top on filter change.
- **Multi-sort** — Sort by any column. Shift-click column headers to add secondary/tertiary sort levels.

### Scores & Color Coding

- **Score sources** — Toggle between raw Steam positive percentage and SteamDB Wilson score (a confidence-adjusted rating that accounts for review count).
- **Color-coded backgrounds** — Optional tinting of cards, list rows, and inspector based on score. Three built-in presets (Subtle, Vivid, Neon) plus a fully custom mode with color pickers for high/mid/low and an opacity slider.
- **Score display** — Every view shows the score with color coding: green (≥70%), amber (40–69%), red (<40%). Metacritic score, review count, and review sentiment string also displayed.

### Data Management

- **CSV export** — Export your library with configurable columns (game info, tags, genres, metadata). Column selection saved in settings.
- **TXT export** — Simple name list export.
- **CSV import** — Import games from CSV. Matches existing games by Steam AppID, creates new entries, and links tags.
- **Manual game entry** — Add games without a Steam AppID. Manually upload screenshots via folder scan.
- **Edit modal** — Edit any game's name, notes, AppID, tags, developers, publishers, genres, and release date. Resizable. Opens instantly for newly added Steam games while metadata fetches in the background — saving tags won't overwrite metadata that arrived after the modal opened.
- **Per-game metadata refresh** — Re-fetch metadata for individual games from the inspector. Updates name if Steam has a different one.

### Clipboard Matching

- **Clipboard tool** (`/clipboard`) — Paste a list of game names and instantly match them against your library. Shows exact, partial, and fuzzy matches with similarity scores. Configurable match thresholds and result limits.
- **Picture-in-Picture mode** — Floating mini-window for clipboard matching while browsing other sites.

### Settings & Customization

- **Tabbed layout** — Settings organized into 5 tabs: Steam & Sync, Display, Recommend, Tags, System. Sticky tab bar at top.
- **Sticky activity log** — Right-side panel (on large screens) shows sync progress, activity log, and system log across all tabs. Falls back to inline on smaller screens.
- **Screenshot quality** — Choose between thumbnail (600×338) or full HD (1920×1080) screenshots.
- **Media limits** — Configure max screenshots and movies per game, download concurrency.
- **Download toggles** — Enable/disable header images, screenshot thumbnails, HD screenshots, and movie thumbnails independently.
- **Slideshow speed** — Configurable interval for card hover slideshows (0.5s–5s).
- **Video delay** — Seconds to wait before auto-loading video in lightbox (0–5s).
- **Card view options** — Default card image source, number of genres and community tags shown per card.
- **Log level** — Server-side logging verbosity for sync operations (off/error/info/debug).
- **LAN access** — Shows your local network IP for accessing the app from other devices on the same network.
- **Database re-init** — Re-run migrations and asset count sync without losing data.
- **System log** — Collapsible log viewer in Settings showing DB initialization, migration results, sync events, and errors. Ring buffer of last 200 entries with color-coded levels.

### Recommendation Engine

- **Play Next scoring** — Sort by "🎯 Recommendation" to see games ranked by how well they match your preferences. 8 configurable signals: genre match, developer match, community tag match (with vote count weighting), score quality (configurable sweet spot), release maturity, time in library (configurable cap), personal match, and priority tag boost.
- **Preference profile** — Built automatically from your played games. Rate games 1–10 to influence the profile — higher-rated games contribute more. View your full profile in Settings.
- **Personal match (⭐📋)** — A dedicated signal that compares candidates against your user-rated and curated games. Rating 9 has much more influence than rating 5 (squared weighting). Curation queue position also feeds in — lower position = stronger influence. Gives you direct control over recommendations.
- **Genre preferences** — Manually boost or penalize specific genres/community tags (e.g. "+50 Metroidvania, -30 Simulation"). Autocomplete from your library's available tags.
- **Configurable weights** — Adjust signal weights in Settings with a live counter. Community tag mode: "by count" (popular tags = stronger) or "inverse" (rare tags = more distinctive). Waiting time cap configurable (default 5 years).
- **Three categories** — Played (training data), Priority (score boost per subtag), Exclude (hidden from results). All configurable with tag>subtag autocomplete.
- **Curation queue** — Manual play ordering with auto-renumber. Set position 3.5 between 3 and 4, all positions renumber to integers.
- **User rating** — Rate any game 1–10. Shown in inspector, list view (⭐ Rating column), and rec breakdown. Sort by "⭐ My Rating" or filter to "With rating" to manage your ratings. Included in CSV export by default.

### Stats Dashboard

- **Library analytics** at `/stats` — Overview cards (total games, Steam games, with notes, untagged, avg score), score distribution, sentiment breakdown, top genres, community tags, developers, release years, added over time.

### Auto Tags

- **Release year** — Auto-assigns games to year subtags (2014–2027, TBA) under a unified "auto" tag.
- **Sentiment** — Auto-assigns Steam review sentiment (Very Positive, Mixed, etc.).
- **Score buckets** — Auto-assigns configurable score ranges.
- **One-click regenerate** — "🏷️ Auto Tags" button in Settings.

### Data Safety & Recovery

- **Auto-backup on exit** — When the dev server stops cleanly, if any data changed during the session, a timestamped backup is saved to `data/backups/` with a delta log showing what changed (games added/removed, tag assignments).
- **Configurable backup retention** — Set max number of backups to keep (default 5, configurable in Settings).
- **Periodic WAL flush** — WAL is flushed every 5 minutes while running, so even a hard kill or Windows Ctrl+C leaves a consistent database.
- **WAL flush on exit** — Clean shutdown flushes WAL and closes the DB properly.
- **Manual flush** — "Flush WAL" button in Settings for on-demand checkpoint.
- **Audit log** — Every write operation (add/update/delete games, tags, syncs) is logged to `data/audit.log` with timestamps, game names, Steam AppIDs, and before→after values for changed fields.

---

## Tech Stack

- **Next.js 16** with App Router and Turbopack
- **SQLite** via better-sqlite3 (WAL mode)
- **Tailwind CSS v4** for styling
- **TypeScript** throughout

## Data Storage

All data lives locally:

- `data/games.db` — SQLite database (auto-created on first run)
- `data/assets/games/<appid>/` — Cached images per game (header, screenshots, movie thumbnails)
- `data/backups/` — Timestamped DB backups with change logs (auto-created on exit if data changed)
- `data/audit.log` — Append-only log of all write operations

The `data/` directory is gitignored. Your database and images stay on your machine.

## License

MIT

---

Built with the help of [Kiro](https://kiro.dev), an AI-powered IDE.
