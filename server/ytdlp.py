"""Runs yt-dlp for streams and downloads: configuration, throttling, retries,
caching and error classification live here so both paths behave the same.

All yt-dlp configuration comes from server environment variables (never from
clients), and nothing that may hold a secret (cookies, proxy credentials, PO
tokens, signed media URLs) is logged or returned to users.
"""
import asyncio
import base64
import hashlib
import json
import logging
import os
import random
import re
import shutil
import sys
import tempfile
import time
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger('musika.ytdlp')

def env_float(name, default):
    try: return float(os.getenv(name) or default)
    except ValueError: return default

def env_int(name, default):
    return int(env_float(name, default))

class YtDlpError(RuntimeError):
    """A classified yt-dlp failure. str(error) is safe to show to users."""
    def __init__(self, kind, message, status=502, retry_after=None):
        super().__init__(message)
        self.kind, self.status, self.retry_after = kind, status, retry_after

# kind: (patterns in yt-dlp's stderr, retry this attempt?, HTTP status, user message)
# Order matters: the first match wins.
KINDS = {
    'bot_check': ([r"confirm you.?re not a bot", r'Sign in to confirm(?! your age)'], False, 503,
                  "YouTube blocked this server's request with a bot check. Try again later."),
    'rate_limited': ([r'HTTP Error 429', r'Too Many Requests', r"This content isn.?t available, try again later"], False, 503,
                     'YouTube is rate-limiting this server. Try again in a few minutes.'),
    'proxy': ([r'Unable to connect to proxy', r'ProxyError', r'Tunnel connection failed'], False, 502,
              "The server's connection to YouTube isn't working. Try again later."),
    'age_restricted': ([r'Sign in to confirm your age', r'age.restricted', r'inappropriate for some users'], False, 403,
                       'This video is age-restricted on YouTube, so it cannot be played here.'),
    'unavailable': ([r'Private video', r'Video unavailable', r'This video is unavailable', r'has been removed',
                     r'not available in your country', r'blocked it in your country', r'members.only', r'Join this channel',
                     r'copyright', r'This live event', r'is_live', r'does not pass filter'], False, 404,
                    'This video is unavailable on YouTube (private, removed, live or region-locked).'),
    'forbidden': ([r'HTTP Error 403', r'403: Forbidden'], True, 502,
                  'YouTube refused the audio stream. Try again in a moment.'),
    'extractor': ([r'Requested format is not available', r'Only images are available', r'Signature extraction failed',
                   r'n challenge', r'nsig', r'Unable to extract', r'JavaScript runtime', r'PO Token'], False, 502,
                  "This server's YouTube extractor needs an update. Try again later."),
    'timeout': ([r'timed out', r'TimeoutError'], True, 504,
                'YouTube took too long to respond. Try again.'),
    'network': ([r'Connection reset', r'Connection refused', r'Temporary failure in name resolution', r'Name or service not known',
                 r'Network is unreachable', r'Unable to download (webpage|API page)', r'HTTP Error 5\d\d', r'IncompleteRead',
                 r'Remote end closed'], True, 502,
                "The server couldn't reach YouTube. Try again."),
}
# A block applies to this server's IP or account, so failing fast beats retrying.
COOLDOWN_KINDS = ('bot_check', 'rate_limited')
# Per-video failures that won't change soon; cached so they aren't re-extracted.
NEGATIVE_KINDS = ('unavailable', 'age_restricted')

def error_lines(stderr):
    lines = [l.strip() for l in stderr.splitlines() if l.strip()]
    errors = [l for l in lines if l.startswith('ERROR')]
    return errors or lines[-1:]

def classify(stderr):
    text = '\n'.join(error_lines(stderr))
    for kind, (patterns, retryable, status, message) in KINDS.items():
        if any(re.search(p, text, re.I) for p in patterns):
            return kind, retryable, status, message
    return 'unknown', False, 502, None

SECRETS = [
    (re.compile(r'(https?://)[^/\s:@]+:[^/\s@]+@'), r'\1***@'),            # credentials in URLs (proxies)
    (re.compile(r'(https?://[^\s?"\']+)\?[^\s"\']*'), r'\1?…'),          # signed query strings (googlevideo, tokens)
    (re.compile(r'(po_token|visitor_data|data_sync_id)[=:]\S+', re.I), r'\1=***'),
    (re.compile(r'(cookie|authorization|x-goog-[\w-]+)\s*[:=]\s*\S+', re.I), r'\1: ***'),
]

def redact(text):
    for pattern, replacement in SECRETS:
        text = pattern.sub(replacement, text)
    return text

class LRUCache(OrderedDict):
    """A dict bounded to `size` entries, evicting the least recently used."""
    def __init__(self, size):
        super().__init__()
        self.size = size
    def get(self, key, default=None):
        if key not in self: return default
        self.move_to_end(key)
        return self[key]
    def __setitem__(self, key, value):
        super().__setitem__(key, value)
        self.move_to_end(key)
        while len(self) > self.size: self.popitem(last=False)

