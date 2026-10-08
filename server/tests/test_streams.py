import time
import unittest
import httpx
from fastapi.testclient import TestClient
from server import main
from server.streams import CHUNK, StreamService

AUDIO = bytes(range(256)) * 64

def upstream(calls, refuse_first=False):
    def handler(request):
        calls.append(request)
        if refuse_first and len(calls) == 1:
            return httpx.Response(403)
        start, end = map(int, request.headers['range'].removeprefix('bytes=').split('-'))
        body = AUDIO[start:end+1]
        return httpx.Response(206, stream=httpx.ByteStream(body), headers={'Content-Length': str(len(body)), 'Content-Range': f'bytes {start}-{end}/{len(AUDIO)}'})
    return handler

class StreamTests(unittest.TestCase):
    def setUp(self):
        self.original = main.streams
        self.calls, self.extracts = [], []
        self.service = StreamService(secret='test')
        async def extract(video_id):
            self.extracts.append(video_id)
            return {'url': f'https://media.example/{len(self.extracts)}', 'headers': {}, 'type': 'audio/mp4', 'size': len(AUDIO), 'expires': time.time() + 3600}
        self.service.extract = extract
        main.streams = self.service
        main.app.dependency_overrides[main.session] = lambda: 'alice'
        self.client = TestClient(main.app)

    def tearDown(self):
        main.streams = self.original
        main.app.dependency_overrides.clear()

    def use(self, handler):
        self.service.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    def test_signed_link_rejects_tampering_and_expiry(self):
        link = self.service.link('abcdefghijk')
        query = dict(p.split('=') for p in link.split('?')[1].split('&'))
        self.assertTrue(self.service.verify('abcdefghijk', int(query['exp']), query['sig']))
        self.assertFalse(self.service.verify('zzzzzzzzzzz', int(query['exp']), query['sig']))
        expired = int(time.time()) - 1
        self.assertFalse(self.service.verify('abcdefghijk', expired, self.service.signature('abcdefghijk', expired)))

    def test_byte_range_is_bounded(self):
        self.assertEqual(StreamService.byte_range(None, None), (0, CHUNK - 1))
        self.assertEqual(StreamService.byte_range('bytes=10-', 100), (10, 99))
        self.assertEqual(StreamService.byte_range('bytes=5-9', 100), (5, 9))
        self.assertEqual(StreamService.byte_range('bytes=0-', CHUNK * 3), (0, CHUNK - 1))

    def test_link_requires_session_and_valid_id(self):
        main.app.dependency_overrides.clear()
        self.assertEqual(self.client.get('/stream/abcdefghijk').status_code, 401)
        main.app.dependency_overrides[main.session] = lambda: 'alice'
        self.assertEqual(self.client.get('/stream/bad;id').status_code, 400)
        self.assertTrue(self.client.get('/stream/abcdefghijk').json()['url'].startswith('/stream/abcdefghijk/audio?exp='))

    def test_audio_relays_requested_range(self):
        self.use(upstream(self.calls))
        url = self.client.get('/stream/abcdefghijk').json()['url']
        response = self.client.get(url, headers={'Range': 'bytes=100-199'})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, AUDIO[100:200])
        self.assertEqual(response.headers['content-range'], f'bytes 100-199/{len(AUDIO)}')
        self.assertEqual(response.headers['content-type'], 'audio/mp4')
        self.assertEqual(self.client.get(url, headers={'Range': f'bytes={len(AUDIO)}-'}).status_code, 416)

    def test_bad_signature_never_reaches_youtube(self):
        self.use(upstream(self.calls))
        self.assertEqual(self.client.get('/stream/abcdefghijk/audio?exp=9999999999&sig=nope').status_code, 403)
        self.assertEqual(self.calls, [])

    def test_expired_youtube_url_is_resolved_again(self):
        self.use(upstream(self.calls, refuse_first=True))
        url = self.client.get('/stream/abcdefghijk').json()['url']
        response = self.client.get(url, headers={'Range': 'bytes=0-9'})
        self.assertEqual(response.content, AUDIO[:10])
        self.assertEqual(len(self.extracts), 2)
        self.assertEqual(str(self.calls[-1].url), 'https://media.example/2')

if __name__ == '__main__':
    unittest.main()
