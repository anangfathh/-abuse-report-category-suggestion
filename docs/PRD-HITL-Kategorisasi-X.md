# PRD — Aplikasi Konsumen API Kategorisasi Pelanggaran X + HITL

Versi: 1.0 · 13 November 2026 · Bahasa produk: Indonesia

## 1. Mandat untuk agent implementasi

Bangun aplikasi web mandiri untuk mengonsumsi **Moderation Review Service** yang sudah tersedia. Fokus pekerjaan adalah UI, autentikasi manusia, backend-for-frontend (BFF), dan integrasi API; **bukan membangun ulang classifier, antrean HITL, atau mesin knowledge**.

Aplikasi tidak boleh terintegrasi dengan aplikasi, database, agent, autentikasi, knowledge, atau HITL Narasi Ahli. Host uji yang kebetulan bernama Narasi Ahli hanya gateway sementara. Base URL harus dapat diganti melalui konfigurasi.

Keputusan produk yang tidak boleh diubah:

1. Hasil LLM dengan `needs_review=false` langsung final, baik melanggar maupun tidak. Tidak perlu persetujuan manusia.
2. Jika ketidakpastian belum terselesaikan oleh knowledge manusia yang valid, `needs_review=true` menjadi antrean manusia. Selama pending, belum ada keputusan final.
3. Keputusan manusia disimpan oleh service sebagai knowledge, bukan oleh frontend sebagai knowledge baru.
4. Knowledge identik/mirip yang valid dapat membantu permintaan berikutnya langsung final. Pemilihan dan pengaman reuse adalah wewenang service, bukan UI.
5. Prediksi LLM tidak otomatis menjadi knowledge tervalidasi manusia. Jangan membuat bot/LLM yang mengirim keputusan reviewer.

## 2. Dasar spesifikasi dan verifikasi

PRD ini disusun dari `INTEGRATION.md`, `openapi.json`, dan source service prototipe yang disimpan 11 November 2026. Kontrak ditelaah secara statis; **availability deployment saat dokumen ini dibuat belum diuji ulang**. Agent wajib melakukan contract smoke test pada environment target sebelum menyatakan integrasi selesai.

Urutan acuan: respons dan validasi service target yang diverifikasi → source service target → OpenAPI → panduan integrasi → contoh ringkas PRD. Laporkan perbedaan; jangan diam-diam menciptakan field atau endpoint. OpenAPI prototipe belum mendefinisikan semua response model secara ketat; buat adapter dan fixture dari respons nyata yang disanitasi.

## 3. Tujuan, pengguna, dan batas scope

Tujuan MVP: operator dapat mengirim konten, melihat hasil final, menangani kasus ambigu, mengoreksi review sebelumnya, dan mengelola knowledge yang dihasilkan manusia.

Peran aplikasi:

- **Operator:** submit konten dan melihat klasifikasi yang diizinkan organisasinya.
- **Reviewer manusia:** akses operator + antrean, keputusan, koreksi, dan inspeksi knowledge.
- **Admin:** pengaturan pengguna/role dan akses revoke/reindex knowledge. Pengaturan credential dilakukan server-side oleh operator deployment.

Service membatasi akses berdasarkan tenant API key. Aplikasi menambahkan RBAC untuk pengguna manusia. Role aplikasi tidak menciptakan role atau permission baru di service. Service saat ini mengizinkan reviewer/admin melakukan revoke/reindex; pembatasan tambahan admin-only diterapkan BFF.

P0: login, submit, detail klasifikasi, antrean pending/completed, keputusan/koreksi manusia, knowledge list/revoke/reindex, penanganan error, dan pengamanan credential.

Di luar MVP: auto-report ke X, crawler/scraping X, upload/analisis media, platform selain X, fine-tuning otomatis, live websocket, webhook, penugasan/claim reviewer, dan dashboard analitik global. API belum menyediakan endpoint untuk sebagian besar fitur tersebut.

Taxonomy awal adalah pemetaan kebijakan X: snapshot 11 November 2026, 14 kategori/50 subkategori. **Bukan replika penuh menu Report X dan bukan keputusan resmi X.** Jangan hardcode jumlah, label, maupun ID; muat dari taxonomy API.

