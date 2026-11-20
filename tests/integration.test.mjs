import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

test('real BFF: login, roles, direct final, review/correction, retries and error recovery', {timeout:120000}, async t => {
  const directory=mkdtempSync(join(tmpdir(),'abuse-reporter-test-'));
  process.env.APP_DATABASE_PATH=join(directory,'test.sqlite3');
  const {db,hashPassword}=await import('../lib/store.mjs');
  const password='Fixture-only-password-9021';
  for(const [id,role] of [['operator','operator'],['reviewer','reviewer'],['reviewer2','reviewer'],['admin','admin'],['outsider','operator']]) await db().prepare('INSERT INTO users(id,email,name,role,password) VALUES(?,?,?,?,?)').run(id,id+'@example.test',id,role,hashPassword(password));
  const cases=new Map(),keys=new Map(),reviews=new Map(),knowledge=new Map(),calls=[];
  let mutation=0,dropNextDecision=false,failedOnce=false;
  const taxonomy={version:'fixture-policy',categories:[{id:'violence',label:'Kekerasan',subcategories:[{id:'violence.threat',label:'Ancaman',evidence_requirement:'text'}]}]};
  const upstream=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;let body=raw?JSON.parse(raw):null;
    const url=new URL(req.url,'http://fixture'),key=req.headers['x-api-key'],tenant=key?.startsWith('b-')?'b':'a';
    url.pathname=url.pathname.replace(/^\/api\/v1\/external\/moderation-review/, '').replace(/^\/api\/v1\/external\/moderation(?=\/(?:history|jobs))/, '');
    calls.push({path:url.pathname,method:req.method,tenant,body,key});
    const send=(status,data,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(data));};
    if(url.pathname==='/history')return send(200,{items:[{id:'fixture-request',created_at:'2026-11-17T00:00:00Z',input:{content:'Contoh riwayat API'},result:{status:'no_violation',explanation:'Tidak ditemukan pelanggaran.',findings:[]}}],total:1});
    if(url.pathname==='/jobs/summary')return send(200,{counts:{queued:2,processing:1,completed:9,failed:1,cancelled:0},retrying_jobs:1,oldest_queued_age_seconds:42,limits:{max_pending:50}});
    if(url.pathname==='/jobs')return send(200,{items:[{job_id:'job-fixture-1',status:url.searchParams.get('status')||'queued',external_reference_id:'case-1',attempts:1,input:{content:'secret text'},callback:{url:'https://x.example/hook'},result:{k:'v'},error:null}],total:1,limit:Number(url.searchParams.get('limit')),offset:Number(url.searchParams.get('offset'))});
    if(url.pathname==='/v1/taxonomy')return send(200,taxonomy);
    if(url.pathname==='/v1/classifications'&&req.method==='POST'){
      const idem=tenant+':'+req.headers['idempotency-key'];
      if(keys.has(idem))return send(200,cases.get(keys.get(idem)));
      if(body.content==='rate')return send(429,{detail:'Busy'},{'Retry-After':'3'});
      if(body.content==='unauthorized')return send(401,{detail:'Service credential rejected'});
      if(body.content==='oversize')return send(413,{detail:'Oversize'});
      if(body.content==='validation')return send(422,{detail:'Validation failed'});
      const id=randomUUID(),needs=body.content==='review',status=body.content==='failed'?'failed':body.content==='processing'?'processing':needs?'pending_review':'completed';
      const result={pelanggaran:body.content==='violation',needs_review:false,explanation:'Fixture decision',findings:[],taxonomy_version:'fixture-policy'};
      const record={id,tenant,status,needs_review:needs,pelanggaran:status==='completed'?result.pelanggaran:null,result:status==='completed'?result:null,prediction:result,decision_source:'llm',created_at:1,updated_at:1,revision:1,review_id:needs?randomUUID():null};
      cases.set(id,record);keys.set(idem,id);
      if(needs)reviews.set(record.review_id,{id:record.review_id,tenant,case_id:id,revision:1,status:'pending',input:body,classification:record,events:[]});
      if(body.content==='lost'&&!failedOnce){failedOnce=true;res.destroy();return;}
      if(body.content==='failed')return send(504,{detail:{code:'model_timeout',classification_id:id}});
      if(body.content==='badgateway')return send(502,{detail:{code:'model_error',classification_id:id}});
      if(body.content==='exact'){record.decision_source='human_knowledge_exact';record.prediction=null;}
      if(body.content==='similar')record.decision_source='human_knowledge_similar';
      if(body.content==='legacy'){record.result.prediction_provider='narasiahli';record.result.prediction_request_id='legacy-fixture-request';}
      return send(200,record);
    }
    if(url.pathname.startsWith('/v1/classifications/')){const c=cases.get(url.pathname.split('/')[3]);return c?.tenant===tenant?send(200,c):send(404,{detail:'Not found'});}
    if(url.pathname==='/v1/reviews')return send(200,{items:[...reviews.values()].filter(r=>r.tenant===tenant&&r.status===url.searchParams.get('status')),total:[...reviews.values()].filter(r=>r.tenant===tenant&&r.status===url.searchParams.get('status')).length});
    if(url.pathname.startsWith('/v1/reviews/')){
      const r=reviews.get(url.pathname.split('/')[3]);if(r?.tenant!==tenant)return send(404,{detail:'Not found'});
      if(req.method==='GET')return send(200,r);
      if(body.expected_revision!==r.revision)return send(409,{detail:'Review revision changed; reload before deciding'});
      if(body.rationale==='POLICY CHANGED')return send(409,{detail:'Policy version changed; reclassify under current policy'});
      mutation++;r.revision++;r.status='completed';r.events.push({revision:r.revision,actor:'fixture-integration',decision:body,created:2});
      r.classification.status='completed';r.classification.result={pelanggaran:body.pelanggaran,explanation:body.rationale,findings:[]};r.classification.decision_source='human';
      for(const k of knowledge.values())if(k.case_id===r.case_id)k.state='revoked';
      const kid=randomUUID();knowledge.set(kid,{id:kid,tenant,case_id:r.case_id,state:'active',reuse:'none',expires:100,revision:r.revision});
      if(dropNextDecision){dropNextDecision=false;res.destroy();return;}
      return send(200,{classification:r.classification,review_revision:r.revision,knowledge_id:kid,reuse:'none',warnings:['context_key required to reuse external/media facts']});
    }
    if(url.pathname==='/v1/knowledge')return send(200,{items:[...knowledge.values()].filter(k=>k.tenant===tenant),total:knowledge.size});
    if(url.pathname.endsWith('/reindex'))return send(200,{id:url.pathname.split('/')[3],indexed:false});
    if(url.pathname.endsWith('/revoke')){const k=knowledge.get(url.pathname.split('/')[3]);if(k?.tenant!==tenant)return send(404,{detail:'Not found'});k.state='revoked';return send(200,{id:k.id,state:k.state});}
    send(404,{detail:'Unknown fixture endpoint'});
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  const origin='http://127.0.0.1:'+port,base='http://127.0.0.1:'+upstream.address().port;
  const app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'production',APP_ORIGIN:origin,COOKIE_SECURE:'false',MODERATION_API_BASE_URL:base+'/api/v1/external/moderation-review',MODERATION_API_KEY:'a-client-fixture'},stdio:['ignore','pipe','pipe']});
  let logs='';app.stdout.on('data',d=>logs+=d);app.stderr.on('data',d=>logs+=d);
  t.after(async()=>{app.kill('SIGTERM');await Promise.race([once(app,'exit'),new Promise(r=>setTimeout(r,3000))]);upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await db().close();rmSync(directory,{recursive:true,force:true});});
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));if(i===99)throw Error('Next startup failed: '+logs);}
  const agents={};
  async function request(path,{actor='operator',method='GET',body,idem,csrf=true,originHeader=origin}={}){
    const headers={};if(body!==undefined)headers['content-type']='application/json';if(originHeader)headers.origin=originHeader;
    if(agents[actor]){headers.cookie=agents[actor].cookie;if(csrf)headers['x-csrf-token']=agents[actor].csrf;}
    if(idem)headers['idempotency-key']=idem;
    const r=await fetch(origin+'/api'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),headers:r.headers};
  }
  await t.test('auth uses HttpOnly SameSite cookies, origin, CSRF and roles',async()=>{
    assert.equal((await request('/reviews')).status,401);
    assert.equal((await request('/login',{method:'POST',body:{email:'operator@example.test',password},originHeader:'https://attacker.test'})).status,403);
    for(const actor of ['operator','reviewer','reviewer2','admin','outsider']){const r=await request('/login',{method:'POST',body:{email:actor+'@example.test',password}});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=strict/i);agents[actor]={cookie:cookie.split(';')[0],csrf:r.data.csrf};}
    assert.equal((await request('/reviews')).status,403);assert.equal((await request('/knowledge/k/revoke',{actor:'reviewer',method:'POST',body:{reason:'Valid reason'}})).status,403);
    assert.equal((await request('/classifications',{method:'POST',body:{platform:'x',content:'text'},idem:randomUUID(),csrf:false})).status,403);
    assert.equal((await request('/users',{actor:'operator'})).status,403);
    assert.equal((await request('/me',{actor:'operator'})).status,200);
  });
  const submit=async(content,actor='operator',key=randomUUID())=>request('/classifications',{actor,method:'POST',body:{platform:'x',content,context:'',context_key:'',external_reference_id:''},idem:key});
  let reviewId,caseId,knowledgeId;
  await t.test('API key history uses the server-side integration key',async()=>{
    const r=await request('/api-history'); assert.equal(r.status,200); assert.equal(r.data.items[0].input.content,'Contoh riwayat API');
    assert.equal(JSON.stringify(r.data).includes('a-client-fixture'),false);
  });
  await t.test('classification queue view is reviewer-only, read-only and uses the server-side integration key and exposes only metadata',async()=>{
    assert.equal((await request('/queue/summary',{actor:'operator'})).status,403);
    assert.equal((await request('/queue/jobs',{actor:'operator'})).status,403);
    const summary=await request('/queue/summary',{actor:'reviewer'});
    assert.equal(summary.status,200);assert.equal(summary.data.counts.queued,2);
    const jobs=await request('/queue/jobs?status=failed&limit=10&offset=5',{actor:'reviewer'});
    assert.equal(jobs.status,200);assert.equal(jobs.data.items[0].status,'failed');assert.equal(jobs.data.offset,5);
    assert.equal((await request('/queue/jobs?status=bogus',{actor:'reviewer'})).status,422);
    assert.equal((await request('/queue/jobs?limit=1000',{actor:'reviewer'})).status,422);
    assert.equal((await request('/queue/jobs',{actor:'reviewer',method:'POST',body:{}})).status,404);
    assert.equal(jobs.data.items[0].input,undefined);assert.equal(jobs.data.items[0].callback,undefined);assert.equal(jobs.data.items[0].result,undefined);
    const queueCalls=calls.filter(c=>c.path==='/jobs/summary'||c.path==='/jobs');
    assert.ok(queueCalls.length>=2&&queueCalls.every(c=>c.method==='GET'&&c.key==='a-client-fixture'));
    assert.equal(calls.some(c=>c.path.startsWith('/v1/queue')),false);
    assert.equal(JSON.stringify(summary.data).includes('fixture'),false);
  });
  await t.test('direct finals, unknown response idempotency and ownership isolation',async()=>{
    for(const content of ['safe','violation','exact','similar','legacy']){const r=await submit(content);assert.equal(r.status,200);assert.equal(r.data.status,'completed');if(content==='exact')assert.equal(r.data.prediction,null);}
    const idempotency=randomUUID(),lost=await submit('lost','operator',idempotency);assert.equal(lost.status,504);assert.ok(lost.data.submission_id);
    const count=cases.size,retry=await submit('lost','operator',idempotency);assert.equal(retry.status,200);assert.equal(cases.size,count);
    assert.equal((await submit('changed','operator',idempotency)).status,409);
    assert.equal((await request('/classifications/'+retry.data.id,{actor:'outsider'})).status,404);
    assert.equal((await request('/classifications/'+retry.data.id,{actor:'reviewer'})).status,200);
    const outsiderList=await request('/submissions',{actor:'outsider'});assert.deepEqual(outsiderList.data.items,[]);
    const pending=await submit('review');assert.equal(pending.data.status,'pending_review');assert.equal(pending.data.result,null);assert.equal(pending.data.pelanggaran,null);reviewId=pending.data.review_id;caseId=pending.data.id;
  });
  const decision={expected_revision:1,pelanggaran:true,rule_ids:['violence.threat'],rationale:'Manusia memeriksa bukti dalam fixture.',verification_notes:'Konteks telah diverifikasi.',evidence_basis:'external_evidence',reuse:'similar',valid_for_hours:24};
  await t.test('human decision creates knowledge once, revision conflict never overwrites, corrections preserve audit',async()=>{
    assert.equal((await request('/reviews/'+reviewId+'/decision',{actor:'reviewer',method:'POST',body:{...decision,rule_ids:['invented.rule']}})).status,422);
    const r=await request('/reviews/'+reviewId+'/decision',{actor:'reviewer',method:'POST',body:decision});assert.equal(r.status,200);assert.equal(r.data.reuse,'none');assert.ok(r.data.warnings.length);knowledgeId=r.data.knowledge_id;
    assert.equal((await request('/reviews/'+reviewId+'/decision',{actor:'reviewer2',method:'POST',body:decision})).status,409);assert.equal(mutation,1);
    assert.equal((await request('/reviews/'+reviewId+'/decision',{actor:'reviewer',method:'POST',body:{...decision,expected_revision:2,rationale:'POLICY CHANGED'}})).status,409);
    const corrected=await request('/reviews/'+reviewId+'/decision',{actor:'reviewer2',method:'POST',body:{...decision,expected_revision:2,pelanggaran:false,rule_ids:[]}});assert.equal(corrected.status,200);assert.equal(corrected.data.classification.decision_source,'human');assert.equal(knowledge.get(knowledgeId).state,'revoked');
    const detail=await request('/reviews/'+reviewId,{actor:'reviewer'});assert.equal(detail.data.revision,3);assert.equal(detail.data.events.length,2);
    assert.equal((await request('/classifications/'+caseId)).data.status,'completed');
  });
  await t.test('lost mutation response is recovered by GET without replay; admin knowledge actions',async()=>{
    dropNextDecision=true;const response=await request('/reviews/'+reviewId+'/decision',{actor:'reviewer',method:'POST',body:{...decision,expected_revision:3}});assert.equal(response.status,504);
    const before=mutation,detail=await request('/reviews/'+reviewId,{actor:'reviewer'});assert.equal(detail.data.revision,4);assert.equal(mutation,before);
    const list=await request('/knowledge',{actor:'admin'});assert.equal(list.status,200);const active=list.data.items.find(k=>k.state==='active');
    assert.equal((await request('/knowledge/'+active.id+'/reindex',{actor:'admin',method:'POST'})).data.indexed,false);
    assert.equal((await request('/knowledge/'+active.id+'/revoke',{actor:'admin',method:'POST',body:{reason:'Knowledge needs correction.'}})).data.state,'revoked');
    assert.equal(calls.some(c=>c.path==='/v1/knowledge'&&c.method==='POST'),false);
  });
  await t.test('429/401/413/422/502/504 remain errors, and failed submissions retain IDs',async()=>{
    for(const [content,status] of [['rate',429],['unauthorized',401],['oversize',413],['validation',422],['badgateway',502],['failed',504]]){const r=await submit(content);assert.equal(r.status,status,content);if(content==='rate')assert.equal(r.headers.get('retry-after'),'3');if(content==='failed'){assert.ok(r.data.detail.classification_id);const saved=await request('/submissions/'+r.data.submission_id);assert.equal(saved.data.service_id,r.data.detail.classification_id);}}
    assert.equal((await request('/classifications',{method:'POST',body:{platform:'x',content:'x'.repeat(100000)},idem:randomUUID()})).status,413);
    assert.equal((await request('/reviews?limit=101',{actor:'reviewer'})).status,422);
    assert.equal((await request('/knowledge/id',{actor:'reviewer'})).status,404);
    assert.equal((await request('/reviews/id/claim',{actor:'reviewer',method:'POST'})).status,404);
  });
  await t.test('keys not present in browser responses or HTML, extra account fields cannot be injected',async()=>{
    const html=await (await fetch(origin)).text();assert.ok(html.includes('Abuse Reporter'));
    for(const p of ['/me','/submissions','/taxonomy']){const r=await request(p);const serialized=JSON.stringify(r.data);assert.equal(serialized.includes('a-client-fixture'),false);assert.equal(serialized.includes('a-reviewer-fixture'),false);}
    assert.equal((await request('/users',{actor:'admin',method:'POST',body:{email:'new@example.test',name:'New operator',role:'operator',password,tenant:'b'}})).status,422);
    const u=await request('/users',{actor:'admin',method:'POST',body:{email:'new@example.test',name:'New operator',role:'operator',password}});assert.equal(u.status,201);
    assert.equal((await request('/users/'+u.data.id,{actor:'admin',method:'POST',body:{role:'reviewer',active:false}})).status,200);
    const logout=await request('/logout',{method:'POST'});assert.equal(logout.status,200);assert.equal((await request('/me')).status,401);
    assert.equal(logs.includes(password),false);assert.equal(logs.includes('a-client-fixture'),false);
  });
  await t.test('browser E2E: direct final, pending→human→final, screenshots and mobile layout', {skip: !process.env.RUN_BROWSER_TESTS}, async()=>{
    const {chromium,expect}=await import('@playwright/test');
    const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
    try {
      const page=await browser.newPage({viewport:{width:1440,height:1050}});
      const browserErrors=[];page.on('pageerror',e=>browserErrors.push(e.message));
      await page.goto(origin);
      await page.getByLabel('Email',{exact:true}).fill('admin@example.test');
      await page.getByLabel('Kata sandi',{exact:true}).fill(password);
      await page.getByRole('button',{name:'Masuk',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Abuse report category suggestion'})).toBeVisible();
      await page.screenshot({path:'docs/screenshots/klasifikasi-desktop.png',fullPage:true});
      await page.getByRole('button',{name:'Taxonomy kebijakan'}).click();
      await expect(page.getByRole('heading',{name:'Taxonomy kebijakan X'})).toBeVisible();
      await expect(page.getByText('fixture-policy',{exact:true}).first()).toBeVisible();
      await page.getByLabel('Cari kategori atau subkategori').fill('ancaman');
      await expect(page.getByRole('heading',{name:'Ancaman',exact:true})).toBeVisible();
      await page.getByLabel('Cari kategori atau subkategori').fill('tidak ada di fixture');
      await expect(page.getByText('Tidak ada kategori yang cocok dengan pencarian.')).toBeVisible();
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
      await page.setViewportSize({width:1440,height:1050});
      await page.getByRole('button',{name:'Klasifikasi baru',exact:false}).click();

      await page.getByRole('button',{name:'Submission saya'}).click();
      await expect(page.getByRole('heading',{name:'Riwayat API key'})).toBeVisible();
      await expect(page.getByText('Contoh riwayat API').first()).toBeVisible();
      await page.getByRole('button',{name:'Klasifikasi baru',exact:false}).click();
      await page.getByLabel('Teks konten').fill('legacy');
      await page.getByRole('button',{name:'Analisis konten'}).click();
      await expect(page.getByText('Tidak ditemukan pelanggaran',{exact:true})).toBeVisible();
      await expect(page.getByText('API NarasiAhli · prediksi final',{exact:true})).toBeVisible();
      await expect(page.getByText('legacy-fixture-request',{exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Mulai submission baru',exact:true}).click();
      await page.getByLabel('Teks konten').fill('review');
      await page.getByRole('button',{name:'Analisis konten'}).click();
      await expect(page.getByText('Menunggu review manusia',{exact:true})).toBeVisible();
      await page.getByRole('button',{name:'Buka workspace reviewer'}).click();
      await expect(page.getByRole('heading',{name:'Keputusan reviewer',exact:true})).toBeVisible();
      await page.getByText('Tidak melanggar',{exact:true}).click();
      await page.getByLabel('Alasan keputusan').fill('Reviewer manusia memeriksa konteks fixture; tidak ditemukan unsur pelanggaran.');
      await page.getByLabel('Catatan verifikasi').fill('Konteks fixture diperiksa oleh reviewer untuk pengujian browser.');
      await page.getByText('Saya telah memeriksa konten dan konteks yang relevan serta audit terbaru.').click();
      await page.getByRole('button',{name:'Simpan keputusan manusia',exact:true}).click();
      await expect(page.getByRole('heading',{name:'Koreksi keputusan'})).toBeVisible();
      await expect(page.getByText('Keputusan tersimpan.',{exact:false})).toBeVisible();
      await page.screenshot({path:'docs/screenshots/review-desktop.png',fullPage:true});
      await page.getByRole('button',{name:'Knowledge',exact:false}).first().click();
      await expect(page.getByRole('heading',{name:'Knowledge manusia',exact:true})).toBeVisible();
      await page.screenshot({path:'docs/screenshots/knowledge-desktop.png',fullPage:true});
      await page.setViewportSize({width:390,height:844});
      await page.getByRole('button',{name:'Klasifikasi baru',exact:false}).click();
      await page.screenshot({path:'docs/screenshots/klasifikasi-mobile.png',fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
      assert.deepEqual(browserErrors,[]);
      const upstreamRequests=[];page.on('request',r=>{if(r.url().includes(base))upstreamRequests.push(r.url());});
      await page.reload();await expect(page.getByRole('heading',{name:'Abuse report category suggestion'})).toBeVisible();
      assert.deepEqual(upstreamRequests,[]);
      assert.equal(await page.evaluate(()=>Object.keys(localStorage).length),0);
    } finally {await browser.close();}
  });
});
