import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, opaque, digest, checkPassword, hashPassword, session, publicUser, audit } from '../../../lib/store.mjs';
import { submissionSchema, decisionSchema, hasRole, routePolicy } from '../../../lib/domain.mjs';
import { upstream, moderationConfig, UpstreamError } from '../../../lib/upstream.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const json = (data, status = 200, headers = {}) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
function fail(status, detail) { throw new UpstreamError(status, detail); }
async function bodyOf(req) {
  if (!req.headers.get('content-type')?.startsWith('application/json')) fail(415, 'Gunakan JSON.');
  const reader = req.body?.getReader();
  if (!reader) fail(422, 'Body wajib diisi.');
  const chunks = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 96 * 1024) { await reader.cancel(); fail(413, 'Body melebihi 96 KiB.'); } chunks.push(Buffer.from(value)); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(422, 'JSON tidak valid.'); }
}
function originCheck(req) {
  const expected = process.env.APP_ORIGIN;
  if (!expected || new URL(expected).origin !== req.headers.get('origin')) fail(403, 'Origin tidak diizinkan.');
}
function csrfCheck(req, user) { originCheck(req); if (!user || req.headers.get('x-csrf-token') !== user.csrf) fail(403, 'Sesi keamanan tidak cocok; muat ulang halaman.'); }
function cookieOptions() { return { httpOnly: true, secure: process.env.COOKIE_SECURE !== 'false', sameSite: 'strict', path: '/', maxAge: 8 * 60 * 60 }; }

