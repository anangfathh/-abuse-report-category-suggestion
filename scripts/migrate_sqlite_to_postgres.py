"""Copy isolated SQLite snapshots into new PostgreSQL schemas, atomically.
Requires DATABASE_URL, APP_SQLITE_PATH, REVIEW_SQLITE_PATH. Aborts if target schemas exist.
"""
import os,re,sqlite3
import psycopg
from psycopg import sql
from app.moderation_review.db import SCHEMA as REVIEW_SCHEMA

app_schema=os.getenv('MIGRATION_APP_SCHEMA','abuse_reporter')
review_schema=os.getenv('MIGRATION_REVIEW_SCHEMA','moderation_review')
for name in (app_schema,review_schema):
    if not re.fullmatch(r'[a-z_][a-z0-9_]{0,62}',name): raise ValueError('Invalid schema name')
if app_schema == review_schema: raise ValueError('Schemas must be distinct')
app_ddl="""
CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,password TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,csrf TEXT NOT NULL,expires BIGINT NOT NULL);
CREATE TABLE login_limits(identity TEXT PRIMARY KEY,count INTEGER NOT NULL,expires BIGINT NOT NULL);
CREATE TABLE submissions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,idem TEXT NOT NULL,payload TEXT NOT NULL,service_id TEXT,status TEXT NOT NULL,created BIGINT NOT NULL,UNIQUE(idem));
CREATE TABLE audit(id BIGSERIAL PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,object_id TEXT,status INTEGER NOT NULL,created BIGINT NOT NULL);
"""
app_tables=['users','sessions','login_limits','submissions','audit']
review_tables=['api_keys','cases','reviews','review_events','knowledge','audit','rate','leases']
def copy_tables(pg, sqlite_path, schema, tables):
    src=sqlite3.connect('file:'+sqlite_path+'?mode=ro&immutable=1',uri=True)
    try:
        for table in tables:
            columns=[r[1] for r in src.execute('PRAGMA table_info('+table+')')]
            if schema == app_schema and table in ('users','submissions','audit'):
                columns=[c for c in columns if c != 'tenant']
            if not columns: raise RuntimeError('Missing SQLite table '+table)
            rows=src.execute('SELECT '+','.join('"'+c+'"' for c in columns)+' FROM '+table).fetchall()
            q=sql.SQL('INSERT INTO {}.{} ({}) VALUES ({})').format(sql.Identifier(schema),sql.Identifier(table),sql.SQL(',').join(map(sql.Identifier,columns)),sql.SQL(',').join(sql.Placeholder() for _ in columns))
            if rows: pg.executemany(q,rows)
            pg.execute(sql.SQL('SELECT count(*) FROM {}.{}').format(sql.Identifier(schema),sql.Identifier(table)))
            if pg.fetchone()[0]!=len(rows): raise RuntimeError('Row count mismatch '+schema+'.'+table)
            print(schema+'.'+table+': '+str(len(rows))+' rows')
    finally: src.close()
dsn=os.environ['DATABASE_URL'].replace('postgresql+psycopg://','postgresql://').replace('postgresql+psycopg2://','postgresql://')
with psycopg.connect(dsn) as conn:
    with conn.cursor() as cur:
        cur.execute('SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY(%s)',([app_schema,review_schema],))
        if cur.fetchone(): raise RuntimeError('Target schema already exists; refusing to overwrite')
        for schema in (app_schema,review_schema): cur.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(schema)))
        cur.execute(sql.SQL('SET LOCAL search_path TO {}, public').format(sql.Identifier(app_schema)));cur.execute(app_ddl)
        cur.execute(sql.SQL('SET LOCAL search_path TO {}, public').format(sql.Identifier(review_schema)));cur.execute(REVIEW_SCHEMA.replace(' REAL',' DOUBLE PRECISION'))
        copy_tables(cur,os.environ['APP_SQLITE_PATH'],app_schema,app_tables)
        copy_tables(cur,os.environ['REVIEW_SQLITE_PATH'],review_schema,review_tables)
        cur.execute('SELECT setval(%s::regclass, COALESCE((SELECT max(id) FROM '+app_schema+'.audit), 1), EXISTS(SELECT 1 FROM '+app_schema+'.audit))',(app_schema+'.audit_id_seq',))
        role=os.getenv('MIGRATION_APP_ROLE')
        if role:
            if not re.fullmatch(r'[a-z_][a-z0-9_]{0,62}',role): raise ValueError('Invalid app role')
            cur.execute(sql.SQL('GRANT USAGE, CREATE ON SCHEMA {} TO {}').format(sql.Identifier(app_schema),sql.Identifier(role)))
            cur.execute(sql.SQL('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {} TO {}').format(sql.Identifier(app_schema),sql.Identifier(role)))
            cur.execute(sql.SQL('GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA {} TO {}').format(sql.Identifier(app_schema),sql.Identifier(role)))
print('Migration committed; source databases preserved')
