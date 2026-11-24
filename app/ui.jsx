'use client';
import { Badge } from '@astryxdesign/core/Badge';
import { Banner } from '@astryxdesign/core/Banner';
import { Blockquote } from '@astryxdesign/core/Blockquote';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack } from '@astryxdesign/core/HStack';
import { Icon } from '@astryxdesign/core/Icon';
import { Link } from '@astryxdesign/core/Link';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Pagination } from '@astryxdesign/core/Pagination';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { StackItem } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { Braces, Monitor, Moon, RefreshCw, ScanSearch, Sun } from 'lucide-react';
import { useThemeMode } from './providers.jsx';
import { stateOf, policyLink } from '../lib/domain.mjs';

export const PAGE_SIZE = 25;
export const stateNames = { violation: 'Pelanggaran ditemukan', no_violation: 'Tidak ditemukan pelanggaran', pending_review: 'Menunggu review manusia', processing: 'Sedang diproses', failed: 'Proses gagal', invalid: 'Hasil belum valid' };
export const sourceNames = { llm: 'Model · final tanpa eskalasi', human: 'Keputusan manusia', human_knowledge_exact: 'Knowledge manusia · identik', human_knowledge_similar: 'Knowledge manusia · mirip' };
const stateVariants = { violation: 'error', no_violation: 'success', pending_review: 'warning', processing: 'info', failed: 'error', invalid: 'error' };
export const date = value => value ? new Date(value * 1000).toLocaleString('id-ID', { timeZoneName: 'short' }) : '—';

/** Pesan status. `kind` memetakan langsung ke status Banner Astryx. */
export function Notice({ children, kind = 'info', title, ...rest }) {
  if (!children) return null;
  if (title) return <Banner status={kind} title={title} collapsible={false} {...rest}>{children}</Banner>;
  return <Banner status={kind} title={children} collapsible={false} {...rest} />;
}

export function StateBadge({ state }) { return <Badge variant={stateVariants[state] || 'neutral'} label={stateNames[state] || state} />; }

export function Mono({ children }) { return <span className="mono">{children}</span>; }

/** Pemilih mode tampilan: terang / sistem / gelap. */
export function ThemeToggle() {
  const { mode, setMode } = useThemeMode();
  return <SegmentedControl label="Mode tampilan" size="sm" value={mode} onChange={setMode}>
    <SegmentedControlItem value="light" label="Terang" isLabelHidden icon={<Icon icon={Sun} />} />
    <SegmentedControlItem value="system" label="Ikuti sistem" isLabelHidden icon={<Icon icon={Monitor} />} />
    <SegmentedControlItem value="dark" label="Gelap" isLabelHidden icon={<Icon icon={Moon} />} />
  </SegmentedControl>;
}

export function PageHeader({ eyebrow, title, description }) {
  return <VStack gap={1}>
    <Text type="label" color="accent">{eyebrow}</Text>
    <Heading level={1}>{title}</Heading>
    <Text type="body" color="secondary">{description}</Text>
  </VStack>;
}

export function Panel({ title, description, actions, children }) {
  return <Card padding={5}>
    <VStack gap={5}>
      {(title || actions) && <HStack gap={3} vAlign="center">
        <StackItem size="fill"><VStack gap={0.5}>
          {title && <Heading level={2}>{title}</Heading>}
          {description && <Text type="supporting">{description}</Text>}
        </VStack></StackItem>
        {actions}
      </HStack>}
      {children}
    </VStack>
  </Card>;
}

export function ReloadButton({ onClick, isDisabled, label = 'Muat ulang' }) {
  return <Button label={label} size="sm" variant="secondary" isDisabled={isDisabled} icon={<Icon icon={RefreshCw} />} onClick={onClick} />;
}

export function ListHead({ title, total, reload }) {
  return <HStack gap={3} vAlign="center">
    <StackItem size="fill"><VStack gap={0.5}>
      <Heading level={2}>{title}</Heading>
      <Text type="supporting">{total} item pada cakupan ini</Text>
    </VStack></StackItem>
    <ReloadButton onClick={() => reload().catch(() => {})} />
  </HStack>;
}

export function PaginationBar({ offset, total, setOffset }) {
  if (!total) return <Text type="supporting">0 item</Text>;
  return <HStack gap={3} vAlign="center" wrap="wrap" justify="between">
    <Text type="supporting" hasTabularNumbers>{offset + 1}–{Math.min(offset + PAGE_SIZE, total)} dari {total}</Text>
    {total > PAGE_SIZE && <Pagination variant="compact" size="sm" page={Math.floor(offset / PAGE_SIZE) + 1} pageSize={PAGE_SIZE} totalItems={total} onChange={page => setOffset((page - 1) * PAGE_SIZE)} />}
  </HStack>;
}

export function Empty({ title, description, isCompact = true, icon, actions }) {
  return <EmptyState isCompact={isCompact} title={title} description={description} icon={icon} actions={actions} />;
}

/** Kartu yang bisa dibuka-tutup; trigger dan isi diberi padding yang konsisten. */
export function DisclosureCard({ title, meta, defaultIsOpen = false, children }) {
  return <div className="disclosure-card"><Card padding={0}>
    <Collapsible defaultIsOpen={defaultIsOpen} trigger={<VStack gap={0.5} paddingBlock={3}>
      <Text weight="semibold" maxLines={2} wordBreak="break-word">{title}</Text>
      {meta && <Text type="supporting">{meta}</Text>}
    </VStack>}>
      <VStack gap={4} padding={4} paddingBlockStart={1}>{children}</VStack>
    </Collapsible>
  </Card></div>;
}

