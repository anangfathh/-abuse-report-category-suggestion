import test from 'node:test';
import assert from 'node:assert/strict';
import { stateOf, policyLink, knowledgeState, filterTaxonomy, decisionSchema, submissionSchema, routePolicy, hasRole, formatWait, queueHealth, jobStatusNames, publicQueueSummary, publicQueueJob } from '../lib/domain.mjs';
test('only completed + boolean final result is final', () => {
  for (const status of ['processing','failed','pending_review']) assert.equal(stateOf({status,needs_review:false,pelanggaran:false,result:null}), status);
  assert.equal(stateOf({status:'completed',result:null}),'invalid');
  assert.equal(stateOf({status:'completed',result:{pelanggaran:false}}),'no_violation');
  assert.equal(stateOf({status:'completed',result:{pelanggaran:true}}),'violation');
});
test('review decisions require explicit choice, bounds, valid rule relationship', () => {
  const base={expected_revision:1,pelanggaran:true,rule_ids:['violence.threat'],rationale:'Bukti ancaman diperiksa.',verification_notes:'Teks diperiksa.',evidence_basis:'text_only',reuse:'exact',valid_for_hours:24};
  assert.equal(decisionSchema.safeParse(base).success,true);
  for(const update of [{pelanggaran:false},{rule_ids:[]},{rule_ids:['a','a']},{valid_for_hours:0},{valid_for_hours:2161},{valid_for_hours:1.5},{expected_revision:0},{rationale:'a'},{unknown:'field'},{pelanggaran:undefined},{evidence_basis:'external_evidence',verification_notes:''}]) assert.equal(decisionSchema.safeParse({...base,...update}).success,false,JSON.stringify(update));
  assert.equal(decisionSchema.safeParse({...base,pelanggaran:false,rule_ids:[]}).success,true);
});
test('submission enforces strict existing contract', () => {
  assert.equal(submissionSchema.safeParse({platform:'x',content:'konten'}).success,true);
  for(const update of [{content:' '},{content:'x'.repeat(8001)},{context:'x'.repeat(3001)},{context_key:'x'.repeat(201)},{platform:'youtube'},{tenant:'other'}]) assert.equal(submissionSchema.safeParse({platform:'x',content:'konten',...update}).success,false);
});
test('permission matrix has no invented endpoints and admin-only knowledge writes',()=>{
  assert.equal(hasRole({role:'operator'},routePolicy('/reviews','GET')),false);
  assert.equal(hasRole({role:'reviewer'},routePolicy('/knowledge/id/revoke','POST')),false);
  assert.equal(hasRole({role:'admin'},routePolicy('/knowledge/id/reindex','POST')),true);
  assert.equal(routePolicy('/knowledge/id','GET'),null);
  assert.equal(routePolicy('/reviews/id/claim','POST'),null);
});
test('untrusted policy URLs and expiry are handled separately',()=>{
  for(const url of ['javascript:alert(1)','data:text/html,hi','file:///etc/passwd']) assert.equal(policyLink(url),null);
  assert.equal(policyLink('https://help.x.com/policy'),'https://help.x.com/policy');
  assert.equal(knowledgeState({state:'revoked',expires:9999},0),'revoked');
  assert.equal(knowledgeState({state:'active',expires:1},2000),'expired');
  assert.equal(knowledgeState({state:'active',expires:9,index_error:'failed'},2000),'active');
});

test('taxonomy search matches categories, rules and details without mutating the catalogue', () => {
  const categories=[{id:'violence',label:'Kekerasan',subcategories:[{id:'violence.threat',label:'Ancaman',detail:'Tindakan fisik'},{id:'violence.other',label:'Lainnya',detail:'Konteks'}]},{id:'privacy',label:'Privasi',subcategories:[]}];
  assert.equal(filterTaxonomy(categories,' KEKERASAN ')[0].subcategories.length,2);
  assert.deepEqual(filterTaxonomy(categories,'FISIK')[0].subcategories.map(x=>x.id),['violence.threat']);
  assert.equal(filterTaxonomy(categories,'tak ada').length,0);
  assert.equal(categories[0].subcategories.length,2);
});

