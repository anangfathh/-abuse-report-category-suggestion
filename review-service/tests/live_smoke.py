"""Explicit live integration smoke. Synthetic tenant; reviewer action is a TEST SIMULATION, not a real human assessment."""
import json,sys,time,uuid
from pathlib import Path
import requests
credentials=json.loads(Path(sys.argv[1]).read_text());base=credentials['base_url'];out=Path(sys.argv[2]);report={'synthetic_only':True,'review_action':'automated reviewer-API fixture simulation','steps':[]}
def call(method,path,role='client',body=None):
    key=credentials[role]['api_key'];started=time.monotonic()
    r=requests.request(method,base+path,headers={'X-API-Key':key,'Idempotency-Key':str(uuid.uuid4())},json=body,timeout=240)
    value=r.json()
    report['steps'].append({'method':method,'path':path,'status':r.status_code,'seconds':round(time.monotonic()-started,2),'response':value})
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    assert r.status_code==200,(path,r.status_code,value)
    return value

health=requests.get(base+'/health',timeout=20);assert health.status_code==200
assert requests.get(base+'/v1/taxonomy',timeout=20).status_code==401
schema=requests.get(base+'/openapi.json',timeout=20).json();assert schema['servers'][0]['url']=='/moderation-lab'
call('GET','/v1/taxonomy')
clean=call('POST','/v1/classifications',body={'content':'Selamat pagi. Rapat koordinasi dimulai pukul sembilan.'})
assert clean['status']=='completed' and clean['needs_review'] is False and clean['review_id'] is None
queue=call('GET','/v1/reviews','reviewer');assert queue['total']==0
first=call('POST','/v1/classifications',body={'content':'Awas kamu, tunggu saja.'})
assert first['status']=='pending_review' and first['result'] is None,first
queue=call('GET','/v1/reviews','reviewer');assert queue['total']==1
review=call('GET','/v1/reviews/'+first['review_id'],'reviewer');assert review['input']['content']=='Awas kamu, tunggu saja.'
decision=call('POST','/v1/reviews/'+first['review_id']+'/decision','reviewer',{'expected_revision':1,'pelanggaran':False,'rule_ids':[],'rationale':'Simulasi reviewer untuk data sintetis: teks tidak menyebut tindakan kekerasan atau unsur pelanggaran yang cukup.','verification_notes':'Fixture pengujian API review; bukan penilaian manusia terhadap konten nyata.','reuse':'similar','evidence_basis':'text_only','valid_for_hours':1})
assert decision['classification']['status']=='completed' and decision['knowledge_id']
state=call('GET','/v1/classifications/'+first['id']);assert state['decision_source']=='human' and state['pelanggaran'] is False
exact=call('POST','/v1/classifications',body={'content':'Awas kamu, tunggu saja.'})
assert exact['decision_source']=='human_knowledge_exact' and exact['needs_review'] is False
similar=call('POST','/v1/classifications',body={'content':'Awas, kamu. Tunggu saja.'})
assert similar['status'] in ['pending_review','completed']
report['similar_observed_source']=similar['decision_source'];report['similar_needs_review']=similar['needs_review']
revoked=call('POST','/v1/knowledge/'+decision['knowledge_id']+'/revoke','reviewer',{'reason':'Akhir skenario sintetis; hentikan reuse fixture.'})
assert revoked['state']=='revoked'
after=call('POST','/v1/classifications',body={'content':'Awas kamu, tunggu saja.'})
assert after['decision_source']=='llm' and after['status']=='pending_review'
report['passed']=True;out.write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps({'passed':True,'exact_seconds':report['steps'][-4]['seconds'],'similar_observed_source':similar['decision_source'],'similar_needs_review':similar['needs_review'],'steps':len(report['steps'])}))
