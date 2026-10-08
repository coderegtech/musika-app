import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

class Database:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = str(path)
        with self.connect() as db:
            db.executescript('''
              PRAGMA journal_mode=WAL;
              CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, profile TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires REAL NOT NULL);
              CREATE TABLE IF NOT EXISTS tracks(user_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(user_id,id));
              CREATE TABLE IF NOT EXISTS downloads(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,video_id TEXT NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL);
              CREATE UNIQUE INDEX IF NOT EXISTS one_active_download ON downloads(user_id,video_id) WHERE state IN ('QUEUED','ANALYZING','DOWNLOADING','PROCESSING');
              CREATE TABLE IF NOT EXISTS settings(user_id TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(user_id,key));
              CREATE TABLE IF NOT EXISTS download_history(id INTEGER PRIMARY KEY,job_id TEXT,state TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
            ''')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def tracks(self, user):
        with self.connect() as db:
            return [json.loads(row['data']) for row in db.execute('SELECT data FROM tracks WHERE user_id=?', (user,))]

    def jobs(self, user):
        with self.connect() as db:
            return [json.loads(row['data']) for row in db.execute('SELECT data FROM downloads WHERE user_id=? ORDER BY rowid DESC', (user,))]

    def save_job(self, job):
        with self.connect() as db:
            db.execute('INSERT INTO downloads VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data', (job['id'],job['user_id'],job['track']['id'],job['state'],json.dumps(job)))
            db.execute('INSERT INTO download_history(job_id,state) VALUES(?,?)', (job['id'],job['state']))

    def save_track(self, user, track):
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO tracks VALUES(?,?,?)', (user,track['id'],json.dumps(track)))

    def paused(self, user):
        with self.connect() as db:
            row = db.execute("SELECT value FROM settings WHERE user_id=? AND key='paused'", (user,)).fetchone()
            return row is not None and row['value'] == 'true'
