import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server.database import Database
from server.downloads import QueueService

ASSET = Path(__file__).resolve().parents[2]/'assets'/'demo-0.wav'
# Stands in for yt-dlp (the real one cannot reach YouTube in CI): honours -o, prints progress in the
# configured template format, and writes a real audio source. FFmpeg then really converts it.
FAKE_YT_DLP = '''#!{python}
import shutil, sys
args = sys.argv[1:]
template = args[args.index('-o') + 1]
if {fail!r}:
    sys.stderr.write('ERROR: [youtube] abcdefghijk: Private video. Sign in if you\\'ve been granted access')
    sys.exit(1)
for done in (250, 500, 1000):
    print('MUSIKA|%d|1000|NA|%d.5' % (done, done * 2), flush=True)
shutil.copy({asset!r}, template.replace('%(ext)s', 'wav'))
'''

class PipelineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.db = Database(self.root/'db.sqlite')
        self.queue = QueueService(self.db, self.root/'audio')
    async def asyncTearDown(self):
        await self.queue.shutdown(); self.temp.cleanup()
    def fake(self, fail=False):
        path = self.root/'fake-yt-dlp'
        path.write_text(FAKE_YT_DLP.format(python=sys.executable, asset=str(ASSET), fail=fail))
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
        return str(path)
    def job(self, video_id='abcdefghijk'):
        job = {'id':'job-1','user_id':'alice','track':{'id':video_id,'source':'youtube','title':'Pipeline Song','artist':'Tester','duration':24,'thumbnail':'','source_url':'https://www.youtube.com/watch?v='+video_id},'state':'QUEUED','progress':0,'format':'mp3','quality':192,'playlist_id':'local-1'}
        self.db.save_job(job)
        return job
    async def test_full_pipeline_streams_progress_and_produces_a_verified_mp3(self):
        job = self.job()
        seen = []
        original = self.db.save_job
        self.db.save_job = lambda j: (seen.append((j['state'],j.get('stage'),j.get('speed'))), original(j))[1]
        with patch.dict(os.environ,{'YT_DLP_PATH':self.fake()}):
            await self.queue.execute(job)
        saved = self.db.jobs('alice')[0]
        self.assertEqual(saved['state'],'COMPLETED',saved.get('error'))
        stages = [s for _,s,_ in seen]
        for expected in ('Fetching','Downloading','Extracting audio','Converting to MP3','Saving metadata','Completed'):
            self.assertIn(expected,stages)
        self.assertTrue(any(speed for state,_,speed in seen if state=='DOWNLOADING'),'speed was never reported')
        track = self.db.tracks('alice')[0]
        output = Path(track['file_path'])
        self.assertEqual(output.suffix,'.mp3'); self.assertGreater(output.stat().st_size,1000)
        self.assertEqual(sorted(p.name for p in output.parent.iterdir()),['audio.mp3'],'temporary files were left behind')
        self.assertNotIn('Pipeline Song',output.name)  # filenames never come from titles
        self.assertEqual(saved['playlist_id'],'local-1')
    async def test_private_video_fails_cleanly_with_no_partial_files_or_track(self):
        job = self.job()
        with patch.dict(os.environ,{'YT_DLP_PATH':self.fake(fail=True)}):
            await self.queue.execute(job)
        saved = self.db.jobs('alice')[0]
        self.assertEqual(saved['state'],'FAILED'); self.assertIn('private',saved['error'].lower())
        self.assertNotIn('Sign in',saved['error']); self.assertEqual(self.db.tracks('alice'),[])
        self.assertFalse((self.root/'audio'/'job-1').exists())

if __name__=='__main__': unittest.main()
