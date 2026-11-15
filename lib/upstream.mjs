export class UpstreamError extends Error {
  constructor(status, detail, retryAfter = null) { super(typeof detail === 'string' ? detail : 'Layanan mengembalikan error.'); this.status = status; this.detail = detail; this.retryAfter = retryAfter; }
}
export function tenantConfig(user) {
  let tenants;
  try { tenants = JSON.parse(process.env.MODERATION_TENANTS_JSON || '{}'); } catch { throw new UpstreamError(503, 'Konfigurasi tenant belum valid.'); }
  const config = Object.hasOwn(tenants, user.tenant) ? tenants[user.tenant] : null;
  if (!config?.baseUrl || !config?.clientKey) throw new UpstreamError(503, 'Koneksi API untuk organisasi ini belum dikonfigurasi.');
  const url = new URL(config.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new UpstreamError(503, 'Base URL service tidak valid.');
  return config;
}
export async function upstream(user, path, { method = 'GET', body, idempotency, reviewer = false } = {}) {
  const config = tenantConfig(user);
  const individual = config.reviewerKeys && Object.hasOwn(config.reviewerKeys, user.id) ? config.reviewerKeys[user.id] : null;
  const key = reviewer ? individual || config.reviewerKey : config.clientKey;
  if (!key) throw new UpstreamError(503, 'Credential reviewer belum dikonfigurasi.');
  const headers = { 'X-API-Key': key, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotency) headers['Idempotency-Key'] = idempotency;
  let response;
  try {
    response = await fetch(config.baseUrl.replace(/\/$/, '') + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(240000), redirect: 'error', cache: 'no-store',
    });
  } catch { throw new UpstreamError(504, 'Respons service belum diketahui. Periksa status; jangan mengulang keputusan secara otomatis.'); }
  let data;
  try { data = await response.json(); } catch { throw new UpstreamError(502, 'Format respons service tidak valid.'); }
  if (!response.ok) {
    // Do not relay arbitrary upstream responses containing configuration or secrets.
    const detail = data.detail;
    const clean = typeof detail === 'string' ? detail.slice(0, 2000) : detail && typeof detail === 'object' ? { code: detail.code, classification_id: detail.classification_id } : `Service HTTP ${response.status}`;
    // Known credentials must never be reflected even by an unexpected upstream error.
    const safe = JSON.parse(JSON.stringify(clean).split(key).join('[redacted]'));
    throw new UpstreamError(response.status, safe, response.headers.get('retry-after'));
  }
  return data;
}
