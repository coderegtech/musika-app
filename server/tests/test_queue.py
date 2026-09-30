import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server.database import Database
from server.downloads import QueueService,DownloadService,parse_progress,friendly_error

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
        with patch.dict(os.environ,{'AUTHORIZED_VIDEO_IDS':','.join(f'{i:011d}' for i in range(6))}):
            worker=asyncio.create_task(self.queue.start());await asyncio.sleep(.15)
            self.assertEqual(peak,3);self.assertEqual(len(self.queue.active),3)
            with self.db.connect() as db: db.execute("INSERT INTO settings VALUES('alice','paused','true')")
            tasks=list(self.queue.active.values())
            for task in tasks:task.cancel()
            await asyncio.gather(*tasks,return_exceptions=True);await asyncio.sleep(.55)
            self.assertEqual(len(self.queue.active),0);self.assertEqual(sum(j['state']=='QUEUED' for j in self.db.jobs('alice')),3)
            worker.cancel();await asyncio.gather(worker,return_exceptions=True)
    async def test_unauthorized_content_never_reaches_engine(self):
        called=False
        async def forbidden(*args):
            nonlocal called;called=True
        self.queue.engine.download=forbidden
        j=job(1);self.db.save_job(j)
        with patch.dict(os.environ,{'AUTHORIZED_VIDEO_IDS':''}):await self.queue.execute(j)
        self.assertFalse(called);self.assertEqual(self.db.jobs('alice')[0]['state'],'FAILED')
    async def test_admin_authorized_video_reaches_engine(self):
        called=False
        async def allowed(job,transition,run):
            nonlocal called;called=True
            return {**job['track'],'file_hash':'x','file_path':str(Path(self.temp.name)/'x'),'format':'mp3','bytes':1}
        self.queue.engine.download=allowed
        j=job(1);self.db.save_job(j);self.db.add_authorized(j['track']['id'],'alice')
        with patch.dict(os.environ,{'AUTHORIZED_VIDEO_IDS':''}):await self.queue.execute(j)
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

    async def test_progress_history_only_records_state_changes(self):
        j=job(4);self.db.save_job(j)
        for pct in (10,20,30):
            j.update(state='DOWNLOADING',progress=pct);self.db.save_job(j)
        with self.db.connect() as db:
            states=[r['state'] for r in db.execute('SELECT state FROM download_history ORDER BY id')]
        self.assertEqual(states,['QUEUED','DOWNLOADING'])
    async def test_failed_download_removes_partial_files_and_reports_failure(self):
        root=Path(self.temp.name)/'audio'
        async def extract(video_id,directory,run,progress=None):
            (directory/'source.webm.part').write_bytes(b'partial');raise RuntimeError('This video is private and cannot be downloaded.')
        self.queue.engine.extractor.extract=extract
        j=job(5);self.db.save_job(j);self.db.add_authorized(j['track']['id'],'alice')
        await self.queue.execute(j)
        saved=self.db.jobs('alice')[0]
        self.assertEqual(saved['state'],'FAILED');self.assertIn('private',saved['error']);self.assertEqual(self.db.tracks('alice'),[])
        self.assertFalse((root/j['id']).exists())
    async def test_cancelled_download_removes_partial_files(self):
        root=Path(self.temp.name)/'audio'
        async def extract(video_id,directory,run,progress=None):
            (directory/'source.webm.part').write_bytes(b'partial');await asyncio.sleep(10)
        self.queue.engine.extractor.extract=extract
        j=job(6);self.db.save_job(j);self.db.add_authorized(j['track']['id'],'alice')
        task=asyncio.create_task(self.queue.execute(j));await asyncio.sleep(.1);task.cancel()
        await asyncio.gather(task,return_exceptions=True)
        self.assertEqual(self.db.jobs('alice')[0]['state'],'CANCELLED');self.assertFalse((root/j['id']).exists())
    async def test_corrupted_output_is_never_completed(self):
        async def extract(video_id,directory,run,progress=None):
            path=directory/'source.webm';path.write_bytes(b'x'*4000);return path
        async def process(source,output,track,quality,run):output.write_bytes(b'not audio')
        async def artwork(*args):return None
        self.queue.engine.extractor.extract=extract;self.queue.engine.ffmpeg.process=process;self.queue.engine.ffmpeg.artwork=artwork
        j=job(7);self.db.save_job(j);self.db.add_authorized(j['track']['id'],'alice')
        await self.queue.execute(j)
        self.assertEqual(self.db.jobs('alice')[0]['state'],'FAILED');self.assertEqual(self.db.tracks('alice'),[])
        self.assertFalse((Path(self.temp.name)/'audio'/j['id']).exists())
    async def test_stage_and_progress_are_reported_while_downloading(self):
        seen=[]
        async def extract(video_id,directory,run,progress=None):
            await progress('MUSIKA|500|1000|NA|2048.5\n')
            seen.append(dict(self.db.jobs('alice')[0]))
            path=directory/'source.webm';path.write_bytes(b'x');return path
        self.queue.engine.extractor.extract=extract
        j=job(8);self.db.save_job(j);self.db.add_authorized(j['track']['id'],'alice')
        await self.queue.execute(j)
        self.assertEqual(seen[0]['stage'],'Downloading');self.assertEqual(seen[0]['speed'],2048.5);self.assertEqual(seen[0]['bytes_total'],1000.0);self.assertEqual(seen[0]['progress'],40)

class ProgressParsingTests(unittest.TestCase):
    def test_parses_known_and_unknown_values(self):
        self.assertEqual(parse_progress('MUSIKA|10|100|NA|5.5\n'),{'downloaded':10.0,'total':100.0,'speed':5.5})
        self.assertEqual(parse_progress('MUSIKA|10|NA|200|NA')['total'],200.0)
    def test_ignores_other_output(self):
        for line in ['[youtube] abc: Downloading webpage','MUSIKA|1|2','','MUSIKA|a|b|c|d|e']:
            self.assertIsNone(parse_progress(line))
    def test_errors_are_classified_without_leaking_raw_output(self):
        cases={'ERROR: [youtube] x: Private video. Sign in':'private','ERROR: Video unavailable':'removed','The uploader has not made this video available in your country':'region','ERROR: Sign in to confirm your age':'sign-in','OSError: No space left on device':'storage','Temporary failure in name resolution':'Network'}
        for raw,expected in cases.items():
            message=friendly_error('yt-dlp',raw+' /home/secret/path')
            self.assertIn(expected.lower(),message.lower());self.assertNotIn('/home/secret',message)
        self.assertIn('FFmpeg',friendly_error('ffmpeg','Invalid data found'))