def ffmpeg_binary():
    configured = os.getenv('FFMPEG_PATH') or shutil.which('ffmpeg')
    if configured:
        return configured
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

def cookie_jar():
    """Path of a private, writable copy of the operator's YouTube cookies, or None.

    Accepts a file (YT_DLP_COOKIES_FILE, e.g. a Render secret file) or the file's
    contents base64-encoded (YT_DLP_COOKIES_B64, for hosts like Railway that only
    have environment variables). yt-dlp rewrites the jar after each run and
    secret files are read-only, hence the copy.
    """
    jar = Path(tempfile.gettempdir())/'musika-youtube-cookies.txt'
    source, encoded = os.getenv('YT_DLP_COOKIES_FILE'), os.getenv('YT_DLP_COOKIES_B64')
    if source:
        if not jar.exists() or jar.stat().st_mtime < Path(source).stat().st_mtime:
            shutil.copyfile(source, jar)
    elif encoded:
        digest = hashlib.sha256(encoded.encode()).hexdigest()
        marker = jar.with_suffix('.sha256')
        if not jar.exists() or not marker.exists() or marker.read_text() != digest:
            jar.write_bytes(base64.b64decode(encoded))
            marker.write_text(digest)
    else:
        return None
    jar.chmod(0o600)
    return jar

def base_command():
    """yt-dlp plus the operator's options. Never accepts client input."""
    command = [os.environ['YT_DLP_PATH']] if os.getenv('YT_DLP_PATH') else [sys.executable, '-m', 'yt_dlp']
    command += ['--ignore-config', '--no-playlist', '--socket-timeout', str(env_int('YT_DLP_SOCKET_TIMEOUT', 30))]
    jar = cookie_jar()
    if jar: command += ['--cookies', str(jar)]
    if os.getenv('YT_DLP_PROXY'): command += ['--proxy', os.environ['YT_DLP_PROXY']]
    if env_float('YT_DLP_SLEEP_REQUESTS', 0) > 0: command += ['--sleep-requests', str(env_float('YT_DLP_SLEEP_REQUESTS', 0))]
    # The PO Token provider is a yt-dlp plugin (installed in the image), so plugins
    # are only loaded when it's configured; otherwise none are.
    pot = os.getenv('YT_DLP_POT_PROVIDER_URL')
    if pot: command += ['--extractor-args', f'youtubepot-bgutilhttp:base_url={pot}']
    else: command += ['--no-plugin-dirs']
    if os.getenv('YT_DLP_EXTRACTOR_ARGS'): command += ['--extractor-args', os.environ['YT_DLP_EXTRACTOR_ARGS']]
    return command

def config_fingerprint():
    """Changes when the operator changes anything that could lift a block."""
    parts = [os.getenv(k, '') for k in ('YT_DLP_PROXY', 'YT_DLP_COOKIES_B64', 'YT_DLP_EXTRACTOR_ARGS', 'YT_DLP_POT_PROVIDER_URL')]
    source = os.getenv('YT_DLP_COOKIES_FILE')
    if source and Path(source).exists(): parts.append(str(Path(source).stat().st_mtime))
    return hashlib.sha256('\0'.join(parts).encode()).hexdigest()

def trim_info(info):
    """Keeps what --load-info-json needs to download audio (~15 KB instead of ~120 KB)."""
    trimmed = {k: v for k, v in info.items() if k not in ('automatic_captions', 'subtitles', 'heatmap', 'thumbnails', 'requested_formats', 'url', 'http_headers')}
    trimmed['formats'] = [f for f in info.get('formats', []) if f.get('vcodec') == 'none' and f.get('acodec') not in (None, 'none')]
    return trimmed

def url_expiry(url, default):
    match = re.search(r'[?&]expire=(\d+)', url or '')
    return int(match.group(1)) if match else default

