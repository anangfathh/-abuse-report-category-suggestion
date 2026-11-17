'use client';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Blockquote } from '@astryxdesign/core/Blockquote';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Divider } from '@astryxdesign/core/Divider';
import { FormLayout } from '@astryxdesign/core/FormLayout';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { MultiSelector } from '@astryxdesign/core/MultiSelector';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Selector } from '@astryxdesign/core/Selector';
import { StackItem } from '@astryxdesign/core/Stack';
import { Table } from '@astryxdesign/core/Table';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { Braces, Hourglass, LogIn, RefreshCw } from 'lucide-react';
import { stateOf, policyLink, knowledgeState, filterTaxonomy } from '../lib/domain.mjs';
import { Spinner } from '@astryxdesign/core/Spinner';
import { DisclosureCard, Empty, Findings, JsonBlock, JsonDisclosure, ListHead, Mono, Notice, PAGE_SIZE, Panel, PaginationBar, ReloadButton, Result, StateBadge, ThemeToggle, date } from './ui.jsx';

const knowledgeVariants = { active: 'success', revoked: 'error', expired: 'warning' };
const REVIEW_TABS = [['pending', 'Pending'], ['completed', 'Selesai']];
const ROLES = ['operator', 'reviewer', 'admin'].map(value => ({ value, label: value }));

