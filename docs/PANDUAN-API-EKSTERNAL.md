# Panduan API Moderasi untuk Aplikasi Eksternal

Panduan ini untuk pengembang yang ingin memanggil API NarasiAhli dari backend, script, atau layanan lain. Contoh memakai konten simulasi dan **bukan API key asli**. Contoh `curl` menggunakan shell Bash/zsh.

## Pilih jalur yang sesuai

| Kebutuhan | Endpoint awal | Apa yang didapat |
| --- | --- | --- |
| Minta analisis langsung | `POST /api/v1/external/moderation/classify` | Hasil prediksi dalam respons dan riwayat API key. Jika `needs_review=true`, tugas review otomatis dibuat pada integrasi yang sama. |
| Kelola kasus sampai review manusia | `POST /api/v1/external/moderation-review/v1/classifications` | ID kasus, status, dan jika diperlukan ID review untuk ditinjau manusia. |

Kedua jalur memakai domain `https://narasiahli.qudo.id`, header `X-API-Key`, dan taxonomy X yang sama. Integrasi Abuse Reporter menggunakan jalur kasus dan review. Klasifikasi langsung yang memerlukan review juga otomatis masuk antrean pada integrasi yang sama. API tidak mengirim laporan ke X atau menjatuhkan sanksi.

## 1. Siapkan API key

1. Minta administrator Narasiahli membuat atau memberikan key melalui **Integrasi → API Keys**. Akses halaman ini mengikuti hak administrator Narasiahli.
2. Untuk membaca taxonomy dan history, key memerlukan `moderation:read`. Untuk klasifikasi, key memerlukan `moderation:classify`. Jalur kasus/review memerlukan **keduanya**, dan membaca atau memutuskan review serta mengelola knowledge juga memerlukan `moderation:review`.
3. Simpan key pada secret manager atau environment server yang memanggil API. Jangan menaruhnya dalam kode frontend, URL, repository, atau contoh yang dibagikan. Key integrasi bukan akun login Abuse Reporter.

Contoh memuat key dari input tanpa menaruh nilai di command history:

```bash
read -rs -p 'API key Narasiahli: ' NARASI_API_KEY; echo
export NARASI_API_KEY
export NARASI_BASE='https://narasiahli.qudo.id/api/v1/external/moderation'
export REVIEW_BASE='https://narasiahli.qudo.id/api/v1/external/moderation-review/v1'
```

Key dipakai untuk menentukan cakupan data integrasi. Gunakan key integrasi yang sama untuk mengirim kasus, mengambilnya kembali, dan melakukan review pada kasus itu. Jika key dirotasi pada integrasi yang sama, riwayat tetap mengikuti identitas integrasinya. Untuk menghapus variabel dari shell setelah selesai, jalankan `unset NARASI_API_KEY NARASI_BASE REVIEW_BASE`.

## 2. Baca taxonomy

```bash
curl --fail-with-body --silent --show-error \
  -H "X-API-Key: $NARASI_API_KEY" \
  "$NARASI_BASE/taxonomy"
```

Respons memuat `version`, `categories`, `subcategories`, detail, dan sumber kebijakan. Gunakan ID rule dari respons saat reviewer memilih kategori. Taxonomy adalah pemetaan kebijakan teks dan **bukan** salinan lengkap menu Report X.

## 3. Klasifikasi langsung

```bash
curl --fail-with-body --silent --show-error \
  -X POST "$NARASI_BASE/classify" \
  -H "X-API-Key: $NARASI_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"platform":"x","content":"Selamat pagi, semoga harimu menyenangkan.","context":"Contoh pesan uji"}'
```

`platform` saat ini hanya `x`. `content` wajib, maksimal 8.000 karakter; `context` opsional, maksimal 3.000 karakter. Media atau tautan di dalam teks tidak dibuka untuk diperiksa.

