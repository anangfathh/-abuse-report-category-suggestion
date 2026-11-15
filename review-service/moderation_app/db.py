import hashlib,json,secrets,sqlite3,time,uuid
from contextlib import contextmanager
from pathlib import Path
from fastapi import HTTPException
from .config import settings

SCHEMA='''
CREATE TABLE IF NOT EXISTS api_keys(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,actor TEXT NOT NULL,role TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,active INTEGER NOT NULL DEFAULT 1,created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS cases(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,idempotency TEXT NOT NULL,payload_hash TEXT NOT NULL,fingerprint TEXT NOT NULL,version TEXT NOT NULL,input TEXT NOT NULL,status TEXT NOT NULL,prediction TEXT,result TEXT,source TEXT,error TEXT,review_id TEXT,revision INTEGER NOT NULL DEFAULT 1,created REAL NOT NULL,updated REAL NOT NULL,UNIQUE(tenant,idempotency));
CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,case_id TEXT UNIQUE NOT NULL,tenant TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created REAL NOT NULL,updated REAL NOT NULL);
CREATE TABLE IF NOT EXISTS review_events(id TEXT PRIMARY KEY,review_id TEXT NOT NULL,revision INTEGER NOT NULL,actor TEXT NOT NULL,decision TEXT NOT NULL,created REAL NOT NULL,UNIQUE(review_id,revision));
CREATE TABLE IF NOT EXISTS knowledge(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,case_id TEXT NOT NULL,revision INTEGER NOT NULL,fingerprint TEXT NOT NULL,context_key TEXT NOT NULL,context TEXT NOT NULL,version TEXT NOT NULL,input TEXT NOT NULL,result TEXT NOT NULL,rationale TEXT NOT NULL,verification TEXT NOT NULL,reuse TEXT NOT NULL,state TEXT NOT NULL,actor TEXT NOT NULL,expires REAL NOT NULL,created REAL NOT NULL,vector TEXT,vector_model TEXT,index_error TEXT,UNIQUE(case_id,revision));
CREATE INDEX IF NOT EXISTS knowledge_exact ON knowledge(tenant,version,fingerprint,state);
CREATE INDEX IF NOT EXISTS review_queue ON reviews(tenant,status,created);
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,object_id TEXT NOT NULL,details TEXT NOT NULL,created REAL NOT NULL);
CREATE TABLE IF NOT EXISTS rate(tenant TEXT NOT NULL,minute INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(tenant,minute));
CREATE TABLE IF NOT EXISTS leases(name TEXT PRIMARY KEY,token TEXT NOT NULL,expires REAL NOT NULL);
'''
def encode(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def digest(value):return hashlib.sha256(value.encode()).hexdigest()
def uid():return str(uuid.uuid4())

@contextmanager
def connection(write=False):
    db=sqlite3.connect(settings.database_path,timeout=10,isolation_level=None)
    db.row_factory=sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    try:
        if write:db.execute('BEGIN IMMEDIATE')
        yield db
        if write:db.commit()
    except BaseException:
        if write:db.rollback()
        raise
    finally:db.close()

def initialize():
    Path(settings.database_path).parent.mkdir(parents=True,exist_ok=True)
    with connection() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript(SCHEMA)

def issue_key(tenant,actor,role):
    if role not in ['client','reviewer','admin'] or not tenant.strip() or not actor.strip():raise ValueError('Invalid key identity')
    token='mod_live_'+secrets.token_urlsafe(32)
    with connection(True) as db:
        db.execute('INSERT INTO api_keys(id,tenant,actor,role,hash,created) VALUES(?,?,?,?,?,?)',(uid(),tenant,actor,role,digest(token),time.time()))
    return token

def audit(db,identity,action,object_id,details):
    db.execute('INSERT INTO audit VALUES(?,?,?,?,?,?,?)',(uid(),identity['tenant'],identity['actor'],action,object_id,encode(details),time.time()))

@contextmanager
def inference_slot(tenant):
    token=uid();now=time.time();minute=int(now//60)
    with connection(True) as db:
        db.execute('DELETE FROM rate WHERE minute<?',(minute-2,))
        db.execute('INSERT INTO rate VALUES(?,?,1) ON CONFLICT(tenant,minute) DO UPDATE SET count=count+1',(tenant,minute))
        if db.execute('SELECT count FROM rate WHERE tenant=? AND minute=?',(tenant,minute)).fetchone()[0]>settings.rate_per_minute:
            raise HTTPException(429,'Rate limit exceeded',headers={'Retry-After':str(60-int(now)%60)})
        row=db.execute('SELECT * FROM leases WHERE name=?',('inference',)).fetchone()
        if row and row['expires']>now:raise HTTPException(429,'Classifier busy',headers={'Retry-After':'15'})
        db.execute('INSERT OR REPLACE INTO leases VALUES(?,?,?)',('inference',token,now+settings.timeout_seconds*2+30))
    release=True;budget={"retain":False}
    try:yield budget
    except Exception as exc:
        if getattr(exc,'code','')=='model_timeout':release=False
        raise
    finally:
        if release and not budget["retain"]:
            with connection(True) as db:db.execute('DELETE FROM leases WHERE name=? AND token=?',('inference',token))