/* ───────────────────────────── Login ───────────────────────────── */
export function Login({ onLogin }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    if (busy || !email || !password) return;
    setBusy(true); setError('');
    try { await onLogin({ email, password }); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className="login-page">
    <div className="login-intro">
      <HStack gap={3} vAlign="center" justify="between"><HStack gap={2} vAlign="center"><span className="brand-mark">AR</span><Heading level={2}>Abuse Reporter</Heading></HStack><ThemeToggle /></HStack>
      <VStack gap={3} className="login-intro-copy">
        <Text type="label" color="accent">HUMAN-CENTERED CONTENT REVIEW</Text>
        <Heading level={1} type="display-2">Teknologi membaca. Manusia memahami.</Heading>
        <Text type="large" color="secondary">Workspace untuk klasifikasi konten, review yang bertanggung jawab, dan knowledge yang bisa ditelusuri.</Text>
      </VStack>
      <Text type="supporting" className="login-intro-foot">𝕏 Policy mapping · Independent workspace</Text>
    </div>
    <div className="login-form">
      <form onSubmit={submit}>
        <VStack gap={5}>
          <VStack gap={1}>
            <Text type="label" color="accent">SELAMAT DATANG KEMBALI</Text>
            <Heading level={2}>Masuk ke workspace.</Heading>
            <Text color="secondary">Gunakan akun yang diberikan admin organisasi Anda.</Text>
          </VStack>
          <Notice kind="error">{error}</Notice>
          <FormLayout>
            <TextInput label="Email" type="email" autoComplete="username" value={email} onChange={setEmail} isDisabled={busy} />
            <TextInput label="Kata sandi" type="password" autoComplete="current-password" value={password} onChange={setPassword} isDisabled={busy} />
          </FormLayout>
          <Button type="submit" variant="primary" size="lg" width="100%" label="Masuk" icon={<Icon icon={LogIn} />} isLoading={busy} isDisabled={!email || !password} />
          <Text type="supporting" color="secondary">Akses berdasarkan role. Kunci service tetap berada di server.</Text>
        </VStack>
      </form>
    </div>
  </div>;
}

/* ───────────────────────────── Taxonomy ───────────────────────────── */
export function Taxonomy({ taxonomy, reload }) {
  const [query, setQuery] = useState('');
  const categories = taxonomy?.categories || [];
  const filtered = filterTaxonomy(categories, query);
  const searching = Boolean(query.trim());
  return <Panel title="Referensi kategori"
    description={taxonomy ? `${categories.length} kategori · ${categories.reduce((sum, c) => sum + c.subcategories.length, 0)} subkategori` : 'Taxonomy belum tersedia'}
    actions={<ReloadButton onClick={reload} />}>
    {taxonomy ? <>
      <MetadataList orientation="horizontal">
        <MetadataListItem label="Versi">{taxonomy.version}</MetadataListItem>
        <MetadataListItem label="Ditinjau">{taxonomy.researched_at || '—'}</MetadataListItem>
      </MetadataList>
      <Notice kind="info">Peta kebijakan untuk membantu peninjauan, bukan keputusan resmi atau salinan lengkap menu pelaporan X.</Notice>
      <TextInput label="Cari kategori atau subkategori" type="search" startIcon="search" hasClear placeholder="Contoh: ancaman, identitas, atau ID rule" value={query} onChange={setQuery} />
      <VStack gap={3}>
        {filtered.map(category => {
          const source = policyLink(category.source_url);
          return <DisclosureCard key={category.id + (searching ? ':search' : '')} defaultIsOpen={searching}
            title={category.label} meta={`${category.id} · ${category.subcategories.length} subkategori`}>
            {category.policy_title && <Text type="supporting">{category.policy_title}{category.source_updated ? ` · diperbarui ${category.source_updated}` : ''}</Text>}
            {category.exceptions && <Text as="p"><Text weight="semibold">Konteks & pengecualian:</Text> {category.exceptions}</Text>}
            {source && <HStack><Link href={source} isExternalLink>Baca sumber kebijakan</Link></HStack>}
            <Grid columns={{ minWidth: 260 }} gap={3}>
              {category.subcategories.map(rule => <Card key={rule.id} variant="muted" padding={4}>
                <VStack gap={2}>
                  <Heading level={4}>{rule.label}</Heading>
                  <Text as="p" color="secondary">{rule.detail}</Text>
                  <Text type="supporting"><Mono>{rule.id}</Mono> · Bukti: {rule.evidence_requirement || '—'}</Text>
                </VStack>
              </Card>)}
            </Grid>
          </DisclosureCard>;
        })}
      </VStack>
      {!filtered.length && <Empty title="Tidak ada kategori yang cocok dengan pencarian." />}
    </> : <Empty title="Taxonomy belum berhasil dimuat." description="Gunakan tombol muat ulang untuk mencoba lagi." />}
  </Panel>;
}

/* ───────────────────────────── Daftar ───────────────────────────── */
export function History({ rows, total, reload, onOpen, api }) {
  const [jsonRow, setJsonRow] = useState(null);
  const columns = [
    { key: 'ref', header: 'Referensi aplikasi', renderCell: r => <Mono>{r.service_id?.slice(0, 12) || r.id.slice(0, 12)}</Mono> },
    { key: 'status', header: 'Status terakhir / cache', renderCell: r => <Badge variant="neutral" label={String(r.status)} /> },
    { key: 'created', header: 'Dikirim', renderCell: r => new Date(r.created).toLocaleString('id-ID') },
    { key: 'action', header: '', renderCell: r => <HStack gap={2} justify="end">
      <Button label="Lihat JSON" size="sm" variant="ghost" icon={<Icon icon={Braces} />} onClick={() => setJsonRow(r)} />
      <Button label="Periksa status terbaru" size="sm" variant="secondary" onClick={() => onOpen(r)} />
    </HStack> },
  ];
  return <Panel>
    <ListHead title="Submission akun ini" total={total} reload={reload} />
    {rows.length ? <Table data={rows} columns={columns} idKey="id" hasHover /> : <Empty title="Belum ada submission dari akun ini." />}
    <Text type="supporting" color="secondary">Maksimal 100 referensi terbaru. Hasil final selalu dimuat ulang dari service saat dibuka.</Text>
    {jsonRow && <SubmissionJsonDialog row={jsonRow} api={api} onClose={() => setJsonRow(null)} />}
  </Panel>;
}

/** Memuat payload submission + hasil klasifikasi terbarunya dari service, lalu menampilkannya sebagai JSON. */
function SubmissionJsonDialog({ row, api, onClose }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await api('/submissions/' + row.id);
        const classification = saved.service_id ? await api('/classifications/' + saved.service_id) : null;
        if (!cancelled) setData({ submission: saved, classification });
      } catch (e) { if (!cancelled) setError(e.message); }
    })();
    return () => { cancelled = true; };
  }, [row.id]);
  return <Dialog isOpen onOpenChange={open => { if (!open) onClose(); }} width={720} purpose="info">
    <Layout height="auto" padding={4} defaultHasDividers
      header={<DialogHeader title="JSON klasifikasi" subtitle={<Mono>{row.service_id || row.id}</Mono>} onOpenChange={open => { if (!open) onClose(); }} hasDivider={false} />}
      content={<LayoutContent><VStack gap={3}>
        <Notice kind="error">{error}</Notice>
        {!data && !error && <HStack gap={2} vAlign="center"><Spinner size="sm" /><Text type="supporting">Memuat JSON dari service…</Text></HStack>}
        {data && !data.classification && <Notice kind="warning">Respons awal belum diketahui, jadi hasil klasifikasi belum ada. Hanya payload submission yang ditampilkan.</Notice>}
        {data && <JsonBlock value={data} title="submission-classification.json" maxHeight={460} />}
      </VStack></LayoutContent>}
      footer={<LayoutFooter><HStack hAlign="end"><Button label="Tutup" variant="secondary" onClick={onClose} /></HStack></LayoutFooter>} />
  </Dialog>;
}

