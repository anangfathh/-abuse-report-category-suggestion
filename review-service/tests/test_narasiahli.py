import copy
import httpx
import pytest
from pydantic import SecretStr
from moderation_app import classifier,narasiahli,main,db
from moderation_app.schemas import Submission

CONTENT='Selamat pagi, rapat dimulai pukul sembilan.'

@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setattr(narasiahli.settings,'narasiahli_tenants','app-tenant')
    monkeypatch.setattr(narasiahli.settings,'narasiahli_api_base_url','https://legacy.example/api/v1/external/moderation')
    monkeypatch.setattr(narasiahli.settings,'narasiahli_api_key',SecretStr('fixture-narasi-secret'))

def output(needs=False):
    data=classifier.enrich({'assessment':'needs_review' if needs else 'no_violation',
        'explanation':'Konteks teks perlu ditinjau.' if needs else 'Tidak ada unsur pelanggaran dalam teks.',
        'findings':[],'missing_context':['Perlu memastikan konteks percakapan.'] if needs else []},Submission(content=CONTENT))
    data.update(request_id='legacy-request-fixture',processing_ms=123)
    return data

def mock_transport(monkeypatch,respond):
    calls=[]
    real_client=httpx.Client
    def handler(request):
        calls.append(request)
        return respond(request)
    monkeypatch.setattr(narasiahli.httpx,'Client',lambda **kwargs:real_client(transport=httpx.MockTransport(handler),**kwargs))
    return calls

@pytest.mark.parametrize('needs',[False,True])
def test_uses_legacy_route_supported_fields_and_provenance(setup,monkeypatch,needs):
    calls=mock_transport(monkeypatch,lambda req:httpx.Response(200,json=classifier.taxonomy() if req.method=='GET' else output(needs)))
    result=narasiahli.classify(Submission(content=CONTENT,context_key='stable-target',external_reference_id='post-1'))
    assert result['needs_review'] is needs
    assert result['prediction_provider']=='narasiahli'
    assert result['prediction_request_id']=='legacy-request-fixture'
    assert [r.url.path for r in calls]==['/api/v1/external/moderation/taxonomy','/api/v1/external/moderation/classify']
    assert calls[-1].headers['X-API-Key']=='fixture-narasi-secret'
    import json
    assert set(json.loads(calls[-1].content))=={'platform','content','context'}
    assert not any('/chat/completions' in str(r.url) for r in calls)

@pytest.mark.parametrize('status',[401,403,409,429,500,502,503,504])
def test_http_failure_never_falls_back_to_direct_llm(setup,monkeypatch,status):
    calls=mock_transport(monkeypatch,lambda req:httpx.Response(200,json=classifier.taxonomy()) if req.method=='GET' else httpx.Response(status,json={'detail':'failure'},headers={'Retry-After':'19'}))
    with pytest.raises(narasiahli.PredictionAPIError) as error:narasiahli.classify(Submission(content=CONTENT))
    assert error.value.status==(502 if status in (409,500) else status)
    if status==429:assert error.value.retry_after=='19'
    assert len(calls)==2

@pytest.mark.parametrize('mode',['policy','bad_boolean','missing_request_id','wrong_quote','unknown_rule','state_conflict','invalid_json','redirect'])
def test_invalid_or_changed_policy_fails_closed(setup,monkeypatch,mode):
    def respond(req):
        if req.method=='GET':
            taxonomy=copy.deepcopy(classifier.taxonomy())
            if mode=='policy':taxonomy['version']='new-policy'
            return httpx.Response(200,json=taxonomy)
        data=output()
        if mode=='bad_boolean':data['needs_review']='false'
        if mode=='missing_request_id':data.pop('request_id')
        if mode in ('wrong_quote','unknown_rule'):
            data=output(True);data['findings']=[{'rule_id':'invented' if mode=='unknown_rule' else 'violence.threat','assessment':'violation','evidence':['not in original text'],'rationale':'Must be checked carefully.'}]
        if mode=='state_conflict':data['status']='violation'
        if mode=='invalid_json':return httpx.Response(200,content=b'not json')
        if mode=='redirect':return httpx.Response(302,headers={'location':'https://attacker.invalid'})
        return httpx.Response(200,json=data)
    mock_transport(monkeypatch,respond)
    with pytest.raises(narasiahli.PredictionAPIError):narasiahli.classify(Submission(content=CONTENT))

def test_configuration_and_tenant_selection(setup,monkeypatch):
    assert narasiahli.enabled('app-tenant')
    assert not narasiahli.enabled('other-tenant')
    monkeypatch.setattr(narasiahli.settings,'narasiahli_api_key',SecretStr(''))
    with pytest.raises(narasiahli.PredictionAPIError) as e:narasiahli.classify(Submission(content=CONTENT))
    assert e.value.status==503

def test_timeout_has_no_retry_or_reroute(setup,monkeypatch):
    def respond(req):raise httpx.ReadTimeout('fixture timeout')
    calls=mock_transport(monkeypatch,respond)
    with pytest.raises(narasiahli.PredictionAPIError) as e:narasiahli.classify(Submission(content=CONTENT))
    assert e.value.status==504
    assert len(calls)==1

@pytest.mark.parametrize('needs',[False,True])
def test_workflow_keeps_review_queue_and_never_uses_local_classifier(setup,monkeypatch,tmp_path,needs):
    monkeypatch.setattr(db.settings,'database_path',str(tmp_path/'review.sqlite3'))
    monkeypatch.setattr(main.settings,'embedding_url','')
    db.initialize()
    mock_transport(monkeypatch,lambda req:httpx.Response(200,json=classifier.taxonomy() if req.method=='GET' else output(needs)))
    def forbidden(body):raise AssertionError('Direct LLM classification must not run for opted-in tenant')
    monkeypatch.setattr(classifier,'classify',forbidden)
    result=main.submit(Submission(content=CONTENT),idempotency_key='narasi-workflow-test',user={'tenant':'app-tenant','actor':'client','role':'client'})
    assert result['status']==('pending_review' if needs else 'completed')
    assert (result['result'] is None) is needs
    data=result['prediction'] if needs else result['result']
    assert data['prediction_provider']=='narasiahli'
    with db.connection() as c:
        assert c.execute('SELECT count(*) FROM knowledge').fetchone()[0]==0
        assert c.execute('SELECT count(*) FROM reviews').fetchone()[0]==int(needs)