## 4. Arsitektur integrasi

```text
Browser manusia → aplikasi/BFF dengan session + RBAC
                         ├─ client API key → submit/get/taxonomy
                         └─ reviewer API key → review/knowledge
                                      ↓
                           Moderation Review Service
                           classifier + antrean + knowledge
```

- Kunci hanya di secret/environment server; jangan pernah masuk bundle browser, localStorage, URL, log, atau repository.
- Tidak ada akses langsung ke SQLite/PVC service. Service adalah source of truth keputusan, revisi, antrean, dan knowledge.
- Database aplikasi boleh menyimpan user/session, hubungan user-tenant, referensi submission milik aplikasi, dan audit tindakan aplikasi. Jangan membuat bank knowledge/antrean paralel.
- Gunakan session HttpOnly/Secure dan proteksi CSRF untuk operasi perubahan. BFF memeriksa role dan tenant pada setiap request; tenant tidak dipercaya dari input browser.
- BFF memilih key tenant dari pemetaan server-side, bukan key/tenant arbitrer yang dikirim browser. Jangan gunakan satu key lintas organisasi.
- Identitas `reviewed_by` service berasal dari actor API key, bukan field nama dalam payload. Untuk atribusi per manusia, provisioning key reviewer per orang melalui CLI operator; bukan endpoint UI yang belum ada. Jika pilot menggunakan key reviewer bersama, label atribusi service sebagai akun integrasi dan simpan identitas manusia di audit aplikasi. Jangan mengklaim audit service mengidentifikasi orang tersebut.
- Gunakan stack yang sudah tersedia di repo agent. Lakukan preflight ringan pada komponen login/form/tabel yang sudah ada dan maintained; tidak perlu membangun komponen generik dari nol atau menambah layanan berbayar.

Konfigurasi server:

```dotenv
MODERATION_API_BASE_URL=https://narasiahli.duckdns.org/moderation-lab
MODERATION_CLIENT_API_KEY=<secret-server-side>
MODERATION_REVIEWER_API_KEY=<secret-server-side-atau-resolver-per-user>
SESSION_SECRET=<secret-aplikasi>
```

Dokumentasi uji: `https://narasiahli.duckdns.org/moderation-lab/docs`.

## 5. State dan sumber keputusan

| State klasifikasi | Makna UI | Tindakan |
|---|---|---|
| `processing` | Sedang diproses; belum ada hasil final | Ambil ulang detail jika ID diketahui |
| `pending_review` | Menunggu keputusan manusia | Tampilkan prediksi sebagai bahan review saja |
| `completed` | Keputusan final tersedia | Tampilkan `result` dan sumber keputusan |
| `failed` | Proses gagal; bukan berarti aman | Tampilkan error dan opsi mencoba ulang |

**Jangan menentukan final hanya dari `needs_review=false`.** Pada prototipe, field ini juga false untuk `processing`/`failed`. Final mensyaratkan `status=completed` dan `result` valid. Pending memakai `result=null` dan `pelanggaran=null`.

Label `decision_source`:

- `llm`: Prediksi model — final tanpa eskalasi.
- `human`: Keputusan reviewer manusia.
- `human_knowledge_exact`: Knowledge manusia — kasus identik.
- `human_knowledge_similar`: Knowledge manusia — kasus mirip yang lolos pemeriksaan service.

Respons `prediction` dapat null pada exact reuse. Jangan menganggap field ini selalu tersedia. Cosine similarity adalah skor kemiripan, bukan persentase akurasi/kepastian.

Urutan service: exact knowledge valid → LLM jika belum cocok → hasil LLM tanpa review langsung final → hasil perlu review mencoba similar knowledge yang memenuhi syarat → pending jika belum terselesaikan. UI tidak perlu mengulang urutan ini.

## 6. Halaman dan interaksi

### A. Login dan navigasi

Login manusia dengan role dari server. Navigasi: Klasifikasi baru, Submission saya/aplikasi, Antrean review, Knowledge. Sembunyikan menu tak berizin dan tetap enforce akses di BFF.

