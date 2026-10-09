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

Every credential below is free — Firebase Authentication with Google sign-in is free on the Spark plan, and the YouTube Data API is quota-limited (10,000 free units/day by default; a search costs 100) rather than pay-per-use. Do this once at [console.cloud.google.com](https://console.cloud.google.com); each step names the exact env key(s) it fills in and **which of the two `.env` files** it goes in:

- Root `.env` (copy from `.env.example`) — client config, read by Expo/EAS/Electron at build time.
- `server/.env` (copy from `server/.env.example`) — server-only secrets, read only by the API. Never put one of these values in the root `.env`, or vice versa.

| # | Console step | Fills in |
|---|---|---|
| 1 | New project (or pick an existing one). | — |
| 2 | **APIs & Services → Library** → enable "YouTube Data API v3". | — |
| 3 | **APIs & Services → Credentials → Create Credentials → API key.** Restrict it: API restrictions → YouTube Data API v3 only; application restrictions → your server's IP once deployed (leave unrestricted only for local testing). | `YOUTUBE_API_KEY` in **`server/.env`** — never in the root `.env` or any `EXPO_PUBLIC_` var |
| 4 | Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → pick the same Google Cloud project from step 1 (Analytics can stay off). Then **Build → Authentication → Get started → Sign-in method → Google → Enable**, choosing your email as support email. This creates the OAuth consent screen and a "Web client (auto created by Google Service)" OAuth client for you. | `FIREBASE_PROJECT_ID` in **`server/.env`** (the project ID shown in Project settings — the server only accepts tokens issued for this project) |
| 5 | **Project settings → General → Your apps → Add app → Web** (nickname "Musika", no Hosting). Copy `apiKey`, `authDomain`, `projectId`, `appId` from the config it shows. Then **Authentication → Settings → Authorized domains**: `localhost` is there by default (it also covers the Electron desktop build, which serves itself from `http://localhost:17321`); add your production domain (e.g. `musika-app.vercel.app`) if you deploy one. | `EXPO_PUBLIC_FIREBASE_API_KEY`, `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`, `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_FIREBASE_APP_ID` in the **root `.env`** |
| 6 | **Android** (native Google sign-in): **Project settings → Add app → Android**, package `app.musika.mobile`, and add the SHA-1 from `npx eas credentials` → Android → your build profile (or after your first `npm run build:android`). Firebase creates the matching Android OAuth client. Then in **Authentication → Sign-in method → Google → Web SDK configuration**, copy the **Web client ID**. | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` in the **root `.env`** (that Web client ID — native Google Sign-In requests an ID token for it, which Firebase then accepts) |
| 7 | **iOS** (only if you'll build for iOS — needs a Mac): **Project settings → Add app → iOS**, bundle ID `app.musika.mobile`, then open the downloaded `GoogleService-Info.plist` and copy `CLIENT_ID` and `REVERSED_CLIENT_ID`. | `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (`CLIENT_ID`) and `GOOGLE_IOS_URL_SCHEME` (`REVERSED_CLIENT_ID`) in the **root `.env`** |
| 8 | Point the client at your running server. | `EXPO_PUBLIC_API_URL` in the **root `.env`** — a physical device needs a real reachable address, not `localhost`. `MUSIKA_ORIGINS` in **`server/.env`** — comma-separated exact browser origins allowed to call the API (needed for the HTTP-only session cookie's CORS/CSRF check). |
| 9 | Once 1–8 are filled in, flip demo mode off. | `EXPO_PUBLIC_DEMO=false` in the **root `.env`** |

`EXPO_PUBLIC_*` values are inlined into the JS bundle at build time, not read at runtime — restart `expo start` / rebuild after changing any of them.

**Cloud Android builds can't see your local root `.env`.** `npx eas build` runs on Expo's own servers, and `.env` is gitignored, so it never uploads. Any `EXPO_PUBLIC_*` value the APK needs (the `EXPO_PUBLIC_FIREBASE_*` config, the web/iOS client IDs, `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_DEMO`) must also be set as an `"env"` block on the build profile in `eas.json`, e.g.:

```json
"preview": {
  "distribution": "internal",
  "android": { "buildType": "apk" },
  "env": { "EXPO_PUBLIC_DEMO": "false", "EXPO_PUBLIC_API_URL": "https://your-server", "EXPO_PUBLIC_FIREBASE_API_KEY": "...", "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN": "...", "EXPO_PUBLIC_FIREBASE_PROJECT_ID": "...", "EXPO_PUBLIC_FIREBASE_APP_ID": "...", "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID": "..." }
}
```

These are all public client identifiers (that's what `EXPO_PUBLIC_` means), so committing them to `eas.json` is fine — never put `YOUTUBE_API_KEY` or any other `server/.env` value there. The server never goes through EAS at all; it reads `server/.env` directly.

For production, also set `ENVIRONMENT=production` in `server/.env` (requires secure cookies) and serve the frontend/API from the same site over HTTPS (the session cookie is same-site, HTTP-only).

Only basic Google identity scopes are used. Discovery uses the server API key and does not request access to the user's YouTube account. Sign-in goes through Firebase Authentication (Google provider only): the client sends a Firebase ID token, which the server verifies against `FIREBASE_PROJECT_ID` (signature, issuer, audience, `google.com` provider, verified email) and exchanges for random, revocable, 30-day Musika sessions. Native tokens use SecureStore; browser sessions use HTTP-only cookies. Authentication failure clears the native token and prompts reauthentication.

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
5. Update `server/.env` on the VPS for production: `ENVIRONMENT=production` (requires secure cookies), `MUSIKA_ORIGINS` set to your actual frontend origin(s) (e.g. your Vercel URL), and Firebase Authentication's authorized domains to match.
6. Point the client at it: set `EXPO_PUBLIC_API_URL=https://your-domain.com` wherever the frontend is built (root `.env` for local/Electron builds, `eas.json`'s `env` block for EAS, Vercel's Environment Variables for the web deploy — see those sections below) — since it's a public HTTPS URL now, a physical device or the Vercel deployment can reach it too, not just your LAN.

### Deploy the API to Render

[render.yaml](render.yaml) is a Render Blueprint that builds the same `server/Dockerfile`, with a persistent disk mounted on `server/data` (SQLite + downloaded audio). Vercel can't host this API: its functions have no persistent disk and can't run the always-on download worker.

1. Push this repo to GitHub, then in [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint** → pick the repo. It creates `musika-api` on the **Starter** plan (persistent disks aren't available on the free plan).
2. Fill in the prompted values: `FIREBASE_PROJECT_ID`, `YOUTUBE_API_KEY`, and `MUSIKA_ORIGINS` (your exact Vercel origin, e.g. `https://musika-app.vercel.app`). `ENVIRONMENT=production` and `COOKIE_SAMESITE=none` are preset — the web app (`vercel.app`) and API (`onrender.com`) are different sites, so the session cookie must be cross-site.
3. Once live, set `EXPO_PUBLIC_API_URL=https://musika-api.onrender.com` (your service's URL) in Vercel's Environment Variables and `eas.json`, then redeploy the frontend.

Browsers that block third-party cookies (Safari, or Chrome with that setting on) won't keep a web session across the two sites. If that matters, give both a shared custom domain (e.g. `app.example.com` on Vercel, `api.example.com` on Render) and set `COOKIE_SAMESITE=lax`. The native apps use bearer tokens and aren't affected.

## Personal builds (Android APK / Windows desktop)

Building your own APK or desktop app for personal use needs no Play Store, App Store, or code-signing certificate — those are only required to *publish* through a store.

**Android APK**, via Expo's free cloud build service (EAS):

```powershell
npx eas login
npx eas init
npm run build:android
```

`eas init` prints a project ID; paste it into `.env` as `EAS_PROJECT_ID=...` (read by `app.config.ts`). The build runs on Expo's servers and finishes with a download link for a directly-installable `.apk` — enable "install unknown apps" for your file manager/browser on the phone to sideload it. Because Google Sign-In needs a signed build (unsupported in Expo Go), this is also the way to test real Google/YouTube login on-device — see step 6 above for the Android OAuth client this build needs, and the note above about mirroring `EXPO_PUBLIC_*` values into `eas.json` since this build never sees your local `.env`.

**Windows desktop app**, via the `electron/` wrapper (loads the same UI, served locally so Firebase Auth still has a real, authorized origin):

```powershell
npm run desktop         # run it directly
npm run desktop:build   # produce an installer at electron\release (unsigned — Windows SmartScreen will warn; "More info" → "Run anyway")
```

Both builds point at whatever `EXPO_PUBLIC_API_URL`/`EXPO_PUBLIC_DEMO` are set to in `.env` at build time. For solo use, the Python API can just run on your own PC — no hosting required — with the phone reaching it over your LAN (or a tool like Tailscale if you want access away from home).

## Deploy the web app to Vercel

Vercel can only host the static **web client** ([vercel.json](vercel.json) runs `npm run export` and serves `dist/`) — not the Python API. That server holds a persistent background queue and writes SQLite/audio files to local disk that must survive restarts, which is incompatible with Vercel's serverless, ephemeral-disk model (same reason covered under "Start the API": it needs a real VPS with a persistent volume, not a serverless host).

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → pick `coderegtech/musika-app`. Vercel auto-detects `vercel.json`; no manual build settings needed. Or from the CLI: `npx vercel login` then `npx vercel --prod`.
2. **Leave `EXPO_PUBLIC_DEMO` unset** (or explicitly `true`) in the Vercel project's Environment Variables if you just want a public, self-contained demo — it needs no API/credentials at all, since `EXPO_PUBLIC_DEMO` defaults to `true` when unset.
3. To deploy the **real** app instead, set `EXPO_PUBLIC_DEMO=false` and `EXPO_PUBLIC_API_URL=<your deployed API's HTTPS URL>` as Vercel Environment Variables (Project → Settings → Environment Variables), then redeploy. Like the EAS builds, Vercel's build never sees your local, gitignored `.env` — every `EXPO_PUBLIC_*` value the deployed site needs has to be set there instead. Also add the Vercel deployment's exact origin (e.g. `https://musika-app.vercel.app`) to the API server's `MUSIKA_ORIGINS`, and its domain to Firebase Authentication's authorized domains (step 5 above).

## What is implemented

- Firebase Authentication with Google (native Google SDK credential on Android/iOS, popup on web/desktop), backend Firebase token verification, secure sessions, restore, expiry, logout, and error states.
- Music-only discovery, search with 500 ms debounce and stale-request cancellation, YouTube page tokens, five-minute server caching, request deduplication, and video metadata batching.
- Reusable music classification and metadata extraction, with original titles and descriptions preserved. Confidence uses category, music topics, channel/title/description signals, and duration. This is a heuristic, not a guarantee of musical content.
- Details before download; local downloaded indicators; exact source-ID, normalized title/artist/duration, and post-download SHA-256 duplicate detection.
- Playlist search and item pagination, per-track status, individual selection, select-new, and batch enqueueing.
- Persistent server queue with three active jobs, restart recovery, pause/resume, cancel, retry, clear completed, history, and user ownership checks. Queue pause lets active jobs finish.
- Isolated yt-dlp and FFmpeg services using subprocess argument arrays, validated video IDs, fixed formats/bitrates, timeouts, file limits, and no inherited yt-dlp configuration.
- Play any track without downloading it: the server resolves YouTube's audio-only stream with yt-dlp and relays it (with Range support for seeking) at a short-lived signed `/stream/{id}/audio` URL, so the normal player handles it, including background playback and lock-screen controls. YouTube binds stream URLs to the resolving IP, which is why the server relays instead of handing the URL to the client. Downloaded tracks always play from the device copy.
- Any signed-in user can download any music video: the server converts it to the chosen format (MP3 by default) and the app saves the file on the device.
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

Live OAuth and YouTube discovery require your own credentials. Native Google login, background playback, platform codec support (particularly Opus on iOS), and on-device file transfer must be tested on signed Android/iOS builds. Browser audio is stored offline, but the web shell is not a service-worker PWA; reopening the website still needs the server. Native builds include the application shell and support cold-start offline playback. A real YouTube extraction is not covered by the automated tests; the automated media test converts original bundled audio through real FFmpeg in all three formats.

Remote demo artwork is served by Unsplash and needs a connection; downloaded audio does not. Production artwork caching, storage quotas/retention, richer metadata correction, distributed workers, and app-store release signing remain deployment work.

## Troubleshooting

**Streams return 502 or downloads fail on a cloud host (Render, etc.).** The API logs the real yt-dlp error as a `musika` warning (`Streaming failed. …` / `Media processing failed. …`), and the same text reaches the app. If it says *"Sign in to confirm you're not a bot"*, YouTube is refusing requests from that server's datacenter IP; the same video will usually work from your own machine. Ways around it, most reliable first:

- **Run the API from home.** Your own connection isn't flagged. Keep the Docker API running on your PC and expose it with [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (free), then point `EXPO_PUBLIC_API_URL` and the Vercel app at the tunnel's HTTPS URL. The catch: the PC has to stay on. Step-by-step: [docs/cloudflare-tunnel.md](docs/cloudflare-tunnel.md).
- **Cookies (`YT_DLP_COOKIES_FILE`).** Sign in to YouTube in a private browser window with a **throwaway** Google account (YouTube can flag accounts used this way), export `cookies.txt` with a "Get cookies.txt LOCALLY"-style extension, then close that window without signing out so the cookies stay valid. On Render: **Environment → Secret Files**, add `youtube-cookies.txt`, and set `YT_DLP_COOKIES_FILE=/etc/secrets/youtube-cookies.txt`. Cookies expire; re-export when the bot check returns.
- **Proxy (`YT_DLP_PROXY`).** A residential proxy URL such as `http://user:pass@host:port`. Datacenter proxies usually hit the same block.

## References

- [Expo Audio](https://docs.expo.dev/versions/v54.0.0/sdk/audio/)
- [Expo Google authentication](https://docs.expo.dev/guides/google-authentication/)
- [Firebase Auth with Google](https://firebase.google.com/docs/auth/web/google-signin)
- [Using Firebase with Expo](https://docs.expo.dev/guides/using-firebase/)
- [YouTube search and pagination](https://developers.google.com/youtube/v3/docs/search/list)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)

The app uses Expo SDK 54 with its matching native dependencies, pinned in the lockfile.
