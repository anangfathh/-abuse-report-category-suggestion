'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { AppShell } from '@astryxdesign/core/AppShell';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Badge } from '@astryxdesign/core/Badge';
import { BreadcrumbItem, Breadcrumbs } from '@astryxdesign/core/Breadcrumbs';
import { Button } from '@astryxdesign/core/Button';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Divider } from '@astryxdesign/core/Divider';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Layout, LayoutContent } from '@astryxdesign/core/Layout';
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { Spinner } from '@astryxdesign/core/Spinner';
import { StackItem } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { BookMarked, Brain, History as HistoryIcon, Inbox, LogOut, ScanSearch, Send, Users as UsersIcon } from 'lucide-react';
import { Mono, Notice, PageHeader, Panel, Result } from './ui.jsx';
import { ApiHistory, History, KnowledgeList, Login, ReviewQueue, ReviewWorkspace, Taxonomy, Users } from './views.jsx';

const blank = { platform: 'x', content: '', context: '', context_key: '', external_reference_id: '' };
const headings = {
  new: ['KLASIFIKASI KONTEN', 'Abuse report category suggestion', 'Kenali kategori yang relevan. Beri ruang untuk pertimbangan manusia.'],
  taxonomy: ['PETA KEBIJAKAN', 'Taxonomy kebijakan X', 'Jelajahi kategori, rincian, dan sumber kebijakan yang digunakan untuk klasifikasi.'],
  history: ['AKTIVITAS ANDA', 'Submission saya', 'Referensi yang dikirim melalui akun ini, bukan riwayat global service.'],
  reviews: ['HUMAN IN THE LOOP', 'Antrean review', 'Tinjau kasus yang membutuhkan konteks dan penilaian manusia.'],
  workspace: ['WORKSPACE REVIEWER', 'Keputusan yang bisa ditelusuri', 'Periksa bukti, konteks, dan kebijakan sebelum memutuskan.'],
  knowledge: ['PENGETAHUAN TERVERIFIKASI', 'Knowledge manusia', 'Keputusan reviewer, provenance, dan masa berlaku reuse.'],
  users: ['ADMINISTRASI', 'Pengguna & peran', 'Akses manusia dibatasi organisasi dan role pada server.'],
};

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

