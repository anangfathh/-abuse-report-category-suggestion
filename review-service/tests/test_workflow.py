import json,time,threading
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from moderation_app import main,knowledge,classifier,db
from moderation_app.config import settings
from moderation_app.schemas import Equivalence,Submission

@pytest.fixture
def env(tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'database_path',str(tmp_path/'own.sqlite3'))
    monkeypatch.setattr(settings,'embedding_url','')
    monkeypatch.setattr(settings,'rate_per_minute',60)
    db.initialize()
    keys={}
    for tenant,role in [('a','client'),('a','reviewer'),('b','client'),('b','reviewer')]:keys[tenant+role]=db.issue_key(tenant,tenant+'-'+role,role)
    calls=[]
    def predict(body):
        calls.append(body.content)
        raw={'assessment':'needs_review','explanation':'Perlu konteks agar keputusan tepat.','findings':[],'missing_context':['Maksud sasaran belum jelas.']}
        return classifier.enrich(raw,body)
    monkeypatch.setattr(classifier,'classify',predict)
    with TestClient(main.app) as client:yield client,keys,calls

def headers(keys,role='aclient',id='request-0001'):return {'X-API-Key':keys[role],'Idempotency-Key':id}
def submit(env,content='Awas kamu.',id='request-0001',role='aclient',**extra):
    client,keys,_=env
    return client.post('/v1/classifications',headers=headers(keys,role,id),json={'content':content,**extra})
def decide(env,review,violation=True,role='areviewer',revision=1,reuse='exact',**extra):
    client,keys,_=env
    return client.post('/v1/reviews/'+review+'/decision',headers=headers(keys,role),json={'expected_revision':revision,'pelanggaran':violation,'rule_ids':['violence.threat'] if violation else [],'rationale':'Manusia memeriksa konteks dan menentukan hasil.','reuse':reuse,'evidence_basis':'text_only',**extra})
def count(table):
    with db.connection() as conn:return conn.execute('SELECT count(*) FROM '+table).fetchone()[0]

@pytest.mark.parametrize('violation',[True,False])
def test_llm_without_review_is_immediately_final_not_knowledge(env,monkeypatch,violation):
    def predict(body):
        return classifier.enrich({'assessment':'violation' if violation else 'no_violation','explanation':'Unsur teks cukup jelas untuk klasifikasi.',
            'findings':[{'rule_id':'violence.threat','assessment':'violation','evidence':[body.content],'rationale':'Ancaman langsung terhadap seseorang.'}] if violation else [],'missing_context':[]},body)
    monkeypatch.setattr(classifier,'classify',predict)
    r=submit(env,content='Aku akan memukul kamu.').json()
    assert r['status']=='completed' and not r['needs_review'] and r['pelanggaran'] is violation
    assert r['decision_source']=='llm' and r['review_id'] is None
    assert count('reviews')==count('knowledge')==0


def test_only_true_escalates_and_human_result_becomes_reusable(env):
    client,keys,calls=env
    initial=submit(env).json();assert initial['status']=='pending_review' and initial['needs_review'] and initial['result'] is None
    assert initial['prediction']['needs_review'] is True
    queue=client.get('/v1/reviews',headers=headers(keys,'areviewer')).json();assert queue['total']==1
    done=decide(env,initial['review_id']).json()
    assert done['classification']['status']=='completed' and done['classification']['pelanggaran'] is True
    assert done['knowledge_id'] and count('knowledge')==1 and len(calls)==1
    reused=submit(env,id='request-0002').json()
    assert reused['decision_source']=='human_knowledge_exact' and reused['status']=='completed'
    assert not reused['needs_review'] and reused['prediction'] is None and len(calls)==1
    assert count('reviews')==1


def test_approved_non_violation_is_also_reused(env):
    initial=submit(env).json();decide(env,initial['review_id'],violation=False)
    result=submit(env,id='request-0002').json()
    assert result['pelanggaran'] is False and result['result']['findings']==[]


@pytest.mark.parametrize('path',['/v1/reviews','/v1/knowledge'])
def test_client_cannot_read_human_queue_or_knowledge(env,path):
    client,keys,_=env
    assert client.get(path,headers=headers(keys)).status_code==403
    assert client.get(path).status_code==401


def test_cross_tenant_read_review_and_reuse_forbidden(env):
    client,keys,calls=env
    first=submit(env).json();decide(env,first['review_id'])
    assert client.get('/v1/classifications/'+first['id'],headers=headers(keys,'bclient')).status_code==404
    assert decide(env,first['review_id'],role='breviewer').status_code==404
    assert client.get('/v1/reviews/'+first['review_id'],headers=headers(keys,'breviewer')).status_code==404
    assert client.get('/v1/knowledge',headers=headers(keys,'breviewer')).json()['total']==0
    other=submit(env,id='request-0002',role='bclient').json();assert other['status']=='pending_review' and len(calls)==2


