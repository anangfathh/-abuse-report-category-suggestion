import json,time,sqlite3
from contextlib import asynccontextmanager
from fastapi import FastAPI,Depends,Header,HTTPException,Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from . import classifier,knowledge,narasiahli
from .db import initialize,connection,encode,digest,uid,audit,inference_slot
from .auth import identity,reviewer
from .schemas import Submission,HumanDecision,RevokeRequest

@asynccontextmanager
async def lifespan(app):
    initialize()
    yield
app=FastAPI(title='Moderation Review Service',version='0.1.0',root_path=settings.root_path,lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origins=[s.strip() for s in settings.allowed_origins.split(',') if s.strip()],allow_credentials=False,allow_methods=['GET','POST'],allow_headers=['X-API-Key','Content-Type','Idempotency-Key'],expose_headers=['Retry-After'])

class BodyLimit:
    def __init__(self,app):self.app=app
    async def __call__(self,scope,receive,send):
        if scope['type']!='http':return await self.app(scope,receive,send)
        async def private(message):
            if message['type']=='http.response.start':
                message['headers']=[(k,v) for k,v in message.get('headers',[]) if k.lower()!=b'cache-control']+[(b'cache-control',b'private, no-store'),(b'x-content-type-options',b'nosniff')]
            await send(message)
        if scope['method']!='POST':return await self.app(scope,receive,private)
        size=0;parts=[]
        while True:
            msg=await receive()
            if msg['type']=='http.disconnect':return
            size+=len(msg.get('body',b''))
            if size>96*1024:return await JSONResponse({'detail':'Request too large'},status_code=413)(scope,receive,private)
            parts.append(msg.get('body',b''))
            if not msg.get('more_body',False):break
        body=b''.join(parts);used=False
        async def replay():
            nonlocal used
            if not used:used=True;return {'type':'http.request','body':body,'more_body':False}
            return await receive()
        return await self.app(scope,replay,private)
app.add_middleware(BodyLimit)

@app.exception_handler(RequestValidationError)
async def validation(request,exc):
    return JSONResponse({'detail':[{'loc':list(e['loc']),'type':e['type'],'msg':e['msg']} for e in exc.errors()]},status_code=422)

@app.get('/health')
def health():return {'status':'ok','service':'moderation-review','version':'0.1.0'}

@app.get('/v1/taxonomy')
def taxonomy(user=Depends(identity)):return classifier.taxonomy()

def case_row(db,tenant,id):
    row=db.execute('SELECT * FROM cases WHERE tenant=? AND id=?',(tenant,id)).fetchone()
    if not row:raise HTTPException(404,'Classification not found')
    return row

def public_case(row):
    final=json.loads(row['result']) if row['result'] else None
    return {'id':row['id'],'status':row['status'],'needs_review':row['status']=='pending_review',
            'pelanggaran':final['pelanggaran'] if final else None,'result':final,
            'prediction':json.loads(row['prediction']) if row['prediction'] else None,
            'decision_source':row['source'],'error':row['error'],'review_id':row['review_id'],
            'revision':row['revision'],'external_reference_id':json.loads(row['input']).get('external_reference_id'),
            'created_at':row['created'],'updated_at':row['updated']}

def existing(db,tenant,key,hashed):
    row=db.execute('SELECT * FROM cases WHERE tenant=? AND idempotency=?',(tenant,key)).fetchone()
    if row and row['payload_hash']!=hashed:raise HTTPException(409,'Idempotency-Key reused with different input')
    return row

def insert_case(db,user,body,key):
    id=uid();now=time.time()
    db.execute('INSERT INTO cases(id,tenant,idempotency,payload_hash,fingerprint,version,input,status,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',
               (id,user['tenant'],key,digest(encode(body.model_dump())),knowledge.fingerprint(body),classifier.taxonomy()['version'],encode(body.model_dump()),'processing',now,now))
    return id