### B. Klasifikasi baru

Form: `content` wajib 1–8000 karakter; `context` opsional maksimal 3000; `context_key` maksimal 200; `external_reference_id` opsional maksimal 200. Platform dikunci `x`. Maksimum body API 96 KiB.

Jelaskan context_key sebagai identitas konteks stabil yang relevan, misalnya target/author/post/media evidence version. Jangan otomatis memakai satu konstanta untuk semua konten. Caption sama pada media/orang berbeda tidak membuktikan kasus sama. ID request acak bukan pengganti identitas konteks.

Generate dan persist `Idempotency-Key` 8–128 karakter per submission logis sebelum request dikirim. Disable submit ganda. Request inference dapat lama; tampilkan loading dan cegah navigasi yang menghilangkan referensi request. POST tidak dijamin langsung mengembalikan job ID sebelum inference selesai.

### C. Detail klasifikasi

Tampilkan konten, konteks, ID internal/eksternal, state, sumber keputusan, waktu, dan hasil dari API. Hasil final menampilkan pelanggaran/tidak, kategori/subkategori/detail, alasan, bukti jika tersedia, serta tautan kebijakan. Tampilkan semua findings, bukan hanya pertama.

Untuk pending: banner “Menunggu review manusia”; prediksi diberi label “Analisis awal model — bukan keputusan final”; tampilkan missing context bila tersedia. Jangan menampilkan badge hijau aman untuk null/error.

Daftar submission aplikasi hanya mencakup data yang aplikasi catat sendiri. API **tidak punya GET daftar seluruh classifications**, jadi jangan menjanjikan riwayat global service. Simpan mapping ID dan status terakhir sebagai cache; refresh dari service sebelum menampilkan final terbaru.

### D. Antrean review

Tab Pending dan Selesai; pagination limit default 25, maksimum 100, offset. Tampilkan total dari service, umur kasus, cuplikan konten, dan tautan detail. Backend mengurutkan antrean berdasarkan waktu pembuatan; filter/search tambahan hanya untuk halaman yang telah dimuat dan harus dilabeli demikian.

Tidak ada endpoint assignment/claim. Dua reviewer boleh membuka kasus sama; integritas keputusan dijaga optimistic revision, bukan lock UI.

### E. Workspace reviewer

Layout desktop: konten/konteks/bukti, prediksi model, lalu form keputusan. Mobile memakai urutan yang sama dalam satu kolom. Konten adalah data tidak tepercaya: render sebagai teks yang di-escape, bukan HTML/instruksi yang dijalankan.

Form keputusan:

- `pelanggaran`: pilihan eksplisit Ya/Tidak, **tanpa default otomatis mengikuti LLM**.
- `rule_ids`: dari taxonomy; jika melanggar minimal satu, maksimal delapan, tanpa duplikat; jika tidak melanggar harus kosong.
- `rationale`: wajib 5–2000 karakter.
- `verification_notes`: maksimal 3000; wajib minimal lima karakter setelah trim untuk keputusan berbasis bukti eksternal/media/konteks sesuai validasi service.
- `evidence_basis`: `text_only` atau `external_evidence`; default `external_evidence`. Teks-only harus dipilih sadar oleh reviewer.
- `reuse`: `none`, `exact`, atau `similar`; default `exact`.
- `valid_for_hours`: bilangan bulat 1–2160; default 24.

Sediakan checkbox aplikasi “Saya telah memeriksa konten dan konteks yang relevan” sebelum submit. Checkbox adalah pengaman UI, tidak dikirim sebagai field tambahan API. Payload dilarang mengandung field asing.

Penjelasan reuse:

- None: knowledge tetap disimpan, tetapi tidak boleh dipakai otomatis.
- Exact: keputusan boleh dipakai untuk kasus identik dalam scope dan masa berlaku yang valid.
- Similar: mengizinkan service mempertimbangkan kasus mirip; **bukan jaminan bebas review**.
- Bukti eksternal/media tidak boleh similar reuse. Service dapat menurunkan menjadi exact; tanpa context_key dapat menjadi none. Tampilkan `reuse` efektif dan `warnings` dari respons, jangan hanya nilai pilihan form.

