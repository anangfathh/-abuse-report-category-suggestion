# Abuse Reporter — HITL Kategorisasi X

Aplikasi web **mandiri** untuk PRD pada `docs/PRD-HITL-Kategorisasi-X.md`. Frontend berbahasa Indonesia + BFF Next.js/React; tidak mengimpor kode, auth, database, agent, atau knowledge NarasiAhli. Moderation Review Service tetap source of truth classifier, antrean manusia, keputusan, dan knowledge. Tidak mengirim laporan ke X.

Deployment Docker: **https://abuse-reporter.qudo.id**. Detail routing/TLS/operasional ada di [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Akses memerlukan akun dari admin; credential tidak disertakan di repository.

**Sumber prediksi terbaru:** sesuai klarifikasi owner, prediksi baru memakai **API NarasiAhli**; pada topologi produksi (review app di NarasiAhli) lewat antrean job `POST /api/v1/external/moderation/jobs` + polling, halaman *Antrean klasifikasi* (reviewer/admin) memantau antrean itu secara read-only. Lapisan review tetap menangani antrean/knowledge. Detail alur, key, konfigurasi dan bukti panggilan ada di [docs/NARASIAHLI-PREDICTION.md](docs/NARASIAHLI-PREDICTION.md). Klarifikasi ini menggantikan batas “tidak memanggil API NarasiAhli” pada handoff awal; data/auth aplikasi tetap terpisah.

## Antarmuka (Astryx)

