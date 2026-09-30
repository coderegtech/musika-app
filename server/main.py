import asyncio
import hashlib
import json
import os
import secrets
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from .database import Database
from .domain import VIDEO_ID, DuplicateDetectionService, parse_video_url
from .downloads import QueueService
from .youtube import YouTubeService

load_dotenv(Path(__file__).parent/'.env')
ROOT = Path(__file__).parent/'data'
db = Database(ROOT/'musika.db')
youtube = YouTubeService()
queue = QueueService(db,ROOT/'audio')

@asynccontextmanager
async def lifespan(app):
    worker = asyncio.create_task(queue.start())
    yield
    worker.cancel()
    await queue.shutdown()
    await asyncio.gather(worker,return_exceptions=True)

app = FastAPI(title='Musika API',lifespan=lifespan)
origins = os.getenv('MUSIKA_ORIGINS','http://localhost:8081').split(',')
app.add_middleware(CORSMiddleware,allow_origins=origins,allow_credentials=True,allow_methods=['GET','POST','DELETE'],allow_headers=['Content-Type','Authorization'])
limits = {}

@app.middleware('http')
async def security(request,call_next):
    if request.method not in ('GET','OPTIONS','HEAD') and request.headers.get('origin') and request.headers['origin'] not in origins:
        return Response('Origin denied',status_code=403)
    key = request.client.host if request.client else 'unknown'
    now = time.monotonic()
    count,until = limits.get(key,(0,now+60))
    if now>until: count,until = 0,now+60
    if count>=180: return Response('Rate limit exceeded',status_code=429)
    limits[key] = (count+1,until)
    result = await call_next(request)
    result.headers['X-Content-Type-Options'] = 'nosniff'
    return result

def session(request:Request):
    token = request.headers.get('authorization','').removeprefix('Bearer ') or request.cookies.get('musika_session','')
    digest = hashlib.sha256(token.encode()).hexdigest()
    with db.connect() as conn:
        row = conn.execute('SELECT * FROM sessions WHERE token_hash=? AND expires>?',(digest,time.time())).fetchone()
    if not row: raise HTTPException(401,'Your session expired. Sign in again.')
    return row['user_id']

class GoogleLogin(BaseModel):
    idToken: str = Field(max_length=10000)

@app.post('/auth/google')
async def login(body:GoogleLogin,response:Response):
    from google.oauth2 import id_token
    from google.auth.transport.requests import Request as GoogleRequest
    audiences = [os.getenv(k) for k in ('GOOGLE_CLIENT_ID','GOOGLE_ANDROID_CLIENT_ID','GOOGLE_IOS_CLIENT_ID') if os.getenv(k)]
    if not audiences: raise HTTPException(503,'Google sign-in is not configured on the server.')
    try:
        claims = await asyncio.to_thread(id_token.verify_oauth2_token,body.idToken,GoogleRequest())
        if claims['aud'] not in audiences or not claims.get('email_verified'): raise ValueError('Invalid audience')
    except Exception:
        raise HTTPException(401,'Google could not verify this account.')
    user = {k:claims.get(k) for k in ('sub','name','email','picture')}
    token = secrets.token_urlsafe(48)
    with db.connect() as conn:
        conn.execute('INSERT OR REPLACE INTO users VALUES(?,?)',(claims['sub'],json.dumps(user)))
        conn.execute('DELETE FROM sessions WHERE expires<?',(time.time(),))
        conn.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),claims['sub'],time.time()+86400*30))
    response.set_cookie('musika_session',token,httponly=True,secure=os.getenv('ENVIRONMENT')=='production',samesite='lax',max_age=86400*30)
    response.headers['Cache-Control'] = 'no-store'
    return {'token':token,'user':user}

@app.get('/auth/me')
def me(user=Depends(session)):
    with db.connect() as conn: return json.loads(conn.execute('SELECT profile FROM users WHERE id=?',(user,)).fetchone()['profile'])

@app.post('/auth/logout')
def logout(request:Request,response:Response,user=Depends(session)):
    token = request.headers.get('authorization','').removeprefix('Bearer ') or request.cookies.get('musika_session','')
    with db.connect() as conn: conn.execute('DELETE FROM sessions WHERE token_hash=?',(hashlib.sha256(token.encode()).hexdigest(),))
    response.delete_cookie('musika_session')
    return {'ok':True}

@app.get('/health')
def health(): return {'ok':True,'discovery_configured':bool(os.getenv('YOUTUBE_API_KEY'))}

@app.get('/music/search')
async def search(q:str='',page:str='',kind:str='tracks',user=Depends(session)):
    if not 1<=len(q)<=200 or len(page)>300: raise HTTPException(400,'Enter a search of 1–200 characters.')
    return await (youtube.searchPlaylists(q,page) if kind=='playlists' else youtube.searchMusic(q,page))

@app.get('/music/discover')
async def discover(user=Depends(session)): return await youtube.discover()

@app.get('/music/video/{video_id}')
async def video(video_id:str,user=Depends(session)):
    if not VIDEO_ID.fullmatch(video_id): raise HTTPException(400,'Invalid YouTube video ID.')
    return await youtube.getVideo(video_id)

