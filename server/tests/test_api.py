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
    def test_firebase_login_keys_user_by_google_id(self):
        claims={'sub':'firebase-uid','name':'Alice','email':'alice@example.com','email_verified':True,'firebase':{'sign_in_provider':'google.com','identities':{'google.com':['alice']}}}
        with patch.dict(os.environ,{'FIREBASE_PROJECT_ID':'musika-test'}),patch.object(main,'verify_firebase',return_value=claims):
            body=self.client.post('/auth/firebase',json={'idToken':'x'}).json()
        self.assertEqual(body['user']['sub'],'alice')
        self.assertEqual(self.client.get('/auth/me',headers={'Authorization':f"Bearer {body['token']}"}).json()['email'],'alice@example.com')
    def test_firebase_login_rejects_bad_token(self):
        with patch.dict(os.environ,{'FIREBASE_PROJECT_ID':'musika-test'}),patch.object(main,'verify_firebase',side_effect=ValueError('bad')):
            self.assertEqual(self.client.post('/auth/firebase',json={'idToken':'x'}).status_code,401)
    def test_firebase_login_unconfigured(self):
        with patch.dict(os.environ,{'FIREBASE_PROJECT_ID':''}):
            self.assertEqual(self.client.post('/auth/firebase',json={'idToken':'x'}).status_code,503)
    def test_verify_firebase_rejects_non_google_provider(self):
        claims={'iss':'https://securetoken.google.com/p','email_verified':True,'firebase':{'sign_in_provider':'password'}}
        with patch('google.oauth2.id_token.verify_firebase_token',return_value=claims):
            with self.assertRaises(ValueError):main.verify_firebase('x','p')
    def test_invalid_id_rejected(self):self.assertEqual(self.client.post('/downloads',headers=self.headers,json={'video_id':'bad;command'}).status_code,422)
    def test_cookie_csrf_origin_rejected(self):self.assertEqual(self.client.post('/auth/logout',headers={**self.headers,'Origin':'https://attacker.example'}).status_code,403)
    def test_user_cannot_read_other_jobs(self):self.assertEqual(self.client.post('/downloads/other-user-job/cancel',headers=self.headers).status_code,404)
    def test_file_requires_ownership(self):self.assertEqual(self.client.get('/files/abcdefghijk',headers=self.headers).status_code,404)
    def test_any_music_video_can_be_queued(self):
        track = {'id':'abcdefghijk','source':'youtube','title':'Song','artist':'Artist','duration':200,'thumbnail':'','classification':'MUSIC'}
        with patch.object(main.youtube,'getMusicMetadata',new=AsyncMock(return_value=track)):
            response = self.client.post('/downloads',headers=self.headers,json={'video_id':'abcdefghijk'})
        self.assertEqual(response.status_code,200)
