import test from 'node:test';
import assert from 'node:assert/strict';
import { stateOf, policyLink, knowledgeState, filterTaxonomy, decisionSchema, submissionSchema, routePolicy, hasRole } from '../lib/domain.mjs';
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
