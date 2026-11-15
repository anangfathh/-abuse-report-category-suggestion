> Snapshot workflow review yang sudah ada, ditambah adapter opsional API NarasiAhli. Deployment terbaru memakai API NarasiAhli untuk tenant aplikasi ini; lihat ../docs/NARASIAHLI-PREDICTION.md. Bagian di bawah mendokumentasikan mode standalone asli yang tetap tersedia bagi tenant lain.

# Standalone Moderation + Human Review API (prototype)

Backend independen, tanpa UI, tanpa import/API/database/HITL/knowledge Narasi Ahli. Hanya inferensi LLM/embedding generik yang dapat memakai server yang sudah tersedia. Awal fokus X: snapshot taxonomy kebijakan 11 November 2026, 14 kategori/50 subkategori; **bukan replika penuh menu Report X**.

## Alur yang diimplementasikan

1. Cari knowledge manusia approved yang identik: tenant + content + context + context_key + versi kebijakan + belum dicabut/kedaluwarsa. Konflik keputusan mematikan reuse, bukan memilih diam-diam.
2. Jika tidak ada, panggil LLM27B. **needs_review=false langsung completed/final**, tidak membuat review atau knowledge approved.
3. **needs_review=true** mencoba knowledge mirip yang reviewer izinkan (`reuse=similar`). Ambil kandidat dari embedding BGE-M3, scope/konteks/kebijakan sama, lalu maksimal satu pemeriksaan kesetaraan oleh LLM. Score cosine bukan probabilitas akurasi. Negasi, sasaran, makna, fakta dan konteks harus setara; jika tidak, tetap pending_review.
4. Buat review task yang durable. `result=null` selama pending; `prediction` tetap tersedia sebagai bahan manusia, bukan keputusan final.
5. Reviewer mengesahkan pelanggaran/nonpelanggaran, rule_ids, alasan dan fakta yang diperiksa. Keputusan final disimpan, audit ditambahkan, dan menjadi knowledge manusia. Prediksi LLM tidak pernah otomatis masuk knowledge manusia.
6. Koreksi membutuhkan expected_revision terbaru, mencabut knowledge versi lama dan menulis audit baru. Revoke/expiry/policy berubah menghentikan reuse masa depan, tanpa menulis ulang hasil historis diam-diam.

`reuse=none` tetap menyimpan keputusan ke bank knowledge, tetapi tidak boleh dipakai otomatis. Default reuse exact, masa berlaku24jam, dapat dikonfigurasi reviewer1–2160jam. `evidence_basis` wajib dinyatakan reviewer untuk reuse berbasis teks: `text_only`. Jika tidak diisi, default aman `external_evidence`. Keputusan yang bergantung pada media/fakta luar harus memakai external_evidence, bukan text_only. Rule media/external/context tidak boleh dipakai via similarity dan membutuhkan verification_notes; exact reuse-nya juga perlu context_key. Tanpa itu, knowledge disimpan dengan reuse none.

**context_key** harus diisi identitas/konteks stabil yang relevan (misalnya target, author, post/media evidence version). Jangan menyamakan caption yang sama dari orang/gambar berbeda. Jangan taruh API key/credential di konteks.

## Autentikasi

Header `X-API-Key`, kunci baru service ini berawalan `mod_live_`. Kunci Narasi Ahli tidak berlaku. Role:

- client: submit/get classification dan taxonomy, hanya tenant sendiri.
- reviewer/admin: juga antrean review, keputusan/correction, knowledge, revoke/reindex tenant sendiri.

Kunci dibuat/revoke via CLI operator; plaintext hanya keluar sekali, database hanya menyimpan SHA256. Actor reviewer berasal dari key, bukan nama yang dikirim pengguna. Reviewer key untuk backend UI manusia, **jangan diberikan kepada LLM**. API tidak membuktikan secara biometrik bahwa pengguna adalah manusia; UI/auth organisasi bertanggung jawab memastikan operator reviewer memang manusia.

```sh
python -m moderation_app.cli create-key --tenant team-a --actor integration-a --role client
python -m moderation_app.cli create-key --tenant team-a --actor reviewer-a --role reviewer
python -m moderation_app.cli list-keys
python -m moderation_app.cli revoke-key --key-id UUID
```

## Kontrak untuk UI sendiri

Dokumentasi interaktif `/docs`, schema `/openapi.json`. Base uji HTTPS sementara: `https://narasiahli.duckdns.org/moderation-lab` (gateway saja dibagi; service/PVC/namespace/auth terpisah).

### Submit

`POST /v1/classifications`, header `Idempotency-Key`8–128karakter. Key sama+input sama mengembalikan record yang sama; input berubah409. Teks maksimum8000karakter, context3000, context_key200, body96KiB. Platform hanya `x`.

```json
{"platform":"x","content":"Awas kamu, tunggu saja.","context":"","context_key":"","external_reference_id":"comment-123"}
```

Contoh pending (dipersingkat):

```json
{"id":"case-id","status":"pending_review","needs_review":true,"pelanggaran":null,"result":null,"prediction":{"needs_review":true,"findings":[]},"review_id":"review-id","revision":1}
```

Hasil tanpa review:

```json
{"id":"case-id","status":"completed","needs_review":false,"pelanggaran":false,"result":{"pelanggaran":false,"findings":[]},"decision_source":"llm","review_id":null}
```

Source dapat `llm`, `human`, `human_knowledge_exact`, `human_knowledge_similar`. `prediction` adalah analisis model awal (null jika langsung reuse exact); `result` keputusan final. Jangan tampilkan prediction sebagai final selama pending. **Failed/error tidak berarti nonpelanggaran.** GET case yang processing terlalu lama menandai failed, bukan false. Retry failed perlu Idempotency-Key baru.