Ambil `expected_revision` dari **top-level revision detail review**, bukan menebak dari classification.revision. Pada 409, muat ulang review, pertahankan draft lokal, tampilkan perubahan, dan minta reviewer memeriksa lagi sebelum submit manual. Jangan auto-overwrite/auto-resubmit keputusan.

Koreksi menggunakan endpoint decision yang sama dengan revision terkini. Tampilkan audit `events` secara kronologis. Koreksi mencabut knowledge versi sebelumnya; audit lama tetap terlihat. Tidak ada fitur koreksi manual untuk hasil LLM tanpa review task pada kontrak saat ini.

### F. Knowledge

Daftar paginated: konten/konteks, hasil, actor, provenance case/revision, versi kebijakan, reuse efektif, expiry, state, dan index_error. Detail menggunakan data item list yang sudah tersedia; tidak ada GET knowledge/{id} khusus.

Label revoked dari state service; expired dihitung dari expires dibanding waktu sekarang (label turunan UI, jangan mengubah enum service). “Active” tidak otomatis berarti layak similar reuse: expiry, policy, scope, konflik, dan kondisi index tetap dievaluasi service.

Admin dapat revoke dengan alasan 5–1000 karakter dan konfirmasi eksplisit. Tidak ada hard delete/restore knowledge pada MVP. Reindex hanya mengulang embedding; tidak mengubah keputusan manusia. Jika embedding gagal, keputusan manusia tetap sah dan exact reuse dapat tetap tersedia; tampilkan status indexing terpisah.

Pencabutan/kedaluwarsa menghentikan reuse masa depan, bukan mengubah seluruh keputusan historis. UI tidak boleh mengubah hasil historis sendiri.

## 7. Peta API

Semua endpoint berprefix base URL; header `X-API-Key` diisi BFF.

| Method/path | Kegunaan | Key service |
|---|---|---|
| GET `/v1/taxonomy` | Label, rules, versi kebijakan | Client/reviewer |
| POST `/v1/classifications` | Submit + `Idempotency-Key` | Client/reviewer |
| GET `/v1/classifications/{id}` | Status/hasil terkini | Client/reviewer |
| GET `/v1/reviews?status=pending&limit=25&offset=0` | Antrean; status juga `completed` | Reviewer |
| GET `/v1/reviews/{id}` | Input, classification, revision, events | Reviewer |
| POST `/v1/reviews/{id}/decision` | Keputusan atau koreksi | Reviewer |
| GET `/v1/knowledge?limit=25&offset=0` | Knowledge dan total | Reviewer |
| POST `/v1/knowledge/{id}/revoke` | Cabut reuse; body reason | Reviewer, dibatasi admin di aplikasi |
| POST `/v1/knowledge/{id}/reindex` | Retry indexing; tanpa body | Reviewer, dibatasi admin di aplikasi |

Contoh submission:

```json
{"platform":"x","content":"Awas kamu, tunggu saja.","context":"Konteks percakapan yang diketahui operator.","context_key":"post-123:target-456:evidence-v1","external_reference_id":"comment-123"}
```

Contoh keputusan manusia (ID rule harus diverifikasi dari taxonomy target):

```json
{"expected_revision":1,"pelanggaran":true,"rule_ids":["violence.threat"],"rationale":"Reviewer menemukan unsur ancaman pada teks yang diperiksa.","verification_notes":"Teks dan konteks relevan telah diperiksa.","evidence_basis":"text_only","reuse":"exact","valid_for_hours":24}
```

Respons decision berisi `classification`, `review_revision`, `knowledge_id`, `reuse`, dan `warnings`. Gunakan respons itu untuk feedback dan refresh; jangan membuat knowledge dengan POST tambahan.

Timestamp service berupa Unix seconds UTC; konversi ke milliseconds sebelum Date JavaScript. Tampilkan zona waktu yang dipakai.

