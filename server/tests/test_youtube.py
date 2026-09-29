import asyncio
import os
import unittest
from unittest.mock import AsyncMock,patch
from server.youtube import YouTubeService

class YouTubeTests(unittest.IsolatedAsyncioTestCase):
    async def test_search_filters_music_and_passes_page_tokens(self):
        service=YouTubeService()
        service.request=AsyncMock(return_value={'items':[{'id':{'videoId':'abcdefghijk'}}],'nextPageToken':'NEXT'})
        service.getVideos=AsyncMock(return_value=[{'id':'abcdefghijk','classification':'MUSIC'},{'id':'other','classification':'NOT_MUSIC'}])
        result=await service.searchMusic('song','PAGE')
        service.request.assert_awaited_once_with('search',part='snippet',type='video',videoCategoryId='10',q='song',maxResults=20,pageToken='PAGE')
        self.assertEqual(result['nextPageToken'],'NEXT');self.assertEqual(len(result['items']),1)
    async def test_search_skips_results_without_a_video_id(self):
        # YouTube's search API occasionally returns non-video items even with
        # type=video; these must be skipped rather than crashing the request.
        service=YouTubeService()
        service.request=AsyncMock(return_value={'items':[{'id':{'kind':'youtube#channel','channelId':'x'}},{'id':{'videoId':'abcdefghijk'}}]})
        service.getVideos=AsyncMock(return_value=[{'id':'abcdefghijk','classification':'MUSIC'}])
        result=await service.searchMusic('song')
        service.getVideos.assert_awaited_once_with(['abcdefghijk'])
        self.assertEqual(len(result['items']),1)
    async def test_metadata_requests_batch_at_fifty(self):
        service=YouTubeService();service.request=AsyncMock(return_value={'items':[]})
        await service.getVideos([f'{i:011d}' for i in range(115)])
        self.assertEqual(service.request.await_count,3)
        self.assertEqual([len(c.kwargs['id'].split(',')) for c in service.request.await_args_list],[50,50,15])
    async def test_concurrent_identical_requests_share_quota_and_cache(self):
        count=0
        class Response:
            status_code=200
            def json(self):return {'items':[]}
        class Client:
            def __init__(self,**kwargs):pass
            async def __aenter__(self):return self
            async def __aexit__(self,*args):pass
            async def get(self,*args,**kwargs):
                nonlocal count
                count+=1;await asyncio.sleep(.03);return Response()
        service=YouTubeService()
        with patch.dict(os.environ,{'YOUTUBE_API_KEY':'test-key'}),patch('server.youtube.httpx.AsyncClient',Client):
            await asyncio.gather(*[service.request('videos',id='abcdefghijk') for _ in range(8)])
            await service.request('videos',id='abcdefghijk')
        self.assertEqual(count,1)
