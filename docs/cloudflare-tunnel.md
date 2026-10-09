# Run the API from home with Cloudflare Tunnel

YouTube blocks yt-dlp requests from most cloud IPs (Render, Fly, VPS hosts) with
*"Sign in to confirm you're not a bot"*. When that happens, play and download
fail even though search still works. A home connection usually isn't flagged.
This guide runs the Musika API on your own PC and gives it a public HTTPS URL
with [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/),
so the Vercel web app (and the Android/desktop builds) can keep using it.

```
phone / browser ──HTTPS──▶ Cloudflare ──tunnel──▶ cloudflared on your PC ──▶ API (Docker, :8010)
                                                                            └─▶ YouTube (home IP)
```

You don't need port forwarding, a static IP, or an open firewall port.
`cloudflared` makes an outbound connection to Cloudflare.

**Trade-off:** the PC has to be on and online for the app to play or download
anything. Tracks people already downloaded keep playing offline.

## Pick a tunnel type

| | Quick tunnel | Named tunnel |
|---|---|---|
| Needs | Nothing | A free Cloudflare account and a domain on Cloudflare DNS |
| URL | Random `*.trycloudflare.com`, **changes on every restart** | Fixed, e.g. `https://api.example.com` |
| Use it for | Checking that streaming works from home | Running the app day to day |

The API URL is compiled into the web app at build time (`EXPO_PUBLIC_API_URL`).
Every URL change means a Vercel redeploy and new APK/desktop builds, so use a
**named tunnel** for anything you plan to keep.

## 1. Start the API locally

Follow [README > Or run it in Docker](../README.md#or-run-it-in-docker) first,
so `server/.env` exists with `YOUTUBE_API_KEY` and `FIREBASE_PROJECT_ID`. Then
set these values in `server/.env`. The web app (Vercel) and the API (your tunnel
hostname) are on different sites:

```ini
ENVIRONMENT=production
COOKIE_SAMESITE=none
# The Vercel URL, plus the local dev and desktop origins if you use them.
MUSIKA_ORIGINS=https://musika-app-umber.vercel.app,http://localhost:8081,http://localhost:17321
# Any long random string. Keeps stream links valid across API restarts.
STREAM_SECRET=<output of: python -c "import secrets; print(secrets.token_hex(32))">
# Leave these blank; the home IP is the whole point.
YT_DLP_COOKIES_FILE=
YT_DLP_PROXY=
```

```bash
docker compose up -d --build
```

```bash
curl http://localhost:8010/health
```

The response should be `{"ok":true,"discovery_configured":true}`.

## 2a. Quick tunnel (testing only)

`docker-compose.yml` has a `quick-tunnel` service behind a profile, so you don't
need to install anything:

```bash
docker compose --profile quick-tunnel up -d --build
```

```bash
docker compose logs quick-tunnel
```

Find the `https://<random>.trycloudflare.com` URL in the logs. It can take
10–20 seconds before it answers; until then Cloudflare returns error 1033.
Then go to [step 3](#3-point-the-apps-at-the-tunnel). Stop it with
`docker compose stop quick-tunnel`; the next start gets a new URL.

## 2b. Named tunnel (recommended)

You need a domain whose DNS is managed by Cloudflare (add it under
**Websites → Add a site** and switch the nameservers at your registrar).

### Create the tunnel in the dashboard

1. Open [Cloudflare One](https://one.dash.cloudflare.com/), then **Networks → Tunnels → Create a tunnel**.
2. Choose **Cloudflared** and name it, e.g. `musika-api`.
3. On the install screen, copy the **token** (the long string after
   `--token`). You don't have to run the command it shows.
4. Under **Public hostnames**, add one:
   - **Subdomain:** `api` · **Domain:** your domain
   - **Service type:** `HTTP`
   - **URL:** `api:8000` if you run cloudflared in Docker (option A below),
     or `localhost:8010` if you install it on Windows (option B).
5. Save. Cloudflare creates the DNS record for `api.<your domain>`.

The dashboard labels move around now and then. If a name above doesn't match,
use Cloudflare's [create a tunnel (dashboard)](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/) guide.

### Option A: run cloudflared next to the API in Docker

Put the token in the root `.env`, which docker compose reads automatically. It
is git-ignored; never commit it:

```ini
TUNNEL_TOKEN=<token from step 3>
```

`docker-compose.yml` already defines the `tunnel` service behind a profile:

```bash
docker compose --profile tunnel up -d --build
```

If you stopped a quick tunnel earlier, it stays stopped; only the profiles you
name are started.

`restart: unless-stopped` brings both containers back after a reboot, as long
as Docker Desktop starts on login (**Settings → General → Start Docker Desktop
when you sign in**).

### Option B: install cloudflared as a Windows service

From an **administrator** terminal:

```bash
winget install --id Cloudflare.cloudflared
```

```bash
cloudflared service install <token from step 3>
```

The service starts with Windows. In this case the public hostname must point to
`localhost:8010`, as noted in step 4.

### Check it

```bash
curl https://api.<your domain>/health
```

In the dashboard, the tunnel should show **HEALTHY**.

## 3. Point the apps at the tunnel

1. **Vercel:** go to Project → Settings → Environment Variables, set
   `EXPO_PUBLIC_API_URL=https://api.<your domain>` (no trailing slash), then
   **Redeploy**. Because the value is baked into the build, a redeploy is
   required.
2. **Android / desktop builds:** set the same value in the root `.env` and
   rebuild (see [README > Personal builds](../README.md#personal-builds-android-apk--windows-desktop)).
3. **Firebase:** nothing to change. Sign-in still happens on the Vercel domain,
   which is already an authorized domain.

## 4. Verify play and download

Open the Vercel app, sign in again (sessions live in the API's database, so the
Render sessions don't carry over), then:

- Search for a song and press play. Audio should start within a few seconds.
- Download it. It should move to your library instead of showing
  *"YouTube blocked this server's request with a bot check"*.

If something fails, the server logs the real yt-dlp error:

```bash
docker compose logs -f api
```

## Moving off Render

Users, sessions, libraries and downloaded audio live in the API's SQLite
database and `server/data`, so the home API starts empty. Everyone signs in
again and re-downloads tracks that aren't already saved on their device. Once
the tunnel works, suspend the Render service so you stop paying for it.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Browser console shows a CORS error | The Vercel URL is missing from `MUSIKA_ORIGINS`, or has a trailing slash. Restart the API after editing `server/.env`. |
| Signed in, but every request returns 401 | Session cookie rejected: set `COOKIE_SAMESITE=none` and `ENVIRONMENT=production`. |
| `502 Bad Gateway` from Cloudflare | The tunnel is up but can't reach the API. Is the container running? Does the hostname's service URL match your setup (`api:8000` for Docker, `localhost:8010` for the Windows service)? |
| Bot check still appears | Your ISP's IP may also be flagged (rare). Try exporting cookies (README > Troubleshooting), or check that `YT_DLP_PROXY` isn't routing through a datacenter. |
| Works, then stops overnight | The PC slept. In Windows power settings, set **Sleep** to *Never* while plugged in. |
