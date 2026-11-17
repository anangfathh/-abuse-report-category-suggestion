# Tilik — HITL Kategorisasi X

Aplikasi web **mandiri** untuk PRD pada `docs/PRD-HITL-Kategorisasi-X.md`. Frontend berbahasa Indonesia + BFF Next.js/React; tidak mengimpor kode, auth, database, agent, atau knowledge NarasiAhli. Moderation Review Service tetap source of truth classifier, antrean manusia, keputusan, dan knowledge. Tidak mengirim laporan ke X.

Deployment Docker: **https://abuse-reporter.qudo.id**. Detail routing/TLS/operasional ada di [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Akses memerlukan akun dari admin; credential tidak disertakan di repository.

**Sumber prediksi terbaru:** sesuai klarifikasi owner, prediksi baru memakai **API NarasiAhli lama** `/api/v1/external/moderation/classify`. Lapisan review tetap menangani antrean/knowledge. Detail alur, key, opt-in tenant dan bukti panggilan ada di [docs/NARASIAHLI-PREDICTION.md](docs/NARASIAHLI-PREDICTION.md). Klarifikasi ini menggantikan batas “tidak memanggil API NarasiAhli” pada handoff awal; data/auth aplikasi tetap terpisah.

## Fitur

- Login manusia, session opaque HttpOnly/SameSite Strict, CSRF + pemeriksaan Origin, scrypt password hashing, rate limit login; role operator/reviewer/admin dan tenant server-side.
- Klasifikasi konten, state processing/pending/completed/failed, seluruh findings/bukti/kebijakan, sumber keputusan dan taxonomy dinamis.
- Ledger submission server-side per pengguna. Key/payload tersimpan sebelum request upstream. Retry respons hilang memakai key/payload asli; proses baru memakai key baru dengan tindakan eksplisit. Bukan daftar klasifikasi global service.
- Antrean pending/selesai, pagination, workspace manusia, validasi rule/reuse/bukti, revision optimistic, koreksi dan audit service. Prediksi tidak otomatis menjadi keputusan manusia.
- Knowledge, provenance, expiry/revoked/index-error terpisah; revoke/reindex admin-only di BFF. Tidak ada bank knowledge atau antrean review paralel.
- Pengguna/role admin pada tenant sendiri. Penggantian role/nonaktif menghapus session target. Tidak ada self-demotion melalui halaman admin.
- Polling 30 detik antrean dan 15 detik detail pending/processing; pause saat tab hidden, tanpa overlapping polling, backoff error, Retry-After 429.

## Menjalankan

Node **24+**, npm. Tidak membutuhkan database/service berbayar tambahan. Next.js/React/Zod maintained; SQLite bawaan Node hanya menyimpan user/session, audit aplikasi dan ledger submission. Tidak mengakses SQLite/PVC service moderation.

```sh
npm ci
cp .env.example .env.local
# Edit .env.local dengan konfigurasi sendiri (jangan commit secret).
npm run dev
```

Buka `http://localhost:3040` (atau ganti APP_ORIGIN dan alamat browser agar persis sama). Konfigurasi tenant di `.env.local` berupa JSON satu baris:

```dotenv
APP_ORIGIN=http://localhost:3040
COOKIE_SECURE=false
APP_DATABASE_PATH=data/app.sqlite3
MODERATION_TENANTS_JSON={"team-a":{"baseUrl":"http://127.0.0.1:8030","clientKey":"<client-key-server-side>","reviewerKey":"<shared-reviewer-key-server-side>","reviewerKeys":{}}}
```

Gunakan **key berbeda per tenant**. Key client untuk classification/taxonomy; key reviewer untuk review/knowledge. Jangan masukkan key ke browser, URL, log, source, atau GitHub. Key server tidak dikirimkan ke browser. Base URL dapat diganti tanpa perubahan source. Jangan mengarahkan runtime ke host yang tidak dipercaya.

### Akun admin pertama

CLI bukan endpoint publik. Masukkan password tanpa menaruh nilai literal di command history:

```sh
read -rs -p 'Password admin (minimal 12 karakter): ' BOOTSTRAP_PASSWORD
export BOOTSTRAP_PASSWORD
npm run user:add -- admin@example.com team-a admin 'Admin Tim'
unset BOOTSTRAP_PASSWORD
```

CLI mencetak ID user, bukan password. Login dengan akun itu; admin menambah operator/reviewer melalui halaman Pengguna. Akun demo/password default **tidak** dipaketkan. Tidak ada registrasi publik, email reset-password, atau SSO pada versi ini. Password recovery dilakukan operator deployment dengan kontrol DB aplikasi, bukan service moderation.

### Atribusi reviewer

Provision key reviewer per manusia melalui **CLI service moderation**, bukan UI ini. Masukkan pemetaan `reviewerKeys: {"<application-user-id>":"<service-reviewer-key>"}` pada tenant server-side. Bila key individual tidak tersedia, BFF memakai shared reviewerKey. UI memberi label bahwa actor service adalah akun integrasi bersama; audit aplikasi menyimpan ID manusia. Jangan mengklaim audit service mengetahui manusia individual saat menggunakan key bersama.

Session adalah random token 256-bit; DB menyimpan hash token dan CSRF token, expiry 8 jam, role/tenant dibaca dari user server pada tiap request. `SESSION_SECRET` dari contoh PRD tidak diperlukan karena token opaque bukan cookie payload yang ditandatangani. Tidak ada draft/key di localStorage. Password minimal 12 karakter untuk provisioning.

## Production

```sh
npm run build
# Gunakan secret manager atau environment loader yang sesuai; .env.local jangan di repository.
npm start
```

Gunakan HTTPS, `APP_ORIGIN=https://domain-anda`, **COOKIE_SECURE=true**, reverse proxy timeout minimal **300 detik**, dan pembatasan akses server/volume aplikasi. Local CLI `start` bind loopback; Docker bind 0.0.0.0 di dalam container, publish hanya ke loopback bila di belakang proxy. Jangan memakai platform serverless dengan timeout di bawah 240 detik untuk inference sinkron ini. Bila platform memiliki limit pendek, perlu implementasi transport job durable terpisah sebelum dipakai; belum disertakan.

```sh
docker build -t tilik:local .
docker run --rm -p 127.0.0.1:3040:3040 --env-file .env.local \
  -v tilik-data:/app/data tilik:local
```

Provision admin sebelum membuka aplikasi menggunakan CLI di container dengan volume yang sama. Jalankan satu instance aplikasi pada pilot SQLite; bukan jaminan deployment horizontal. Runtime/test tidak mengubah deployment service moderation atau NarasiAhli.

## Route BFF

Browser hanya berbicara same-origin `/api/*`; BFF mengisi credential dari tenant user yang login.

| Route | Role minimum | Kegunaan |
|---|---|---|
| POST /api/login | publik + Origin | login, rate limit 8 kegagalan/15 menit/email |
| GET /api/me; POST /api/logout | login | identitas/CSRF, logout |
| GET /api/taxonomy | operator | taxonomy service |
| POST /api/classifications | operator | submit + Idempotency-Key |
| GET /api/classifications/:id | operator milik sendiri / reviewer tenant | detail service |
| GET /api/submissions; GET /api/submissions/:id | pemilik | ledger aplikasi, maksimal 100 terbaru |
| GET /api/reviews; GET /api/reviews/:id | reviewer | antrean/detail service |
| POST /api/reviews/:id/decision | reviewer | keputusan/koreksi, revision top-level |
| GET /api/knowledge | reviewer | daftar service |
| POST /api/knowledge/:id/revoke atau /reindex | admin | tindakan knowledge service |
| GET/POST /api/users; POST /api/users/:id | admin tenant | daftar/provision/role/nonaktif |
| GET /api/health | publik | kesehatan proses aplikasi, bukan kesehatan classifier |