Respons sukses berisi antara lain `request_id`, `status`, `pelanggaran`, `needs_review`, `explanation`, `findings`, dan `taxonomy_version`. Untuk klasifikasi langsung dengan `needs_review=true`, respons juga memuat `case_id` dan `review_id` yang otomatis dibuat. Gunakan API key integrasi yang sama dengan Abuse Reporter agar review terlihat di aplikasi. Bentuk singkat berikut hanya contoh; isi hasil bergantung pada input:

```json
{
  "request_id": "contoh-request-id",
  "status": "no_violation",
  "pelanggaran": false,
  "needs_review": false,
  "explanation": "Penjelasan hasil analisis.",
  "findings": [],
  "taxonomy_version": "versi-dari-server"
}
```

Periksa `needs_review` bersama `pelanggaran`. Jika `needs_review=true`, jangan menyajikan prediksi sebagai keputusan manusia. Nilai `pelanggaran` dapat `null` ketika bukti belum cukup; dalam kasus lain temuan terkonfirmasi dan kebutuhan review bisa muncul bersamaan. Respons gagal atau timeout bukan berarti konten aman.

### Riwayat panggilan langsung

```bash
curl --fail-with-body --silent --show-error \
  -H "X-API-Key: $NARASI_API_KEY" \
  "$NARASI_BASE/history?limit=25&offset=0"
```

Respons berisi `items`, `total`, `limit`, dan `offset`. Setiap item yang tercatat memuat ID, waktu, input, dan hasil. History hanya mengembalikan data integrasi dari key tersebut dan mulai merekam sejak fitur history diaktifkan; panggilan lama yang tidak disimpan tidak dapat direkonstruksi otomatis. Karena input tersimpan, terapkan kebijakan akses, retensi, dan backup yang sesuai.

## 4. Kasus dengan review manusia

Gunakan jalur ini jika aplikasi membutuhkan status kasus, antrean review, dan hasil setelah keputusan manusia. Kirim `Idempotency-Key` unik 8–128 karakter; contoh berikut membuat UUID baru. Jika respons hilang, ulangi **payload dan key yang sama** untuk mendapatkan kasus yang sama. Jangan memakai key yang sama untuk payload berbeda.

```bash
IDEMPOTENCY_KEY="$(python3 -c 'import uuid; print(uuid.uuid4())')"
curl --fail-with-body --silent --show-error \
  -X POST "$REVIEW_BASE/classifications" \
  -H "X-API-Key: $NARASI_API_KEY" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"platform":"x","content":"Contoh teks yang perlu ditinjau.","context":"Konteks percakapan","context_key":"post-123:target-456","external_reference_id":"post-123"}'
```

`context_key` dan `external_reference_id` opsional. Gunakan `context_key` yang stabil dan spesifik terhadap sasaran/konteks jika relevan; jangan isi dengan rahasia. Simpan `id` kasus dari respons. Respons dapat berupa:

- `completed`: hasil final tersedia di `result`.
- `pending_review`: `result` belum tersedia; `prediction` adalah analisis awal dan `review_id` menunjuk ke tugas reviewer.
- `processing` atau `failed`: jangan anggap sebagai hasil negatif. Periksa `error` dan status terbaru.

Ambil kembali status memakai ID kasus yang diterima:

```bash
CASE_ID='<id-kasus-dari-respons>'
curl --fail-with-body --silent --show-error \
  -H "X-API-Key: $NARASI_API_KEY" "$REVIEW_BASE/classifications/$CASE_ID"
```

### Antrean dan keputusan

Key reviewer memerlukan `moderation:review` selain izin baca dan klasifikasi. Keputusan harus dibuat oleh reviewer manusia yang telah memeriksa konten dan konteks.

```bash
# Daftar antrean; status bisa pending atau completed.
curl --fail-with-body --silent --show-error \
  -H "X-API-Key: $NARASI_API_KEY" \
  "$REVIEW_BASE/reviews?status=pending&limit=25&offset=0"

# Buka detail dan baca revision TERBARU dari respons.
REVIEW_ID='<id-review-dari-respons>'
curl --fail-with-body --silent --show-error \
  -H "X-API-Key: $NARASI_API_KEY" "$REVIEW_BASE/reviews/$REVIEW_ID"
```

