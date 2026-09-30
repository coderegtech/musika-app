import asyncio
import errno
import hashlib
import json
import os
import shutil
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from .domain import DuplicateDetectionService

def ffmpeg_binary():
    configured = os.getenv('FFMPEG_PATH') or shutil.which('ffmpeg')
    if configured:
        return configured
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

PROGRESS_PREFIX = 'MUSIKA|'
PROGRESS_TEMPLATE = 'download:' + PROGRESS_PREFIX + '%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s'

def parse_progress(line):
    """Parse one yt-dlp progress-template line into byte counts, or None for any other output."""
    if not line.startswith(PROGRESS_PREFIX):
        return None
    parts = line.strip()[len(PROGRESS_PREFIX):].split('|')
    if len(parts) != 4:
        return None
    def number(value):
        try:
            return float(value)
        except ValueError:
            return None  # yt-dlp prints NA when a value is unknown
    done, total, estimate, speed = map(number, parts)
    return {'downloaded':done,'total':total or estimate,'speed':speed}

def friendly_error(tool, stderr):
    """Map tool output to a message that is safe to show the user; raw stderr never leaves the server."""
    text = stderr.lower()
    if 'private video' in text:
        return 'This video is private and cannot be downloaded.'
    if 'in your country' in text or 'geo restrict' in text or 'geo-restrict' in text:
        return 'This video is region-restricted and cannot be downloaded from the server’s location.'
    if 'sign in to confirm' in text or 'confirm your age' in text:
        return 'YouTube requires a sign-in for this video, so it cannot be downloaded.'
    if 'video unavailable' in text or 'has been removed' in text or 'account associated with this video has been terminated' in text:
        return 'This video has been removed or is no longer available.'
    if 'no space left' in text:
        return 'The server is out of storage space.'
    if any(marker in text for marker in ('name resolution','timed out','connection reset','unable to download','network is unreachable')):
        return 'Network error while contacting YouTube. Try again.'
    if tool == 'ffmpeg':
        return 'Audio conversion failed (FFmpeg). Try again or choose another format.'
    return 'YouTube audio could not be fetched (yt-dlp). Try again later.'

class YtDlpService:
    async def extract(self, video_id, directory, run, progress=None):
        # Fixed arguments only; never accepts client URLs, cookies or extractor arguments.
        executable = [os.environ['YT_DLP_PATH']] if os.getenv('YT_DLP_PATH') else [sys.executable, '-m', 'yt_dlp']
        await run(executable + ['--ffmpeg-location', ffmpeg_binary(), '--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-overwrites', '--newline', '--progress', '--progress-template', PROGRESS_TEMPLATE, '--no-warnings',
                   '--socket-timeout','30','--retries','2','--max-filesize','200M','--match-filter','duration <= 14400 & !is_live',
                   '-f','bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio','-o',str(directory/'source.%(ext)s'),
                   '--','https://www.youtube.com/watch?v='+video_id], **({'on_line':progress} if progress else {}))
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

    async def verify(self, output, run):
        # A file only becomes a library track after it exists, is non-trivial and fully decodes.
        if not output.is_file() or output.stat().st_size < 1024:
            raise RuntimeError('The converted file is empty or corrupted. Try again.')
        try:
            await run([ffmpeg_binary(),'-v','error','-nostdin','-i',str(output),'-f','null','-'])
        except RuntimeError:
            raise RuntimeError('The converted file is corrupted. Try again.')

    async def download(self, job, transition, run):
        directory = self.root/job['id']
        directory.mkdir(parents=True,exist_ok=True)
        try:
            await transition('DOWNLOADING',10,stage='Downloading',speed=None)
            last = 0.0
            async def progress(line):
                nonlocal last
                sample = parse_progress(line)
                now = time.monotonic()
                if not sample or not sample['total'] or now-last < .5:
                    return
                last = now
                percent = min(1.0, sample['downloaded']/sample['total']) if sample['downloaded'] is not None else 0
                await transition('DOWNLOADING',10+int(60*percent),stage='Downloading',speed=sample['speed'],bytes_total=sample['total'])
            source = await self.extractor.extract(job['track']['id'],directory,run,progress)
            await transition('PROCESSING',72,stage='Extracting audio',speed=None)
            output = directory/('audio.'+job['format'])
            await transition('PROCESSING',78,stage='Converting to '+job['format'].upper())
            await self.ffmpeg.process(source,output,job['track'],job['quality'],run)
            await transition('PROCESSING',90,stage='Saving metadata')
            try:
                await self.ffmpeg.artwork(output,job['track']['thumbnail'],run)
            except Exception:
                job['warning'] = 'Audio saved; cover artwork could not be embedded.'
            await self.verify(output,run)
            digest = hashlib.sha256()
            with output.open('rb') as stream:
                for chunk in iter(lambda:stream.read(1024*1024),b''):
                    digest.update(chunk)
            for leftover in directory.iterdir():
                if leftover != output:
                    leftover.unlink(missing_ok=True)
            return {**job['track'],'file_hash':digest.hexdigest(),'file_path':str(output.resolve()),'downloaded_at':datetime.now(timezone.utc).isoformat(),'format':job['format'],'bytes':output.stat().st_size}
        except BaseException:
            # Failed, cancelled or interrupted: never leave partial files behind to be mistaken for a track.
            shutil.rmtree(directory,ignore_errors=True)
            raise

