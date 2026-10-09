import base64
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from server import main
from server.downloads import YtDlpService
from server.ytdlp import LRUCache, YtDlpError, YtDlpRunner, base_command, classify, redact, trim_info

BOT = "ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies"
FAST = {'YT_DLP_MIN_INTERVAL': '0', 'YT_DLP_BACKOFF_SECONDS': '0', 'YT_DLP_PROXY': '', 'YT_DLP_COOKIES_FILE': '',
        'YT_DLP_COOKIES_B64': '', 'YT_DLP_EXTRACTOR_ARGS': '', 'YT_DLP_POT_PROVIDER_URL': '', 'YT_DLP_SLEEP_REQUESTS': ''}

def scripted(runner, results):
    """Replaces the subprocess with scripted (exit code, stdout, stderr) results."""
    calls = []
    async def attempt(args, timeout):
        calls.append(args)
        return results.pop(0)
    runner.attempt = attempt
    return calls

class ClassifyTests(unittest.TestCase):
    def test_known_failures(self):
        cases = {
            BOT: 'bot_check',
            'ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.': 'age_restricted',
            'ERROR: unable to download video data: HTTP Error 429: Too Many Requests': 'rate_limited',
            "ERROR: [youtube] abc: This content isn't available, try again later.": 'rate_limited',
            'ERROR: unable to download video data: HTTP Error 403: Forbidden': 'forbidden',
            'ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access': 'unavailable',
            'ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader': 'unavailable',
            'ERROR: [youtube] abc: Requested format is not available. Use --list-formats': 'extractor',
            'ERROR: [youtube] abc: Unable to download webpage: The read operation timed out': 'timeout',
            'ERROR: [youtube] abc: Unable to download API page: HTTP Error 503: Service Unavailable': 'network',
            'ERROR: Unable to connect to proxy': 'proxy',
            'ERROR: something new': 'unknown',
        }
        for stderr, kind in cases.items():
            with self.subTest(kind=kind):
                self.assertEqual(classify('WARNING: noise\n' + stderr)[0], kind)

    def test_warnings_do_not_change_the_classification(self):
        self.assertEqual(classify('WARNING: [youtube] PO Token missing\nERROR: Video unavailable')[0], 'unavailable')

    def test_redact_hides_secrets(self):
        text = redact('proxy http://bob:hunter2@proxy.example:8080 failed; url https://rr1.googlevideo.com/videoplayback?ip=1.2.3.4&sig=XYZ '
                      'po_token=web.gvs+SECRET Cookie: SID=abc123')
        for secret in ('hunter2', '1.2.3.4', 'XYZ', 'SECRET', 'abc123'):
            self.assertNotIn(secret, text)
        self.assertIn('proxy.example', text)

