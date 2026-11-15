'use client';
import { useEffect, useRef, useState } from 'react';
import { stateOf, policyLink, knowledgeState } from '../lib/domain.mjs';

const stateNames = { violation: 'Pelanggaran ditemukan', no_violation: 'Tidak ditemukan pelanggaran', pending_review: 'Menunggu review manusia', processing: 'Sedang diproses', failed: 'Proses gagal', invalid: 'Hasil belum valid' };
const sourceNames = { llm: 'Model · final tanpa eskalasi', human: 'Keputusan manusia', human_knowledge_exact: 'Knowledge manusia · identik', human_knowledge_similar: 'Knowledge manusia · mirip' };
const date = value => value ? new Date(value * 1000).toLocaleString('id-ID', { timeZoneName: 'short' }) : '—';
const blank = { platform: 'x', content: '', context: '', context_key: '', external_reference_id: '' };
function usePolling(fn, delay, enabled) {
  const callback = useRef(fn); callback.current = fn;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false, timer, failures = 0;
    async function tick() {
      if (cancelled) return;
      if (!document.hidden) { try { await callback.current(); failures = 0; } catch { failures++; } }
      if (!cancelled) timer = setTimeout(tick, Math.min(delay * 2 ** failures, 120000));
    }
    timer = setTimeout(tick, delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [delay, enabled]);
}
function Message({ children, kind = 'info' }) { return children ? <div className={`message ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div> : null; }
function Badge({ state }) { return <span className={`badge ${state}`}>{stateNames[state] || state}</span>; }
function Findings({ value }) {
  if (!value) return null;
  return <><p className="explanation">{value.explanation}</p>{(value.findings || []).map((f, i) => {
    const url = policyLink(f.policy?.url);
    return <article className="finding" key={f.rule_id || i}><div className="eyebrow">{f.category || f.category_id}</div><h3>{f.subcategory || f.rule_id}</h3><p>{f.detail}</p>{(f.evidence || []).map((q, j) => <blockquote key={j}>{q}</blockquote>)}<p>{f.rationale}</p>{url && <a href={url} target="_blank" rel="noopener noreferrer">Baca kebijakan ↗</a>}</article>;
  })}{value.missing_context?.length > 0 && <div className="message warning"><strong>Konteks yang perlu diperiksa</strong><ul>{value.missing_context.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}</>;
}
function Result({ value, openReview }) {
  if (!value) return <div className="empty"><div className="empty-symbol">⌕</div><h3>Mulai dari sebuah konten.</h3><p>Kategori, bukti, dan alasan akan muncul di sini.<br />Kasus ambigu diteruskan untuk review manusia.</p><div className="step"><span>01</span> Masukkan konten <span>02</span> Periksa analisis</div></div>;
  const state = stateOf(value), final = ['violation', 'no_violation'].includes(state);
  return <div className="result"><div className="row"><Badge state={state} /><span className="muted mono">{value.id?.slice(0, 8)}</span></div>
    <p className="muted">{final ? value.result?.prediction_provider === 'narasiahli' && value.decision_source === 'llm' ? 'API NarasiAhli · prediksi final' : sourceNames[value.decision_source] || value.decision_source : 'Belum ada keputusan final'}</p>
    {final ? <Findings value={value.result} /> : state === 'pending_review' ? <><Message kind="warning">Menunggu review manusia. Analisis di bawah adalah prediksi awal model, bukan keputusan final.</Message><Findings value={value.prediction} />{value.review_id && openReview && <button className="primary" onClick={() => openReview(value.review_id)}>Buka workspace reviewer ↗</button>}</> : <Message kind={state === 'failed' || state === 'invalid' ? 'error' : 'info'}>{value.error || 'Hasil final belum tersedia. Status akan diperbarui saat halaman ini aktif.'}</Message>}
    <dl className="meta"><dt>ID klasifikasi</dt><dd className="mono">{value.id}</dd><dt>Dibuat</dt><dd>{date(value.created_at)}</dd>{(value.result?.prediction_provider || value.prediction?.prediction_provider) && <><dt>Sumber prediksi</dt><dd>API NarasiAhli</dd><dt>Request API</dt><dd className="mono">{value.result?.prediction_request_id || value.prediction?.prediction_request_id}</dd></>}<dt>Kebijakan</dt><dd>{value.result?.taxonomy_version || value.prediction?.taxonomy_version || '—'}</dd>{value.external_reference_id && <><dt>Referensi</dt><dd>{value.external_reference_id}</dd></>}</dl>
  </div>;
}

export default function App() {
  const [user, setUser] = useState(null), [boot, setBoot] = useState(true), [csrf, setCsrf] = useState('');
  const [page, setPage] = useState('new'), [error, setError] = useState(''), [busy, setBusy] = useState(false), [attribution, setAttribution] = useState('');
  const [taxonomy, setTaxonomy] = useState(null), [form, setForm] = useState(blank), [attempt, setAttempt] = useState(null), [result, setResult] = useState(null);
  const [rows, setRows] = useState([]), [total, setTotal] = useState(0), [offset, setOffset] = useState(0), [queue, setQueue] = useState('pending');
  const [review, setReview] = useState(null), [notice, setNotice] = useState(''), [retryAt, setRetryAt] = useState(0), [clock, setClock] = useState(Date.now());
  const [previewInput, setPreviewInput] = useState(null);
  const loadingRef = useRef(new Set()), listVersion = useRef(0), rateLimit = useRef(0), submitting = useRef(false);
  const canReview = user && user.role !== 'operator', isAdmin = user?.role === 'admin';
  async function api(path, { method = 'GET', body, key, login = false } = {}) {
    if (Date.now() < rateLimit.current) throw Error('Tunggu sebelum mencoba lagi.');
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && !login) headers['X-CSRF-Token'] = csrf;
    if (key) headers['Idempotency-Key'] = key;
    let response;
    try { response = await fetch('/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(250000) }); }
    catch { throw Error('Respons belum diketahui. Untuk submission gunakan retry payload/key yang sama. Untuk keputusan, muat ulang review sebelum tindakan lain.'); }
    const data = await response.json();
    if (response.status === 429) {
      const retry = response.headers.get('retry-after');
      const seconds = /^\d+$/.test(retry || '') ? Number(retry) : Math.max(1, (Date.parse(retry) - Date.now()) / 1000) || 30;
      rateLimit.current = Date.now() + seconds * 1000; setRetryAt(rateLimit.current);
    }
    if (!response.ok) { const e = Error(data.issues?.map(i => `${i.path}: ${i.message}`).join('; ') || data.error || 'Permintaan gagal.'); e.status = response.status; e.data = data; throw e; }
    return data;
  }
  async function bootstrap() {
    try {
      const me = await api('/me'); setUser(me.user); setCsrf(me.csrf); setAttribution(me.attribution);
      try { setTaxonomy(await api('/taxonomy')); } catch (e) { setError('Taxonomy belum termuat: ' + e.message); }
    } catch { setUser(null); } finally { setBoot(false); }
  }
  useEffect(() => { bootstrap(); }, []);
  useEffect(() => { if (!retryAt) return; const t = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(t); }, [retryAt]);
  const remaining = Math.max(0, Math.ceil((retryAt - clock) / 1000));
  async function loadList(target = page, skip = offset) {
    if (Date.now() < rateLimit.current) return;
    const generation = listVersion.current;
    const key = `${generation}:${target}:${skip}:${queue}`;
    if (loadingRef.current.has(key)) return;
    loadingRef.current.add(key);
    try {
      const path = target === 'history' ? '/submissions' : target === 'reviews' ? `/reviews?status=${queue}&limit=25&offset=${skip}` : target === 'knowledge' ? `/knowledge?limit=25&offset=${skip}` : target === 'users' ? '/users' : null;
      if (path) { const data = await api(path); if (generation === listVersion.current) { setRows(data.items); setTotal(data.total ?? data.items.length); } }
    } catch (e) { if (generation === listVersion.current) setError(e.message); throw e; } finally { loadingRef.current.delete(key); }
  }
  useEffect(() => { listVersion.current++; if (user && ['history', 'reviews', 'knowledge', 'users'].includes(page)) { setRows([]); loadList().catch(() => {}); } }, [page, offset, queue, user]);
  usePolling(() => loadList(), 30000, Boolean(user && page === 'reviews'));
  usePolling(async () => { try { setResult(await api('/classifications/' + result.id)); } catch (e) { setError(e.message); throw e; } }, 15000, Boolean(user && page === 'new' && result && ['pending_review', 'processing'].includes(result.status)));
  usePolling(async () => { const updated = await api('/reviews/' + review.id); setReview(updated); }, 15000, Boolean(user && page === 'workspace' && review?.status === 'pending'));
  function navigate(target) { if (submitting.current) return; setPage(target); setOffset(0); setError(''); setNotice(''); }
  async function openReview(id) { setBusy(true); setError(''); try { const data = await api('/reviews/' + id); setReview(data); setPage('workspace'); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function submit(e) {
    e.preventDefault(); if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setPreviewInput(null);
    const next = attempt || { key: crypto.randomUUID(), payload: { ...form } }; setAttempt(next);
    try { setResult(await api('/classifications', { method: 'POST', body: next.payload, key: next.key })); }
    catch (e) {
      setError(e.message);
      if (e.data?.detail?.classification_id) { try { setResult(await api('/classifications/' + e.data.detail.classification_id)); } catch {} }
    } finally { submitting.current = false; setBusy(false); }
  }
  useEffect(() => { if (!busy) return; const listener = e => { e.preventDefault(); e.returnValue = ''; }; window.addEventListener('beforeunload', listener); return () => window.removeEventListener('beforeunload', listener); }, [busy]);
  async function viewSubmission(row) {
    setError(''); setBusy(true);
    try {
      const saved = await api('/submissions/' + row.id); setForm(saved.payload); setPreviewInput(saved.payload);
      setAttempt({ key: saved.idem, payload: saved.payload }); setResult(null); setPage('new');
      if (saved.service_id) setResult(await api('/classifications/' + saved.service_id));
      else setNotice('Respons awal belum diketahui. Gunakan tombol retry; payload dan key asli dipertahankan.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function fresh() { setForm(blank); setAttempt(null); setResult(null); setPreviewInput(null); setError(''); setNotice(''); }
  async function signOut() { try { await api('/logout', { method: 'POST' }); setUser(null); setCsrf(''); fresh(); setRows([]); setReview(null); setTaxonomy(null); } catch (e) { setError(e.message); } }
  if (boot) return <div className="boot">Memuat workspace…</div>;
  if (!user) return <Login onLogin={async body => { const data = await api('/login', { method: 'POST', body, login: true }); setUser(data.user); setCsrf(data.csrf); await bootstrap(); }} />;
  const headings = { new: ['KLASIFIKASI KONTEN', 'Abuse report category suggestion', 'Kenali kategori yang relevan. Beri ruang untuk pertimbangan manusia.'], history: ['AKTIVITAS ANDA', 'Submission saya', 'Referensi yang dikirim melalui akun ini, bukan riwayat global service.'], reviews: ['HUMAN IN THE LOOP', 'Antrean review', 'Tinjau kasus yang membutuhkan konteks dan penilaian manusia.'], workspace: ['WORKSPACE REVIEWER', 'Keputusan yang bisa ditelusuri', 'Periksa bukti, konteks, dan kebijakan sebelum memutuskan.'], knowledge: ['PENGETAHUAN TERVERIFIKASI', 'Knowledge manusia', 'Keputusan reviewer, provenance, dan masa berlaku reuse.'], users: ['ADMINISTRASI', 'Pengguna & peran', 'Akses manusia dibatasi organisasi dan role pada server.'] };
  const heading = headings[page];
  return <div className="shell"><aside><a className="brand" href="#" onClick={e => { e.preventDefault(); navigate('new'); }}><span className="brand-mark">t</span>tilik<span className="brand-dot">.</span></a><div className="workspace-label">CONTENT INTELLIGENCE <span>WORKSPACE</span></div>
    <nav aria-label="Navigasi utama">{[['new', '⌕', 'Klasifikasi baru'], ['history', '▤', 'Submission saya'], ...(canReview ? [['reviews', '◫', 'Antrean review'], ['knowledge', '◇', 'Knowledge']] : []), ...(isAdmin ? [['users', '⚙', 'Pengguna & peran']] : [])].map(([id, icon, title]) => <button disabled={busy} className={page === id || id === 'reviews' && page === 'workspace' ? 'nav-active' : ''} key={id} onClick={() => navigate(id)}><span>{icon}</span>{title}</button>)}<button className="mobile-signout" disabled={busy} onClick={signOut}>↗ Keluar</button></nav>
    <div className="side-note"><span className="small-dot" /> Human judgment matters<p>Prediksi membantu. Manusia memberi konteks.</p></div><div className="identity"><div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div><strong>{user.name}</strong><small>{user.role} · {user.tenant}</small></div><button title="Keluar" aria-label="Keluar" disabled={busy} onClick={signOut}>↗</button></div>
  </aside><main><div className="topbar"><span>Workspace <span className="muted">/</span> {page === 'new' ? 'Category suggestion' : heading[1]}</span><span className="platform-pill">𝕏 <span>Policy mapping</span></span></div>
    <header><div className="eyebrow">{heading[0]}</div><h1>{heading[1]}</h1><p>{heading[2]}</p></header>
    <Message kind="error">{error}</Message><Message>{notice}</Message>{remaining > 0 && <Message kind="warning">Batas permintaan tercapai. Coba lagi dalam {remaining} detik.</Message>}
    {page === 'new' && <><div className="content-grid"><section className="panel"><div className="panel-title"><span className="section-number">01</span><h2>Konten yang ingin diperiksa</h2><span className="platform-mini">𝕏</span></div><form onSubmit={submit}>
      <label htmlFor="content">Teks konten <span className="required">*</span><span className="counter">{form.content.length.toLocaleString('id-ID')} / 8.000</span></label><textarea id="content" rows={7} value={form.content} disabled={busy || Boolean(attempt)} required maxLength={8000} placeholder="Tempel teks postingan atau balasan yang ingin ditinjau…" onChange={e => setForm({ ...form, content: e.target.value })} />
      <label htmlFor="context">Konteks tambahan <span className="optional">Opsional</span></label><textarea id="context" rows={3} maxLength={3000} disabled={busy || Boolean(attempt)} value={form.context} placeholder="Siapa yang menjadi sasaran? Apa konteks percakapannya?" onChange={e => setForm({ ...form, context: e.target.value })} />
      <details><summary>Referensi & identitas konteks</summary><label htmlFor="context-key">Context key</label><input id="context-key" maxLength={200} disabled={busy || Boolean(attempt)} value={form.context_key} onChange={e => setForm({ ...form, context_key: e.target.value })} placeholder="post-123:target-456:evidence-v1" /><p className="help">Identitas konteks yang stabil, misalnya post, sasaran, dan versi bukti. Jangan gunakan satu nilai untuk semua kasus.</p><label htmlFor="external-id">Referensi eksternal</label><input id="external-id" maxLength={200} disabled={busy || Boolean(attempt)} value={form.external_reference_id || ''} onChange={e => setForm({ ...form, external_reference_id: e.target.value })} /></details>
      <div className="form-foot"><span>⌁ Teks saja · tidak membuka tautan/media</span><button className="primary" disabled={busy || remaining > 0 || Boolean(result)} type="submit">{busy ? 'Menganalisis…' : attempt ? 'Retry payload yang sama ↗' : 'Analisis konten ↗'}</button></div>
      {attempt && <><p className="help mono">Request {attempt.key.slice(0, 8)} · tersimpan server-side</p><button type="button" className="text-button" disabled={busy} onClick={() => { if (!result || ['pending_review','processing'].includes(result.status)) { if (!window.confirm('Submission sebelumnya belum final. Referensinya tetap ada di Submission saya. Mulai submission baru?')) return; } fresh(); }}>Mulai submission baru{result?.status === 'failed' ? ' dengan key baru' : ''}</button></>}
    </form></section><section className="panel output"><div className="panel-title"><span className="section-number">02</span><h2>Hasil analisis</h2><span className="muted">✧</span></div>{busy && !result ? <div className="empty"><div className="spinner" /><h3>Membaca konten dan konteks…</h3><p>Analisis bisa memerlukan beberapa menit. Referensi submission tetap tersimpan jika koneksi terputus.</p></div> : <Result value={result} openReview={canReview ? openReview : null} />}</section></div>
      {previewInput && <section className="panel compact"><h3>Konten submission</h3><p className="prewrap">{previewInput.content}</p><p className="muted prewrap">{previewInput.context}</p></section>}
      <section className="taxonomy-preview"><div><div className="eyebrow">KEBIJAKAN, BUKAN ASUMSI</div><h2>Kategori dimuat dari taxonomy service.</h2><p>Snapshot kebijakan, bukan replika lengkap menu Report X atau keputusan resmi platform.</p></div><div className="chips">{taxonomy ? taxonomy.categories.map(c => <span key={c.id}>{c.label}</span>) : <button onClick={async () => { try { setTaxonomy(await api('/taxonomy')); setError(''); } catch (e) { setError(e.message); } }}>Muat ulang taxonomy</button>}</div></section></>}
    {page === 'history' && <section className="panel"><ListHead title="Submission akun ini" total={total} reload={() => loadList()} /><div className="table-wrap"><table><thead><tr><th>Referensi aplikasi</th><th>Status terakhir / cache</th><th>Dikirim</th><th /></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td className="mono">{r.service_id?.slice(0, 12) || r.id.slice(0, 12)}</td><td>{r.status}</td><td>{new Date(r.created).toLocaleString('id-ID')}</td><td><button onClick={() => viewSubmission(r)}>Periksa status terbaru ↗</button></td></tr>)}</tbody></table></div>{!rows.length && <div className="empty small">Belum ada submission dari akun ini.</div>}<p className="help">Maksimal 100 referensi terbaru. Hasil final selalu dimuat ulang dari service saat dibuka.</p></section>}
    {page === 'reviews' && <section className="panel"><ListHead title="Review manusia" total={total} reload={() => loadList()} /><div className="tabs">{[['pending','Pending'],['completed','Selesai']].map(([value,label]) => <button key={value} className={queue === value ? 'selected' : ''} onClick={() => { setQueue(value); setOffset(0); }}>{label}</button>)}</div><div className="review-list">{rows.map(r => <button className="review-row" key={r.id} onClick={() => openReview(r.id)}><span className="review-icon">◫</span><div><strong>{r.input?.content?.slice(0, 170)}</strong><small>{date(r.created)} · {r.status} · {r.id.slice(0, 8)}</small></div><span>↗</span></button>)}</div>{!rows.length && <div className="empty small">Tidak ada review pada halaman ini.</div>}<Pagination offset={offset} total={total} setOffset={setOffset} /></section>}
    {page === 'workspace' && review && <ReviewWorkspace key={review.id} review={review} taxonomy={taxonomy} api={api} setReview={setReview} setError={setError} attribution={attribution} limited={remaining > 0} />}
    {page === 'knowledge' && <section className="panel"><ListHead title="Keputusan manusia yang tersimpan" total={total} reload={() => loadList()} />{rows.map(item => <Knowledge key={item.id} item={item} admin={isAdmin} api={api} refresh={() => loadList()} setError={setError} />)}{!rows.length && <div className="empty small">Belum ada knowledge pada halaman ini.</div>}<Pagination offset={offset} total={total} setOffset={setOffset} /><p className="help">Revoke/expiry menghentikan reuse masa depan, bukan mengubah hasil historis. Indexing terpisah dari validitas keputusan manusia.</p></section>}
    {page === 'users' && <Users rows={rows} user={user} api={api} refresh={() => loadList()} setError={setError} />}
    <footer><span>tilik. <span className="muted">Human-centered content review</span></span><span>{taxonomy?.version || 'Taxonomy belum terhubung'} · Waktu lokal browser</span></footer>
  </main></div>;
}
function ListHead({ title, total, reload }) { return <div className="list-head"><div><h2>{title}</h2><p className="muted">{total} item pada cakupan ini</p></div><button onClick={() => reload().catch(() => {})}>↻ Muat ulang</button></div>; }
function Pagination({ offset, total, setOffset }) { return <div className="pagination"><span>{total ? `${offset + 1}–${Math.min(offset + 25, total)} dari ${total}` : '0 item'}</span><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>← Sebelumnya</button><button disabled={offset + 25 >= total} onClick={() => setOffset(offset + 25)}>Berikutnya →</button></div>; }
function Login({ onLogin }) {
  const [email,setEmail] = useState(''), [password,setPassword] = useState(''), [busy,setBusy] = useState(false), [error,setError] = useState('');
  return <div className="login-page"><div className="login-intro"><div className="brand"><span className="brand-mark">t</span>tilik.</div><div><div className="eyebrow">HUMAN-CENTERED CONTENT REVIEW</div><h1>Teknologi membaca.<br />Manusia memahami.</h1><p>Workspace untuk klasifikasi konten, review yang bertanggung jawab, dan knowledge yang bisa ditelusuri.</p></div><span>𝕏 Policy mapping · Independent workspace</span></div><div className="login-form"><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await onLogin({ email, password }); } catch (e) { setError(e.message); } finally { setBusy(false); } }}><div className="eyebrow">SELAMAT DATANG KEMBALI</div><h2>Masuk ke workspace.</h2><p className="muted">Gunakan akun yang diberikan admin organisasi Anda.</p><Message kind="error">{error}</Message><label htmlFor="email">Email</label><input id="email" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /><label htmlFor="password">Kata sandi</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /><button className="primary" disabled={busy}>{busy ? 'Memeriksa…' : 'Masuk ↗'}</button><p className="help">Akses berdasarkan role. Kunci service tetap berada di server.</p></form></div></div>;
}
function ReviewWorkspace({ review, taxonomy, api, setReview, setError, attribution, limited }) {
  const [choice,setChoice] = useState(''), [rules,setRules] = useState([]), [rationale,setRationale] = useState(''), [notes,setNotes] = useState(''), [basis,setBasis] = useState('external_evidence'), [reuse,setReuse] = useState('exact'), [hours,setHours] = useState(24), [checked,setChecked] = useState(false), [busy,setBusy] = useState(false), [feedback,setFeedback] = useState(null), [conflict,setConflict] = useState(false);
  const revision = useRef(review.revision);
  useEffect(() => { if (revision.current !== review.revision) { setChecked(false); setConflict(true); revision.current = review.revision; } }, [review.revision]);
  async function reload() { setReview(await api('/reviews/' + review.id)); setChecked(false); }
  async function decide(e) {
    e.preventDefault(); setBusy(true); setError(''); setFeedback(null);
    try {
      const result = await api('/reviews/' + review.id + '/decision', { method: 'POST', body: { expected_revision: review.revision, pelanggaran: choice === 'yes', rule_ids: choice === 'yes' ? rules : [], rationale, verification_notes: notes, evidence_basis: basis, reuse, valid_for_hours: Number(hours) } });
      setFeedback(result); await reload(); setConflict(false); setChecked(false);
    } catch (e) {
      setError(e.status === 409 ? 'Konflik revision atau kebijakan. Draft tetap ada. Periksa detail terbaru sebelum mengirim manual kembali. ' + e.message : e.message);
      setChecked(false); setConflict(true);
      try { await reload(); } catch { setError('Respons keputusan belum diketahui dan detail gagal dimuat. Jangan kirim ulang; muat ulang review terlebih dahulu.'); }
    } finally { setBusy(false); }
  }
  const allRules = taxonomy?.categories.flatMap(c => c.subcategories.map(r => ({ ...r, category: c.label }))) || [];
  const external = basis !== 'text_only' || allRules.some(r => rules.includes(r.id) && r.evidence_requirement !== 'text') || review.classification?.prediction?.findings?.some(f => f.evidence_requirement !== 'text');
  return <><div className="review-status"><Badge state={stateOf(review.classification)} /><span>Revision review: {review.revision}</span><button disabled={busy} onClick={() => reload().catch(e => setError(e.message))}>↻ Detail terbaru</button></div><Message>{attribution}</Message>{conflict && <Message kind="warning">Detail telah diperbarui atau respons sebelumnya belum pasti. Draft tidak ditimpa. Bandingkan audit, periksa kebijakan, lalu konfirmasi ulang jika masih perlu mengirim.</Message>}{feedback && <Message>Keputusan tersimpan. Knowledge: {feedback.knowledge_id}. Reuse efektif: <strong>{feedback.reuse}</strong>. {feedback.warnings?.join(' · ')}</Message>}
    <div className="content-grid"><section className="panel"><h2>Konten & konteks</h2><blockquote className="source-content">{review.input?.content}</blockquote><h3>Konteks</h3><p className="prewrap">{review.input?.context || 'Tidak tersedia'}</p><p className="help mono">Context key: {review.input?.context_key || 'Tidak tersedia'}</p><h3>Analisis awal model — bukan keputusan manusia</h3><Findings value={review.classification?.prediction} /><details><summary>Hasil klasifikasi terkini</summary><Result value={review.classification} /></details></section>
    <section className="panel"><h2>{review.status === 'completed' ? 'Koreksi keputusan' : 'Keputusan reviewer'}</h2><p className="muted">Pilihan tidak diisi otomatis dari prediksi model.</p><form onSubmit={decide}><fieldset disabled={busy}><legend>Apakah konten melanggar?</legend><div className="choices">{[['yes','Ya, melanggar'],['no','Tidak melanggar']].map(([value,label]) => <label key={value}><input type="radio" name="violation" required value={value} checked={choice === value} onChange={() => { setChoice(value); if (value === 'no') setRules([]); setChecked(false); }} />{label}</label>)}</div>
      {choice === 'yes' && <><label htmlFor="rules">Kategori/subkategori (maksimal 8)</label><select id="rules" multiple size={7} value={rules} disabled={!taxonomy} onChange={e => { const next = [...e.target.selectedOptions].map(x => x.value); if (next.length <= 8) setRules(next); setChecked(false); }}>{allRules.map(r => <option value={r.id} key={r.id}>{r.category} / {r.label}</option>)}</select><p className="help">Gunakan Ctrl/⌘ untuk memilih beberapa rule. Taxonomy harus berhasil dimuat.</p></>}
      <label htmlFor="rationale">Alasan keputusan</label><textarea id="rationale" rows={4} required minLength={5} maxLength={2000} value={rationale} onChange={e => { setRationale(e.target.value); setChecked(false); }} />
      <label htmlFor="basis">Dasar bukti</label><select id="basis" value={basis} onChange={e => { setBasis(e.target.value); setChecked(false); }}><option value="external_evidence">Bukti eksternal / media / konteks</option><option value="text_only">Hanya teks — saya telah memastikan</option></select>
      <label htmlFor="notes">Catatan verifikasi {external && <span className="required">*</span>}</label><textarea id="notes" rows={3} maxLength={3000} required={Boolean(external)} minLength={external ? 5 : undefined} value={notes} onChange={e => { setNotes(e.target.value); setChecked(false); }} />
      <div className="field-pair"><div><label htmlFor="reuse">Izin reuse</label><select id="reuse" value={reuse} onChange={e => { setReuse(e.target.value); setChecked(false); }}><option value="none">None — tetap simpan knowledge</option><option value="exact">Exact — kasus identik</option><option value="similar">Similar — sesuai pemeriksaan service</option></select></div><div><label htmlFor="hours">Masa berlaku (jam)</label><input id="hours" type="number" min={1} max={2160} step={1} required value={hours} onChange={e => { setHours(e.target.value); setChecked(false); }} /></div></div><p className="help">Similar bukan jaminan bebas review. Bukti eksternal tidak dapat direuse melalui similarity; service dapat menurunkan izin efektif.</p>
      <label className="confirm"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} />Saya telah memeriksa konten dan konteks yang relevan serta audit terbaru.</label><button className="primary" disabled={busy || limited || !checked || !taxonomy || !choice || (choice === 'yes' && !rules.length)}>{busy ? 'Menyimpan…' : review.status === 'completed' ? 'Simpan koreksi manusia' : 'Simpan keputusan manusia'}</button></fieldset></form></section></div>
    <section className="panel compact"><h2>Audit service · urutan revision</h2>{review.events?.map(event => <article className="audit-row" key={event.revision}><strong>Revision {event.revision}</strong><span>{date(event.created)} · actor service: {event.actor}</span><p>{event.decision?.rationale}</p></article>)}{!review.events?.length && <p className="muted">Belum ada keputusan manusia.</p>}</section></>;
}
function Knowledge({ item, admin, api, refresh, setError }) {
  const [busy,setBusy] = useState(false), [feedback,setFeedback] = useState('');
  async function action(kind) {
    let reason;
    if (kind === 'revoke') { reason = window.prompt('Alasan pencabutan (5–1000 karakter):'); if (reason === null) return; if (reason.trim().length < 5 || reason.length > 1000) { setError('Alasan harus 5–1000 karakter.'); return; } if (!window.confirm('Cabut izin reuse knowledge ini untuk permintaan berikutnya? Hasil historis tidak diubah.')) return; }
    setBusy(true); setError('');
    try { const data = await api(`/knowledge/${item.id}/${kind}`, { method: 'POST', ...(reason !== undefined ? { body: { reason } } : {}) }); setFeedback(kind === 'reindex' ? data.indexed ? 'Index berhasil diperbarui.' : 'Index belum tersedia; keputusan manusia tetap tersimpan.' : 'Reuse knowledge dicabut.'); await refresh(); }
    catch (e) { setError('Respons tindakan: ' + e.message + ' Muat ulang daftar sebelum mencoba lagi.'); try { await refresh(); } catch {} }
    finally { setBusy(false); }
  }
  return <article className="knowledge"><div className="row"><span className="badge neutral">{knowledgeState(item)}</span><span className="muted">Reuse: {item.reuse} · berakhir {date(item.expires)}</span></div><h3>{item.input?.content}</h3><p>{item.result?.explanation || item.rationale}</p><details><summary>Provenance, konteks & keputusan</summary><p className="prewrap">{item.input?.context}</p><dl className="meta"><dt>Case / revision</dt><dd>{item.case_id} / {item.revision}</dd><dt>Actor service</dt><dd>{item.actor}</dd><dt>Versi kebijakan</dt><dd>{item.version}</dd><dt>Context key</dt><dd>{item.input?.context_key || '—'}</dd><dt>ID knowledge</dt><dd>{item.id}</dd></dl><Findings value={item.result} /></details>{item.index_error && <Message kind="warning">Indexing: {item.index_error}. Ini bukan kegagalan keputusan manusia.</Message>}<Message>{feedback}</Message>{admin && <div className="actions"><button disabled={busy} onClick={() => action('reindex')}>Reindex</button><button className="danger" disabled={busy || item.state === 'revoked'} onClick={() => action('revoke')}>Cabut reuse</button></div>}</article>;
}
function Users({ rows, user, api, refresh, setError }) {
  const [busy,setBusy] = useState(false), [email,setEmail] = useState(''), [name,setName] = useState(''), [password,setPassword] = useState(''), [role,setRole] = useState('operator');
  async function update(row, changes) { setBusy(true); try { await api('/users/' + row.id, { method: 'POST', body: { role: row.role, active: Boolean(row.active), ...changes } }); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <div className="content-grid"><section className="panel"><h2>Pengguna organisasi</h2>{rows.map(row => <div className="user-row" key={row.id}><strong>{row.name}</strong><small>{row.email}</small><div className="actions"><select aria-label={'Role '+row.email} disabled={busy || row.id === user.id} value={row.role} onChange={e => update(row,{role:e.target.value})}>{['operator','reviewer','admin'].map(role => <option key={role}>{role}</option>)}</select><button disabled={busy || row.id === user.id} onClick={() => update(row,{active:!row.active})}>{row.active ? 'Nonaktifkan' : 'Aktifkan'}</button></div><code>{row.id}</code></div>)}</section><section className="panel"><h2>Tambah pengguna</h2><form onSubmit={async e => { e.preventDefault(); setBusy(true); try { await api('/users',{method:'POST',body:{email,name,password,role}});setEmail('');setName('');setPassword('');await refresh(); } catch(e) {setError(e.message);}finally{setBusy(false);} }}><label htmlFor="new-name">Nama</label><input id="new-name" required maxLength={150} value={name} onChange={e=>setName(e.target.value)}/><label htmlFor="new-email">Email</label><input id="new-email" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/><label htmlFor="new-password">Kata sandi awal (minimal 12 karakter)</label><input id="new-password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/><label htmlFor="new-role">Role</label><select id="new-role" value={role} onChange={e=>setRole(e.target.value)}>{['operator','reviewer','admin'].map(role=><option key={role}>{role}</option>)}</select><button className="primary" disabled={busy}>Buat pengguna</button><p className="help">Tenant mengikuti admin. Key reviewer per manusia diprovision terpisah pada service; ID pengguna dipakai pada pemetaan server.</p></form></section></div>;
}