def finish(db,user,id,result,source,prediction=None):
    now=time.time();review_id=None;status='completed';final=result
    if result['needs_review']:
        review_id=uid();status='pending_review';final=None
        db.execute('INSERT INTO reviews(id,case_id,tenant,status,created,updated) VALUES(?,?,?,?,?,?)',(review_id,id,user['tenant'],'pending',now,now))
    db.execute('UPDATE cases SET status=?,prediction=?,result=?,source=?,review_id=?,updated=? WHERE id=?',(status,encode(prediction if prediction is not None else result) if prediction is not None or source=='llm' else None,encode(final) if final else None,source,review_id,now,id))
    audit(db,user,'classification_'+status,id,{'source':source,'review_id':review_id})
    return public_case(case_row(db,user['tenant'],id))

@app.post('/v1/classifications')
def submit(body:Submission,idempotency_key:str=Header(...,alias='Idempotency-Key',min_length=8,max_length=128),user=Depends(identity)):
    hashed=digest(encode(body.model_dump()))
    with connection() as db:
        old=existing(db,user['tenant'],idempotency_key,hashed)
        if old:return public_case(old)
    precedent=knowledge.exact(user['tenant'],body)
    if precedent:
        with connection(True) as db:
            old=existing(db,user['tenant'],idempotency_key,hashed)
            if old:return public_case(old)
            fresh=knowledge.active(db,user['tenant'],precedent['id'])
            if fresh:
                id=insert_case(db,user,body,idempotency_key)
                return finish(db,user,id,knowledge.reused(dict(fresh),'exact'),'human_knowledge_exact')
    with inference_slot(user['tenant']) as budget:
        with connection(True) as db:
            old=existing(db,user['tenant'],idempotency_key,hashed)
            if old:return public_case(old)
            id=insert_case(db,user,body,idempotency_key)
        try:
            prediction=narasiahli.classify(body) if narasiahli.enabled(user['tenant']) else classifier.classify(body)
            result=prediction;source='llm'
            # needs_review=false is final immediately. Do not turn it into a task.
            if prediction['needs_review']:
                eligible=not any(f['evidence_requirement']!='text' for f in prediction['findings'])
                if eligible:
                    matches=knowledge.candidates(user['tenant'],body,knowledge.embedding(body))
                    def decision_key(c):
                        r=json.loads(c['result']);return (r['pelanggaran'],tuple(sorted(f['rule_id'] for f in r['findings'])))
                    if len({decision_key(c) for _,c in matches})<=1:
                        # At most one additional LLM call, even if top-k are retrieved.
                        for score,candidate in matches[:1]:
                            try:equal=knowledge.equivalent(body,candidate)
                            except classifier.ClassificationError:
                                budget['retain']=True;equal=None
                            if equal:
                                with connection() as db:fresh=knowledge.active(db,user['tenant'],candidate['id'])
                                if fresh:
                                    result=knowledge.reused(dict(fresh),'similar',equal.evidence)
                                    result['reuse_check']={'cosine_similarity':score,'rationale':equal.rationale}
                                    source='human_knowledge_similar'
            with connection(True) as db:
                # Recheck revocation/expiry at commit, not only before the model call.
                if source.startswith('human_knowledge') and not knowledge.active(db,user['tenant'],result['knowledge_id']):
                    result=prediction;source='llm'
                return finish(db,user,id,result,source,prediction)
        except classifier.ClassificationError as exc:
            with connection(True) as db:db.execute("UPDATE cases SET status='failed',error=?,updated=? WHERE id=?",(exc.code,time.time(),id))
            code=getattr(exc,'status',504 if exc.code=='model_timeout' else 502)
            retry=getattr(exc,'retry_after',None)
            raise HTTPException(code,{'code':exc.code,'classification_id':id},headers={'Retry-After':retry} if retry else None) from None
        except Exception:
            with connection(True) as db:db.execute("UPDATE cases SET status='failed',error='internal_error',updated=? WHERE id=?",(time.time(),id))
            raise

@app.get('/v1/classifications/{id}')
def get_case(id:str,user=Depends(identity)):
    with connection(True) as db:
        row=case_row(db,user['tenant'],id)
        if row['status']=='processing' and row['updated']<time.time()-settings.timeout_seconds*2-60:
            db.execute("UPDATE cases SET status='failed',error='processing_expired',updated=? WHERE id=?",(time.time(),id));row=case_row(db,user['tenant'],id)
        return public_case(row)