### Antrean manusia

- `GET /v1/reviews?status=pending&limit=25&offset=0`
- `GET /v1/reviews/{review_id}` — input, prediction, revision, audit keputusan.
- `POST /v1/reviews/{review_id}/decision`:

```json
{"expected_revision":1,"pelanggaran":true,"rule_ids":["violence.threat"],"rationale":"Hasil pemeriksaan manusia terhadap unsur ancaman.","verification_notes":"Konteks dan bukti terkait sudah diperiksa.","reuse":"similar","evidence_basis":"text_only","valid_for_hours":24}
```

Timestamp respons adalah Unix seconds UTC.

Untuk nonpelanggaran: `pelanggaran=false`, `rule_ids=[]`. Hanya ID dari `GET /v1/taxonomy`. Hanya kasus yang punya review task yang bisa diputuskan; tidak ada auto-review semua hasil LLM. Dua keputusan pada revision sama: hanya satu berhasil, yang lain409; reload dulu. Correction melalui endpoint yang sama dengan expected_revision terbaru, audit sebelumnya tetap utuh.

- `GET /v1/classifications/{id}` — UI/pemakai API mengambil hasil setelah review.
- `GET /v1/knowledge` — input/result, provenance, expiry, index error dan status.
- `POST /v1/knowledge/{id}/revoke`, body `{"reason":"Keputusan lama perlu dibatalkan."}`.
- `POST /v1/knowledge/{id}/reindex` — retry embedding tanpa mengubah keputusan manusia.

Antrean dan update hasil tersedia lewat polling API. Tidak ada webhook/notifikasi keluar pada prototipe ini. Tidak ada UI buatan bot; UI milik pengguna yang menampilkan task dan menerima keputusan manusia.

## Menjalankan

```sh
docker build -t moderation-standalone:prototype .
docker run --rm -p 127.0.0.1:8030:8030 -v moderation-data:/data \
  -e MODERATION_LLM_BASE_URL=http://ollama:11434/v1 \
  -e MODERATION_LLM_MODEL=qwen3.8:27b-mom-128k \
  moderation-standalone:prototype
```

Siapkan permission volume untuk UID10001. Kubernetes contoh di deploy/kubernetes.yaml, namespace `moderation-lab`, PVC sendiri1GiB; tanpa migrasi data Narasi Ahli. Kunci/DB tidak disimpan di source.

Konfigurasi `MODERATION_*`: DATABASE_PATH, ROOT_PATH, LLM_BASE_URL, LLM_MODEL, LLM_API_KEY, EMBEDDING_URL (`POST /embed` dengan output1024d), EMBEDDING_MODEL, SIMILAR_THRESHOLD(default0.94), RATE_PER_MINUTE(default6/tenant), ALLOWED_ORIGINS(daftar dipisah koma). Untuk development UI, set origin persis, misalnya `http://localhost:3000`; CORS default kosong, tidak wildcard. API key sebaiknya disimpan backend UI, bukan dibagikan ke semua browser.

## Batas dan operasional

- SQLite WAL, satu replica/worker, transaksi singkat + optimistic revision, model lease persisten. Prototipe untuk testing, bukan janji skala tinggi. Live inference berbagi server, bukan isolasi GPU. Salah satu request model dapat menunggu karena beban lain.
- Maksimal1inference workflow bersamaan,429/Retry-After jika sibuk. Output base dan equivalence memakai JSON Schema terikat pada provider lokal (dites Ollama0.40.4); validasi pasca-output tetap berlaku. Base model timeout100detik; similar check dapat menambah satu call100detik. Timeout judge kembali ke antrean manusia dan slot ditahan sampai TTL untuk menghindari penumpukan inferensi. Model error base menghasilkan failed502/504, bukan false.
- Embedding gagal tidak membatalkan keputusan manusia; exact tetap bisa. Tidak ada indexing worker tersembunyi, retry explicit. Similarity tidak memakai teks yang terpotong; input lebih6000karakter tidak diembed. Scan maksimal2000knowledge scoped; jika lebih, similarity dinonaktifkan aman, exact/LLM/review tetap jalan. Untuk skala besar ganti ke index vektor mandiri setelah benchmark.
- Nilai0.94 hanya filter kandidat awal, belum terkalibrasi pada data tim; tidak cukup sendiri untuk auto-approve. Reuse mirip bersifat konservatif dan dapat tetap meminta manusia. Bukan fine-tuning/ubah bobot model otomatis.
- Pending, final, knowledge dan audit tersimpan di PVC. Batasi akses key dan backup volume; tidak ada retensi/penghapusan otomatis yang bisa membuang keputusan diam-diam. Riwayat bisa mengandung data pribadi input. Log aplikasi tidak mencatat body, namun konfigurasi proxy/inference perlu dikelola terpisah.
- Backup konsisten gunakan SQLite backup API, bukan menyalin satu file saat WAL aktif. Rollback image mempertahankan PVC; jangan hapus namespace/PVC untuk rollback.
- TLS pada gateway uji memakai salinan sertifikat host yang ada. Saat memakai domain sendiri, sediakan TLS/renewal sendiri; tidak perlu domain Narasi Ahli atau service aplikasi Narasi Ahli.

## Existing solution preflight

Mekanisme review/case-memory ini memakai FastAPI, SQLite dan HTTP client terawat. Antrean review/HITL Narasi Ahli sengaja tidak direuse karena pengguna meminta pemisahan. Tidak ada provider/model berbayar baru; tidak menambahkan platform workflow besar untuk prototipe kecil. Taxonomy kebijakan resmi dan pengecualian tetap dipin per versi, bukan menyalin menu Facebook.
