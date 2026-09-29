import asyncio
import tempfile
import unittest
from pathlib import Path
from server.downloads import FFmpegService,ffmpeg_binary

class MediaTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_ffmpeg_converts_all_formats_and_embeds_tags(self):
        source=Path(__file__).resolve().parents[2]/'assets'/'demo-0.wav'
        track={'title':'Musika test title','artist':'Musika original','album':'Demo','release':'2026','source_url':'https://example.test/original'}
        async def run(args):
            process=await asyncio.create_subprocess_exec(*args,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
            _,stderr=await process.communicate()
            self.assertEqual(process.returncode,0,stderr.decode(errors='replace')[-2000:])
        with tempfile.TemporaryDirectory() as directory:
            for fmt in ('mp3','m4a','opus'):
                with self.subTest(format=fmt):
                    output=Path(directory)/('audio.'+fmt)
                    await FFmpegService().process(source,output,track,192,run)
                    self.assertGreater(output.stat().st_size,1000)
                    process=await asyncio.create_subprocess_exec(ffmpeg_binary(),'-i',str(output),'-f','null','-',stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
                    _,stderr=await process.communicate()
                    self.assertEqual(process.returncode,0)
                    self.assertIn('Musika test title',stderr.decode(errors='replace'))

if __name__=='__main__':unittest.main()