export default function App() {
  const [user, setUser] = useState(null), [boot, setBoot] = useState(true), [csrf, setCsrf] = useState('');
  const [page, setPage] = useState('new'), [error, setError] = useState(''), [busy, setBusy] = useState(false), [attribution, setAttribution] = useState('');
  const [taxonomy, setTaxonomy] = useState(null), [form, setForm] = useState(blank), [attempt, setAttempt] = useState(null), [result, setResult] = useState(null);
  const [rows, setRows] = useState([]), [total, setTotal] = useState(0), [offset, setOffset] = useState(0), [queue, setQueue] = useState('pending');
  const [review, setReview] = useState(null), [notice, setNotice] = useState(''), [retryAt, setRetryAt] = useState(0), [clock, setClock] = useState(Date.now());
  const [previewInput, setPreviewInput] = useState(null), [confirmNew, setConfirmNew] = useState(false);
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
  function startNew() { if (!result || ['pending_review', 'processing'].includes(result.status)) setConfirmNew(true); else fresh(); }
  async function signOut() { try { await api('/logout', { method: 'POST' }); setUser(null); setCsrf(''); fresh(); setRows([]); setReview(null); setTaxonomy(null); } catch (e) { setError(e.message); } }
  const reloadTaxonomy = async () => { try { setTaxonomy(await api('/taxonomy')); setError(''); } catch (e) { setError(e.message); } };

  if (boot) return <div className="boot"><Spinner size="lg" label="Memuat workspace…" /></div>;
  if (!user) return <Login onLogin={async body => { const data = await api('/login', { method: 'POST', body, login: true }); setUser(data.user); setCsrf(data.csrf); await bootstrap(); }} />;

  const heading = headings[page];
  const locked = Boolean(attempt);
  const navItem = (id, label, icon) => <SideNavItem key={id} label={label} icon={icon} isSelected={page === id || (id === 'reviews' && page === 'workspace')} isDisabled={busy} onClick={() => navigate(id)} />;

  const sideNav = <SideNav aria-label="Navigasi utama"
    header={<SideNavHeading heading="Abuse Reporter" subheading="Content intelligence" icon={<span className="brand-mark">AR</span>} />}
    footer={<HStack gap={2} vAlign="center" padding={2}>
      <Avatar name={user.name} size="sm" tooltip={false} />
      <StackItem size="fill"><VStack gap={0}>
        <Text weight="medium" maxLines={1}>{user.name}</Text>
        <Text type="supporting" maxLines={1}>{user.role} · {user.tenant}</Text>
      </VStack></StackItem>
      <IconButton label="Keluar" icon={<Icon icon={LogOut} />} variant="ghost" size="sm" isDisabled={busy} onClick={signOut} />
    </HStack>}>
    <SideNavSection title="Workspace">
      {navItem('new', 'Klasifikasi baru', ScanSearch)}
      {navItem('history', 'Submission saya', HistoryIcon)}
      {navItem('taxonomy', 'Taxonomy kebijakan', BookMarked)}
    </SideNavSection>
    {canReview && <SideNavSection title="Review">
      {navItem('reviews', 'Antrean review', Inbox)}
      {navItem('knowledge', 'Knowledge', Brain)}
    </SideNavSection>}
    {isAdmin && <SideNavSection title="Administrasi">
      {navItem('users', 'Pengguna & peran', UsersIcon)}
    </SideNavSection>}
  </SideNav>;

  return <AppShell sideNav={sideNav} contentPadding={0} variant="elevated">
    <Layout contentWidth={1240} height="auto">
      <LayoutContent><VStack gap={6}>
        <HStack gap={3} vAlign="center" wrap="wrap" justify="between">
          <Breadcrumbs variant="supporting" label="Lokasi halaman">
            <BreadcrumbItem>Workspace</BreadcrumbItem>
            <BreadcrumbItem isCurrent>{page === 'new' ? 'Category suggestion' : heading[1]}</BreadcrumbItem>
          </Breadcrumbs>
          <Badge variant="neutral" label="𝕏 Policy mapping" />
        </HStack>
        <PageHeader eyebrow={heading[0]} title={heading[1]} description={heading[2]} />
        <Notice kind="error">{error}</Notice>
        <Notice kind="info">{notice}</Notice>
        {remaining > 0 && <Notice kind="warning">Batas permintaan tercapai. Coba lagi dalam {remaining} detik.</Notice>}

        {page === 'new' && <>
          <Grid columns={{ minWidth: 440 }} gap={5} align="start">
            <Panel title="Konten yang ingin diperiksa" actions={<Badge variant="neutral" label="𝕏" />}>
              <form onSubmit={submit}>
                <VStack gap={5}>
                  <TextArea label="Teks konten" isRequired rows={7} maxLength={8000} htmlMaxLength={8000} value={form.content} isDisabled={busy || locked}
                    placeholder="Tempel teks postingan atau balasan yang ingin ditinjau…" onChange={value => setForm({ ...form, content: value })} />
                  <TextArea label="Konteks tambahan" isOptional rows={3} maxLength={3000} htmlMaxLength={3000} value={form.context} isDisabled={busy || locked}
                    placeholder="Siapa yang menjadi sasaran? Apa konteks percakapannya?" onChange={value => setForm({ ...form, context: value })} />
                  <Collapsible defaultIsOpen={false} chevronPosition="start" trigger={<Text weight="medium">Referensi & identitas konteks</Text>}>
                    <VStack gap={4} paddingBlockStart={3}>
                      <TextInput label="Context key" isOptional maxLength={200} value={form.context_key} isDisabled={busy || locked} placeholder="post-123:target-456:evidence-v1"
                        description="Identitas konteks yang stabil, misalnya post, sasaran, dan versi bukti. Jangan gunakan satu nilai untuk semua kasus."
                        onChange={value => setForm({ ...form, context_key: value.slice(0, 200) })} />
                      <TextInput label="Referensi eksternal" isOptional value={form.external_reference_id || ''} isDisabled={busy || locked}
                        onChange={value => setForm({ ...form, external_reference_id: value.slice(0, 200) })} />
                    </VStack>
                  </Collapsible>
                  <Divider />
                  <HStack gap={3} vAlign="center" wrap="wrap" justify="between">
                    <Text type="supporting">Teks saja · tidak membuka tautan/media</Text>
                    <Button type="submit" variant="primary" icon={<Icon icon={Send} />} isLoading={busy} label={attempt && !result ? 'Retry payload yang sama' : 'Analisis konten'}
                      isDisabled={busy || remaining > 0 || Boolean(result) || !form.content.trim()} />
                  </HStack>
                  {attempt && <VStack gap={2} hAlign="start">
                    <Text type="supporting">Request <Mono>{attempt.key.slice(0, 8)}</Mono> · tersimpan server-side</Text>
                    <Button variant="secondary" size="sm" isDisabled={busy} onClick={startNew} label={'Mulai submission baru' + (result?.status === 'failed' ? ' dengan key baru' : '')} />
                  </VStack>}
                </VStack>
              </form>
            </Panel>
            <Panel title="Hasil analisis">
              {busy && !result
                ? <VStack gap={3} hAlign="center" paddingBlock={8}>
                    <Spinner size="xl" label="Membaca konten dan konteks…" />
                    <Text type="supporting" justify="center">Analisis bisa memerlukan beberapa menit. Referensi submission tetap tersimpan jika koneksi terputus.</Text>
                  </VStack>
                : <Result value={result} openReview={canReview ? openReview : null} />}
            </Panel>
          </Grid>
          {previewInput && <Panel title="Konten submission">
            <Text as="p" className="prewrap">{previewInput.content}</Text>
            {previewInput.context && <Text as="p" color="secondary" className="prewrap">{previewInput.context}</Text>}
          </Panel>}
          <Panel title="Kategori dimuat dari taxonomy service." description="Snapshot kebijakan, bukan replika lengkap menu Report X atau keputusan resmi platform.">
            {taxonomy
              ? <HStack gap={2} wrap="wrap">{taxonomy.categories.map(c => <Badge key={c.id} variant="neutral" label={c.label} />)}</HStack>
              : <HStack><Button variant="secondary" size="sm" label="Muat ulang taxonomy" onClick={reloadTaxonomy} /></HStack>}
          </Panel>
          <AlertDialog isOpen={confirmNew} onOpenChange={setConfirmNew} title="Mulai submission baru?"
            description="Submission sebelumnya belum final. Referensinya tetap ada di Submission saya."
            actionLabel="Mulai submission baru" cancelLabel="Batal" actionVariant="primary"
            onAction={() => { setConfirmNew(false); fresh(); }} />
        </>}

        {page === 'taxonomy' && <Taxonomy taxonomy={taxonomy} reload={reloadTaxonomy} />}
        {page === 'history' && <>
          <ApiHistory api={api} />
          <History rows={rows} total={total} reload={() => loadList()} onOpen={viewSubmission} />
        </>}
        {page === 'reviews' && <ReviewQueue rows={rows} total={total} offset={offset} setOffset={setOffset} queue={queue} setQueue={setQueue} reload={() => loadList()} onOpen={openReview} />}
        {page === 'workspace' && review && <ReviewWorkspace key={review.id} review={review} taxonomy={taxonomy} api={api} setReview={setReview} setError={setError} attribution={attribution} limited={remaining > 0} />}
        {page === 'knowledge' && <KnowledgeList rows={rows} total={total} offset={offset} setOffset={setOffset} reload={() => loadList()} admin={isAdmin} api={api} setError={setError} />}
        {page === 'users' && <Users rows={rows} user={user} api={api} refresh={() => loadList()} setError={setError} />}

        <Divider />
        <HStack gap={3} wrap="wrap" justify="between">
          <Text type="supporting"><Text weight="semibold" color="accent">Abuse Reporter</Text> · Human-centered content review</Text>
          <Text type="supporting">{taxonomy?.version || 'Taxonomy belum terhubung'} · Waktu lokal browser</Text>
        </HStack>
      </VStack></LayoutContent>
    </Layout>
  </AppShell>;
}