## 8. Polling, timeout, dan pemulihan error

- Antrean pada tab aktif: default polling 30 detik; detail pending/processing 15 detik. Konfigurabel, pause saat hidden/unmount, hindari request tumpang tindih, dan backoff saat error. Hentikan polling status setelah completed/failed; refresh manual saat koreksi diperlukan.
- Tidak ada webhook atau SSE. Jangan membuat fitur seolah push tersedia.
- Inference utama dapat sampai 100 detik dan similarity check menambah call sampai 100 detik. Untuk BFF yang mendukung request panjang, beri budget upstream sekitar 240 detik dan selaraskan timeout reverse proxy. Jika platform tidak mendukung, gunakan durable job di BFF yang memanggil service; itu transport submission, bukan antrean review/knowledge kedua.
- `429`: patuhi Retry-After, tampilkan waktu tunggu. Jangan membuat retry storm; service prototipe default sekitar 6 workflow/menit per tenant dan satu workflow inference bersamaan.
- Network timeout/response hilang pada submission: ulangi **payload dan idempotency key yang sama** untuk menemukan record yang mungkin sudah terbentuk. Jangan langsung membuat key baru.
- Jika hasil terkonfirmasi failed, retry disengaja memakai key baru. Error 502/504 dapat menyertakan classification_id; simpan dan GET detail. Jangan artikan kegagalan sebagai tidak melanggar.
- Response decision hilang: GET detail review/events dan cek apakah keputusan sudah tercatat sebelum mencoba lagi. Jangan replay mutation secara buta.
- 409 idempotency berbeda payload: beri error konflik; jangan diam-diam mengganti key. 409 review revision: reload dan review ulang. 409 policy version berubah: jelaskan perlu klasifikasi baru pada kebijakan terkini, bukan mengulang keputusan lama.
- 401/403: blok tindakan dan tampilkan pesan akses/konfigurasi; 404: item tidak tersedia tanpa membocorkan tenant lain; 413/422: tampilkan validasi relevan dan pertahankan draft.
- Jika taxonomy tidak termuat, form keputusan rule tidak boleh submit menggunakan ID tebakan. Jangan memaksa logout manusia hanya karena upstream API key bermasalah.

## 9. Persyaratan nonfungsional

- Responsif desktop/mobile; label dan feedback Bahasa Indonesia; navigasi keyboard, fokus error, dan status tidak dibedakan hanya melalui warna.
- Sanitasi URL kebijakan dengan allowlist scheme http/https; tautan eksternal gunakan proteksi opener. Jangan render HTML konten pengguna.
- Tidak mencatat key atau body konten sensitif di log default. Gunakan ID korelasi, status, latency, dan actor aplikasi untuk observability.
- Draft tidak disimpan di browser secara persisten secara default. Jika recovery server-side diperlukan, batasi akses per user/tenant dan dokumentasikan retensinya.
- Aplikasi/DB independen. Retensi data dan backup aplikasi didokumentasikan; tidak menghapus data service atau mengubah konfigurasi deployment backend tanpa scope tambahan.
- Tidak ada jaminan akurasi klasifikasi dari UI. Tampilkan versi kebijakan dan provenance, bukan klaim kepastian model.
- Metrik MVP hanya yang dapat dihitung sah: total review pending/completed dari endpoint, keberhasilan request, latency aplikasi, dan jumlah konflik. Jangan tampilkan angka total klasifikasi global tanpa sumber.

## 10. Acceptance criteria wajib