/** JSON mentah (read-only, bisa disalin) untuk keperluan audit/debug. */
export function JsonBlock({ value, title = 'JSON', maxHeight = 420 }) {
  return <CodeBlock code={JSON.stringify(value, null, 2)} language="json" title={title} hasLanguageLabel={false} width="100%" maxHeight={maxHeight} isWrapped />;
}

export function JsonDisclosure({ value, label = 'Lihat JSON', title }) {
  return <Collapsible defaultIsOpen={false} chevronPosition="start" trigger={<HStack gap={2} vAlign="center"><Icon icon={Braces} size="sm" /><Text weight="medium">{label}</Text></HStack>}>
    <VStack paddingBlockStart={3}><JsonBlock value={value} title={title} /></VStack>
  </Collapsible>;
}

export function Findings({ value }) {
  if (!value) return null;
  return <VStack gap={4}>
    {value.explanation && <Text as="p">{value.explanation}</Text>}
    {(value.findings || []).map((f, i) => {
      const url = policyLink(f.policy?.url);
      return <Card key={f.rule_id || i} variant="muted" padding={4}>
        <VStack gap={2}>
          <Text type="label" color="accent">{f.category || f.category_id}</Text>
          <Heading level={4}>{f.subcategory || f.rule_id}</Heading>
          <Text type="supporting">{f.subcategory_is_report_label ? "Nama submenu dari dokumentasi resmi X; pertanyaan lanjutan belum lengkap." : "Rincian kebijakan, bukan nama submenu X."}</Text>
          {f.subcategory_is_report_label && f.policy_subcategory && <Text type="supporting">Rincian kebijakan: {f.policy_subcategory}</Text>}
          {f.detail && <Text as="p" color="secondary">{f.detail}</Text>}
          {(f.evidence || []).map((q, j) => <Blockquote key={j}><span className="prewrap">{q}</span></Blockquote>)}
          {f.rationale && <Text as="p" type="supporting">{f.rationale}</Text>}
          {url && <Link href={url} isExternalLink>Baca kebijakan</Link>}
        </VStack>
      </Card>;
    })}
    {value.missing_context?.length > 0 && <Notice kind="warning" title="Konteks yang perlu diperiksa"><ul>{value.missing_context.map((x, i) => <li key={i}>{x}</li>)}</ul></Notice>}
  </VStack>;
}

export function Result({ value, openReview }) {
  if (!value) return <EmptyState icon={<Icon icon={ScanSearch} size="lg" />} title="Mulai dari sebuah konten." description="Kategori, bukti, dan alasan akan muncul di sini. Kasus ambigu diteruskan untuk review manusia." />;
  const state = stateOf(value), final = ['violation', 'no_violation'].includes(state);
  const provider = value.result?.prediction_provider || value.prediction?.prediction_provider;
  const sourceLine = final ? (value.result?.prediction_provider === 'narasiahli' && value.decision_source === 'llm' ? 'API NarasiAhli · prediksi final' : sourceNames[value.decision_source] || value.decision_source) : 'Belum ada keputusan final';
  return <VStack gap={4}>
    <HStack gap={3} vAlign="center" wrap="wrap" justify="between">
      <StateBadge state={state} />
      <Text type="supporting"><Mono>{value.id?.slice(0, 8)}</Mono></Text>
    </HStack>
    <Text type="supporting">{sourceLine}</Text>
    {final ? <Findings value={value.result} />
      : state === 'pending_review' ? <>
        <Notice kind="warning">Menunggu review manusia. Analisis di bawah adalah prediksi awal model, bukan keputusan final.</Notice>
        <Findings value={value.prediction} />
        {value.review_id && openReview && <HStack><Button label="Buka workspace reviewer" variant="primary" endContent={<Icon icon="externalLink" />} onClick={() => openReview(value.review_id)} /></HStack>}
      </>
      : <Notice kind={state === 'failed' || state === 'invalid' ? 'error' : 'info'}>{value.error || 'Hasil final belum tersedia. Status akan diperbarui saat halaman ini aktif.'}</Notice>}
    <MetadataList label={{ position: 'start', width: 128 }}>
      <MetadataListItem label="ID klasifikasi"><Mono>{value.id}</Mono></MetadataListItem>
      <MetadataListItem label="Dibuat">{date(value.created_at)}</MetadataListItem>
      {provider && <MetadataListItem label="Sumber prediksi">API NarasiAhli</MetadataListItem>}
      {provider && <MetadataListItem label="Request API"><Mono>{value.result?.prediction_request_id || value.prediction?.prediction_request_id}</Mono></MetadataListItem>}
      <MetadataListItem label="Kebijakan">{value.result?.taxonomy_version || value.prediction?.taxonomy_version || '—'}</MetadataListItem>
      {value.external_reference_id && <MetadataListItem label="Referensi">{value.external_reference_id}</MetadataListItem>}
    </MetadataList>
    <JsonDisclosure value={value} label="Lihat JSON hasil klasifikasi" title="classification.json" />
  </VStack>;
}
