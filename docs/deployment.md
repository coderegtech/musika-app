# Production deployment

Musika has two parts:

| Part | What it is | Where it runs |
|---|---|---|
| Web app | Static Expo export | Vercel |
| API | FastAPI, plus yt-dlp, FFmpeg and Deno, in one Docker image (`server/Dockerfile`) | Render, Railway, any Docker host, or your own PC behind a [Cloudflare Tunnel](cloudflare-tunnel.md) |

The API needs a **persistent disk** mounted at `/app/server/data`. It holds the
SQLite database (users, sessions, libraries, the download queue) and the
downloaded audio.

> **Read this first: YouTube may still block a cloud server.** YouTube often
> answers datacenter IPs with *"Sign in to confirm you're not a bot"*. Cookies,
> PO tokens, proxies or a different host can help, but none of them is
> guaranteed, and YouTube changes its defences often. The API detects these
> blocks, shows users a clear message, and stops retrying for a while instead
> of hammering YouTube. See [When YouTube blocks the server](#when-youtube-blocks-the-server).
> Running the API from a home connection is the most reliable option we've found.

## What the image contains

`server/Dockerfile` installs:

- **FFmpeg** from Debian, used to convert audio and embed tags and artwork.
- **Deno 2.5.6**, which yt-dlp uses to solve YouTube's JavaScript challenges
  ([EJS](https://github.com/yt-dlp/yt-dlp/wiki/EJS)). Without it, formats go
  missing.
- **yt-dlp[default]**, which includes `yt-dlp-ejs`, the challenge-solver scripts.
- **bgutil-ytdlp-pot-provider**, an optional PO Token plugin. It is inactive
  unless configured.

The build runs `yt-dlp --version`, `ffmpeg -version` and `deno --version`, so a
broken toolchain fails the build rather than the first request.

**Rebuild regularly.** YouTube changes often, and an old yt-dlp is the most
common cause of `extractor` errors. `requirements.txt` sets a minimum version,
not a maximum, so a fresh build (without the Docker cache) picks up the latest
release. On Render use **Manual Deploy → Clear build cache & deploy**. On
Railway use **Redeploy**.

## Environment variables

Set these on the API service. Everything marked optional can stay unset.

| Variable | Required | Purpose |
|---|---|---|
| `YOUTUBE_API_KEY` | yes | Search and discovery (YouTube Data API v3). |
| `FIREBASE_PROJECT_ID` | yes | Only accepts sign-ins from this Firebase project. |
| `MUSIKA_ORIGINS` | yes | Comma-separated web origins, e.g. `https://musika-app-umber.vercel.app`. |
| `ENVIRONMENT` | yes | `production` (secure cookies). |
| `COOKIE_SAMESITE` | yes | `none` when the web app and API are on different sites (Vercel + Render/Railway). |
| `STREAM_SECRET` | yes | Long random string that signs stream links. If unset, a random key is generated on each restart, which breaks links in use. |
| `PORT` | – | Railway sets it automatically. Defaults to 8000. |
| `LOG_LEVEL` | optional | `INFO` by default. `DEBUG` for more detail. |
| `YT_DLP_COOKIES_FILE` | optional | Path to a cookies.txt, e.g. a Render secret file. |
| `YT_DLP_COOKIES_B64` | optional | The cookies.txt contents, base64-encoded. For hosts without secret files (Railway). |
| `YT_DLP_PROXY` | optional | `http://user:pass@host:port`. Use a residential proxy; datacenter proxies usually hit the same block. |
| `YT_DLP_POT_PROVIDER_URL` | optional | PO Token provider server, e.g. `http://pot-provider:4416`. |
| `YT_DLP_EXTRACTOR_ARGS` | optional | Raw `--extractor-args`, e.g. `youtube:player_client=default,mweb`. |
| `YT_DLP_SLEEP_REQUESTS` | optional | Seconds yt-dlp waits between its own requests. `0` (off) by default. |
| `YT_DLP_MAX_CONCURRENCY` | optional | Maximum simultaneous yt-dlp processes. Default 4. |
| `YT_DLP_MIN_INTERVAL` | optional | Minimum seconds between yt-dlp process starts. Default 1. |
| `YT_DLP_MAX_ATTEMPTS` | optional | Attempts per download for transient errors. Default 3. Playback always uses 2. |
| `YT_DLP_BACKOFF_SECONDS` | optional | Base for exponential backoff (2 s, 4 s, …, capped at 30 s, plus jitter). Default 2. |
| `YT_DLP_TIMEOUT` | optional | Seconds per playback extraction attempt. Default 60. |
| `YT_DLP_SOCKET_TIMEOUT` | optional | yt-dlp's network timeout. Default 30. |
| `YT_DLP_BLOCK_COOLDOWN` | optional | Seconds to fail fast after a bot check or rate limit. Default 600. |

Cookies, proxy credentials and PO tokens stay on the server. They never reach
the web app, `/health`, error messages or the logs: URLs are stripped of
credentials and query strings, and cookie, token and authorization values are
masked before anything is logged or shown.

## Deploy the API on Render

`render.yaml` is a Blueprint for the API.

1. In the dashboard, go to **New → Blueprint** and pick this repository.
2. Fill in the values it asks for (see the table above). Render generates
   `STREAM_SECRET`.
3. The Blueprint uses the **Starter** plan with a 5 GB disk at
   `/app/server/data`. The free plan has no disks, so libraries would be lost
   on every deploy.
4. Render checks `/health` before switching traffic to a new deploy.

For cookies, open **Environment → Secret Files**, add `youtube-cookies.txt`,
and set `YT_DLP_COOKIES_FILE=/etc/secrets/youtube-cookies.txt`.

## Deploy the API on Railway

1. Go to **New Project → Deploy from GitHub repo** and pick this repository.
2. In the service's **Settings**:
   - **Root Directory:** `/server`
   - **Config-as-code → Railway Config File:** `/server/railway.json`. Railway
     doesn't look for it under the root directory on its own.
3. **Volumes:** add a volume mounted at `/app/server/data`.
4. **Variables:** set the required variables from the table. Generate
   `STREAM_SECRET` with:

   ```bash
   python -c "import secrets; print(secrets.token_hex(32))"
   ```

   Railway sets `PORT` itself.
5. **Networking:** generate a public domain. That domain is your API URL.

`server/railway.json` builds from the Dockerfile, waits for `/health`, and
restarts the service on failure.

Railway has no secret files, so pass cookies as an environment variable
instead:

```bash
base64 -w0 cookies.txt
```

Set the output as `YT_DLP_COOKIES_B64`.

## Point the web app (Vercel) at the API

In Vercel, go to **Project → Settings → Environment Variables** and set
`EXPO_PUBLIC_API_URL` to the API's public URL, with no trailing slash. Then
**Redeploy**. The value is compiled into the build, so changing it always needs
a redeploy. Make sure the Vercel URL is listed in the API's `MUSIKA_ORIGINS`.

## Health check

`GET /health` always returns 200 while the process is serving requests, so a
YouTube block doesn't make the host restart the service. The `extractor` object
is for diagnosis:

```json
{
  "ok": true,
  "discovery_configured": true,
  "extractor": {
    "status": "ok",
    "blocked_for_seconds": 0,
    "blocked_reason": null,
    "yt_dlp": "2026.8.19",
    "ffmpeg": true,
    "js_runtime": true,
    "cookies": false,
    "proxy": false,
    "po_token_provider": false,
    "last_success": "2026-10-09T15:20:11+00:00",
    "last_error": null,
    "last_error_at": null
  }
}
```

`status` is one of:

- `ok`: the last extraction worked, or none has run yet.
- `degraded`: the most recent extraction failed.
- `blocked`: the server is in a cooldown after a bot check or rate limit.
  `blocked_reason` says which, and `blocked_for_seconds` says how long until it
  tries again.

`cookies`, `proxy` and `po_token_provider` only say whether each one is
configured. They never show the values.

## How extraction behaves

- **Background work.** Downloads run in a background queue: `POST /downloads`
  returns immediately, and the app polls `GET /downloads`. Playback has to wait
  for an extraction, but it starts as soon as the app asks for a stream link,
  and requests that arrive together share one yt-dlp run. Everything runs as
  async subprocesses, so other requests are never blocked.
- **Throttling.** At most `YT_DLP_MAX_CONCURRENCY` yt-dlp processes run at once,
  and they start at least `YT_DLP_MIN_INTERVAL` seconds apart.
- **Retries.** Only transient failures are retried: timeouts, network errors,
  YouTube 5xx responses, and 403s on media URLs. Retries use exponential
  backoff with jitter, and the number of attempts is bounded.
- **Never retried.** Bot checks, rate limits (HTTP 429, or *"This content isn't
  available, try again later"*), unavailable videos, age-restricted videos and
  extractor errors are not retried.
- **Cooldown.** After a bot check or rate limit, every play and download fails
  immediately for `YT_DLP_BLOCK_COOLDOWN` seconds, with HTTP 503 and a
  `Retry-After` header, without contacting YouTube. Changing the cookies, proxy,
  PO token or extractor settings lifts the cooldown at once.
- **Caching.**
  - Resolved streams are kept until their URL expires, so seeking and replays
    don't call yt-dlp again.
  - Extracted metadata is reused when the same track is downloaded
    (`--load-info-json`), so "play, then download" makes only one extraction
    request to YouTube.
  - Unavailable and age-restricted videos are remembered for an hour.
  - All of these caches are size-limited.

### What users see

| Kind (`kind` in logs) | HTTP | Message |
|---|---|---|
| `bot_check` | 503 | YouTube blocked this server's request with a bot check. Try again later. |
| `rate_limited` | 503 | YouTube is rate-limiting this server. Try again in a few minutes. |
| `unavailable` | 404 | This video is unavailable on YouTube (private, removed, live or region-locked). |
| `age_restricted` | 403 | This video is age-restricted on YouTube, so it cannot be played here. |
| `forbidden` | 502 | YouTube refused the audio stream. Try again in a moment. |
| `timeout` | 504 | YouTube took too long to respond. Try again. |
| `network` | 502 | The server couldn't reach YouTube. Try again. |
| `proxy` | 502 | The server's connection to YouTube isn't working. Try again later. |
| `extractor` | 502 | This server's YouTube extractor needs an update. Try again later. |
| `unknown` | 502 | Couldn't get this track from YouTube, followed by yt-dlp's reason with secrets removed. |

### Logs

Each yt-dlp run logs one line:

```
INFO musika.ytdlp event=ytdlp.ok purpose=stream video=hJhVURhdLEg attempt=1/2 elapsed_ms=2576
WARNING musika.ytdlp event=ytdlp.failure purpose=download video=… kind=bot_check attempt=1/3 elapsed_ms=1490 exit=1 detail="ERROR: [youtube] …"
ERROR musika.ytdlp event=ytdlp.blocked kind=bot_check cooldown_s=600
WARNING musika.ytdlp event=ytdlp.warning purpose=stream video=… detail="WARNING: … cookies are no longer valid …"
```

`event=ytdlp.warning` lines report expiring cookies, PO token trouble or a
missing JavaScript runtime before they turn into failures. Command lines are
never logged.

## When YouTube blocks the server

Work through these in order. After each change, check `/health` and play one
track. Don't loop retries: the cooldown is there to keep the server from making
its standing with YouTube worse.

1. **Rebuild** to get the latest yt-dlp. This fixes most `extractor` errors.
2. **Cookies** (`YT_DLP_COOKIES_FILE` or `YT_DLP_COOKIES_B64`). Follow
   [yt-dlp's guide](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies):
   - Sign in from a private window with a **throwaway** account, because
     YouTube can ban accounts used this way.
   - Open `https://www.youtube.com/robots.txt` in that window.
   - Export the cookies, then close the window without signing out.

   Signed-in sessions get higher limits (roughly 2000 videos an hour, compared
   with about 300 for guests). Cookies expire, so watch for
   `event=ytdlp.warning` lines about them.
3. **PO Token provider.** yt-dlp's
   [PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)
   recommends a provider plugin over pasting tokens by hand, because most
   tokens are now tied to a single video. The plugin is already in the image.
   Run the provider server next to the API and point the API at it:
   - Docker compose: run `docker compose --profile pot up -d` and set
     `YT_DLP_POT_PROVIDER_URL=http://pot-provider:4416`.
   - Render or Railway: deploy `brainicism/bgutil-ytdlp-pot-provider:2.0.0` as
     a **private** service (it has no authentication) and set the variable to
     its internal URL.
   - Keep the image's major version the same as the plugin's in
     `requirements.txt`.
   - The guide's suggested setup is the `mweb` client with a GVS token. Try it
     with `YT_DLP_EXTRACTOR_ARGS=youtube:player_client=default,mweb`.

   A PO token can fix 403s on media URLs. It doesn't stop a bot check aimed at
   the IP address.
4. **Residential proxy** (`YT_DLP_PROXY`). This is a paid service, and its
   reliability varies by provider.
5. **Run the API from a home connection** with
   [Cloudflare Tunnel](cloudflare-tunnel.md). This is the most reliable option,
   but the machine has to stay on.

None of these is guaranteed. Respect YouTube's terms and rate limits, and keep
traffic proportionate to real listening.

## Local verification

```bash
docker compose up -d --build api
```

```bash
curl http://localhost:8010/health
```

```bash
npm test
```

The server tests mock yt-dlp, so they don't contact YouTube.
