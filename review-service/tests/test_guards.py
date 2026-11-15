import json,pytest,httpx
from moderation_app import classifier,knowledge
from moderation_app.schemas import Submission

TEXT='Aku akan memukul kamu.'
def raw(rule='violence.threat'):
    return {'assessment':'violation','explanation':'Terdapat ancaman eksplisit dalam teks.','findings':[{'rule_id':rule,'assessment':'violation','evidence':[TEXT],'rationale':'Teks mengancam melukai orang tertentu.'}],'missing_context':[]}

@pytest.mark.parametrize('rule',[id for id,(_,r) in classifier.rules().items() if r['evidence_requirement']!='text'])
def test_all_nontext_claims_force_review(rule):
    result=classifier.enrich(raw(rule),Submission(content=TEXT))
    assert result['needs_review'] and result['pelanggaran'] is None

@pytest.mark.parametrize('mode',['invented_rule','invented_quote','extra_key','duplicate'])
def test_invalid_model_content_is_rejected(mode):
    d=raw()
    if mode=='invented_rule':d['findings'][0]['rule_id']='fake.rule'
    if mode=='invented_quote':d['findings'][0]['evidence']=['not in the text']
    if mode=='extra_key':d['unexpected']=True
    if mode=='duplicate':d['findings'].append(d['findings'][0])
    with pytest.raises(ValueError):classifier.enrich(d,Submission(content=TEXT))

@pytest.mark.parametrize('mode',['valid','negative','bad_quote','unknown_field','timeout','invalid_json','truncated'])
def test_equivalence_schema_polarity_and_evidence(monkeypatch,mode):
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,url,headers,json):
            if mode=='timeout':raise httpx.ReadTimeout('model timed out')
            d={'safe_to_reuse':True,'same_intent':True,'same_polarity':mode!='negative','same_target_context':True,'no_missing_facts':True,'evidence':['not present' if mode=='bad_quote' else TEXT],'rationale':'Maksud dan konteks tidak berubah.'}
            if mode=='unknown_field':d['surprise']=True
            return httpx.Response(200,request=httpx.Request('POST',url),json={'choices':[{'finish_reason':'length' if mode=='truncated' else 'stop','message':{'content':'invalid' if mode=='invalid_json' else __import__('json').dumps(d)}}]})
    monkeypatch.setattr(knowledge.httpx,'Client',Client)
    candidate={'input':'{}','result':'{"pelanggaran":true}','rationale':'Keputusan manusia.','verification':''}
    if mode=='timeout':
        with pytest.raises(classifier.ClassificationError):knowledge.equivalent(Submission(content=TEXT),candidate)
    else:assert bool(knowledge.equivalent(Submission(content=TEXT),candidate))==(mode=='valid')

@pytest.mark.parametrize('mode',['valid','nan','dimension','zero','http_error'])
def test_embedding_transport_is_bounded_and_normalized(monkeypatch,mode):
    monkeypatch.setattr(knowledge.settings,'embedding_url','http://embedding.invalid')
    class Client:
        def __init__(self,**kwargs):pass
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def post(self,url,json):
            if mode=='http_error':raise httpx.ConnectError('offline')
            d=[0.0]*1024
            if mode=='dimension':d=[1.0]*2
            elif mode=='nan':d[0]=float('nan')
            elif mode=='valid':d[0]=3.0;d[1]=4.0
            class Response:
                def raise_for_status(self):pass
                def json(self):return {'embedding':d}
            return Response()
    monkeypatch.setattr(knowledge.httpx,'Client',Client)
    r=knowledge.embedding(Submission(content=TEXT))
    if mode=='valid':assert r[:2]==[0.6,0.8]
    else:assert r is None
