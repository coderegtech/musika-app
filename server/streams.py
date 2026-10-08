import asyncio
import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import time
from urllib.parse import parse_qs, urlparse
import httpx

# googlevideo throttles long open-ended reads, so the relay serves bounded
# chunks; media players request the next range on their own.
CHUNK = 4 * 1024 * 1024
LINK_TTL = 6 * 3600

class StreamService:
    """Resolves a video's audio-only stream with yt-dlp and relays its bytes.

    YouTube binds stream URLs to the IP that resolved them, so clients can't
    fetch them directly; the server proxies them with Range support instead.
    """

    def __init__(self, secret=None):
        self.secret = (secret or os.getenv('STREAM_SECRET') or secrets.token_hex(32)).encode()
        self.cache = {}
        self.pending = {}
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(30, read=60), follow_redirects=True)

    def link(self, video_id, now=None):
        expires = int((now or time.time()) + LINK_TTL)
        return f'/stream/{video_id}/audio?exp={expires}&sig={self.signature(video_id, expires)}'

    def signature(self, video_id, expires):
        return hmac.new(self.secret, f'{video_id}:{expires}'.encode(), hashlib.sha256).hexdigest()

    def verify(self, video_id, expires, signature):
        return expires > time.time() and hmac.compare_digest(self.signature(video_id, expires), signature)

    async def extract(self, video_id):
        # Fixed arguments only, as in YtDlpService: no client URLs, cookies or extractor arguments.
        executable = [os.environ['YT_DLP_PATH']] if os.getenv('YT_DLP_PATH') else [sys.executable, '-m', 'yt_dlp']
        process = await asyncio.create_subprocess_exec(
            *executable, '--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-warnings', '--socket-timeout', '30',
            '--match-filter', '!is_live', '-f', 'bestaudio[ext=m4a]/bestaudio', '-j',
            '--', 'https://www.youtube.com/watch?v=' + video_id,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            out, err = await asyncio.wait_for(process.communicate(), 90)
        except asyncio.TimeoutError:
            process.kill()
            raise RuntimeError('YouTube took too long to respond.')
        if process.returncode or not out.strip():
            lines = err.decode(errors='replace').strip().splitlines()
            raise RuntimeError(lines[-1] if lines else 'This track cannot be streamed.')
        info = json.loads(out)
        url = info['url']
        expire = int(parse_qs(urlparse(url).query).get('expire', [time.time() + 3600])[0])
        return {
            'url': url,
            'headers': info.get('http_headers') or {},
            'type': 'audio/mp4' if info.get('ext') == 'm4a' else 'audio/webm',
            'size': info.get('filesize'),
            'expires': expire - 300,
        }

    async def resolve(self, video_id, fresh=False):
        cached = self.cache.get(video_id)
        if cached and not fresh and cached['expires'] > time.time():
            return cached
        # Concurrent range requests for the same track share one yt-dlp run.
        if video_id not in self.pending:
            self.pending[video_id] = asyncio.ensure_future(self.extract(video_id))
        try:
            info = await self.pending[video_id]
        finally:
            self.pending.pop(video_id, None)
        self.cache[video_id] = info
        return info

    @staticmethod
    def byte_range(header, size):
        match = re.fullmatch(r'bytes=(\d+)-(\d*)', (header or '').strip())
        start = int(match.group(1)) if match else 0
        end = int(match.group(2)) if match and match.group(2) else start + CHUNK - 1
        end = min(end, start + CHUNK - 1)
        if size: end = min(end, size - 1)
        return start, end

    async def open(self, video_id, range_header):
        """Returns (upstream response, start, end, info). The caller must close the response."""
        for attempt in range(2):
            info = await self.resolve(video_id, fresh=attempt > 0)
            start, end = self.byte_range(range_header, info['size'])
            if info['size'] and start >= info['size']:
                return None, start, end, info
            request = self.client.build_request('GET', info['url'], headers={**info['headers'], 'Range': f'bytes={start}-{end}'})
            upstream = await self.client.send(request, stream=True)
            if upstream.status_code in (200, 206):
                return upstream, start, end, info
            await upstream.aclose()
            # 403/410 means the signed URL expired or was revoked: resolve once more.
            self.cache.pop(video_id, None)
        raise RuntimeError('YouTube refused the stream.')

    async def close(self):
        await self.client.aclose()
