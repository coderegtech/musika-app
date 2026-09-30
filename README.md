# Musika

**Your music. Your library.** An Expo / React Native application with a separate authenticated Python API. Runs on Android, iOS, and the web. The default demo includes fictional artists and three original, synthesized audio loops; it does not download commercial recordings.

## Run the demo

Requirements: Node 20.19+ and npm.

```powershell
npm install
npm run web
```

Open http://localhost:8081. The first visit saves four bundled tracks into the local audio library. Search “Indie”, “Luna”, “Golden”, or “Chill”; open a result to inspect it, download a new song, create a playlist, and play saved audio. The interface adapts to phone, tablet, and desktop widths.

On a restricted Windows workspace, Expo's global cache can be moved into the project before starting:

```powershell
$env:__UNSAFE_EXPO_HOME_DIRECTORY = Join-Path (Get-Location) '.expo-home'
$env:EXPO_NO_TELEMETRY = '1'
npm run web
```

## Connect Google and YouTube

Every credential below is free — Google OAuth has no cost at any scale, and the YouTube Data API is quota-limited (10,000 free units/day by default; a search costs 100) rather than pay-per-use. Do this once at [console.cloud.google.com](https://console.cloud.google.com); each step names the exact env key(s) it fills in and **which of the two `.env` files** it goes in:

- Root `.env` (copy from `.env.example`) — client config, read by Expo/EAS/Electron at build time.
- `server/.env` (copy from `server/.env.example`) — server-only secrets, read only by the API. Never put one of these values in the root `.env`, or vice versa.

| # | Console step | Fills in |
|---|---|---|
| 1 | New project (or pick an existing one). | — |
| 2 | **APIs & Services → Library** → enable "YouTube Data API v3". | — |
| 3 | **APIs & Services → Credentials → Create Credentials → API key.** Restrict it: API restrictions → YouTube Data API v3 only; application restrictions → your server's IP once deployed (leave unrestricted only for local testing). | `YOUTUBE_API_KEY` in **`server/.env`** — never in the root `.env` or any `EXPO_PUBLIC_` var |
| 4 | **APIs & Services → OAuth consent screen** → External → app name "Musika", your email as contact. Leave scopes at the default (openid/email/profile) — Musika never requests YouTube-account access. Leave **Publishing status: Testing** and add yourself under "Test users" — this skips Google's verification review entirely for personal use (up to 100 test users). | — |
| 5 | **Create Credentials → OAuth client ID → Web application.** Authorized JavaScript origins: `http://localhost:8081` (Expo web dev), plus `http://127.0.0.1:17321` if you'll use the Electron desktop build, plus your production HTTPS origin if you deploy one. | `GOOGLE_CLIENT_ID` in **`server/.env`** and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in the **root `.env`** (same value in both — the server verifies tokens against it, the web client requests them with it) |
| 6 | **Create Credentials → OAuth client ID → Android.** Package name `app.musika.mobile` (already set in `app.config.ts`). SHA-1: run `npx eas credentials` → Android → your build profile → view the keystore, or get it after your first `npm run build:android`. | `GOOGLE_ANDROID_CLIENT_ID` in **`server/.env`** (no client-side var needed — native Google Sign-In matches by package name + SHA-1, not by ID in code) |
| 7 | **Create Credentials → OAuth client ID → iOS** (only if you'll build for iOS — needs a Mac). Bundle ID `app.musika.mobile`. | `GOOGLE_IOS_CLIENT_ID` in **`server/.env`**; `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (same value) and `GOOGLE_IOS_URL_SCHEME` (that ID with its segments reversed, e.g. `123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`) in the **root `.env`** |
| 8 | Add your own Google account email. | `ADMIN_EMAILS` in **`server/.env`** — lets that signed-in account call `/admin/authorized-videos` to approve videos for download live, without a server restart. `AUTHORIZED_VIDEO_IDS` (also `server/.env`) can stay blank; it's only a fixed fallback seed list. |
| 9 | Point the client at your running server. | `EXPO_PUBLIC_API_URL` in the **root `.env`** — a physical device needs a real reachable address, not `localhost`. `MUSIKA_ORIGINS` in **`server/.env`** — comma-separated exact browser origins allowed to call the API (needed for the HTTP-only session cookie's CORS/CSRF check). |
| 10 | Once 1–9 are filled in, flip demo mode off. | `EXPO_PUBLIC_DEMO=false` in the **root `.env`** |

`EXPO_PUBLIC_*` values are inlined into the JS bundle at build time, not read at runtime — restart `expo start` / rebuild after changing any of them.

**Cloud Android builds can't see your local root `.env`.** `npx eas build` runs on Expo's own servers, and `.env` is gitignored, so it never uploads. Any `EXPO_PUBLIC_*` value the APK needs (the web/iOS client IDs, `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_DEMO`) must also be set as an `"env"` block on the build profile in `eas.json`, e.g.:

```json
"preview": {
  "distribution": "internal",
  "android": { "buildType": "apk" },
  "env": { "EXPO_PUBLIC_DEMO": "false", "EXPO_PUBLIC_API_URL": "https://your-server", "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID": "..." }
}
```

These are all public client identifiers (that's what `EXPO_PUBLIC_` means), so committing them to `eas.json` is fine — never put `YOUTUBE_API_KEY` or any other `server/.env` value there. The server never goes through EAS at all; it reads `server/.env` directly.

For production, also set `ENVIRONMENT=production` in `server/.env` (requires secure cookies) and serve the frontend/API from the same site over HTTPS (the session cookie is same-site, HTTP-only).

Only basic Google identity scopes are used. Discovery uses the server API key and does not request access to the user's YouTube account. Google ID tokens are verified server-side against configured audiences and exchanged for random, revocable, 30-day Musika sessions. Native tokens use SecureStore; browser sessions use HTTP-only cookies. Authentication failure clears the native token and prompts reauthentication.

## Start the API

Requirements: Python 3.11+ and the dependencies below. Copy `server/.env.example` to `server/.env` and fill it in (see the credential table above) — `server/main.py` loads that file specifically, not the root one. The virtual environment installs yt-dlp and a bundled FFmpeg executable through imageio-ffmpeg. An existing FFmpeg on PATH takes precedence; optional executable overrides are in `server/.env.example`. Run one API worker so the queue's global concurrency cap remains three.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r server/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000
```

API reference: http://localhost:8000/docs. Runtime databases and media live in `server/data/` and are ignored by Git. Configure HTTPS and durable storage before deploying. Do not run multiple queue workers against the same database; distributed job leasing is outside this implementation.

### Or run it in Docker

[server/Dockerfile](server/Dockerfile) is self-contained — `server/` (including its own `server/.env`) is the whole build context, so it's a unit you can deploy on its own (see VPS section below) without the rest of the monorepo. No local Python/venv needed either way; `ffmpeg` is installed on `PATH` in the image, so it starts instantly instead of downloading a binary on first request.

Locally, via the root [docker-compose.yml](docker-compose.yml):

```powershell
docker compose up -d          # build + start, http://localhost:8010
docker compose logs -f        # watch it
docker compose down           # stop (data in server/data/ persists in the musika_data volume)
docker compose down -v        # stop AND wipe that data, for a fully disposable/temporary run
```

It reads `server/.env` (via `env_file`) — the same file the venv-based run above uses, nothing extra to configure. The container listens on `8000` internally, published as `8010` to match `EXPO_PUBLIC_API_URL` in the root `.env`; edit the `ports:` mapping if you'd rather use a different host port.

### Deploy the API to a VPS with Docker

1. Get `server/` onto the VPS — either `git clone` the whole repo, or just `scp` the `server/` folder if you don't want the rest of the project there. Either way, create `server/.env` on the VPS itself (copy `server/.env.example` and fill it in) — that one folder is now fully self-contained.
2. [Install Docker](https://docs.docker.com/engine/install/) on the VPS (most distros: `curl -fsSL https://get.docker.com | sh`).
3. Build and run:
   ```bash
   cd server
   docker build -t musika-api .
   docker run -d --name musika-api --restart unless-stopped \
     -p 8000:8000 --env-file .env -v musika_data:/app/server/data \
     musika-api
   ```
   (`--restart unless-stopped` brings it back up after a VPS reboot or crash; the image has a built-in `HEALTHCHECK` against `/health` that `docker ps` will report.)
4. Put it behind a reverse proxy for HTTPS — the app needs a real TLS origin for the session cookie and CORS to work correctly in production. [Caddy](https://caddyserver.com/) is the least setup for this: point a domain's A record at the VPS, then a two-line Caddyfile (`your-domain.com { reverse_proxy localhost:8000 }`) gets you automatic Let's Encrypt certificates.
5. Update `server/.env` on the VPS for production: `ENVIRONMENT=production` (requires secure cookies), `MUSIKA_ORIGINS` set to your actual frontend origin(s) (e.g. your Vercel URL), and the Google OAuth Web client's authorized origins to match.
6. Point the client at it: set `EXPO_PUBLIC_API_URL=https://your-domain.com` wherever the frontend is built (root `.env` for local/Electron builds, `eas.json`'s `env` block for EAS, Vercel's Environment Variables for the web deploy — see those sections below) — since it's a public HTTPS URL now, a physical device or the Vercel deployment can reach it too, not just your LAN.

## Personal builds (Android APK / Windows desktop)

Building your own APK or desktop app for personal use needs no Play Store, App Store, or code-signing certificate — those are only required to *publish* through a store.

**Android APK**, via Expo's free cloud build service (EAS):

```powershell
npx eas login
npx eas init
npm run build:android
```

`eas init` prints a project ID; paste it into `.env` as `EAS_PROJECT_ID=...` (read by `app.config.ts`). The build runs on Expo's servers and finishes with a download link for a directly-installable `.apk` — enable "install unknown apps" for your file manager/browser on the phone to sideload it. Because Google Sign-In needs a signed build (unsupported in Expo Go), this is also the way to test real Google/YouTube login on-device — see step 6 above for the Android OAuth client this build needs, and the note above about mirroring `EXPO_PUBLIC_*` values into `eas.json` since this build never sees your local `.env`.

**Windows desktop app**, via the `electron/` wrapper (loads the same UI, served locally so Google Identity Services still has a real origin to attach to):

```powershell
npm run desktop         # run it directly
npm run desktop:build   # produce an installer at electron\release (unsigned — Windows SmartScreen will warn; "More info" → "Run anyway")
```

Both builds point at whatever `EXPO_PUBLIC_API_URL`/`EXPO_PUBLIC_DEMO` are set to in `.env` at build time. For solo use, the Python API can just run on your own PC — no hosting required — with the phone reaching it over your LAN (or a tool like Tailscale if you want access away from home).

## Deploy the web app to Vercel

Vercel can only host the static **web client** ([vercel.json](vercel.json) runs `npm run export` and serves `dist/`) — not the Python API. That server holds a persistent background queue and writes SQLite/audio files to local disk that must survive restarts, which is incompatible with Vercel's serverless, ephemeral-disk model (same reason covered under "Start the API": it needs a real VPS with a persistent volume, not a serverless host).

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → pick `coderegtech/musika-app`. Vercel auto-detects `vercel.json`; no manual build settings needed. Or from the CLI: `npx vercel login` then `npx vercel --prod`.
2. **Leave `EXPO_PUBLIC_DEMO` unset** (or explicitly `true`) in the Vercel project's Environment Variables if you just want a public, self-contained demo — it needs no API/credentials at all, since `EXPO_PUBLIC_DEMO` defaults to `true` when unset.
3. To deploy the **real** app instead, set `EXPO_PUBLIC_DEMO=false` and `EXPO_PUBLIC_API_URL=<your deployed API's HTTPS URL>` as Vercel Environment Variables (Project → Settings → Environment Variables), then redeploy. Like the EAS builds, Vercel's build never sees your local, gitignored `.env` — every `EXPO_PUBLIC_*` value the deployed site needs has to be set there instead. Also add the Vercel deployment's exact origin (e.g. `https://musika-app.vercel.app`) to the API server's `MUSIKA_ORIGINS`, and as an authorized JavaScript origin on the Google **Web** OAuth client (step 5 above).

## What is implemented

- Google native SDK sign-in / Google Identity Services on web, backend token verification, secure sessions, restore, expiry, logout, and error states.
- Music-only discovery, search with 500 ms debounce and stale-request cancellation, YouTube page tokens, five-minute server caching, request deduplication, and video metadata batching.
- Reusable music classification and metadata extraction, with original titles and descriptions preserved. Confidence uses category, music topics, channel/title/description signals, and duration. This is a heuristic, not a guarantee of musical content.
- Details before download; local downloaded indicators; exact source-ID, normalized title/artist/duration, and post-download SHA-256 duplicate detection.
- Playlist search and item pagination, per-track status, individual selection, select-new, and batch enqueueing.
- Persistent server queue with three active jobs, restart recovery, pause/resume, cancel, retry, clear completed, history, and user ownership checks. Queue pause lets active jobs finish.
- Isolated yt-dlp and FFmpeg services using subprocess argument arrays, permitted IDs, fixed formats/bitrates, timeouts, file limits, and no inherited yt-dlp configuration.
- Live-editable download catalog: admins (by email, over the existing session) can add or remove authorized video IDs through `/admin/authorized-videos` without a server restart, in addition to the fixed `AUTHORIZED_VIDEO_IDS` seed list.
- MP3, M4A, and Opus; MP3 at 320 kbps by default. M4A can retain its source stream to avoid an unnecessary transcode, so requested bitrate is a preference rather than a promise of upsampling.
- Title, artist, album/year where available, source tags, and best-effort cover embedding. Artwork failure preserves the successful audio result.
- SQLite local storage and app-private audio files on native; localStorage metadata and IndexedDB audio on web. Completed server files are transferred to the device before becoming playable locally. Native tracks and playlists are also mirrored into relational `artists`/`albums`/`playlists`/`playlist_tracks` tables, used to recover the library if the primary state blob is ever missing or corrupted.
- Per-track ⋮ menu everywhere a track appears (search, details, recently viewed, playlists, library, download history): Download, Download & Add to Playlist, Add to Playlist, Copy Link, Open on YouTube, View Details, Play Offline, Delete Download. Copy Link always copies the canonical `https://www.youtube.com/watch?v=<id>` URL and shows "Link copied to clipboard".
- Download → MP3 → local library → playlist in one step. Playlists reference the single downloaded track (audio is never copied per playlist), and a track already on the device is reused, never downloaded again. The playlist add is applied when the download completes, even if the app was restarted in between.
- Local playlists: create, rename, delete, add/remove/reorder tracks, play, shuffle, repeat, artwork from the first track, track count and total duration, and "Download missing tracks". A YouTube playlist can be saved with "Download playlist", which skips tracks you already have, keeps going past failures, shows `12 / 30 tracks downloaded`, and ends with a Downloaded / Already available / Failed summary.
- Deleting a downloaded song that playlists use asks first and explains the offline impact; playlists keep the song's metadata so it can be downloaded again. Deleting a playlist never deletes audio.
- Download manager shows the stage (Fetching → Downloading → Extracting audio → Converting to MP3 → Saving metadata → Completed), percent, speed and size from yt-dlp's live progress; cancel, retry, remove one item, clear completed. Failed or cancelled jobs delete their temporary files, and an output only becomes a track after FFmpeg has decoded it cleanly. Server errors are mapped to safe messages (private, removed, region-restricted, sign-in required, network, storage, FFmpeg).
- Cover art is cached on the device (native) so library and playlist artwork render offline.
- Persistent player, now-playing view, seek, volume, next/previous, shuffle/repeat, queue, likes, local playlists, artist/album browsing, light/dark appearance, and storage totals.
- Original vector logo and rendered 1024px master, transparent variants, adaptive foreground, iOS icon, notification icon, favicon, and splash assets.

## Download API

All routes need a signed-in session. Video IDs are validated (`^[A-Za-z0-9_-]{11}$`); a supplied `url` is only checked against the ID (supported YouTube hosts only) and is never passed to yt-dlp, which always receives a URL the server builds from the ID. Files are named by job/video ID, never by title.

| Route | Purpose |
|---|---|
| `POST /downloads` | `{ "video_id", "url"?, "playlist_id"?, "format", "quality", "permission_confirmed" }` — queue a download (returns the existing local track instead if it is a duplicate). |
| `GET /downloads/{id}` | Status: `{ id, status, progress, title, stage, speed, bytes_total, error, ... }`. Only the owner can read it. |
| `GET /downloads` | The user's queue and pause state. |
| `POST /downloads/{id}/{cancel,retry,remove}` | Per-job actions (`remove` only for finished jobs). |
| `POST /downloads/queue/{pause,resume,retry,clear}` | Whole-queue actions. |

Musika needs its own server for this: a React Native build cannot run the yt-dlp/FFmpeg binaries itself, so the app only ever calls this API and then stores the finished file on the device.

## Structure

```text
App.tsx                       Screens and responsive navigation
src/components/               Reusable UI, ⋮ track actions, playlist views, Google login, audio player
src/services/                 Auth, API, links (copy/open), local SQLite and audio storage
src/store.ts                  Zustand persistence and queue synchronization
src/models.ts                 Application models and local duplicate rules
server/main.py                Authenticated HTTP endpoints
server/youtube.py             YouTube discovery and response transformation
server/domain.py              Metadata, classification, duplicate rules
server/downloads.py           Persistent queue, yt-dlp, FFmpeg
server/database.py            SQLite persistence and transactions
server/tests/                 Domain, queue, auth and API security tests
scripts/                      Reproducible original logo/audio generation
assets/                       Brand files and original demo audio
```

## Validate

```powershell
npm run typecheck
.\.venv\Scripts\python.exe -m unittest discover -s server/tests -v
npm run export
```

Regenerate branding with `node scripts/generate-assets.cjs` and audio with `python scripts/generate-audio.py`. The source SVGs are editable. `assets/icon.png` is the opaque iOS / master icon; `adaptive-icon.png` is transparent Android foreground.

## Device and deployment verification still needed

Live OAuth and YouTube discovery require your own credentials. Native Google login, background playback, platform codec support (particularly Opus on iOS), and on-device file transfer must be tested on signed Android/iOS builds. Browser audio is stored offline, but the web shell is not a service-worker PWA; reopening the website still needs the server. Native builds include the application shell and support cold-start offline playback. A real YouTube extraction still needs an authorized test video; the automated media test converts original bundled audio through real FFmpeg in all three formats.

Remote demo artwork is served by Unsplash and needs a connection; downloaded audio does not. Production artwork caching, storage quotas/retention, richer metadata correction, distributed workers, and app-store release signing remain deployment work.

## References

- [Expo Audio](https://docs.expo.dev/versions/v54.0.0/sdk/audio/)
- [Expo Google authentication](https://docs.expo.dev/guides/google-authentication/)
- [YouTube search and pagination](https://developers.google.com/youtube/v3/docs/search/list)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)

The app uses Expo SDK 54 with its matching native dependencies, pinned in the lockfile.
