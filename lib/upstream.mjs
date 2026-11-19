export class UpstreamError extends Error {
  constructor(status, detail, retryAfter = null) { super(typeof detail === 'string' ? detail : 'Layanan mengembalikan error.'); this.status = status; this.detail = detail; this.retryAfter = retryAfter; }
}
export function moderationConfig() {
  const baseUrl = process.env.MODERATION_API_BASE_URL;
  const apiKey = process.env.MODERATION_API_KEY;
  if (!baseUrl || !apiKey) throw new UpstreamError(503, 'Koneksi API belum dikonfigurasi.');
  let url;
  try { url = new URL(baseUrl); } catch { throw new UpstreamError(503, 'Base URL service tidak valid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new UpstreamError(503, 'Base URL service tidak valid.');
  return { baseUrl, apiKey };
}
export async function upstream(user, path, { method = 'GET', body, idempotency, moderation = false } = {}) {
  const config = moderationConfig();
  const key = config.apiKey;
  const headers = { 'X-API-Key': key, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotency) headers['Idempotency-Key'] = idempotency;
  let base = config.baseUrl.replace(/\/$/, '');
  if (moderation) {
    if (!base.endsWith('/api/v1/external/moderation-review')) throw new UpstreamError(503, 'Alamat API riwayat belum dikonfigurasi.');
    base = base.slice(0, -'-review'.length);
  }
  let response;
  try {
    response = await fetch(base + path, {
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