@app.get('/v1/reviews')
def reviews(status:str=Query('pending',pattern='^(pending|completed)$'),limit:int=Query(25,ge=1,le=100),offset:int=Query(0,ge=0),user=Depends(reviewer)):
    with connection() as db:
        rows=db.execute('SELECT r.*,c.input,c.prediction FROM reviews r JOIN cases c ON c.id=r.case_id WHERE r.tenant=? AND r.status=? ORDER BY r.created LIMIT ? OFFSET ?',(user['tenant'],status,limit,offset)).fetchall()
        return {'items':[{**dict(r),'input':json.loads(r['input']),'prediction':json.loads(r['prediction'])} for r in rows],
                'total':db.execute('SELECT count(*) FROM reviews WHERE tenant=? AND status=?',(user['tenant'],status)).fetchone()[0]}

@app.get('/v1/reviews/{id}')
def get_review(id:str,user=Depends(reviewer)):
    with connection() as db:
        row=db.execute('SELECT * FROM reviews WHERE id=? AND tenant=?',(id,user['tenant'])).fetchone()
        if not row:raise HTTPException(404,'Review not found')
        events=db.execute('SELECT revision,actor,decision,created FROM review_events WHERE review_id=? ORDER BY revision',(id,)).fetchall()
        case=case_row(db,user['tenant'],row['case_id'])
        return {**dict(row),'input':json.loads(case['input']),'classification':public_case(case),'events':[{**dict(e),'decision':json.loads(e['decision'])} for e in events]}

def human_result(body,submission,user):
    ids=body.rule_ids
    if len(ids)!=len(set(ids)) or any(id not in classifier.rules() for id in ids):raise HTTPException(422,'Unknown/duplicate rule IDs')
    if body.pelanggaran!=bool(ids):raise HTTPException(422,'Violation requires rules; non-violation requires an empty rule list')
    findings=[]
    for id in ids:
        category,rule=classifier.rules()[id]
        findings.append({'rule_id':id,'category_id':category['id'],'category':category['label'],'subcategory':rule['label'],'detail':rule['detail'],
                         'assessment':'violation','evidence':[], 'rationale':body.rationale,'evidence_requirement':rule['evidence_requirement'],
                         'policy':{'title':category['policy_title'],'url':rule.get('source_url',category['source_url'])}})
    return {'platform':'x','taxonomy_version':classifier.taxonomy()['version'],'taxonomy_kind':'policy_mapping','report_ui_verified':False,
            'status':'violation' if body.pelanggaran else 'no_violation','pelanggaran':body.pelanggaran,'needs_review':False,
            'findings':findings,'explanation':body.rationale,'missing_context':[],'decision_source':'human',
            'reviewed_by':user['actor'],'verification_notes':body.verification_notes,'evidence_basis':body.evidence_basis}