Mutations selain login wajib `X-CSRF-Token` dari `/api/me` dan Origin cocok APP_ORIGIN. POST decision tidak menambah field buatan UI; checkbox manusia hanya pengaman UI. Key tenant/role tidak diterima dari payload browser. Role operator tidak dapat membaca submission operator lain; reviewer tetap dibatasi tenant service credential. Semua upstream route/method di-allowlist.

## Timeout dan konflik

- Anggaran upstream 240 detik; browser 250 detik. Ledger ditulis sebelum request. Jika browser reload saat respons hilang, buka Submission saya dan lanjutkan submission asli. Tidak ada replay mutation reviewer otomatis.
- 409 revision: detail dimuat ulang, draft dipertahankan, konfirmasi manusia direset, tidak auto-overwrite. Policy version berubah memerlukan klasifikasi baru, bukan memaksa keputusan lama.
- Respons decision hilang: aplikasi GET detail dan menampilkan audit/revision; reviewer memeriksa sebelum tindakan manual. Revoke/reindex gagal juga refresh daftar sebelum mencoba ulang.
- 502/504 dengan classification_id dicatat pada ledger untuk GET detail; error tidak ditampilkan sebagai konten aman. Failed yang sudah pasti dapat dimulai ulang melalui tombol submission baru dengan key baru.
- 429 meneruskan Retry-After; polling backoff. 401 upstream tidak memaksa logout session aplikasi. Taxonomy gagal memblokir form keputusan dengan rule tebakan.

## Retensi, backup, audit

DB `data/app.sqlite3` menyimpan password hash, session, metadata audit (actor/tenant/action/object/status/waktu) dan **payload submission** untuk recovery. Tidak menyimpan prediction sebagai knowledge. Folder data dibuat mode 0700. Lindungi volume dan backup karena payload dapat sensitif.

Retensi pilot: data submission/audit bertahan sampai operator menghapusnya; **belum ada auto-purge**. Tentukan kebijakan retensi organisasi sebelum produksi, dan hapus ledger kedaluwarsa lewat maintenance aplikasi (tidak menghapus data service). Session expired dibersihkan ketika login berhasil. Backup SQLite menggunakan `.backup`/SQLite backup API atau snapshot volume dengan prosedur konsisten; jangan hanya menyalin file DB saat WAL aktif. Restore backup ke aplikasi yang dihentikan, lalu verifikasi permission. Jangan commit DB/backup.

Tidak ada log body/key default; audit tidak berisi body. Tidak ada autosave draft di browser. Tidak ada analytics global yang dikarang, assignment/claim, webhook/SSE, scraping X, analisis media, fine-tuning, atau koreksi hasil LLM final tanpa review task.

## Verifikasi

```sh
npm run build
npm test
# Browser acceptance + screenshot fixture (bukan production data):
npx playwright install chromium
RUN_BROWSER_TESTS=1 npm test
# Browser custom bila disediakan environment:
RUN_BROWSER_TESTS=1 CHROMIUM_PATH=/path/to/chrome npm test
```

Integration test menjalankan build Next produksi, service fixture HTTP di localhost, database sementara, dan user fixture. Alur final langsung dan pending → manusia → final diuji, termasuk correction, konflik revision, tenant/RBAC/CSRF, idempotency respons hilang, 429/401/413/422/502/504, dan tidak ada POST knowledge tambahan. Browser test menulis `docs/screenshots/*.png` menggunakan fixture. Jangan mengarahkan test ke service produksi.

Live contract read-only diperiksa terpisah, tanpa menyalin credential/konten. Hasil sanitasi: `docs/live-contract-smoke.json`. Tidak melakukan live mutation/classification/keputusan reviewer dalam tenant produksi. Status dan batas verifikasi lengkap di `docs/VERIFICATION.md`.

## NarasiAhli API integration

Production uses NarasiAhli `/api/v1/external/moderation-review` for classification and human-review workflow. `MODERATION_TENANTS_JSON` configures the service base URL and server-only API Integration key. The key needs `moderation:read`, `moderation:classify`, and `moderation:review`; use the same integration key for client and reviewer access to the same case scope. Application login and reviewer roles remain enforced separately. The API key must never be exposed to the browser or committed.