class CommandTests(unittest.TestCase):
    def test_defaults_disable_plugins_and_add_no_secrets(self):
        with patch.dict(os.environ, FAST):
            command = base_command()
        self.assertIn('--no-plugin-dirs', command)
        self.assertFalse({'--cookies', '--proxy', '--extractor-args', '--sleep-requests'} & set(command))

    def test_operator_options(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        source = Path(temp.name)/'cookies.txt'; source.write_text('# Netscape HTTP Cookie File\n')
        env = {**FAST, 'YT_DLP_COOKIES_FILE': str(source), 'YT_DLP_PROXY': 'http://proxy.example:8080',
               'YT_DLP_EXTRACTOR_ARGS': 'youtube:player_client=default,mweb', 'YT_DLP_POT_PROVIDER_URL': 'http://pot:4416',
               'YT_DLP_SLEEP_REQUESTS': '1.5'}
        with patch.dict(os.environ, env):
            command = base_command()
        jar = Path(command[command.index('--cookies')+1]); self.addCleanup(jar.unlink, missing_ok=True)
        self.assertNotEqual(jar, source); self.assertEqual(jar.read_text(), source.read_text())
        self.assertEqual(command[command.index('--proxy')+1], 'http://proxy.example:8080')
        self.assertIn('youtubepot-bgutilhttp:base_url=http://pot:4416', command)
        self.assertIn('youtube:player_client=default,mweb', command)
        self.assertEqual(command[command.index('--sleep-requests')+1], '1.5')
        self.assertNotIn('--no-plugin-dirs', command)  # the PO Token provider is a plugin

    def test_cookies_from_base64_env(self):
        content = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n'
        with patch.dict(os.environ, {**FAST, 'YT_DLP_COOKIES_B64': base64.b64encode(content.encode()).decode()}):
            command = base_command()
        jar = Path(command[command.index('--cookies')+1]); self.addCleanup(jar.unlink, missing_ok=True)
        self.addCleanup(jar.with_suffix('.sha256').unlink, missing_ok=True)
        self.assertEqual(jar.read_text(), content)

class RunnerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, FAST); self.env.start(); self.addCleanup(self.env.stop)
        self.runner = YtDlpRunner()

    async def test_transient_errors_retry_with_bounded_attempts(self):
        calls = scripted(self.runner, [(1, b'', 'ERROR: timed out'), (1, b'', 'ERROR: HTTP Error 503'), (0, b'{}', '')])
        self.assertEqual(await self.runner.run(['x'], video_id='abcdefghijk', purpose='test', timeout=1, attempts=3), b'{}')
        self.assertEqual(len(calls), 3)
        scripted(self.runner, [(1, b'', 'ERROR: timed out')] * 2)
        with self.assertRaises(YtDlpError) as raised, self.assertLogs('musika.ytdlp', 'WARNING'):
            await self.runner.run(['x'], video_id='abcdefghijk', purpose='test', timeout=1, attempts=2)
        self.assertEqual((raised.exception.kind, raised.exception.status), ('timeout', 504))

    async def test_bot_check_fails_fast_during_cooldown(self):
        calls = scripted(self.runner, [(1, b'', BOT)])
        with self.assertRaises(YtDlpError) as raised, self.assertLogs('musika.ytdlp', 'WARNING'):
            await self.runner.run(['x'], video_id='abcdefghijk', purpose='test', timeout=1)
        self.assertEqual(len(calls), 1)  # not retried
        self.assertIn('bot check', str(raised.exception)); self.assertGreater(raised.exception.retry_after, 0)
        with self.assertRaises(YtDlpError):
            await self.runner.run(['x'], video_id='bbbbbbbbbbb', purpose='test', timeout=1)
        self.assertEqual(len(calls), 1)  # blocked without contacting YouTube
        self.assertEqual(self.runner.health()['status'], 'blocked')
        # New operator config (e.g. fresh cookies) lifts the block immediately.
        with patch.dict(os.environ, {'YT_DLP_PROXY': 'http://proxy.example:8080'}):
            scripted(self.runner, [(0, b'ok', '')])
            self.assertEqual(await self.runner.run(['x'], video_id='bbbbbbbbbbb', purpose='test', timeout=1), b'ok')

    async def test_unavailable_video_is_remembered(self):
        calls = scripted(self.runner, [(1, b'', 'ERROR: [youtube] abc: Private video')])
        for _ in range(2):
            with self.assertRaises(YtDlpError) as raised, self.assertNoLogs('musika.ytdlp', 'ERROR'):
                await self.runner.run(['x'], video_id='abcdefghijk', purpose='test', timeout=1)
            self.assertEqual(raised.exception.status, 404)
        self.assertEqual(len(calls), 1)

    async def test_unknown_errors_show_redacted_detail(self):
        scripted(self.runner, [(1, b'', 'ERROR: weird https://bob:pw@host.example/a?token=zzz')])
        with self.assertRaises(YtDlpError) as raised, self.assertLogs('musika.ytdlp', 'WARNING') as logs:
            await self.runner.run(['x'], video_id='abcdefghijk', purpose='test', timeout=1)
        for text in (str(raised.exception), '\n'.join(logs.output)):
            self.assertIn('weird', text); self.assertNotIn('pw', text); self.assertNotIn('zzz', text)

    async def test_real_subprocess_timeout_is_classified(self):
        runner = YtDlpRunner()
        with patch('server.ytdlp.base_command', return_value=[os.sys.executable, '-c', 'import time; time.sleep(5)']), \
             self.assertRaises(YtDlpError) as raised, self.assertLogs('musika.ytdlp', 'WARNING'):
            await runner.run([], video_id='abcdefghijk', purpose='test', timeout=0.5, attempts=1)
        self.assertEqual(raised.exception.kind, 'timeout')