async function handle(req, context) {
  let user;
  try {
    const { path: parts } = await context.params;
    if (!parts || parts.some(p => !/^[a-zA-Z0-9-]+$/.test(p))) fail(404, 'Route tidak tersedia.');
    const path = '/' + parts.join('/'), method = req.method;
    if (path === '/health' && method === 'GET') return json({ status: 'healthy' });
    if (path === '/login' && method === 'POST') {
      originCheck(req);
      const body = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) }).strict().parse(await bodyOf(req));
      const email = body.email.toLowerCase(), identity = digest(email), now = Date.now();
      const limiter = await db().prepare('SELECT * FROM login_limits WHERE identity=?').get(identity);
      if (limiter && limiter.expires > now && limiter.count >= 8) return json({ error: 'Terlalu banyak percobaan login.' }, 429, { 'Retry-After': String(Math.ceil((limiter.expires - now) / 1000)) });
      await db().prepare('INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(identity) DO UPDATE SET count=CASE WHEN login_limits.expires>? THEN login_limits.count+1 ELSE 1 END,expires=CASE WHEN login_limits.expires>? THEN login_limits.expires ELSE excluded.expires END').run(identity, now + 15 * 60000, now, now);
      const account = await db().prepare('SELECT * FROM users WHERE email=?').get(email);
      const verified = checkPassword(body.password, account?.password);
      if (!account?.active || !verified) fail(401, 'Email atau kata sandi tidak sesuai.');
      await db().prepare('DELETE FROM login_limits WHERE identity=?').run(identity);
      await db().prepare('DELETE FROM sessions WHERE expires<?').run(now);
      const token = opaque(), csrf = opaque();
      await db().prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token), account.id, csrf, now + 8 * 3600000);
      const res = json({ user: publicUser(account), csrf });
      res.cookies.set('hitl_session', token, cookieOptions()); await audit(account, 'login', '', 200); return res;
    }
    user = await session(req.cookies.get('hitl_session')?.value);
    if (!user) fail(401, 'Silakan login kembali.');
    if (method !== 'GET') csrfCheck(req, user);
    if (path === '/me' && method === 'GET') {
      let attribution = 'Belum dikonfigurasi';
      try { moderationConfig(); attribution = 'Akun integrasi bersama; identitas manusia tercatat pada audit aplikasi'; } catch {}
      return json({ user: publicUser(user), csrf: user.csrf, attribution });
    }
    if (path === '/logout' && method === 'POST') {
      await db().prepare('DELETE FROM sessions WHERE hash=?').run(user.hash);
      const res = json({ ok: true }); res.cookies.set('hitl_session', '', { ...cookieOptions(), maxAge: 0 }); return res;
    }
    if (path === '/users') {
      if (!hasRole(user, 'admin')) fail(403, 'Hanya admin.');
      if (method === 'GET') return json({ items: await db().prepare('SELECT id,email,name,role,active FROM users').all() });
      if (method === 'POST') {
        const b = z.object({ email: z.email().max(254), name: z.string().trim().min(1).max(150), role: z.enum(['operator', 'reviewer', 'admin']), password: z.string().min(12).max(128) }).strict().parse(await bodyOf(req));
        const id = randomUUID();
        if (await db().prepare('SELECT id FROM users WHERE email=?').get(b.email.toLowerCase())) fail(409, 'Email tidak dapat digunakan.');
        await db().prepare('INSERT INTO users(id,email,name,role,password) VALUES(?,?,?,?,?)').run(id, b.email.toLowerCase(), b.name, b.role, hashPassword(b.password));
        await audit(user, 'create_user', id, 201); return json({ id }, 201);
      }
    }
    if (/^\/users\/[^/]+$/.test(path) && method === 'POST') {
      if (!hasRole(user, 'admin')) fail(403, 'Hanya admin.');
      const id = parts[1], b = z.object({ role: z.enum(['operator', 'reviewer', 'admin']), active: z.boolean() }).strict().parse(await bodyOf(req));
      if (id === user.id) fail(409, 'Ubah akun sendiri melalui admin lain.');
      const result = await db().prepare('UPDATE users SET role=?,active=? WHERE id=?').run(b.role, Number(b.active), id);
      if (!result.changes) fail(404, 'Pengguna tidak tersedia.');
      await db().prepare('DELETE FROM sessions WHERE user_id=?').run(id); await audit(user, 'update_user', id, 200); return json({ ok: true });
    }
    if (path === '/api-history' && method === 'GET') {
      const q = new URL(req.url).searchParams;
      const limit = z.coerce.number().int().min(1).max(100).parse(q.get('limit') || 25);
      const offset = z.coerce.number().int().min(0).max(1000000).parse(q.get('offset') || 0);
      return json(await upstream(user, `/history?limit=${limit}&offset=${offset}`, { moderation: true }));
    }
    if (path === '/submissions' && method === 'GET') {
      const items = await db().prepare('SELECT id,idem,service_id,status,created FROM submissions WHERE user_id=? ORDER BY created DESC LIMIT 100').all(user.id);
      return json({ items, scope: '100 submission terakhir milik akun ini; bukan riwayat global service' });
    }
    if (/^\/submissions\/[^/]+$/.test(path) && method === 'GET') {
      const row = await db().prepare('SELECT * FROM submissions WHERE id=? AND user_id=?').get(parts[1], user.id);
      if (!row) fail(404, 'Submission tidak tersedia.');
      return json({ ...row, payload: JSON.parse(row.payload) });
    }
    const role = routePolicy(path, method);
    if (!role) fail(404, 'Route tidak tersedia.');
    if (!hasRole(user, role)) fail(403, 'Role Anda tidak memiliki akses.');
    const reviewer = role !== 'operator';
    let payload, idem, localId;
    if (path === '/classifications' && method === 'GET') fail(404, 'Service tidak menyediakan riwayat global.');
    if (path === '/classifications' && method === 'POST') {
      payload = submissionSchema.parse(await bodyOf(req));
      idem = z.string().regex(/^[a-zA-Z0-9:_-]{8,128}$/).parse(req.headers.get('idempotency-key'));
      const encoded = JSON.stringify(payload);
      const old = await db().prepare('SELECT * FROM submissions WHERE idem=?').get(idem);
      if (old && (old.user_id !== user.id || old.payload !== encoded)) fail(409, 'Idempotency-Key sudah dipakai untuk submission berbeda.');
      localId = old?.id || randomUUID();
      if (!old) await db().prepare('INSERT INTO submissions(id,user_id,idem,payload,service_id,status,created) VALUES(?,?,?,?,NULL,?,?)').run(localId, user.id, idem, encoded, 'unknown', Date.now());
    } else if (path.startsWith('/classifications/')) {
      if (method !== 'GET') fail(405, 'Method tidak diizinkan.');
      if (!hasRole(user, 'reviewer') && !(await db().prepare('SELECT id FROM submissions WHERE service_id=? AND user_id=?').get(parts[1], user.id))) fail(404, 'Klasifikasi tidak tersedia.');
    } else if (path.endsWith('/decision')) {
      payload = decisionSchema.parse(await bodyOf(req));
      const taxonomy = await upstream(user, '/v1/taxonomy');
      const rules = new Map(taxonomy.categories.flatMap(c => c.subcategories.map(r => [r.id, r])));
      if (payload.rule_ids.some(id => !rules.has(id))) fail(422, 'Rule tidak ada pada taxonomy saat ini.');
      const review = await upstream(user, '/v1/reviews/' + parts[1], { reviewer: true });
      const requiresEvidence = payload.rule_ids.some(id => rules.get(id).evidence_requirement !== 'text') || review.classification?.prediction?.findings?.some(f => f.evidence_requirement !== 'text');
      if (requiresEvidence && payload.verification_notes.trim().length < 5) fail(422, 'Catatan verifikasi eksternal/media/konteks wajib diisi.');
      // The service enforces the top-level review revision atomically.
    } else if (path.endsWith('/revoke')) payload = z.object({ reason: z.string().trim().min(5).max(1000) }).strict().parse(await bodyOf(req));
    let suffix = '';
    if (path === '/taxonomy') {
      const q = new URL(req.url).searchParams;
      const platform = z.enum(['x']).parse(q.get('platform') || 'x');
      const language = z.enum(['id', 'en']).parse(q.get('language') || 'id');
      suffix = `?platform=${platform}&language=${language}`;
    }
    if (path === '/reviews' || path === '/knowledge') {
      const q = new URL(req.url).searchParams;
      const limit = z.coerce.number().int().min(1).max(100).parse(q.get('limit') || 25);
      const offset = z.coerce.number().int().min(0).max(1000000).parse(q.get('offset') || 0);
      suffix = `?limit=${limit}&offset=${offset}`;
      if (path === '/reviews') suffix += '&status=' + z.enum(['pending', 'completed']).parse(q.get('status') || 'pending');
    }
    try {
      const data = await upstream(user, '/v1' + path + suffix, { method, body: payload, idempotency: idem, reviewer });
      if (localId) await db().prepare('UPDATE submissions SET service_id=?,status=? WHERE id=?').run(data.id, data.status, localId);
      if (path.startsWith('/classifications/') && data.id) await db().prepare('UPDATE submissions SET status=? WHERE service_id=?').run(data.status, data.id);
      await audit(user, method + ' ' + path.replace(/\/[a-zA-Z0-9-]{20,}/g, '/:id'), data.id || parts[1], 200);
      return json(data, 200, localId ? { 'X-Submission-ID': localId } : {});
    } catch (e) {
      if (localId && e.detail?.classification_id) await db().prepare('UPDATE submissions SET service_id=?,status=? WHERE id=?').run(e.detail.classification_id, 'failed', localId);
      await audit(user, method + ' ' + parts[0], parts[1], e.status || 500);
      if (localId) return json({ error: e.message, detail: e.detail, submission_id: localId }, e.status || 502, e.retryAfter ? { 'Retry-After': e.retryAfter } : {});
      throw e;
    }
  } catch (e) {
    if (e instanceof z.ZodError) return json({ error: 'Isian tidak valid.', issues: e.issues.map(i => ({ path: i.path.join('.'), message: i.message })) }, 422);
    if (e instanceof UpstreamError) return json({ error: e.message, detail: e.detail }, e.status, e.retryAfter ? { 'Retry-After': e.retryAfter } : {});
    return json({ error: 'Terjadi kesalahan aplikasi. Hubungi admin dengan waktu kejadian.' }, 500);
  }
}
export const GET = handle;
export const POST = handle;
