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

Every credential below is free — Google OAuth has no cost at any scale, and the YouTube Data API is quota-limited (10,000 free units/day by default; a search costs 100) rather than pay-per-use. Do this once at [console.cloud.google.com](https://console.cloud.google.com); each step names the exact `.env` key(s) it fills in. Copy `.env.example` to `.env` first if you haven't.

| # | Console step | Fills in |
|---|---|---|
| 1 | New project (or pick an existing one). | — |
| 2 | **APIs & Services → Library** → enable "YouTube Data API v3". | — |
| 3 | **APIs & Services → Credentials → Create Credentials → API key.** Restrict it: API restrictions → YouTube Data API v3 only; application restrictions → your server's IP once deployed (leave unrestricted only for local testing). | `YOUTUBE_API_KEY` (server only — never an `EXPO_PUBLIC_` var) |
| 4 | **APIs & Services → OAuth consent screen** → External → app name "Musika", your email as contact. Leave scopes at the default (openid/email/profile) — Musika never requests YouTube-account access. Leave **Publishing status: Testing** and add yourself under "Test users" — this skips Google's verification review entirely for personal use (up to 100 test users). | — |
| 5 | **Create Credentials → OAuth client ID → Web application.** Authorized JavaScript origins: `http://localhost:8081` (Expo web dev), plus `http://127.0.0.1:17321` if you'll use the Electron desktop build, plus your production HTTPS origin if you deploy one. | `GOOGLE_CLIENT_ID` **and** `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (same value in both — the server verifies tokens against it, the web client requests them with it) |
| 6 | **Create Credentials → OAuth client ID → Android.** Package name `app.musika.mobile` (already set in `app.config.ts`). SHA-1: run `npx eas credentials` → Android → your build profile → view the keystore, or get it after your first `npm run build:android`. | `GOOGLE_ANDROID_CLIENT_ID` (no client-side var needed — native Google Sign-In matches by package name + SHA-1, not by ID in code) |
| 7 | **Create Credentials → OAuth client ID → iOS** (only if you'll build for iOS — needs a Mac). Bundle ID `app.musika.mobile`. | `GOOGLE_IOS_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (same value); `GOOGLE_IOS_URL_SCHEME` is that ID with its segments reversed, e.g. `123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc` |
| 8 | Add your own Google account email. | `ADMIN_EMAILS` — lets that signed-in account call `/admin/authorized-videos` to approve videos for download live, without a server restart. `AUTHORIZED_VIDEO_IDS` can stay blank; it's only a fixed fallback seed list. |
| 9 | Point the client at your running server. | `EXPO_PUBLIC_API_URL` — a physical device needs a real reachable address, not `localhost`. `MUSIKA_ORIGINS` — comma-separated exact browser origins allowed to call the API (needed for the HTTP-only session cookie's CORS/CSRF check). |
| 10 | Once 1–9 are filled in, flip demo mode off. | `EXPO_PUBLIC_DEMO=false` |

`EXPO_PUBLIC_*` values are inlined into the JS bundle at build time, not read at runtime — restart `expo start` / rebuild after changing any of them.

**Cloud Android builds can't see your local `.env`.** `npx eas build` runs on Expo's own servers, and `.env` is gitignored, so it never uploads. Any `EXPO_PUBLIC_*` value the APK needs (the web/iOS client IDs, `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_DEMO`) must also be set as an `"env"` block on the build profile in `eas.json`, e.g.:

```json
"preview": {
  "distribution": "internal",
  "android": { "buildType": "apk" },
  "env": { "EXPO_PUBLIC_DEMO": "false", "EXPO_PUBLIC_API_URL": "https://your-server", "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID": "..." }
}
```

These are all public client identifiers (that's what `EXPO_PUBLIC_` means), so committing them to `eas.json` is fine — never put `YOUTUBE_API_KEY` or any server-only var there. The server reads its own local `.env` directly and never goes through EAS.

For production, also set `ENVIRONMENT=production` (requires secure cookies) and serve the frontend/API from the same site over HTTPS (the session cookie is same-site, HTTP-only).

Only basic Google identity scopes are used. Discovery uses the server API key and does not request access to the user's YouTube account. Google ID tokens are verified server-side against configured audiences and exchanged for random, revocable, 30-day Musika sessions. Native tokens use SecureStore; browser sessions use HTTP-only cookies. Authentication failure clears the native token and prompts reauthentication.

## Start the API

Requirements: Python 3.11+ and the dependencies below. The virtual environment installs yt-dlp and a bundled FFmpeg executable through imageio-ffmpeg. An existing FFmpeg on PATH takes precedence; optional executable overrides are in `.env.example`. Run one API worker so the queue's global concurrency cap remains three.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r server/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000
```

API reference: http://localhost:8000/docs. Runtime databases and media live in `server/data/` and are ignored by Git. Configure HTTPS and durable storage before deploying. Do not run multiple queue workers against the same database; distributed job leasing is outside this implementation.

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
- Persistent player, now-playing view, seek, volume, next/previous, shuffle/repeat, queue, likes, local playlists, artist/album browsing, light/dark appearance, and storage totals.
- Original vector logo and rendered 1024px master, transparent variants, adaptive foreground, iOS icon, notification icon, favicon, and splash assets.

## Structure

```text
App.tsx                       Screens and responsive navigation
src/components/               Reusable UI, Google login, audio player
src/services/                 Auth, API, local SQLite and audio storage
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
