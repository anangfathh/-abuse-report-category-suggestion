import { z } from 'zod';

export const submissionSchema = z.object({
  platform: z.literal('x'), language: z.enum(['id','en']).optional(), content: z.string().trim().min(1).max(8000),
  context: z.string().max(3000).default(''), context_key: z.string().max(200).default(''),
  external_reference_id: z.string().max(200).nullable().optional(),
}).strict();
export const decisionSchema = z.object({
  expected_revision: z.number().int().min(1), pelanggaran: z.boolean(),
  rule_ids: z.array(z.string()).max(8), rationale: z.string().trim().min(5).max(2000),
  verification_notes: z.string().max(3000).default(''),
  evidence_basis: z.enum(['text_only', 'external_evidence']).default('external_evidence'),
  reuse: z.enum(['none', 'exact', 'similar']).default('exact'),
  valid_for_hours: z.number().int().min(1).max(2160).default(24),
}).strict().superRefine((v, ctx) => {
  if (v.pelanggaran !== Boolean(v.rule_ids.length)) ctx.addIssue({ code: 'custom', message: 'Pelanggaran wajib memiliki rules; nonpelanggaran wajib tanpa rules.' });
  if (new Set(v.rule_ids).size !== v.rule_ids.length) ctx.addIssue({ code: 'custom', message: 'Rule tidak boleh duplikat.' });
  if (v.evidence_basis !== 'text_only' && v.verification_notes.trim().length < 5) ctx.addIssue({ code: 'custom', message: 'Catatan verifikasi bukti eksternal wajib diisi.' });
});
export const roleRank = { operator: 0, reviewer: 1, admin: 2 };
export function hasRole(user, role) { return user && roleRank[user.role] >= roleRank[role]; }
export function stateOf(c) {
  if (c?.status === 'completed' && c.result && typeof c.result.pelanggaran === 'boolean') return c.result.pelanggaran ? 'violation' : 'no_violation';
  if (c?.status === 'completed') return 'invalid';
  return ['pending_review', 'processing', 'failed'].includes(c?.status) ? c.status : 'invalid';
}
export function policyLink(url) { try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } }
export function knowledgeState(item, now = Date.now()) { return item.state === 'revoked' ? 'revoked' : item.expires * 1000 <= now ? 'expired' : item.state; }
export function routePolicy(path, method) {
  if (path === '/taxonomy' && method === 'GET') return 'operator';
  if (/^\/classifications(?:\/[a-zA-Z0-9-]+)?$/.test(path) && ['GET', 'POST'].includes(method)) return 'operator';
  if (/^\/reviews(?:\/[a-zA-Z0-9-]+)?$/.test(path) && method === 'GET') return 'reviewer';
  if (/^\/reviews\/[a-zA-Z0-9-]+\/decision$/.test(path) && method === 'POST') return 'reviewer';
  if (/^\/queue\/(summary|jobs)$/.test(path) && method === 'GET') return 'reviewer';
  if (path === '/knowledge' && method === 'GET') return 'reviewer';
  if (/^\/knowledge\/[a-zA-Z0-9-]+\/(revoke|reindex)$/.test(path) && method === 'POST') return 'admin';
  return null;
}

// Keep all rules when the category itself matches; otherwise show matching rules.
export function filterTaxonomy(categories, query) {
  const term = query.trim().toLocaleLowerCase('id-ID');
  if (!term) return categories;
  const matches = (...values) => values.some(value => typeof value === 'string' && value.toLocaleLowerCase('id-ID').includes(term));
  return categories.flatMap(category => {
    if (matches(category.label, category.id, category.policy_title, category.exceptions)) return [category];
    const subcategories = category.subcategories.filter(rule => matches(rule.label, rule.id, rule.detail));
    return subcategories.length ? [{ ...category, subcategories }] : [];
  });
}

// ---- Classification queue (NarasiAhli jobs) -----------------------------------------
export const jobStatusNames = { queued: 'Menunggu', processing: 'Diproses', completed: 'Selesai', failed: 'Gagal', cancelled: 'Dibatalkan' };
export const jobStatusVariants = { queued: 'neutral', processing: 'info', completed: 'success', failed: 'error', cancelled: 'neutral' };
export function formatWait(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s} dtk`;
  if (s < 3600) return `${Math.floor(s / 60)} mnt ${s % 60} dtk`;
  return `${Math.floor(s / 3600)} jam ${Math.floor((s % 3600) / 60)} mnt`;
}
// Quiet by default; warn only on signals that a person can act on.
export function queueHealth(summary, now = Date.now()) {
  const counts = summary?.counts || {};
  const age = summary?.oldest_queued_age_seconds;
  const open = (counts.queued || 0) + (counts.processing || 0), max = summary?.limits?.max_pending;
  if (Number.isFinite(age) && age > 300) return { kind: 'warning', text: `Job tertua menunggu ${formatWait(age)}. Worker mungkin berhenti atau model sedang sibuk.` };
  if (max && open >= max * 0.8) return { kind: 'warning', text: `Antrean hampir penuh (${open} dari batas ${max} job aktif). Pengiriman baru akan ditolak saat penuh.` };
  return null;
}

// Whitelists: the browser only ever sees queue metadata, never submitted text, results or callback URLs.
const pick = (source, keys) => Object.fromEntries(keys.map(key => [key, source?.[key] ?? null]));
export function publicQueueSummary(data) {
  const counts = Object.fromEntries(Object.keys(jobStatusNames).map(key => [key, Number.isFinite(data?.counts?.[key]) ? data.counts[key] : 0]));
  return { counts, ...pick(data, ['retrying_jobs', 'oldest_queued_at', 'oldest_queued_age_seconds', 'generated_at']), limits: pick(data?.limits, ['max_pending', 'max_attempts', 'retention_days']) };
}
export function publicQueueJob(job) {
  return { ...pick(job, ['job_id', 'status', 'external_reference_id', 'attempts', 'created_at', 'started_at', 'completed_at', 'expires_at']),
    error: job?.error && typeof job.error === 'object' ? pick(job.error, ['code', 'message', 'retryable']) : null };
}
