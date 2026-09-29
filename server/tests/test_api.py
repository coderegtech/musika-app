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
    def test_no_permission_rejected(self):self.assertEqual(self.client.post('/downloads',headers=self.headers,json={'video_id':'abcdefghijk'}).status_code,403)
    def test_cookie_csrf_origin_rejected(self):self.assertEqual(self.client.post('/auth/logout',headers={**self.headers,'Origin':'https://attacker.example'}).status_code,403)
    def test_user_cannot_read_other_jobs(self):self.assertEqual(self.client.post('/downloads/other-user-job/cancel',headers=self.headers).status_code,404)
    def test_file_requires_ownership(self):self.assertEqual(self.client.get('/files/abcdefghijk',headers=self.headers).status_code,404)
    def test_non_admin_cannot_manage_authorized_videos(self):
        self.assertEqual(self.client.get('/admin/authorized-videos',headers=self.bob_headers).status_code,403)
        self.assertEqual(self.client.post('/admin/authorized-videos',headers=self.bob_headers,json={'video_id':'abcdefghijk'}).status_code,403)
    def test_admin_can_add_and_remove_authorized_videos(self):
        with patch.dict(os.environ,{'ADMIN_EMAILS':'alice@example.com'}):
            self.assertEqual(self.client.post('/admin/authorized-videos',headers=self.headers,json={'video_id':'abcdefghijk'}).status_code,200)
            items = self.client.get('/admin/authorized-videos',headers=self.headers).json()['items']
            self.assertEqual([i['video_id'] for i in items],['abcdefghijk']);self.assertEqual(items[0]['added_by'],'alice')
            self.assertEqual(self.client.delete('/admin/authorized-videos/abcdefghijk',headers=self.headers).status_code,200)
            self.assertEqual(self.client.get('/admin/authorized-videos',headers=self.headers).json()['items'],[])
    def test_admin_authorization_rejects_malformed_id(self):
        with patch.dict(os.environ,{'ADMIN_EMAILS':'alice@example.com'}):
            self.assertEqual(self.client.post('/admin/authorized-videos',headers=self.headers,json={'video_id':'bad;command'}).status_code,422)
            self.assertEqual(self.client.delete('/admin/authorized-videos/bad;command',headers=self.headers).status_code,400)
    def test_download_allowed_once_admin_authorizes(self):
        track = {'id':'abcdefghijk','source':'youtube','title':'Song','artist':'Artist','duration':200,'thumbnail':'','classification':'MUSIC'}
        with patch.dict(os.environ,{'ADMIN_EMAILS':'alice@example.com'}):
            self.client.post('/admin/authorized-videos',headers=self.headers,json={'video_id':'abcdefghijk'})
        with patch.object(main.youtube,'getMusicMetadata',new=AsyncMock(return_value=track)):
            response = self.client.post('/downloads',headers=self.headers,json={'video_id':'abcdefghijk','permission_confirmed':True})
        self.assertEqual(response.status_code,200)
