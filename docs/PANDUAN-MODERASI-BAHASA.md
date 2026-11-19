# Moderation API: platform dan bahasa

Taxonomy mendukung platform `x` dan bahasa `id` (default) atau `en`. Platform lain belum didukung dan akan ditolak dengan HTTP 422. ID rule dan versi policy yang telah ada tidak berubah.

Baca taxonomy: `GET /api/v1/external/moderation/taxonomy?platform=x&language=en` atau `GET /api/v1/external/moderation-review/v1/taxonomy?platform=x&language=en`. Gunakan header `X-API-Key`. Respons menyediakan `platform`, `language`, dan `supported_languages`.

Klasifikasi langsung: `POST /api/v1/external/moderation/classify` dengan body `{"platform":"x","language":"en","content":"Example text","context":""}`. Jalur kasus menggunakan body yang sama pada `POST /api/v1/external/moderation-review/v1/classifications`, dengan `Idempotency-Key`. Untuk kompatibilitas, language yang tidak disertakan berarti `id`.

Nama dan uraian taxonomy tersedia dalam dua bahasa; teks hasil model diminta mengikuti bahasa yang dipilih, sementara kutipan bukti tetap sesuai teks sumber. Catatan keputusan reviewer tetap ditulis sebagaimana dimasukkan reviewer. Demi menghindari reuse lintas bahasa, request berbahasa Inggris tidak menggunakan kembali knowledge manusia secara otomatis.

Terjemahan taxonomy dibantu mesin dan perlu pemeriksaan manusia. Peta kebijakan ini bukan salinan menu report X. Pengambilan langsung situs X dari server menghasilkan HTTP 403 sehingga tidak dilakukan sinkronisasi otomatis atau pembaruan kategori yang tidak terverifikasi.
