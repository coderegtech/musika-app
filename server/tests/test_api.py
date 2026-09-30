import hashlib
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from server.database import Database
from server import main

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.db=Database(Path(self.temp.name)/'api.db');self.original=main.db;main.db=self.db
        with self.db.connect() as db:
            db.execute('INSERT INTO users VALUES(?,?)',('alice',json.dumps({'sub':'alice','name':'Alice','email':'alice@example.com'})))
            db.execute('INSERT INTO users VALUES(?,?)',('bob',json.dumps({'sub':'bob','name':'Bob','email':'bob@example.com'})))
            db.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(b'test-token').hexdigest(),'alice',time.time()+60))
            db.execute('INSERT INTO sessions VALUES(?,?,?)',(hashlib.sha256(b'bob-token').hexdigest(),'bob',time.time()+60))
        self.client=TestClient(main.app);self.headers={'Authorization':'Bearer test-token'};self.bob_headers={'Authorization':'Bearer bob-token'}
    def tearDown(self):main.db=self.original;self.temp.cleanup()
    def test_auth_required(self):self.assertEqual(self.client.get('/downloads').status_code,401)
    def test_session_restore(self):self.assertEqual(self.client.get('/auth/me',headers=self.headers).json()['name'],'Alice')
    def test_logout_revokes_session(self):
        self.assertEqual(self.client.post('/auth/logout',headers=self.headers).status_code,200);self.assertEqual(self.client.get('/auth/me',headers=self.headers).status_code,401)
    def test_invalid_id_rejected(self):self.assertEqual(self.client.post('/downloads',headers=self.headers,json={'video_id':'bad;command'}).status_code,422)
    def test_cookie_csrf_origin_rejected(self):self.assertEqual(self.client.post('/auth/logout',headers={**self.headers,'Origin':'https://attacker.example'}).status_code,403)
    def test_user_cannot_read_other_jobs(self):self.assertEqual(self.client.post('/downloads/other-user-job/cancel',headers=self.headers).status_code,404)
    def test_file_requires_ownership(self):self.assertEqual(self.client.get('/files/abcdefghijk',headers=self.headers).status_code,404)
    def test_download_needs_no_permission_flag_or_approval_list(self):
        track = {'id':'abcdefghijk','source':'youtube','title':'Song','artist':'Artist','duration':200,'thumbnail':'','classification':'MUSIC'}
        with patch.object(main.youtube,'getMusicMetadata',new=AsyncMock(return_value=track)):
            response = self.client.post('/downloads',headers=self.headers,json={'video_id':'abcdefghijk'})
        self.assertEqual(response.status_code,200);self.assertEqual(response.json()['state'],'QUEUED')
    def test_admin_catalog_endpoints_are_gone(self):
        self.assertEqual(self.client.get('/admin/authorized-videos',headers=self.headers).status_code,404)
    def test_download_url_must_match_video_id(self):
        for url in ['https://evil.test/watch?v=abcdefghijk','https://www.youtube.com/watch?v=zzzzzzzzzzz','file:///etc/passwd']:
            response = self.client.post('/downloads',headers=self.headers,json={'video_id':'abcdefghijk','url':url})
            self.assertEqual(response.status_code,400,url)
    def test_playlist_id_is_validated(self):
        response = self.client.post('/downloads',headers=self.headers,json={'video_id':'abcdefghijk','playlist_id':'../../etc; rm'})
        self.assertEqual(response.status_code,422)
    def test_matching_url_and_playlist_are_accepted_and_reported(self):
        track = {'id':'abcdefghijk','source':'youtube','title':'Song','artist':'Artist','duration':200,'thumbnail':'','classification':'MUSIC'}
        with patch.object(main.youtube,'getMusicMetadata',new=AsyncMock(return_value=track)):
            response = self.client.post('/downloads',headers=self.headers,json={'video_id':'abcdefghijk','url':'https://youtu.be/abcdefghijk','playlist_id':'local-road_trip'})
        self.assertEqual(response.status_code,200);self.assertEqual(response.json()['playlist_id'],'local-road_trip')
        status = self.client.get('/downloads/'+response.json()['id'],headers=self.headers).json()
        self.assertEqual(status['status'],'queued');self.assertEqual(status['title'],'Song');self.assertNotIn('user_id',status)
    def test_status_is_user_scoped(self):
        track = {'id':'abcdefghijk','source':'youtube','title':'Song','artist':'Artist','duration':200,'thumbnail':''}
        self.db.save_job({'id':'job1','user_id':'alice','track':track,'state':'DOWNLOADING','progress':40,'format':'mp3','quality':320})
        self.assertEqual(self.client.get('/downloads/job1',headers=self.headers).json()['progress'],40)
        self.assertEqual(self.client.get('/downloads/job1',headers=self.bob_headers).status_code,404)
        self.assertEqual(self.client.get('/downloads/job1').status_code,401)
    def test_remove_only_finished_jobs(self):
        track = {'id':'abcdefghijk','source':'youtube','title':'Song','artist':'Artist','duration':200,'thumbnail':''}
        base = {'user_id':'alice','track':track,'progress':0,'format':'mp3','quality':320}
        self.db.save_job({**base,'id':'active','state':'DOWNLOADING'})
        self.assertEqual(self.client.post('/downloads/active/remove',headers=self.headers).status_code,400)
        self.db.save_job({**base,'id':'active','state':'COMPLETED'})
        self.assertEqual(self.client.post('/downloads/active/remove',headers=self.bob_headers).status_code,404)
        self.assertEqual(self.client.post('/downloads/active/remove',headers=self.headers).status_code,200)
        self.assertEqual(self.db.jobs('alice'),[])