test('classification queue is read-only and reviewer-only',() => {
  for (const path of ['/queue/summary','/queue/jobs']) {
    assert.equal(routePolicy(path,'GET'),'reviewer');
    for (const method of ['POST','PUT','DELETE']) assert.equal(routePolicy(path,method),null);
  }
  assert.equal(routePolicy('/queue/jobs/abc/cancel','POST'),null);
  assert.equal(routePolicy('/queue','GET'),null);
  assert.equal(hasRole({role:'operator'},routePolicy('/queue/summary','GET')),false);
  assert.equal(hasRole({role:'admin'},routePolicy('/queue/summary','GET')),true);
});
test('queue formatting and health only warn on actionable signals',() => {
  assert.equal(formatWait(null),'—');assert.equal(formatWait(-1),'—');assert.equal(formatWait(42),'42 dtk');
  assert.equal(formatWait(125),'2 mnt 5 dtk');assert.equal(formatWait(3725),'1 jam 2 mnt');
  assert.deepEqual(Object.keys(jobStatusNames),['queued','processing','completed','failed','cancelled']);
  assert.equal(queueHealth(null),null);
  assert.equal(queueHealth({counts:{queued:3},oldest_queued_age_seconds:30,limits:{max_pending:50}}),null);
  assert.match(queueHealth({counts:{queued:1},oldest_queued_age_seconds:900}).text,/15 mnt/);
  assert.match(queueHealth({counts:{queued:35,processing:5},oldest_queued_age_seconds:5,limits:{max_pending:50}}).text,/hampir penuh/);
});
test('queue payloads are whitelisted before reaching the browser',() => {
  const job = publicQueueJob({ job_id: 'j1', status: 'failed', external_reference_id: 'c1', attempts: 2, created_at: 'x', input: { content: 'secret' },
    callback: { url: 'https://hook.example/?token=t' }, result: { a: 1 }, error: { code: 'model_timeout', message: 'm', retryable: true, internal: 'stack' } });
  assert.deepEqual(Object.keys(job).sort(),['attempts','completed_at','created_at','error','expires_at','external_reference_id','job_id','started_at','status']);
  assert.deepEqual(job.error,{ code: 'model_timeout', message: 'm', retryable: true });
  assert.equal(JSON.stringify(job).includes('secret'),false);assert.equal(JSON.stringify(job).includes('token'),false);
  assert.equal(publicQueueJob({ job_id: 'j2', status: 'queued', error: 'oops' }).error,null);
  const summary = publicQueueSummary({ counts: { queued: 3, failed: 'x', bogus: 9 }, retrying_jobs: 1, callbacks: { dead: 1 }, secret: 's', limits: { max_pending: 50, other: 1 } });
  assert.deepEqual(summary.counts,{ queued: 3, processing: 0, completed: 0, failed: 0, cancelled: 0 });
  assert.equal(summary.secret,undefined);assert.equal(summary.callbacks,undefined);assert.deepEqual(Object.keys(summary.limits),['max_pending','max_attempts','retention_days']);
  assert.deepEqual(publicQueueSummary(null).counts,{ queued: 0, processing: 0, completed: 0, failed: 0, cancelled: 0 });
});

test('report menu keeps exact labels separate from translated policy and unmapped rules', async () => {
  const { reportMenuGroups } = await import('../lib/domain.mjs');
  const tax={categories:[{label:'Pelecehan',source_url:'https://help.x.com/rules',subcategories:[{id:'abuse.targeted',label:'Pelecehan terarah'},{id:'civic.other',label:'Kebijakan lain'}]}], report_menu:{categories:[{id:'hate_abuse_harassment',label:'Hate, Abuse, or Harassment',verification:'user_screenshot_verified',rule_ids:['abuse.targeted']},{id:'adult',label:'Adult Sexual Content',verification:'client_documented_not_live_verified',rule_ids:[]}]}};
  const before=JSON.stringify(tax), groups=reportMenuGroups(tax);
  assert.equal(groups.verified[0].label,'Hate, Abuse, or Harassment');
  assert.equal(groups.verified[0].subcategories[0].policy_category,'Pelecehan');
  assert.equal(groups.documented.length,1);
  assert.deepEqual(groups.unmapped.map(r=>r.id),['civic.other']);
  assert.equal(JSON.stringify(tax),before);
});