class YtDlpRunner:
    def __init__(self):
        self.concurrency = asyncio.Semaphore(env_int('YT_DLP_MAX_CONCURRENCY', 4))
        self.spacing = asyncio.Lock()
        self.last_start = 0.0
        self.blocked = None  # (until, error, config fingerprint)
        self.info = LRUCache(200)  # video id -> (expires, trimmed info) for --load-info-json
        self.unavailable = LRUCache(500)  # video id -> (until, error)
        self.stats = {'last_success': None, 'last_error': None, 'last_error_at': None}
        self._version = None

    def check_blocked(self, video_id=None):
        if self.blocked:
            until, error, fingerprint = self.blocked
            if time.time() >= until or fingerprint != config_fingerprint():
                self.blocked = None
            else:
                error.retry_after = int(until - time.time()) + 1
                raise error
        if video_id:
            cached = self.unavailable.get(video_id)
            if cached and cached[0] > time.time():
                raise cached[1]

    async def throttle(self):
        # Spaces process starts so bursts (a queued playlist, rapid skips) don't hammer YouTube.
        async with self.spacing:
            wait = self.last_start + env_float('YT_DLP_MIN_INTERVAL', 1.0) - time.monotonic()
            if wait > 0: await asyncio.sleep(wait)
            self.last_start = time.monotonic()

    async def attempt(self, args, timeout):
        async with self.concurrency:
            await self.throttle()
            process = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            try:
                out, err = await asyncio.wait_for(process.communicate(), timeout)
                return process.returncode, out, err.decode(errors='replace')
            except asyncio.TimeoutError:
                return None, b'', 'ERROR: yt-dlp timed out'
            finally:
                if process.returncode is None:
                    process.kill()
                    await process.wait()

    async def run(self, args, *, video_id, purpose, timeout, attempts=None):
        """Runs `base_command() + args` with bounded retries; returns stdout bytes.

        Raises YtDlpError. Blocks (bot check, rate limit) start a cooldown during
        which calls fail fast; unavailable videos are remembered for an hour.
        """
        self.check_blocked(video_id)
        attempts = attempts or env_int('YT_DLP_MAX_ATTEMPTS', 3)
        command = base_command() + args
        for attempt in range(1, attempts + 1):
            started = time.monotonic()
            code, out, err = await self.attempt(command, timeout)
            elapsed = int((time.monotonic() - started) * 1000)
            for line in err.splitlines():
                # Surfaced so operators notice expiring cookies or PO token trouble.
                if line.startswith('WARNING') and re.search(r'cookies|po.?token|js runtime|challenge', line, re.I):
                    log.warning('event=ytdlp.warning purpose=%s video=%s detail="%s"', purpose, video_id, redact(line)[:300])
            if code == 0:
                self.stats['last_success'] = datetime.now(timezone.utc).isoformat()
                log.info('event=ytdlp.ok purpose=%s video=%s attempt=%d/%d elapsed_ms=%d', purpose, video_id, attempt, attempts, elapsed)
                return out
            kind, retryable, status, message = classify(err)
            detail = redact(' | '.join(error_lines(err)))[:500]
            log.warning('event=ytdlp.failure purpose=%s video=%s kind=%s attempt=%d/%d elapsed_ms=%d exit=%s detail="%s"',
                        purpose, video_id, kind, attempt, attempts, elapsed, code, detail)
            self.stats.update(last_error=kind, last_error_at=datetime.now(timezone.utc).isoformat())
            if not retryable or attempt == attempts:
                break
            delay = min(env_float('YT_DLP_BACKOFF_SECONDS', 2) * 2 ** (attempt - 1), 30) + random.uniform(0, 1)
            await asyncio.sleep(delay)
        if kind == 'unknown':
            # Unrecognized: show yt-dlp's own (redacted) reason, as before.
            message = f"Couldn't get this track from YouTube. {redact(error_lines(err)[-1] if err.strip() else '')[:200]}".strip()
        error = YtDlpError(kind, message, status)
        if kind in COOLDOWN_KINDS:
            cooldown = env_float('YT_DLP_BLOCK_COOLDOWN', 600)
            self.blocked = (time.time() + cooldown, error, config_fingerprint())
            error.retry_after = int(cooldown)
            log.error('event=ytdlp.blocked kind=%s cooldown_s=%d', kind, cooldown)
        if kind in NEGATIVE_KINDS and video_id:
            self.unavailable[video_id] = (time.time() + 3600, error)
        raise error

    def remember(self, video_id, info):
        url = info.get('url') or next((f.get('url') for f in info.get('formats', []) if f.get('url')), '')
        self.info[video_id] = (url_expiry(url, time.time() + 3600) - 300, trim_info(info))

    def cached_info(self, video_id):
        cached = self.info.get(video_id)
        return cached[1] if cached and cached[0] > time.time() else None

    def version(self):
        if self._version is None:
            try:
                from importlib.metadata import version
                self._version = 'external' if os.getenv('YT_DLP_PATH') else version('yt-dlp')
            except Exception:
                self._version = 'missing'
        return self._version

    def health(self):
        """Operator diagnostics: booleans and versions only, never secret values."""
        blocked_for = 0
        try: self.check_blocked()
        except YtDlpError as error: blocked_for = error.retry_after or 0
        return {
            'status': 'blocked' if blocked_for else ('degraded' if self.stats['last_error'] and (self.stats['last_error_at'] or '') > (self.stats['last_success'] or '') else 'ok'),
            'blocked_for_seconds': blocked_for,
            'blocked_reason': self.blocked[1].kind if blocked_for else None,
            'yt_dlp': self.version(),
            'ffmpeg': bool(os.getenv('FFMPEG_PATH') or shutil.which('ffmpeg')),
            'js_runtime': bool(shutil.which('deno')),
            'cookies': bool(os.getenv('YT_DLP_COOKIES_FILE') or os.getenv('YT_DLP_COOKIES_B64')),
            'proxy': bool(os.getenv('YT_DLP_PROXY')),
            'po_token_provider': bool(os.getenv('YT_DLP_POT_PROVIDER_URL')),
            **self.stats,
        }

runner = YtDlpRunner()