@app.get('/music/playlists/{playlist_id}')
async def playlist(playlist_id:str,page:str='',user=Depends(session)):
    import re
    if not re.fullmatch(r'[\w-]{10,100}',playlist_id) or len(page)>300: raise HTTPException(400,'Invalid playlist.')
    return await youtube.getPlaylistItems(playlist_id,page)

class DownloadRequest(BaseModel):
    video_id:str = Field(pattern=r'^[A-Za-z0-9_-]{11}$')
    # Optional and never used to fetch anything: it is only checked against video_id, and yt-dlp always gets a URL the server builds.
    url:str|None = Field(default=None,max_length=300)
    playlist_id:str|None = Field(default=None,pattern=r'^[\w-]{1,64}$')
    format:Literal['mp3','m4a','opus']='mp3'
    quality:Literal[128,192,256,320]=320
    allow_duplicate:bool=False

@app.post('/downloads')
async def download(body:DownloadRequest,user=Depends(session)):
    if body.url is not None and parse_video_url(body.url) != body.video_id:
        raise HTTPException(400,'Only YouTube links that match the requested video are supported.')
    track = await youtube.getMusicMetadata(body.video_id)
    if track['classification']=='NOT_MUSIC': raise HTTPException(400,'This video is not classified as music.')
    duplicate = DuplicateDetectionService.check(track,db.tracks(user))
    if duplicate == 'ALREADY DOWNLOADED': return {'duplicate':duplicate,'track':track}
    if duplicate == 'POSSIBLE DUPLICATE' and not body.allow_duplicate: return {'duplicate':duplicate,'track':track}
    job = {'id':uuid.uuid4().hex,'user_id':user,'track':track,'state':'QUEUED','progress':0,'format':body.format,'quality':body.quality,'allow_duplicate':body.allow_duplicate,'playlist_id':body.playlist_id}
    try: db.save_job(job)
    except sqlite3.IntegrityError:
        return next(j for j in db.jobs(user) if j['track']['id']==body.video_id and j['state'] in ('QUEUED','ANALYZING','DOWNLOADING','PROCESSING'))
    return job

@app.get('/downloads')
def jobs(user=Depends(session)): return {'items':db.jobs(user),'paused':db.paused(user)}

@app.get('/downloads/{download_id}')
def download_status(download_id:str,user=Depends(session)):
    job = next((j for j in db.jobs(user) if j['id']==download_id),None)
    if not job: raise HTTPException(404,'Download not found.')
    return {**{k:v for k,v in job.items() if k!='user_id'},'status':job['state'].lower(),'title':job['track']['title']}

@app.post('/downloads/queue/{action}')
def queue_action(action:str,user=Depends(session)):
    if action in ('pause','resume'):
        with db.connect() as conn: conn.execute("INSERT OR REPLACE INTO settings VALUES(?,'paused',?)",(user,'true' if action=='pause' else 'false'))
    elif action=='clear':
        with db.connect() as conn: conn.execute("DELETE FROM downloads WHERE user_id=? AND state IN ('COMPLETED','SKIPPED','CANCELLED')",(user,))
    elif action=='retry':
        for job in db.jobs(user):
            if job['state']=='FAILED': job.update(state='QUEUED',progress=0,error=None); db.save_job(job)
    else: raise HTTPException(400,'Unknown queue action.')
    return {'ok':True}

@app.post('/downloads/{job_id}/{action}')
async def job_action(job_id:str,action:str,user=Depends(session)):
    job = next((j for j in db.jobs(user) if j['id']==job_id),None)
    if not job: raise HTTPException(404,'Download not found.')
    if action=='cancel' and job['state'] in ('QUEUED','ANALYZING','DOWNLOADING','PROCESSING'):
        task = queue.active.get(job_id)
        if task: task.cancel(); await asyncio.gather(task,return_exceptions=True)
        else: job.update(state='CANCELLED'); db.save_job(job)
    elif action=='retry' and job['state'] in ('FAILED','CANCELLED'):
        job.update(state='QUEUED',progress=0,error=None)
        try: db.save_job(job)
        except sqlite3.IntegrityError: raise HTTPException(409,'This track is already queued.')
    elif action=='remove' and job['state'] in ('COMPLETED','SKIPPED','FAILED','CANCELLED'): db.delete_job(user,job_id)
    else: raise HTTPException(400,'This action is not available for this download.')
    return {'ok':True}

@app.get('/library')
def library(user=Depends(session)):
    return {'items':[{k:v for k,v in t.items() if k!='file_path'} for t in db.tracks(user)]}

@app.get('/files/{video_id}')
def media(video_id:str,user=Depends(session)):
    track = next((t for t in db.tracks(user) if t['id']==video_id),None)
    if not track or not Path(track['file_path']).is_file(): raise HTTPException(404,'Audio file not found.')
    path = Path(track['file_path']).resolve()
    if not path.is_relative_to((ROOT/'audio').resolve()): raise HTTPException(403,'Invalid file path.')
    return FileResponse(path,filename=path.name,media_type={'mp3':'audio/mpeg','m4a':'audio/mp4','opus':'audio/ogg'}[track['format']])

