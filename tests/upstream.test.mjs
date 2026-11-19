import test from 'node:test';
import assert from 'node:assert/strict';
import { moderationConfig, upstream, UpstreamError } from '../lib/upstream.mjs';

test('single integration uses direct environment values for client, reviewer and history', async t => {
  const priorFetch = globalThis.fetch;
  const oldBase = process.env.MODERATION_API_BASE_URL, oldKey = process.env.MODERATION_API_KEY;
  t.after(() => { globalThis.fetch = priorFetch; if (oldBase === undefined) delete process.env.MODERATION_API_BASE_URL; else process.env.MODERATION_API_BASE_URL = oldBase; if (oldKey === undefined) delete process.env.MODERATION_API_KEY; else process.env.MODERATION_API_KEY = oldKey; });
  delete process.env.MODERATION_API_BASE_URL; delete process.env.MODERATION_API_KEY;
  assert.throws(() => moderationConfig(), UpstreamError);
  process.env.MODERATION_API_BASE_URL='not a url'; process.env.MODERATION_API_KEY='secret-fixture';
  assert.throws(() => moderationConfig(), UpstreamError);
  process.env.MODERATION_API_BASE_URL='https://example.test/api/v1/external/moderation-review';
  const calls=[];
  globalThis.fetch = async (url, options) => { calls.push({url,options}); return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}}); };
  await upstream({id:'fixture-user'},'/v1/taxonomy');
  await upstream({id:'fixture-user'},'/v1/reviews',{reviewer:true});
  await upstream({id:'fixture-user'},'/history?limit=25',{moderation:true});
  assert.equal(calls.length,3);
  assert.ok(calls.every(c=>c.options.headers['X-API-Key']==='secret-fixture'));
  assert.equal(calls[2].url,'https://example.test/api/v1/external/moderation/history?limit=25');
  globalThis.fetch = async () => new Response(JSON.stringify({detail:'bad secret-fixture'}),{status:403});
  await assert.rejects(upstream({id:'fixture-user'},'/v1/taxonomy'), e => !e.message.includes('secret-fixture') && e.status===403);
});
