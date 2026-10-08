import asyncio
import hashlib
import json
import logging
import os
import shutil
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from .domain import DuplicateDetectionService

log = logging.getLogger('musika')

def tool_error(stderr, fallback):
    """Logs a yt-dlp/FFmpeg failure and returns the message to show users."""
    lines = [l for l in stderr.decode(errors='replace').splitlines() if l.strip()]
    detail = lines[-1].strip() if lines else ''
    log.warning('%s %s', fallback, detail)
    if 'confirm you' in detail and 'bot' in detail:
        return "YouTube blocked this server's request with a bot check. Cloud server IPs are often blocked; see README > Troubleshooting."
    return f'{fallback} {detail[:300]}'.strip()

def ffmpeg_binary():
    configured = os.getenv('FFMPEG_PATH') or shutil.which('ffmpeg')
    if configured:
        return configured
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

class YtDlpService:
    async def extract(self, video_id, directory, run):
        # Fixed arguments only; never accepts client URLs, cookies or extractor arguments.
        executable = [os.environ['YT_DLP_PATH']] if os.getenv('YT_DLP_PATH') else [sys.executable, '-m', 'yt_dlp']
        await run(executable + ['--ffmpeg-location', ffmpeg_binary(), '--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-overwrites', '--no-progress', '--no-warnings',
                   '--socket-timeout','30','--retries','2','--max-filesize','200M','--match-filter','duration <= 14400 & !is_live',
                   '-f','bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio','-o',str(directory/'source.%(ext)s'),
                   '--','https://www.youtube.com/watch?v='+video_id])
        files = [p for p in directory.glob('source.*') if p.suffix not in ('.part','.ytdl')]
        if len(files) != 1:
            raise RuntimeError('Audio extraction did not produce a file.')
        return files[0]

class FFmpegService:
    async def process(self, source, output, track, quality, run):
        ext = output.suffix[1:]
        codec = {'mp3':'libmp3lame','m4a':'aac','opus':'libopus'}[ext]
        args = [ffmpeg_binary(),'-nostdin','-y','-i',str(source),'-vn']
        args += ['-c:a','copy'] if ext == 'm4a' and source.suffix == '.m4a' else ['-c:a',codec,'-b:a',str(quality)+'k']
        for field,value in {'title':track['title'],'artist':track['artist'],'album':track.get('album'),'date':(track.get('release') or '')[:4],'comment':track['source_url']}.items():
            if value:
                args += ['-metadata',field+'='+value]
        await run(args + [str(output)])

    async def artwork(self, output, thumbnail, run):
        # Artwork is best effort. Only trusted Google thumbnail hosts are fetched.
        from urllib.parse import urlparse
        import httpx
        if output.suffix not in ('.mp3','.m4a') or urlparse(thumbnail).hostname not in ('i.ytimg.com','img.youtube.com'):
            return
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(thumbnail)
            response.raise_for_status()
        if len(response.content)>5_000_000:
            return
        cover = output.parent/'cover.jpg'
        cover.write_bytes(response.content)
        tagged = output.with_name('tagged'+output.suffix)
        await run([ffmpeg_binary(),'-nostdin','-y','-i',str(output),'-i',str(cover),'-map','0:a','-map','1:v','-c','copy','-disposition:v','attached_pic',str(tagged)])
        tagged.replace(output)

class DownloadService:
    def __init__(self, root):
        self.root = Path(root)
        self.extractor = YtDlpService()
        self.ffmpeg = FFmpegService()

    async def download(self, job, transition, run):
        directory = self.root/job['id']
        directory.mkdir(parents=True,exist_ok=True)
        await transition('DOWNLOADING',10)
        source = await self.extractor.extract(job['track']['id'],directory,run)
        await transition('PROCESSING',75)
        output = directory/('audio.'+job['format'])
        await self.ffmpeg.process(source,output,job['track'],job['quality'],run)
        try:
            await self.ffmpeg.artwork(output,job['track']['thumbnail'],run)
        except Exception:
            job['warning'] = 'Audio saved; cover artwork could not be embedded.'
        digest = hashlib.sha256()
        with output.open('rb') as stream:
            for chunk in iter(lambda:stream.read(1024*1024),b''):
                digest.update(chunk)
        source.unlink(missing_ok=True)
        return {**job['track'],'file_hash':digest.hexdigest(),'file_path':str(output.resolve()),'downloaded_at':datetime.now(timezone.utc).isoformat(),'format':job['format'],'bytes':output.stat().st_size}

class QueueService:
    def __init__(self, db, root):
        self.db,self.engine = db,DownloadService(root)
        self.active = {}
        self.processes = {}
        self.stopping = False

    async def run_process(self, job_id, args):
        process = await asyncio.create_subprocess_exec(*args,stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.PIPE)
        self.processes[job_id] = process
        try:
            _,stderr = await asyncio.wait_for(process.communicate(),timeout=1800)
            if process.returncode:
                raise RuntimeError(tool_error(stderr,'Media processing failed.'))
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
            self.processes.pop(job_id,None)

    async def execute(self, job):
        async def transition(state,progress):
            job.update(state=state,progress=progress)
            self.db.save_job(job)
        try:
            await transition('ANALYZING',3)
            duplicate = DuplicateDetectionService.check(job['track'],self.db.tracks(job['user_id']))
            if duplicate == 'ALREADY DOWNLOADED' or (duplicate == 'POSSIBLE DUPLICATE' and not job.get('allow_duplicate')):
                job['error'] = duplicate
                await transition('SKIPPED',100)
                return
            track = await self.engine.download(job,transition,lambda args:self.run_process(job['id'],args))
            final_duplicate = DuplicateDetectionService.check(track,self.db.tracks(job['user_id']))
            if final_duplicate == 'ALREADY DOWNLOADED' or (final_duplicate == 'POSSIBLE DUPLICATE' and not job.get('allow_duplicate')):
                Path(track['file_path']).unlink(missing_ok=True)
                await transition('SKIPPED',100)
                return
            self.db.save_track(job['user_id'],track)
            job['track'] = track
            await transition('COMPLETED',100)
        except asyncio.CancelledError:
            await transition('QUEUED' if self.stopping else 'CANCELLED',0)
            raise
        except Exception as error:
            job['error'] = str(error) if isinstance(error,RuntimeError) else 'Download failed. Verify yt-dlp and FFmpeg are installed.'
            await transition('FAILED',0)
        finally:
            self.active.pop(job['id'],None)

    async def start(self):
        with self.db.connect() as db:
            interrupted = db.execute("SELECT data FROM downloads WHERE state IN ('ANALYZING','DOWNLOADING','PROCESSING')").fetchall()
        for row in interrupted:
            job = json.loads(row['data']); job.update(state='QUEUED',progress=0); self.db.save_job(job)
        while True:
            with self.db.connect() as db:
                rows = db.execute("SELECT data FROM downloads WHERE state='QUEUED' ORDER BY rowid").fetchall()
            for row in rows:
                if len(self.active)>=3:
                    break
                job = json.loads(row['data'])
                if job['id'] not in self.active and not self.db.paused(job['user_id']):
                    self.active[job['id']] = asyncio.create_task(self.execute(job))
            await asyncio.sleep(.5)

    async def shutdown(self):
        self.stopping = True
        tasks = list(self.active.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)
