import hmac
from fastapi import Header,HTTPException,Depends
from .db import connection,digest

def identity(x_api_key: str|None=Header(None,alias='X-API-Key')):
    if not x_api_key or not x_api_key.startswith('mod_live_'):raise HTTPException(401,'X-API-Key required')
    hashed=digest(x_api_key)
    with connection() as db:row=db.execute('SELECT * FROM api_keys WHERE hash=? AND active=1',(hashed,)).fetchone()
    if not row or not hmac.compare_digest(row['hash'],hashed):raise HTTPException(401,'Invalid API key')
    return dict(row)

def reviewer(user=Depends(identity)):
    if user['role'] not in ['reviewer','admin']:raise HTTPException(403,'Reviewer role required')
    return user
