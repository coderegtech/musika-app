import asyncio
import os
import time
import httpx
from fastapi import HTTPException
from .domain import MetadataService

class YouTubeService:
    def __init__(self):
        self.cache = {}
        self.pending = {}

    async def request(self, resource, **params):
        key = resource + repr(sorted(params.items()))
        cached = self.cache.get(key)
        if cached and cached[0] > time.monotonic():
            return cached[1]
        if key in self.pending:
            return await asyncio.shield(self.pending[key])
        async def fetch():
            api_key = os.getenv('YOUTUBE_API_KEY')
            if not api_key:
                raise HTTPException(503, 'YouTube discovery is not configured. Add YOUTUBE_API_KEY on the server.')
            async with httpx.AsyncClient(timeout=20) as client:
                result = await client.get('https://www.googleapis.com/youtube/v3/' + resource, params={**params,'key':api_key})
            if result.status_code != 200:
                raise HTTPException(429 if result.status_code == 403 else 502, 'YouTube is unavailable or its quota has been reached. Try again later.')
            data = result.json()
            if len(self.cache) >= 500:
                self.cache.pop(next(iter(self.cache)))
            self.cache[key] = (time.monotonic()+300, data)
            return data
        task = asyncio.create_task(fetch())
        self.pending[key] = task
        try:
            return await asyncio.shield(task)
        finally:
            task.add_done_callback(lambda _: self.pending.pop(key, None))

    async def getVideos(self, ids):
        videos = []
        for start in range(0,len(ids),50):
            if ids[start:start+50]:
                data = await self.request('videos', part='snippet,contentDetails,topicDetails', id=','.join(ids[start:start+50]))
                videos.extend(MetadataService.transform(v) for v in data.get('items', []))
        return videos

    async def getVideo(self, video_id):
        videos = await self.getVideos([video_id])
        if not videos:
            raise HTTPException(404, 'This video is unavailable.')
        return videos[0]

    getMusicMetadata = getVideo

    async def searchMusic(self, query, page=''):
        result = await self.request('search', part='snippet', type='video', videoCategoryId='10', q=query, maxResults=20, pageToken=page)
        ids = [v['id']['videoId'] for v in result.get('items',[]) if v.get('id',{}).get('videoId')]
        tracks = await self.getVideos(ids)
        return {'items': sorted([t for t in tracks if t['classification'] != 'NOT_MUSIC'], key=lambda t:t['classification']!='MUSIC'), 'nextPageToken':result.get('nextPageToken')}

    async def discover(self):
        result = await self.request('videos', part='snippet,contentDetails,topicDetails', chart='mostPopular', videoCategoryId='10', regionCode='PH', maxResults=20)
        tracks = [MetadataService.transform(v) for v in result.get('items',[])]
        return {'items':[t for t in tracks if t['classification']!='NOT_MUSIC']}

    async def searchPlaylists(self, query, page=''):
        result = await self.request('search', part='snippet',type='playlist',q=query+' music',maxResults=20,pageToken=page)
        items = [v for v in result.get('items',[]) if v.get('id',{}).get('playlistId')]
        return {'items':[{'id':v['id']['playlistId'],'title':v['snippet']['title'],'artist':v['snippet']['channelTitle'],'thumbnail':v['snippet']['thumbnails'].get('high',v['snippet']['thumbnails']['default'])['url']} for v in items], 'nextPageToken':result.get('nextPageToken')}

    async def getPlaylist(self, playlist_id):
        return await self.request('playlists', part='snippet,contentDetails', id=playlist_id)

    async def getPlaylistItems(self, playlist_id, page=''):
        result = await self.request('playlistItems',part='contentDetails',playlistId=playlist_id,maxResults=50,pageToken=page)
        tracks = await self.getVideos([v['contentDetails']['videoId'] for v in result.get('items',[])])
        return {'items':[t for t in tracks if t['classification']!='NOT_MUSIC'],'nextPageToken':result.get('nextPageToken')}