@pytest.mark.parametrize('extra',[{'context':'Konteks baru'},{'context_key':'another-target'}])
def test_changed_context_cannot_exact_reuse(env,extra):
    first=submit(env).json();decide(env,first['review_id'])
    assert submit(env,id='request-0002',**extra).json()['status']=='pending_review'


def test_idempotency_and_conflicting_payload(env):
    a=submit(env).json();b=submit(env).json();assert a['id']==b['id'] and len(env[2])==1
    assert submit(env,content='Konten berbeda').status_code==409
    assert count('cases')==count('reviews')==1


def test_two_reviewers_only_one_revision_wins(env):
    first=submit(env).json()
    with ThreadPoolExecutor(2) as pool:
        statuses=list(pool.map(lambda _:decide(env,first['review_id']).status_code,range(2)))
    assert sorted(statuses)==[200,409] and count('knowledge')==1 and count('review_events')==1


def test_correction_revokes_old_knowledge_and_keeps_audit(env):
    client,keys,_=env
    first=submit(env).json();a=decide(env,first['review_id']).json()
    b=decide(env,first['review_id'],violation=False,revision=2).json();assert b['review_revision']==3
    reused=submit(env,id='request-0002').json();assert reused['pelanggaran'] is False
    events=client.get('/v1/reviews/'+first['review_id'],headers=headers(keys,'areviewer')).json()['events'];assert len(events)==2
    with db.connection() as conn:assert conn.execute('SELECT state FROM knowledge WHERE id=?',(a['knowledge_id'],)).fetchone()[0]=='revoked'


@pytest.mark.parametrize('mode',['expired','revoked','old_policy','none'])
def test_unusable_knowledge_never_reused(env,mode):
    first=submit(env).json();k=decide(env,first['review_id'],reuse='none' if mode=='none' else 'exact').json()['knowledge_id']
    with db.connection(True) as conn:
        if mode=='expired':conn.execute('UPDATE knowledge SET expires=? WHERE id=?',(time.time()-1,k))
        if mode=='revoked':conn.execute("UPDATE knowledge SET state='revoked' WHERE id=?",(k,))
        if mode=='old_policy':conn.execute("UPDATE knowledge SET version='old' WHERE id=?",(k,))
    assert submit(env,id='request-0002').json()['status']=='pending_review'


def test_similar_knowledge_requires_opt_in_retrieval_and_equivalence(env,monkeypatch):
    monkeypatch.setattr(knowledge,'embedding',lambda body:[1.0]+[0.0]*1023)
    monkeypatch.setattr(knowledge,'equivalent',lambda body,case:Equivalence(safe_to_reuse=True,same_intent=True,same_polarity=True,same_target_context=True,no_missing_facts=True,evidence=[body.content],rationale='Unsur dan konteks tetap setara.'))
    first=submit(env,content='Aku akan memukul kamu.').json();decide(env,first['review_id'],reuse='similar')
    second=submit(env,content='Kamu akan kupukul.',id='request-0002').json()
    assert second['decision_source']=='human_knowledge_similar' and not second['needs_review']
    assert second['result']['findings'][0]['evidence']==['Kamu akan kupukul.']
    assert len(env[2])==2 and count('reviews')==1 and count('knowledge')==1


def test_similar_words_do_not_override_negation(env,monkeypatch):
    monkeypatch.setattr(knowledge,'embedding',lambda body:[1.0]+[0.0]*1023)
    monkeypatch.setattr(knowledge,'equivalent',lambda body,case:None)
    first=submit(env,content='Aku akan memukul kamu.').json();decide(env,first['review_id'],reuse='similar')
    new=submit(env,content='Jangan memukul dia.',id='request-0002').json()
    assert new['status']=='pending_review' and new['result'] is None


def test_embedding_failure_does_not_lose_review_and_exact_still_works(env,monkeypatch):
    monkeypatch.setattr(knowledge,'embedding',lambda body:None)
    first=submit(env).json();done=decide(env,first['review_id'],reuse='similar')
    assert done.status_code==200 and done.json()['knowledge_id']
    assert submit(env,id='request-0002').json()['decision_source']=='human_knowledge_exact'


def test_media_needs_verification_and_context_for_reuse(env):
    client,keys,_=env;first=submit(env).json()
    payload={'expected_revision':1,'pelanggaran':True,'rule_ids':['adult.unmarked'],'rationale':'Manusia melihat bukti media terkait.','reuse':'similar'}
    assert client.post('/v1/reviews/'+first['review_id']+'/decision',headers=headers(keys,'areviewer'),json=payload).status_code==422
    payload['verification_notes']='Media telah diperiksa secara langsung.'
    result=client.post('/v1/reviews/'+first['review_id']+'/decision',headers=headers(keys,'areviewer'),json=payload).json()
    assert result['reuse']=='none' and result['knowledge_id'] and result['warnings']