/** Riwayat klasifikasi untuk API key integrasi organisasi (key tetap di server). */
export function ApiHistory({ api }) {
  const [items, setItems] = useState([]), [total, setTotal] = useState(0), [offset, setOffset] = useState(0), [loading, setLoading] = useState(true), [error, setError] = useState('');
  async function load() {
    setLoading(true); setError('');
    try { const data = await api(`/api-history?limit=${PAGE_SIZE}&offset=${offset}`); setItems(data.items); setTotal(data.total); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [offset]);
  return <Panel title="Riwayat API key" description="Klasifikasi yang menggunakan API key integrasi organisasi ini. Semua pengguna organisasi dengan akses history dapat melihatnya."
    actions={<ReloadButton onClick={load} isDisabled={loading} />}>
    <Notice kind="error">{error}</Notice>
    {loading && <HStack gap={2} vAlign="center"><Spinner size="sm" /><Text type="supporting">Memuat riwayat…</Text></HStack>}
    {!loading && !error && !items.length && <Empty title="Belum ada klasifikasi yang tercatat untuk API key ini." />}
    <VStack gap={3}>
      {items.map(item => <DisclosureCard key={item.id} title={item.input?.content?.slice(0, 120) || 'Klasifikasi'}
        meta={<>{new Date(item.created_at).toLocaleString('id-ID')} · {item.result?.status || '—'} · <Mono>{item.id.slice(0, 8)}</Mono></>}>
        <Text as="p" className="prewrap">{item.input?.content}</Text>
        {item.input?.context && <Text as="p" color="secondary" className="prewrap">Konteks: {item.input.context}</Text>}
        <Findings value={item.result} />
        <Text type="supporting">Request API: <Mono>{item.id}</Mono></Text>
        <JsonDisclosure value={item} label="Lihat JSON hasil klasifikasi" title="history-item.json" />
      </DisclosureCard>)}
    </VStack>
    <PaginationBar offset={offset} total={total} setOffset={setOffset} />
    <Text type="supporting" color="secondary">Riwayat mulai tercatat sejak fitur ini diaktifkan. Permintaan dari aplikasi juga dapat muncul di sini.</Text>
  </Panel>;
}

export function ReviewQueue({ rows, total, offset, setOffset, queue, setQueue, reload, onOpen }) {
  return <Panel>
    <ListHead title="Review manusia" total={total} reload={reload} />
    <TabList label="Status antrean" value={queue} onChange={value => { setQueue(value); setOffset(0); }} hasDivider>
      {REVIEW_TABS.map(([value, label]) => <Tab key={value} value={value} label={label} />)}
    </TabList>
    {rows.length ? <VStack gap={0}>
      {rows.map((r, i) => <div key={r.id}>
        {i > 0 && <Divider />}
        <HStack gap={3} vAlign="center" paddingBlock={3}>
          <StackItem size="fill"><VStack gap={1}>
            <Text maxLines={3} weight="medium" wordBreak="break-word">{r.input?.content?.slice(0, 170)}</Text>
            <Text type="supporting">{date(r.created)} · {r.status} · <Mono>{r.id.slice(0, 8)}</Mono></Text>
          </VStack></StackItem>
          <Button label="Buka review" size="sm" variant="secondary" endContent={<Icon icon="externalLink" />} onClick={() => onOpen(r.id)} />
        </HStack>
      </div>)}
    </VStack> : <Empty title="Tidak ada review pada halaman ini." />}
    <PaginationBar offset={offset} total={total} setOffset={setOffset} />
  </Panel>;
}

/* ───────────────────────────── Review workspace ───────────────────────────── */
export function ReviewWorkspace({ review, taxonomy, api, setReview, setError, attribution, limited }) {
  const [choice, setChoice] = useState(''), [rules, setRules] = useState([]), [rationale, setRationale] = useState(''), [notes, setNotes] = useState('');
  const [basis, setBasis] = useState('external_evidence'), [reuse, setReuse] = useState('exact'), [hours, setHours] = useState(24), [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState(null), [conflict, setConflict] = useState(false);
  const revision = useRef(review.revision);
  useEffect(() => { if (revision.current !== review.revision) { setChecked(false); setConflict(true); revision.current = review.revision; } }, [review.revision]);
  async function reload() { setReview(await api('/reviews/' + review.id)); setChecked(false); }
  async function decide(e) {
    e.preventDefault(); setBusy(true); setError(''); setFeedback(null);
    try {
      const result = await api('/reviews/' + review.id + '/decision', { method: 'POST', body: { expected_revision: review.revision, pelanggaran: choice === 'yes', rule_ids: choice === 'yes' ? rules : [], rationale, verification_notes: notes, evidence_basis: basis, reuse, valid_for_hours: Number(hours) } });
      setFeedback(result); await reload(); setConflict(false); setChecked(false);
    } catch (err) {
      setError(err.status === 409 ? 'Konflik revision atau kebijakan. Draft tetap ada. Periksa detail terbaru sebelum mengirim manual kembali. ' + err.message : err.message);
      setChecked(false); setConflict(true);
      try { await reload(); } catch { setError('Respons keputusan belum diketahui dan detail gagal dimuat. Jangan kirim ulang; muat ulang review terlebih dahulu.'); }
    } finally { setBusy(false); }
  }
  const allRules = taxonomy?.categories.flatMap(c => c.subcategories.map(r => ({ ...r, category: c.label }))) || [];
  const ruleOptions = (taxonomy?.categories || []).map(c => ({ type: 'section', title: c.label, options: c.subcategories.map(r => ({ value: r.id, label: r.label })) }));
  const external = basis !== 'text_only' || allRules.some(r => rules.includes(r.id) && r.evidence_requirement !== 'text') || review.classification?.prediction?.findings?.some(f => f.evidence_requirement !== 'text');
  const touch = fn => value => { fn(value); setChecked(false); };
  const completed = review.status === 'completed';
  return <VStack gap={5}>
    <HStack gap={3} vAlign="center" wrap="wrap">
      <StateBadge state={stateOf(review.classification)} />
      <StackItem size="fill"><Text type="supporting">Revision review: <Text hasTabularNumbers weight="semibold">{review.revision}</Text></Text></StackItem>
      <ReloadButton label="Detail terbaru" isDisabled={busy} onClick={() => reload().catch(err => setError(err.message))} />
    </HStack>
    <Notice kind="info">{attribution}</Notice>
    {conflict && <Notice kind="warning">Detail telah diperbarui atau respons sebelumnya belum pasti. Draft tidak ditimpa. Bandingkan audit, periksa kebijakan, lalu konfirmasi ulang jika masih perlu mengirim.</Notice>}
    {feedback && <Notice kind="success" title="Keputusan tersimpan.">Knowledge: <Mono>{feedback.knowledge_id}</Mono>. Reuse efektif: <strong>{feedback.reuse}</strong>. {feedback.warnings?.join(' · ')}</Notice>}
    <Grid columns={{ minWidth: 440 }} gap={5} align="start">
      <Panel title="Konten & konteks">
        <Blockquote><span className="prewrap source-content">{review.input?.content}</span></Blockquote>
        <VStack gap={1}>
          <Heading level={3}>Konteks</Heading>
          <Text as="p" className="prewrap">{review.input?.context || 'Tidak tersedia'}</Text>
          <Text type="supporting">Context key: <Mono>{review.input?.context_key || 'Tidak tersedia'}</Mono></Text>
        </VStack>
        <Divider />
        <VStack gap={3}>
          <Heading level={3}>Analisis awal model — bukan keputusan manusia</Heading>
          <Findings value={review.classification?.prediction} />
        </VStack>
        <Collapsible defaultIsOpen={false} chevronPosition="start" trigger={<Text weight="medium">Hasil klasifikasi terkini</Text>}>
          <VStack paddingBlockStart={3}><Result value={review.classification} /></VStack>
        </Collapsible>
      </Panel>
      <Panel title={completed ? 'Koreksi keputusan' : 'Keputusan reviewer'} description="Pilihan tidak diisi otomatis dari prediksi model.">
        <form onSubmit={decide}>
          <VStack gap={5}>
            <RadioList label="Apakah konten melanggar?" orientation="horizontal" value={choice} isDisabled={busy}
              onChange={value => { setChoice(value); if (value === 'no') setRules([]); setChecked(false); }}>
              <RadioListItem value="yes" label="Ya, melanggar" />
              <RadioListItem value="no" label="Tidak melanggar" />
            </RadioList>
            {choice === 'yes' && <MultiSelector label="Kategori/subkategori (maksimal 8)" description="Pilih rule yang relevan. Taxonomy harus berhasil dimuat."
              options={ruleOptions} value={rules} hasSearch triggerDisplay="badges" isDisabled={!taxonomy || busy} placeholder="Pilih rule…"
              onChange={next => { if (next.length <= 8) setRules(next); setChecked(false); }}
              status={rules.length >= 8 ? { type: 'warning', message: 'Batas maksimal 8 rule tercapai.' } : undefined} />}
            <FormLayout>
              <TextArea label="Alasan keputusan" isRequired rows={4} maxLength={2000} value={rationale} isDisabled={busy} onChange={touch(setRationale)} />
              <Selector label="Dasar bukti" value={basis} isDisabled={busy} onChange={touch(setBasis)} options={[
                { value: 'external_evidence', label: 'Bukti eksternal / media / konteks' },
                { value: 'text_only', label: 'Hanya teks — saya telah memastikan' },
              ]} />
              <TextArea label="Catatan verifikasi" isRequired={Boolean(external)} isOptional={!external} rows={3} maxLength={3000} value={notes} isDisabled={busy} onChange={touch(setNotes)} />
              <Grid columns={{ minWidth: 180 }} gap={4}>
                <Selector label="Izin reuse" value={reuse} isDisabled={busy} onChange={touch(setReuse)} options={[
                  { value: 'none', label: 'None — tetap simpan knowledge' },
                  { value: 'exact', label: 'Exact — kasus identik' },
                  { value: 'similar', label: 'Similar — sesuai pemeriksaan service' },
                ]} />
                <NumberInput label="Masa berlaku (jam)" isRequired min={1} max={2160} step={1} value={Number(hours)} isDisabled={busy} onChange={touch(setHours)} />
              </Grid>
            </FormLayout>
            <Text type="supporting">Similar bukan jaminan bebas review. Bukti eksternal tidak dapat direuse melalui similarity; service dapat menurunkan izin efektif.</Text>
            <CheckboxInput label="Saya telah memeriksa konten dan konteks yang relevan serta audit terbaru." value={checked} isDisabled={busy} onChange={setChecked} />
            <HStack><Button type="submit" variant="primary" isLoading={busy} label={completed ? 'Simpan koreksi manusia' : 'Simpan keputusan manusia'}
              isDisabled={busy || limited || !checked || !taxonomy || !choice || (choice === 'yes' && !rules.length)} /></HStack>
          </VStack>
        </form>
      </Panel>
    </Grid>
    <Panel title="Audit service · urutan revision">
      {review.events?.length ? <VStack gap={0}>
        {review.events.map((event, i) => <div key={event.revision}>
          {i > 0 && <Divider />}
          <VStack gap={1} paddingBlock={3}>
            <HStack gap={3} wrap="wrap" vAlign="center">
              <Badge variant="neutral" label={`Revision ${event.revision}`} />
              <Text type="supporting">{date(event.created)} · actor service: {event.actor}</Text>
            </HStack>
            <Text as="p">{event.decision?.rationale}</Text>
          </VStack>
        </div>)}
      </VStack> : <Text color="secondary">Belum ada keputusan manusia.</Text>}
    </Panel>
  </VStack>;
}

/* ───────────────────────────── Knowledge ───────────────────────────── */
export function Knowledge({ item, admin, api, refresh, setError }) {
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState('');
  const [revoking, setRevoking] = useState(false), [reason, setReason] = useState(''), [reasonError, setReasonError] = useState('');
  const state = knowledgeState(item);
  async function action(kind, body) {
    setBusy(true); setError('');
    try {
      const data = await api(`/knowledge/${item.id}/${kind}`, { method: 'POST', ...(body !== undefined ? { body } : {}) });
      setFeedback(kind === 'reindex' ? data.indexed ? 'Index berhasil diperbarui.' : 'Index belum tersedia; keputusan manusia tetap tersimpan.' : 'Reuse knowledge dicabut.');
      await refresh();
    } catch (err) { setError('Respons tindakan: ' + err.message + ' Muat ulang daftar sebelum mencoba lagi.'); try { await refresh(); } catch {} }
    finally { setBusy(false); }
  }
  function openRevoke() { setReason(''); setReasonError(''); setRevoking(true); }
  async function confirmRevoke() {
    if (reason.trim().length < 5 || reason.length > 1000) { setReasonError('Alasan harus 5–1000 karakter.'); return; }
    setRevoking(false);
    await action('revoke', { reason });
  }
  return <VStack gap={3} paddingBlock={4}>
    <HStack gap={3} vAlign="center" wrap="wrap">
      <Badge variant={knowledgeVariants[state] || 'neutral'} label={state} />
      <Text type="supporting">Reuse: {item.reuse} · berakhir {date(item.expires)}</Text>
    </HStack>
    <Heading level={3} wordBreak="break-word"><span className="prewrap">{item.input?.content}</span></Heading>
    <Text as="p" color="secondary">{item.result?.explanation || item.rationale}</Text>
    <Collapsible defaultIsOpen={false} chevronPosition="start" trigger={<Text weight="medium">Provenance, konteks & keputusan</Text>}>
      <VStack gap={4} paddingBlockStart={3}>
        {item.input?.context && <Text as="p" className="prewrap">{item.input.context}</Text>}
        <MetadataList label={{ position: 'start', width: 140 }}>
          <MetadataListItem label="Case / revision">{item.case_id} / {item.revision}</MetadataListItem>
          <MetadataListItem label="Actor service">{item.actor}</MetadataListItem>
          <MetadataListItem label="Versi kebijakan">{item.version}</MetadataListItem>
          <MetadataListItem label="Context key">{item.input?.context_key || '—'}</MetadataListItem>
          <MetadataListItem label="ID knowledge"><Mono>{item.id}</Mono></MetadataListItem>
        </MetadataList>
        <Findings value={item.result} />
      </VStack>
    </Collapsible>
    {item.index_error && <Notice kind="warning">Indexing: {item.index_error}. Ini bukan kegagalan keputusan manusia.</Notice>}
    <Notice kind="success">{feedback}</Notice>
    {admin && <HStack gap={2}>
      <Button label="Reindex" size="sm" variant="secondary" icon={<Icon icon={RefreshCw} />} isDisabled={busy} onClick={() => action('reindex')} />
      <Button label="Cabut reuse" size="sm" variant="destructive" isDisabled={busy || item.state === 'revoked'} onClick={openRevoke} />
    </HStack>}
    <Dialog isOpen={revoking} onOpenChange={setRevoking} width={480} purpose="form">
      <Layout height="auto" padding={4} defaultHasDividers
        header={<DialogHeader title="Cabut reuse knowledge" onOpenChange={setRevoking} hasDivider={false} />}
        content={<LayoutContent><VStack gap={4}>
          <Text as="p" color="secondary">Cabut izin reuse knowledge ini untuk permintaan berikutnya? Hasil historis tidak diubah.</Text>
          <TextArea label="Alasan pencabutan" description="5–1000 karakter." rows={4} maxLength={1000} isRequired value={reason}
            onChange={value => { setReason(value); setReasonError(''); }} status={reasonError ? { type: 'error', message: reasonError } : undefined} />
        </VStack></LayoutContent>}
        footer={<LayoutFooter><HStack gap={2} hAlign="end">
          <Button label="Batal" variant="secondary" onClick={() => setRevoking(false)} />
          <Button label="Cabut reuse" variant="destructive" onClick={confirmRevoke} />
        </HStack></LayoutFooter>} />
    </Dialog>
  </VStack>;
}

export function KnowledgeList({ rows, total, offset, setOffset, reload, admin, api, setError }) {
  return <Panel>
    <ListHead title="Keputusan manusia yang tersimpan" total={total} reload={reload} />
    {rows.length ? <VStack gap={0}>
      {rows.map((item, i) => <div key={item.id}>
        {i > 0 && <Divider />}
        <Knowledge item={item} admin={admin} api={api} refresh={reload} setError={setError} />
      </div>)}
    </VStack> : <Empty title="Belum ada knowledge pada halaman ini." icon={<Icon icon={Hourglass} size="lg" />} />}
    <PaginationBar offset={offset} total={total} setOffset={setOffset} />
    <Text type="supporting" color="secondary">Revoke/expiry menghentikan reuse masa depan, bukan mengubah hasil historis. Indexing terpisah dari validitas keputusan manusia.</Text>
  </Panel>;
}

/* ───────────────────────────── Users ───────────────────────────── */
export function Users({ rows, user, api, refresh, setError }) {
  const [busy, setBusy] = useState(false), [email, setEmail] = useState(''), [name, setName] = useState(''), [password, setPassword] = useState(''), [role, setRole] = useState('operator');
  async function update(row, changes) { setBusy(true); try { await api('/users/' + row.id, { method: 'POST', body: { role: row.role, active: Boolean(row.active), ...changes } }); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function create(e) {
    e.preventDefault(); setBusy(true);
    try { await api('/users', { method: 'POST', body: { email, name, password, role } }); setEmail(''); setName(''); setPassword(''); await refresh(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <Grid columns={{ minWidth: 420 }} gap={5} align="start">
    <Panel title="Pengguna organisasi" description={`${rows.length} akun`}>
      {rows.length ? <VStack gap={0}>
        {rows.map((row, i) => <div key={row.id}>
          {i > 0 && <Divider />}
          <VStack gap={2} paddingBlock={3}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <StackItem size="fill"><VStack gap={0.5}>
                <Text weight="semibold">{row.name}</Text>
                <Text type="supporting">{row.email}</Text>
              </VStack></StackItem>
              <Badge variant={row.active ? 'success' : 'neutral'} label={row.active ? 'Aktif' : 'Nonaktif'} />
            </HStack>
            <HStack gap={2} vAlign="end" wrap="wrap">
              <Selector label={'Role ' + row.email} isLabelHidden size="sm" width={150} value={row.role} options={ROLES} isDisabled={busy || row.id === user.id} onChange={value => update(row, { role: value })} />
              <Button label={row.active ? 'Nonaktifkan' : 'Aktifkan'} size="sm" variant="secondary" isDisabled={busy || row.id === user.id} onClick={() => update(row, { active: !row.active })} />
            </HStack>
            <Text type="supporting"><Mono>{row.id}</Mono></Text>
          </VStack>
        </div>)}
      </VStack> : <Empty title="Belum ada pengguna." />}
    </Panel>
    <Panel title="Tambah pengguna">
      <form onSubmit={create}>
        <VStack gap={5}>
          <FormLayout>
            <TextInput label="Nama" isRequired value={name} onChange={setName} isDisabled={busy} />
            <TextInput label="Email" type="email" isRequired value={email} onChange={setEmail} isDisabled={busy} />
            <TextInput label="Kata sandi awal (minimal 12 karakter)" type="password" autoComplete="new-password" isRequired value={password} onChange={setPassword} isDisabled={busy} />
            <Selector label="Role" value={role} options={ROLES} onChange={setRole} isDisabled={busy} />
          </FormLayout>
          <HStack><Button type="submit" variant="primary" label="Buat pengguna" isLoading={busy} isDisabled={busy || !name || !email || password.length < 12} /></HStack>
          <Text type="supporting" color="secondary">Tenant mengikuti admin. Key reviewer per manusia diprovision terpisah pada service; ID pengguna dipakai pada pemetaan server.</Text>
        </VStack>
      </form>
    </Panel>
  </Grid>;
}
