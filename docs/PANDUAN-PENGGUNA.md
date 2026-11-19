# Panduan Pengguna Abuse Reporter

Abuse Reporter adalah workspace internal untuk membaca hasil klasifikasi teks, melakukan review manusia, dan menelusuri keputusan. Akses aplikasi: **https://abuse-reporter.qudo.id**.

Aplikasi membantu memetakan konten teks ke kategori kebijakan X. Hasilnya bukan keputusan resmi X, tidak mengirim laporan otomatis, dan bukan pengganti penilaian manusia. Gambar, audio, video, atau halaman pada tautan tidak otomatis dibuka dan dianalisis.

## Masuk dan tampilan

1. Buka alamat aplikasi dan masuk menggunakan email serta kata sandi dari administrator.
2. Menu tersedia sesuai peran akun. Gunakan tombol menu navigasi pada layar kecil untuk membuka daftar halaman.
3. Gunakan pengaturan tema jika ingin memilih tampilan terang, gelap, atau mengikuti perangkat. Keluar menggunakan tombol **Keluar** setelah selesai.

Jika tidak bisa masuk, periksa email dan kata sandi atau hubungi administrator. Beberapa kegagalan login berulang dapat menyebabkan pembatasan sementara.

## Peran pengguna

| Peran | Kegiatan utama |
| --- | --- |
| Operator | Mengirim klasifikasi, melihat submission miliknya, taxonomy, dan riwayat API key yang terhubung. |
| Reviewer | Kemampuan operator, ditambah membuka antrean review dan menyimpan atau mengoreksi keputusan manusia. |
| Admin | Kemampuan reviewer, ditambah mengelola pengguna dan tindakan knowledge yang disediakan aplikasi. |

Aplikasi menggunakan satu integrasi API bersama. Riwayat API key dapat terlihat oleh pengguna yang memiliki akses ke halaman history. Pada service, actor tercatat sebagai integrasi bersama; identitas pengguna untuk tindakan dalam aplikasi dicatat di audit aplikasi.

## Mengirim klasifikasi

1. Buka **Klasifikasi baru**.
2. Masukkan **Teks konten**. Jika perlu, isi **Konteks tambahan** untuk membantu penilaian; batasnya 8.000 karakter teks dan 3.000 karakter konteks.
3. Jika tersedia, isi **Context key** dan referensi eksternal. Context key membantu membedakan konteks stabil seperti post dan sasaran; jangan menggunakannya untuk menyimpan rahasia.
4. Tekan **Analisis konten** dan tunggu hasil. Proses dapat memerlukan waktu beberapa menit.

Hasil dapat menyatakan pelanggaran, tidak ditemukan pelanggaran, atau menunggu review. Saat **menunggu review manusia**, analisis yang tampil adalah prediksi awal, bukan keputusan akhir. Jika proses gagal atau koneksi terputus, jangan menyimpulkan konten aman. Buka **Submission saya** untuk memeriksa status terbaru. Ikuti pilihan retry untuk payload yang sama jika respons awal belum diketahui.

## Taxonomy kebijakan

Buka **Taxonomy kebijakan** untuk melihat kategori dan subkategori, penjelasan, pengecualian, dan tautan sumber. Gunakan kolom pencarian untuk mencari nama atau ID rule. Tombol **Muat ulang** mengambil taxonomy terbaru dari service.

Taxonomy adalah peta kebijakan untuk membantu analisis. Nama kategori tidak menjamin bahwa sebuah konten otomatis melanggar; periksa teks, bukti, dan konteks.

## Submission dan riwayat API

Buka **Submission saya**:

- **Submission akun ini** menampilkan referensi yang dibuat lewat akun aplikasi Anda. Buka baris untuk memeriksa status terbaru; tersedia juga tampilan JSON jika ingin memeriksa respons.
- **Riwayat API key** menampilkan klasifikasi langsung yang memakai key integrasi yang terhubung ke aplikasi. Permintaan aplikasi juga dapat muncul di riwayat ini. Key integrasi lain memiliki cakupan riwayat sendiri.

Klasifikasi langsung melalui API yang menghasilkan `needs_review=true` juga otomatis masuk ke **Antrean review**, selama API key tersebut terhubung ke integrasi yang sama dengan aplikasi.

Riwayat API mulai direkam setelah fitur pencatatan diaktifkan. Permintaan lama yang tidak disimpan sebelumnya tidak akan otomatis muncul. Bila integrasi eksternal memakai key yang berbeda dari key aplikasi, history-nya tidak muncul pada key aplikasi.

## Meninjau antrean manusia

Fitur ini tersedia untuk reviewer dan admin.

1. Buka **Antrean review** lalu pilih tab pending atau selesai.
2. Buka kasus. Baca konten, konteks, analisis awal, dan sumber kebijakan. Analisis awal bukan keputusan final.
3. Pilih apakah konten melanggar. Jika melanggar, pilih rule yang relevan dari taxonomy; jika tidak, jangan pilih rule pelanggaran.
4. Isi alasan dan pilih dasar bukti. Isi catatan verifikasi ketika keputusan memerlukan bukti di luar teks, media, atau konteks tambahan.
5. Pilih izin reuse dan masa berlakunya, konfirmasi bahwa Anda telah memeriksa kasus dan audit, lalu simpan keputusan.

Keputusan disimpan sebagai hasil manusia dan dapat menghasilkan knowledge. `none` berarti tidak boleh dipakai ulang otomatis; `exact` untuk kasus identik yang memenuhi aturan service; `similar` dapat diperiksa untuk kasus mirip, tetapi bukan jaminan otomatis. Service dapat membatasi izin reuse berdasarkan bukti dan konteks.

Untuk koreksi, buka kembali review, periksa detail dan audit terbaru, lalu simpan keputusan dengan revision yang berlaku. Jika muncul konflik atau respons simpan tidak jelas, muat ulang detail dan audit sebelum memutuskan apakah tindakan masih perlu diulang.

## Knowledge dan pengguna

Di **Knowledge**, reviewer dan admin dapat melihat keputusan manusia, konteks, sumber keputusan, dan masa berlaku. Admin dapat melakukan reindex atau mencabut reuse. Mencabut reuse menghentikan pemakaian berikutnya dan tidak diam-diam mengubah hasil historis.

Di **Pengguna & peran**, admin dapat menambahkan akun, mengubah peran, atau menonaktifkan akun. Berikan kata sandi awal melalui kanal yang aman. Pengguna yang perannya berubah atau dinonaktifkan mungkin perlu masuk kembali.

## Jika ada kendala

- **Taxonomy belum termuat:** gunakan **Muat ulang**. Reviewer tidak seharusnya menebak ID rule saat taxonomy tidak tersedia.
- **Terkena batas permintaan:** tunggu durasi yang ditampilkan lalu coba lagi.
- **Review tidak ditemukan:** periksa bahwa kasus dikirim menggunakan integrasi API key yang sama dan akun Anda memiliki peran reviewer/admin.
- **Hasil atau keputusan belum jelas:** periksa status dan audit terbaru; jangan menganggap timeout sebagai hasil aman dan jangan mengulang keputusan secara otomatis.
- **Masalah berlanjut:** sampaikan waktu kejadian dan ID kasus/request kepada administrator. Jangan mengirim kata sandi atau API key melalui chat.