@pytest.mark.parametrize('change',[{'platform':'facebook'},{'content':''},{'content':'x'*8001},{'fake':'value'}])
def test_bad_requests_do_not_create_records(env,change):
    client,keys,_=env;body={'content':'Awas kamu.'};body.update(change)
    r=client.post('/v1/classifications',headers=headers(keys),json=body)
    assert r.status_code==422 and count('cases')==0
    assert all('input' not in e for e in r.json()['detail'])


def test_body_limit(env):
    client,keys,_=env
    assert client.post('/v1/classifications',content=b'x'*100_000,headers=headers(keys)).status_code==413


def test_model_failure_is_failed_not_false_or_human_review(env,monkeypatch):
    def fail(body):raise classifier.ClassificationError('invalid_model_output')
    monkeypatch.setattr(classifier,'classify',fail)
    r=submit(env);assert r.status_code==502
    client,keys,_=env
    result=client.get('/v1/classifications/'+r.json()['detail']['classification_id'],headers=headers(keys)).json()
    assert result['status']=='failed' and result['pelanggaran'] is None and count('reviews')==0 and count('knowledge')==0


def test_cannot_review_a_case_without_review_task(env,monkeypatch):
    client,keys,_=env
    assert client.post('/v1/reviews/nonexistent/decision',headers=headers(keys,'aclient'),json={'expected_revision':1,'pelanggaran':False,'rationale':'Hasil diperiksa oleh manusia.'}).status_code==403


def test_human_rule_validation_is_strict(env):
    client,keys,_=env;first=submit(env).json()
    for ids,violation in [(['fake.rule'],True),([],True),(['violence.threat'],False),(['violence.threat','violence.threat'],True)]:
        r=client.post('/v1/reviews/'+first['review_id']+'/decision',headers=headers(keys,'areviewer'),json={'expected_revision':1,'pelanggaran':violation,'rule_ids':ids,'rationale':'Bukti sudah ditinjau manusia.'})
        assert r.status_code==422
    assert count('knowledge')==0


def test_revoked_during_similarity_check_falls_back_to_human(env,monkeypatch):
    monkeypatch.setattr(knowledge,'embedding',lambda body:[1.0]+[0.0]*1023)
    first=submit(env).json();decide(env,first['review_id'],reuse='similar')
    def revoke_during(body,case):
        with db.connection(True) as conn:conn.execute("UPDATE knowledge SET state='revoked' WHERE id=?",(case['id'],))
        return Equivalence(safe_to_reuse=True,same_intent=True,same_polarity=True,same_target_context=True,no_missing_facts=True,evidence=[body.content],rationale='Konteks tampak setara.')
    monkeypatch.setattr(knowledge,'equivalent',revoke_during)
    assert submit(env,content='Awas, kamu.',id='request-0002').json()['status']=='pending_review'


def test_equivalence_timeout_does_not_skip_human_queue(env,monkeypatch):
    monkeypatch.setattr(knowledge,'embedding',lambda body:[1.0]+[0.0]*1023)
    first=submit(env).json();decide(env,first['review_id'],reuse='similar')
    def fail(body,case):raise classifier.ClassificationError('model_timeout')
    monkeypatch.setattr(knowledge,'equivalent',fail)
    assert submit(env,content='Awas, kamu.',id='request-0002').json()['status']=='pending_review'
    with db.connection() as conn:assert conn.execute("SELECT count(*) FROM leases WHERE name='inference'").fetchone()[0]==1


def test_revoked_key_and_other_service_key_rejected(env):
    client,keys,_=env
    assert client.get('/v1/taxonomy',headers={'X-API-Key':'nai_live_not_this_service'}).status_code==401
    with db.connection(True) as conn:conn.execute('UPDATE api_keys SET active=0 WHERE hash=?',(db.digest(keys['aclient']),))
    assert client.get('/v1/taxonomy',headers=headers(keys)).status_code==401


def test_review_detail_has_original_content(env):
    client,keys,_=env;initial=submit(env,content='Teks yang perlu ditinjau.').json()
    r=client.get('/v1/reviews/'+initial['review_id'],headers=headers(keys,'areviewer')).json()
    assert r['input']['content']=='Teks yang perlu ditinjau.'


def test_negative_external_decision_without_context_is_not_reused(env):
    client,keys,_=env;initial=submit(env,content='Caption foto yang belum tersedia.').json()
    result=client.post('/v1/reviews/'+initial['review_id']+'/decision',headers=headers(keys,'areviewer'),json={'expected_revision':1,'pelanggaran':False,'rule_ids':[],'rationale':'Media telah diperiksa manusia dalam skenario uji.','verification_notes':'Hasil bergantung pada foto asli yang diperiksa.','reuse':'similar'}).json()
    assert result['reuse']=='none' and result['knowledge_id']
    assert submit(env,content='Caption foto yang belum tersedia.',id='request-0002').json()['status']=='pending_review'