Contoh keputusan **tidak melanggar** untuk review dengan revision terbaru `1`. Ganti `expected_revision` sesuai detail terbaru; ini contoh, bukan keputusan otomatis:

```bash
curl --fail-with-body --silent --show-error \
  -X POST "$REVIEW_BASE/reviews/$REVIEW_ID/decision" \
  -H "X-API-Key: $NARASI_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"expected_revision":1,"pelanggaran":false,"rule_ids":[],"rationale":"Reviewer memeriksa konten dan konteks.","verification_notes":"Konteks percakapan sudah diperiksa.","evidence_basis":"external_evidence","reuse":"none","valid_for_hours":24}'
```

Untuk keputusan melanggar, gunakan `pelanggaran: true` dan minimal satu `rule_ids` valid dari taxonomy. `verification_notes` diperlukan saat keputusan bergantung pada bukti eksternal/media/konteks. `reuse` dapat `none`, `exact`, atau `similar`; service dapat menurunkan izin reuse demi keamanan. Koreksi menggunakan endpoint yang sama dan revision terbaru; keputusan sebelumnya tetap ada dalam audit. Jika respons keputusan hilang atau menerima 409, buka ulang detail dan audit sebelum mengambil tindakan lagi. Jangan otomatis mengulang keputusan.

Reviewer juga dapat membaca `GET $REVIEW_BASE/knowledge?limit=25&offset=0`. Pencabutan reuse memakai `POST $REVIEW_BASE/knowledge/<id>/revoke` dengan JSON `{"reason":"Alasan pencabutan yang jelas"}`; `POST .../reindex` mencoba indexing ulang. Hak reviewer di API key harus dijaga oleh aplikasi pemanggil, dan identitas manusia perlu dicatat oleh aplikasi tersebut bila key dipakai bersama.

## Contoh JavaScript di server

Contoh berikut menggunakan Node.js modern dengan `fetch` bawaan. Jalankan di backend atau script server, **bukan di browser**:

```js
const response = await fetch(
  'https://narasiahli.qudo.id/api/v1/external/moderation/classify',
  {
    method: 'POST',
    headers: {
      'X-API-Key': process.env.NARASI_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ platform: 'x', content: 'Contoh teks', context: '' }),
    signal: AbortSignal.timeout(120_000),
  },
);
const data = await response.json();
if (!response.ok) throw new Error(`API gagal: HTTP ${response.status}`);
console.log(data.status, data.needs_review, data.request_id);
```

Jangan mencetak key atau konten sensitif pada log. Timeout jaringan adalah batas pemanggil; hasil mungkin belum diketahui ketika koneksi terputus.

## Arti error umum

| HTTP | Arti umum | Tindakan |
| --- | --- | --- |
| 401 | Key tidak valid, kedaluwarsa, atau dicabut | Periksa key dan statusnya di Narasiahli. |
| 403 | Izin key tidak mencukupi | Minta administrator memeriksa permission integrasi. |
| 404 | ID tidak ditemukan atau tidak berada dalam cakupan key | Periksa ID dan gunakan integrasi yang sama. |
| 409 | Konflik idempotency, revision, atau versi kebijakan | Baca detail error; muat ulang kasus/review sebelum bertindak. |
| 413 / 422 | Ukuran atau bentuk input tidak valid | Periksa ukuran, field, dan tipe data. |
| 429 | Batas permintaan atau kapasitas sementara tercapai | Hormati header `Retry-After` jika tersedia. |
| 502 / 503 / 504 | Model atau layanan tidak tersedia, atau timeout | Jangan menafsirkan sebagai nonpelanggaran; periksa status kasus dan coba sesuai konteks. |

Untuk jalur kasus, simpan `Idempotency-Key` dan ID kasus secara aman agar status dapat dipulihkan. Untuk keputusan reviewer, baca ulang revision dan audit sebelum mencoba tindakan ulang.