UI memakai [Astryx](https://astryx.atmeta.com) (`@astryxdesign/core` + `@astryxdesign/theme-neutral`, React 19): `AppShell`/`SideNav` untuk kerangka, `Table`, `Selector`/`MultiSelector`, `TextArea`, `Dialog`/`AlertDialog`, `Banner`, `Badge`, `Pagination`, dan seterusnya; mode tampilan bisa dipilih pengguna (terang / ikuti sistem / gelap) lewat tombol di pojok kanan atas; pilihan disimpan di cookie `theme` (bukan localStorage) agar server merender mode yang benar sejak awal. Font Figtree dimuat lokal lewat `@fontsource-variable/figtree` karena CSP hanya mengizinkan `font-src 'self'`. Presentasi ada di `app/ui.jsx` dan `app/views.jsx`; logika/polling tetap di `app/page.jsx`. Cek API komponen dengan `npx astryx component <Nama>`.

## Fitur

- Login manusia, session opaque HttpOnly/SameSite Strict, CSRF + pemeriksaan Origin, scrypt password hashing, rate limit login; role operator/reviewer/admin server-side.
- Klasifikasi konten, state processing/pending/completed/failed, seluruh findings/bukti/kebijakan, sumber keputusan dan taxonomy dinamis.
- Ledger submission server-side per pengguna. Key/payload tersimpan sebelum request upstream. Retry respons hilang memakai key/payload asli; proses baru memakai key baru dengan tindakan eksplisit. Bukan daftar klasifikasi global service.
- Antrean pending/selesai, pagination, workspace manusia, validasi rule/reuse/bukti, revision optimistic, koreksi dan audit service. Prediksi tidak otomatis menjadi keputusan manusia.
- Knowledge, provenance, expiry/revoked/index-error terpisah; revoke/reindex admin-only di BFF. Tidak ada bank knowledge atau antrean review paralel.
- Pengguna/role untuk lingkungan internal. Penggantian role/nonaktif menghapus session target. Tidak ada self-demotion melalui halaman admin.
- Halaman **Antrean klasifikasi** (reviewer/admin): jumlah job per status, job tertua yang menunggu, job yang sedang mencoba ulang, dan daftar job; segar tiap 10 detik. Read-only, cakupan = API key integrasi ini, langsung dari API NarasiAhli.
- Polling 30 detik antrean dan 15 detik detail pending/processing; pause saat tab hidden, tanpa overlapping polling, backoff error, Retry-After 429.

## Menjalankan

Node **24+**, npm. Tidak membutuhkan database/service berbayar tambahan. Next.js/React/Zod maintained; PostgreSQL menyimpan user/session, audit aplikasi dan ledger submission dalam database `abuse_reporter_db` dan skema `abuse_reporter` yang terisolasi.

```sh
npm ci
cp .env.example .env.local
# Edit .env.local dengan konfigurasi sendiri (jangan commit secret).
npm run dev
```

Buka `http://localhost:3040` (atau ganti APP_ORIGIN dan alamat browser agar persis sama). Konfigurasi integrasi di `.env.local` memakai base URL dan satu API key server:

```dotenv
APP_ORIGIN=http://localhost:3040
COOKIE_SECURE=false
APP_DATABASE_URL=postgresql://app_user:replace-me@localhost:5432/abuse_reporter_db
MODERATION_API_BASE_URL=https://narasiahli.qudo.id/api/v1/external/moderation-review
MODERATION_API_KEY=<server-side-integration-key>
```

Aplikasi ini memakai **satu key integrasi bersama** untuk classification, taxonomy, review, dan knowledge. Semua pengguna aplikasi yang berwenang menggunakan key dan cakupan data yang sama. Jangan masukkan key ke browser, URL, log, source, atau GitHub. Key server tidak dikirimkan ke browser. Base URL dapat diganti tanpa perubahan source. Jangan mengarahkan runtime ke host yang tidak dipercaya.

### Akun admin pertama

CLI bukan endpoint publik. Masukkan password tanpa menaruh nilai literal di command history:

```sh
read -rs -p 'Password admin (minimal 12 karakter): ' BOOTSTRAP_PASSWORD
export BOOTSTRAP_PASSWORD
npm run user:add -- admin@example.com admin 'Admin Tim'
unset BOOTSTRAP_PASSWORD
```

CLI mencetak ID user, bukan password. Login dengan akun itu; admin menambah operator/reviewer melalui halaman Pengguna. Akun demo/password default **tidak** dipaketkan. Tidak ada registrasi publik, email reset-password, atau SSO pada versi ini. Password recovery dilakukan operator deployment dengan kontrol DB aplikasi, bukan service moderation.

### Atribusi reviewer

Service mencatat actor sebagai akun integrasi bersama. Audit aplikasi mencatat ID pengguna yang mengambil tindakan; jangan mengklaim service mengetahui identitas manusia individual hanya dari API key.

Session adalah random token 256-bit; DB menyimpan hash token dan CSRF token, expiry 8 jam, role dibaca dari user server pada tiap request. `SESSION_SECRET` dari contoh PRD tidak diperlukan karena token opaque bukan cookie payload yang ditandatangani. Tidak ada draft/key di localStorage. Password minimal 12 karakter untuk provisioning.

## Production

```sh
npm run build
# Gunakan secret manager atau environment loader yang sesuai; .env.local jangan di repository.
npm start
```

Gunakan HTTPS, `APP_ORIGIN=https://domain-anda`, **COOKIE_SECURE=true**, reverse proxy timeout minimal **300 detik**, dan pembatasan akses server/volume aplikasi. Local CLI `start` bind loopback; Docker bind 0.0.0.0 di dalam container, publish hanya ke loopback bila di belakang proxy. Jangan memakai platform serverless dengan timeout di bawah 240 detik untuk inference sinkron ini. Bila platform memiliki limit pendek, perlu implementasi transport job durable terpisah sebelum dipakai; belum disertakan.

```sh
docker build -t abuse-reporter:local .
docker run --rm -p 127.0.0.1:3040:3040 --env-file .env.local \
  -v abuse-reporter-data:/app/data abuse-reporter:local
```

Provision admin sebelum membuka aplikasi menggunakan CLI di container dengan volume yang sama. Jalankan satu instance aplikasi dengan PostgreSQL; bukan jaminan deployment horizontal. Runtime/test tidak mengubah deployment service moderation atau NarasiAhli.

## Route BFF

Browser hanya berbicara same-origin `/api/*`; BFF menggunakan credential integrasi bersama yang disimpan di server.

| Route | Role minimum | Kegunaan |
|---|---|---|
| POST /api/login | publik + Origin | login, rate limit 8 kegagalan/15 menit/email |
| GET /api/me; POST /api/logout | login | identitas/CSRF, logout |
| GET /api/taxonomy | operator | taxonomy service |
| POST /api/classifications | operator | submit + Idempotency-Key |
| GET /api/classifications/:id | operator milik sendiri / reviewer | detail service |
| GET /api/submissions; GET /api/submissions/:id | pemilik | ledger aplikasi, maksimal 100 terbaru |
| GET /api/reviews; GET /api/reviews/:id | reviewer | antrean/detail service |
| POST /api/reviews/:id/decision | reviewer | keputusan/koreksi, revision top-level |
| GET /api/knowledge | reviewer | daftar service |
| POST /api/knowledge/:id/revoke atau /reindex | admin | tindakan knowledge service |
| GET/POST /api/users; POST /api/users/:id | admin | daftar/provision/role/nonaktif |
| GET /api/health | publik | kesehatan proses aplikasi, bukan kesehatan classifier |

Mutations selain login wajib `X-CSRF-Token` dari `/api/me` dan Origin cocok APP_ORIGIN. POST decision tidak menambah field buatan UI; checkbox manusia hanya pengaman UI. Key integrasi atau role tidak diterima dari payload browser. Role operator tidak dapat membaca submission operator lain; reviewer tetap dibatasi tenant service credential. Semua upstream route/method di-allowlist.

## Timeout dan konflik

- Anggaran upstream 240 detik; browser 250 detik. Ledger ditulis sebelum request. Jika browser reload saat respons hilang, buka Submission saya dan lanjutkan submission asli. Tidak ada replay mutation reviewer otomatis.
- 409 revision: detail dimuat ulang, draft dipertahankan, konfirmasi manusia direset, tidak auto-overwrite. Policy version berubah memerlukan klasifikasi baru, bukan memaksa keputusan lama.
- Respons decision hilang: aplikasi GET detail dan menampilkan audit/revision; reviewer memeriksa sebelum tindakan manual. Revoke/reindex gagal juga refresh daftar sebelum mencoba ulang.
- 502/504 dengan classification_id dicatat pada ledger untuk GET detail; error tidak ditampilkan sebagai konten aman. Failed yang sudah pasti dapat dimulai ulang melalui tombol submission baru dengan key baru.
- 429 meneruskan Retry-After; polling backoff. 401 upstream tidak memaksa logout session aplikasi. Taxonomy gagal memblokir form keputusan dengan rule tebakan.

## Retensi, backup, audit

Skema PostgreSQL `abuse_reporter` menyimpan password hash, session, metadata audit (actor/action/object/status/waktu) dan **payload submission** untuk recovery. Tidak menyimpan prediction sebagai knowledge. Lindungi database dan backup karena payload dapat sensitif.

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

Integration test menjalankan build Next produksi, service fixture HTTP di localhost, database sementara, dan user fixture. Alur final langsung dan pending → manusia → final diuji, termasuk correction, konflik revision, RBAC/CSRF, idempotency respons hilang, 429/401/413/422/502/504, dan tidak ada POST knowledge tambahan. Browser test menulis `docs/screenshots/*.png` menggunakan fixture. Jangan mengarahkan test ke service produksi.

Live contract read-only diperiksa terpisah, tanpa menyalin credential/konten. Hasil sanitasi: `docs/live-contract-smoke.json`. Tidak melakukan live mutation/classification/keputusan reviewer pada produksi. Status dan batas verifikasi lengkap di `docs/VERIFICATION.md`.

## NarasiAhli API integration

Production uses NarasiAhli `/api/v1/external/moderation-review` for classification and human-review workflow. `MODERATION_API_BASE_URL` and `MODERATION_API_KEY` configure the service base URL and one server-only API Integration key. The key needs `moderation:read`, `moderation:classify`, and `moderation:review`; the same integration key is used for client and reviewer access to the same case scope. Application login and reviewer roles remain enforced separately. The API key must never be exposed to the browser or committed.

For Docker deployments, set `NARASIAHLI_IP` in the Compose environment to the private IP serving HTTPS for `narasiahli.qudo.id`. Compose adds a host mapping for this domain, so the application can reach the existing ingress even when the server DNS resolver is unavailable.

## PostgreSQL migration

Aplikasi membutuhkan `APP_DATABASE_URL` yang menunjuk ke database khusus `abuse_reporter_db` dan skema `abuse_reporter` dengan izin untuk akun aplikasi. Data review Narasiahli tetap berada di database Narasiahli `multiagent_db`, skema `moderation_review`. Skrip `scripts/migrate_sqlite_to_postgres.py` menyalin snapshot SQLite ke skema baru tanpa mengubah skema PostgreSQL yang sudah ada; jalankan hanya saat penulis dihentikan, dan verifikasi serta simpan backup sebelum peralihan.

## Riwayat berdasarkan API key

Halaman Submission menampilkan riwayat klasifikasi Narasiahli untuk key integrasi organisasi dan riwayat submission akun aplikasi secara terpisah. Riwayat API dapat diakses pengguna dalam organisasi yang memakai key tersebut; key tidak dikirim ke browser. Klasifikasi sebelum fitur riwayat diaktifkan tidak otomatis muncul.

## Migrasi ke satu lingkungan internal

Aplikasi tidak memakai tenant. Pada database lama, buat backup PostgreSQL yang terverifikasi dan hentikan penulisan sebelum menjalankan `node scripts/remove-tenant.mjs --apply`. Tanpa `--apply`, perintah hanya memeriksa keamanan migrasi. Migrasi akan menolak penggabungan bila ditemukan lebih dari satu tenant atau konflik idempotency; baris akun, submission dan audit dipertahankan. Data dan konfigurasi Narasiahli tidak diubah.

## Panduan penggunaan

- [Panduan API untuk aplikasi eksternal](docs/PANDUAN-API-EKSTERNAL.md)
- [Panduan pengguna Abuse Reporter](docs/PANDUAN-PENGGUNA.md)
