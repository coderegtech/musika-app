import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server.database import Database
from server.downloads import QueueService, tool_error

def job(i,user='alice'):
    return {'id':f'job{i}','user_id':user,'track':{'id':f'{i:011d}','source':'youtube','title':f'Track {i}','artist':'Artist','duration':200,'thumbnail':''},'state':'QUEUED','progress':0,'format':'mp3','quality':320}

class QueueTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory();self.db=Database(Path(self.temp.name)/'db.sqlite');self.queue=QueueService(self.db,Path(self.temp.name)/'audio')
    async def asyncTearDown(self):
        await self.queue.shutdown();self.temp.cleanup()
    async def test_concurrency_pause_cancel_and_recovery(self):
        for i in range(6): self.db.save_job(job(i))
        count=0;peak=0
        async def download(j,transition,run):
            nonlocal count,peak
            count+=1;peak=max(peak,count)
            try: await asyncio.sleep(10)
            finally: count-=1
        self.queue.engine.download=download
        worker=asyncio.create_task(self.queue.start());await asyncio.sleep(.15)
        self.assertEqual(peak,3);self.assertEqual(len(self.queue.active),3)
        with self.db.connect() as db: db.execute("INSERT INTO settings VALUES('alice','paused','true')")
        tasks=list(self.queue.active.values())
        for task in tasks:task.cancel()
        await asyncio.gather(*tasks,return_exceptions=True);await asyncio.sleep(.55)
        self.assertEqual(len(self.queue.active),0);self.assertEqual(sum(j['state']=='QUEUED' for j in self.db.jobs('alice')),3)
        worker.cancel();await asyncio.gather(worker,return_exceptions=True)
    async def test_any_video_reaches_engine(self):
        called=False
        async def allowed(job,transition,run):
            nonlocal called;called=True
            return {**job['track'],'file_hash':'x','file_path':str(Path(self.temp.name)/'x'),'format':'mp3','bytes':1}
        self.queue.engine.download=allowed
        j=job(1);self.db.save_job(j);await self.queue.execute(j)
        self.assertTrue(called);self.assertEqual(self.db.jobs('alice')[0]['state'],'COMPLETED')
    async def test_exact_duplicate_skipped(self):
        j=job(2);self.db.save_track('alice',j['track']);self.db.save_job(j);await self.queue.execute(j)
        self.assertEqual(self.db.jobs('alice')[0]['state'],'SKIPPED')
    async def test_downloads_are_user_scoped(self):
        self.db.save_job(job(1,'alice'));self.db.save_job(job(2,'bob'));self.assertEqual(len(self.db.jobs('alice')),1);self.assertEqual(self.db.jobs('alice')[0]['track']['id'],'00000000001')
    async def test_database_rejects_duplicate_active_jobs(self):
        import sqlite3
        j=job(3);self.db.save_job(j)
        with self.assertRaises(sqlite3.IntegrityError):self.db.save_job({**j,'id':'another-job'})
    async def test_tool_error_explains_youtube_bot_check(self):
        with self.assertLogs('musika','WARNING'):
            message=tool_error(b"ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies\n",'Streaming failed.')
        self.assertIn('bot check',message)
        with self.assertLogs('musika','WARNING'):
            self.assertEqual(tool_error(b'ERROR: Video unavailable\n','Media processing failed.'),'Media processing failed. ERROR: Video unavailable')
    async def test_ytdlp_command_adds_operator_cookies_and_proxy(self):
        from server.downloads import ytdlp_command
        source=Path(self.temp.name)/'cookies.txt';source.write_text('# Netscape HTTP Cookie File\n')
        with patch.dict(os.environ,{'YT_DLP_COOKIES_FILE':str(source),'YT_DLP_PROXY':'http://proxy.example:8080'}):
            command=ytdlp_command()
        jar=Path(command[command.index('--cookies')+1]);self.addCleanup(jar.unlink,missing_ok=True)
        self.assertNotEqual(jar,source);self.assertEqual(jar.read_text(),source.read_text())
        self.assertEqual(command[command.index('--proxy')+1],'http://proxy.example:8080')
        with patch.dict(os.environ,{'YT_DLP_COOKIES_FILE':'','YT_DLP_PROXY':''}):
            self.assertFalse({'--cookies','--proxy'} & set(ytdlp_command()))