@app.post('/v1/reviews/{id}/decision')
def decide(id:str,body:HumanDecision,user=Depends(reviewer)):
    new_id=None;warnings=[];now=time.time()
    with connection(True) as db:
        review=db.execute('SELECT * FROM reviews WHERE id=? AND tenant=?',(id,user['tenant'])).fetchone()
        if not review:raise HTTPException(404,'Review not found')
        if review['revision']!=body.expected_revision:raise HTTPException(409,'Review revision changed; reload before deciding')
        case=case_row(db,user['tenant'],review['case_id'])
        if case['version']!=classifier.taxonomy()['version']:raise HTTPException(409,'Policy version changed; reclassify under current policy')
        submission=Submission.model_validate_json(case['input']);result=human_result(body,submission,user)
        revision=review['revision']+1
        db.execute("UPDATE knowledge SET state='revoked' WHERE case_id=? AND tenant=? AND state='active'",(case['id'],user['tenant']))
        reuse=body.reuse
        predicted=json.loads(case['prediction']) if case['prediction'] else {}
        nontext=body.evidence_basis!='text_only' or any(f['evidence_requirement']!='text' for f in result['findings']) or any(f.get('evidence_requirement','text')!='text' for f in predicted.get('findings',[]))
        if nontext and len(body.verification_notes.strip())<5:raise HTTPException(422,'Verification notes required for external/media/context decisions')
        if nontext and reuse=='similar':reuse='exact';warnings.append('External/media facts cannot be reused by similarity')
        if nontext and not submission.context_key:reuse='none';warnings.append('context_key required to reuse external/media facts')
        new_id=uid()
        db.execute('INSERT INTO knowledge(id,tenant,case_id,revision,fingerprint,context_key,context,version,input,result,rationale,verification,reuse,state,actor,expires,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       (new_id,user['tenant'],case['id'],revision,case['fingerprint'],submission.context_key,submission.context,case['version'],case['input'],encode(result),body.rationale,body.verification_notes,reuse,'active',user['actor'],now+body.valid_for_hours*3600,now))
        db.execute('INSERT INTO review_events VALUES(?,?,?,?,?,?)',(uid(),id,revision,user['actor'],encode(body.model_dump()),now))
        db.execute("UPDATE reviews SET status='completed',revision=?,updated=? WHERE id=?",(revision,now,id))
        db.execute("UPDATE cases SET status='completed',result=?,source='human',revision=revision+1,updated=? WHERE id=?",(encode(result),now,case['id']))
        audit(db,user,'human_decision',id,{'revision':revision,'knowledge_id':new_id,'reuse':reuse})
        response={'classification':public_case(case_row(db,user['tenant'],case['id'])),'review_revision':revision,'knowledge_id':new_id,'reuse':reuse,'warnings':warnings}
    # A failed embedding must not roll back a human decision. Exact reuse still works.
    if new_id and reuse=='similar':index_knowledge(user,new_id)
    return response

def index_knowledge(user,id):
    with connection() as db:
        row=db.execute('SELECT * FROM knowledge WHERE id=? AND tenant=?',(id,user['tenant'])).fetchone()
        if not row:raise HTTPException(404,'Knowledge not found')
        body=Submission.model_validate_json(row['input'])
    vector=knowledge.embedding(body)
    with connection(True) as db:
        db.execute('UPDATE knowledge SET vector=?,vector_model=?,index_error=? WHERE id=? AND tenant=?',(encode(vector) if vector else None,settings.embedding_model if vector else None,None if vector else 'embedding_unavailable_or_oversize',id,user['tenant']))
    return {'id':id,'indexed':vector is not None}

@app.get('/v1/knowledge')
def list_knowledge(limit:int=Query(25,ge=1,le=100),offset:int=Query(0,ge=0),user=Depends(reviewer)):
    with connection() as db:
        rows=db.execute('SELECT * FROM knowledge WHERE tenant=? ORDER BY created DESC LIMIT ? OFFSET ?',(user['tenant'],limit,offset)).fetchall()
        return {'items':[{k:(json.loads(v) if k in ['input','result'] else v) for k,v in dict(row).items() if k not in ['vector','fingerprint','tenant']} for row in rows],
                'total':db.execute('SELECT count(*) FROM knowledge WHERE tenant=?',(user['tenant'],)).fetchone()[0]}

@app.post('/v1/knowledge/{id}/reindex')
def reindex(id:str,user=Depends(reviewer)):return index_knowledge(user,id)

@app.post('/v1/knowledge/{id}/revoke')
def revoke(id:str,body:RevokeRequest,user=Depends(reviewer)):
    with connection(True) as db:
        row=db.execute('SELECT * FROM knowledge WHERE id=? AND tenant=?',(id,user['tenant'])).fetchone()
        if not row:raise HTTPException(404,'Knowledge not found')
        db.execute("UPDATE knowledge SET state='revoked' WHERE id=? AND tenant=?",(id,user['tenant']))
        audit(db,user,'knowledge_revoked',id,{'reason':body.reason})
    return {'id':id,'state':'revoked'}