class QueueService:
    def __init__(self, db, root):
        self.db,self.engine = db,DownloadService(root)
        self.active = {}
        self.processes = {}
        self.stopping = False

    async def run_process(self, job_id, args, on_line=None):
        tool = 'ffmpeg' if 'ffmpeg' in Path(args[0]).name.lower() else 'yt-dlp'
        process = await asyncio.create_subprocess_exec(*args,stdout=asyncio.subprocess.PIPE if on_line else asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.PIPE)
        self.processes[job_id] = process
        async def pump():
            async for raw in process.stdout:
                await on_line(raw.decode(errors='replace'))
        async def drain():
            return (await process.stderr.read())[-8000:].decode(errors='replace')
        readers = [asyncio.create_task(drain())] + ([asyncio.create_task(pump())] if on_line else [])
        try:
            try:
                await asyncio.wait_for(process.wait(),timeout=1800)
            except asyncio.TimeoutError:
                raise RuntimeError('The media tool timed out. Try again.')
            stderr = await readers[0]
            if len(readers) > 1:
                await readers[1]
            if process.returncode:
                raise RuntimeError(friendly_error(tool,stderr))
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
            for reader in readers:
                reader.cancel()
            await asyncio.gather(*readers,return_exceptions=True)
            self.processes.pop(job_id,None)

    async def execute(self, job):
        async def transition(state,progress,**extra):
            job.update(state=state,progress=progress,**extra)
            self.db.save_job(job)
        try:
            await transition('ANALYZING',3,stage='Fetching')
            duplicate = DuplicateDetectionService.check(job['track'],self.db.tracks(job['user_id']))
            if duplicate == 'ALREADY DOWNLOADED' or (duplicate == 'POSSIBLE DUPLICATE' and not job.get('allow_duplicate')):
                job['error'] = duplicate
                await transition('SKIPPED',100)
                return
            track = await self.engine.download(job,transition,lambda args,**kwargs:self.run_process(job['id'],args,**kwargs))
            final_duplicate = DuplicateDetectionService.check(track,self.db.tracks(job['user_id']))
            if final_duplicate == 'ALREADY DOWNLOADED' or (final_duplicate == 'POSSIBLE DUPLICATE' and not job.get('allow_duplicate')):
                shutil.rmtree(Path(track['file_path']).parent,ignore_errors=True)
                await transition('SKIPPED',100)
                return
            self.db.save_track(job['user_id'],track)
            job['track'] = track
            await transition('COMPLETED',100,stage='Completed',speed=None)
        except asyncio.CancelledError:
            await transition('QUEUED' if self.stopping else 'CANCELLED',0,stage='Queued' if self.stopping else 'Cancelled',speed=None)
            raise
        except Exception as error:
            if isinstance(error,OSError) and error.errno == errno.ENOSPC:
                job['error'] = 'The server is out of storage space.'
            else:
                job['error'] = str(error) if isinstance(error,RuntimeError) else 'Download failed. Verify yt-dlp and FFmpeg are installed.'
            await transition('FAILED',0,stage='Failed',speed=None)
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