1. Hasil completed/LLM pelanggaran maupun nonpelanggaran tampil final tanpa antrean/tombol approve wajib.
2. Pending memiliki result/pelanggaran null, banner menunggu manusia, dan prediksi yang jelas bukan final.
3. Processing/failed dengan needs_review=false tidak ditampilkan sebagai hasil aman/final.
4. Reviewer manusia dapat menyelesaikan pending; hasil berubah completed/human dan knowledge_id muncul tanpa POST knowledge tambahan.
5. Pelanggaran wajib rules valid; nonpelanggaran wajib rules kosong; batas panjang dan enums diterapkan.
6. UI menampilkan reuse efektif dan warning ketika service menurunkan similar/exact menjadi mode lebih konservatif.
7. Dua reviewer dengan revision sama menghasilkan satu keputusan sukses; yang lain mendapat conflict dan tidak menimpa diam-diam.
8. Koreksi menggunakan revision review terbaru dan audit sebelumnya tetap terlihat; knowledge lama tidak dianggap aktif lagi setelah refresh.
9. Reuse exact/similar menampilkan provenance yang benar; UI tidak memaksa service melewati pemeriksaan kesetaraan.
10. Revoked/expired dan index_error dibedakan; kegagalan embedding tidak ditampilkan sebagai keputusan manusia gagal.
11. Submit ganda/timeout memakai idempotency yang sama dan tidak membuat duplikasi logis. Retry failed yang disengaja memakai key baru.
12. 429 menghormati Retry-After; 409 policy/revision, 422, 502/504, dan respons mutation hilang memiliki recovery yang diuji.
13. Credential tidak ditemukan di bundle/network browser ke upstream, localStorage, log, atau repository. Browser hanya berkomunikasi dengan BFF untuk service ini.
14. User tidak dapat mengakses tenant lain atau endpoint reviewer dengan role operator melalui manipulasi URL/request.
15. Tidak ada ketergantungan aplikasi/data Narasi Ahli; base URL dapat diganti tanpa mengubah source.
16. Semua endpoint/method/payload integrasi tersedia di kontrak target; tidak ada webhook/list-classifications/claim yang dikarang.

Gunakan unit/integration test bermakna untuk adapter state, permission, idempotency, dan conflict; E2E untuk submit→pending→human→hasil final serta jalur langsung final. Gunakan fixture yang disanitasi; **jangan menyuntikkan keputusan dummy ke knowledge produksi**. Live mutation smoke test harus memakai tenant uji terpisah dan manusia untuk keputusan reviewer.

## 11. Rencana delivery dan definition of done

1. Inspeksi repo, autentikasi/komponen yang ada, dan preflight dependency. Konfirmasi kontrak target secara read-only; catat gap backend yang nyata.
2. Implementasikan BFF, secret configuration, session/RBAC/tenant mapping, adapter, dan fixtures.
3. Implementasikan submit/detail, antrean, workspace keputusan/koreksi, lalu knowledge.
4. Jalankan tes acceptance, error recovery, dan pemeriksaan kebocoran key; lakukan smoke test tenant uji sesuai izin environment.
5. Serahkan source, README setup, `.env.example` tanpa nilai rahasia, daftar route BFF, petunjuk provisioning actor reviewer, laporan tes, screenshot halaman utama, dan batas fitur yang belum didukung.

Selesai berarti aplikasi dapat menjalankan alur API yang ada secara end-to-end dan pengamanan akses lulus; mock UI saja belum selesai. Jika credential/environment tidak tersedia, tetap selesaikan implementasi dan pengujian fixture, lalu tandai live integration **belum terverifikasi**, bukan mengklaim sudah live.

## 12. Prompt handoff siap pakai

> Implementasikan PRD ini sebagai aplikasi mandiri yang mengonsumsi Moderation Review Service. Baca PRD, INTEGRATION.md, dan openapi.json sebelum coding. Gunakan stack dan komponen maintained yang sudah ada. Bangun UI + BFF dengan auth manusia, RBAC, tenant isolation, dan credential server-side. Hasil LLM tanpa needs_review langsung final; hanya kasus unresolved yang perlu review manusia. Jangan membuat keputusan reviewer melalui LLM. Bank knowledge dan reuse tetap milik service. Jangan integrasikan Narasi Ahli atau mengarang endpoint. Tangani revision conflict, idempotency, polling, timeout, dan error sesuai PRD. Kerjakan hingga implementasi dan tes selesai; laporkan perbedaan kontrak dan hasil live yang belum terverifikasi. Jangan mengubah backend klasifikasi/deployment atau mengisi knowledge produksi dengan data dummy sebagai bagian dari pekerjaan UI ini.