class CacheTests(unittest.IsolatedAsyncioTestCase):
    def test_lru_is_bounded(self):
        cache = LRUCache(2); cache['a'] = 1; cache['b'] = 2; cache.get('a'); cache['c'] = 3
        self.assertEqual(list(cache), ['a', 'c'])

    def test_trim_keeps_audio_formats_only(self):
        info = {'id': 'x', 'url': 'u', 'subtitles': {'en': []}, 'formats': [
            {'format_id': '140', 'vcodec': 'none', 'acodec': 'mp4a', 'url': 'a'},
            {'format_id': '137', 'vcodec': 'avc1', 'acodec': 'none', 'url': 'v'}]}
        trimmed = trim_info(info)
        self.assertEqual([f['format_id'] for f in trimmed['formats']], ['140'])
        self.assertNotIn('subtitles', trimmed); self.assertNotIn('url', trimmed)

    async def test_download_reuses_extracted_info_and_falls_back(self):
        temp = tempfile.TemporaryDirectory(); self.addCleanup(temp.cleanup)
        directory = Path(temp.name)
        with patch.dict(os.environ, FAST):
            runner = YtDlpRunner()
            runner.remember('abcdefghijk', {'url': f'https://media.example/a?expire={int(time.time())+3600}', 'formats': []})
            seen = []
            async def run(args, **kw):
                seen.append(kw['purpose'])
                if kw['purpose'] == 'download-cached': raise YtDlpError('forbidden', 'nope')
                (directory/'source.m4a').write_bytes(b'audio')
                return b''
            runner.run = run
            source = await YtDlpService(runner).extract('abcdefghijk', directory)
        self.assertEqual(seen, ['download-cached', 'download'])
        self.assertEqual(source.name, 'source.m4a')
        self.assertIsNone(runner.cached_info('abcdefghijk'))  # stale cache dropped

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.original = main.runner.blocked
        main.app.dependency_overrides[main.session] = lambda: 'alice'
        self.client = TestClient(main.app)

    def tearDown(self):
        main.runner.blocked = self.original
        main.app.dependency_overrides.clear()

    def test_health_reports_extractor_without_secrets(self):
        with patch.dict(os.environ, {'YT_DLP_PROXY': 'http://bob:hunter2@proxy.example:1'}):
            body = self.client.get('/health').json()
        self.assertTrue(body['ok'])
        self.assertTrue(body['extractor']['proxy'])
        self.assertNotIn('hunter2', str(body))
        for key in ('yt_dlp', 'ffmpeg', 'js_runtime', 'cookies', 'po_token_provider', 'status'):
            self.assertIn(key, body['extractor'])

    def test_blocked_server_refuses_with_retry_after(self):
        from server.ytdlp import config_fingerprint
        main.runner.blocked = (time.time() + 120, YtDlpError('bot_check', 'YouTube blocked this server', 503), config_fingerprint())
        for response in (self.client.get('/stream/abcdefghijk'), self.client.post('/downloads', json={'video_id': 'abcdefghijk'})):
            self.assertEqual(response.status_code, 503)
            self.assertIn('blocked', response.json()['detail'])
            self.assertTrue(0 < int(response.headers['retry-after']) <= 121)
        self.assertEqual(self.client.get('/health').json()['extractor']['status'], 'blocked')

if __name__ == '__main__':
    unittest.main()
