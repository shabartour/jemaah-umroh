# Panduan aktivasi OCR AI KTP Shabar Tour

Frontend aplikasi tetap di GitHub Pages. Pemrosesan foto dilakukan melalui Firebase Callable Cloud Function yang hanya dapat dipanggil oleh staf yang sudah login.

## Arsitektur

1. Browser mengompres foto KTP menjadi JPEG.
2. Firebase Cloud Function mengirim foto langsung ke Google Document AI Enterprise OCR.
3. Cloud Function mengirim **teks OCR saja** (bukan foto) ke Gemini melalui Vertex AI untuk ekstraksi JSON.
4. Hasil dikembalikan ke formulir. Tidak ada upload ke Cloud Storage atau penyimpanan foto permanen.

## Konfigurasi satu kali di Google Cloud

Project: `umroh-app-database`

Aktifkan API:
- Cloud Functions API
- Cloud Build API
- Artifact Registry API
- Document AI API
- Vertex AI API

Buat processor **Enterprise Document OCR** di Document AI. Gunakan lokasi `asia-southeast1` dan salin Processor ID (bukan seluruh resource name).

Berikan role berikut kepada service account runtime Cloud Functions:
- `roles/documentai.apiUser`
- `roles/aiplatform.user`

Buka detail Cloud Function setelah deploy untuk melihat runtime service account yang digunakan, lalu berikan kedua role tersebut kepada akun itu. Jangan menebak service account jika project sudah memiliki konfigurasi khusus.

## Deploy

Pasang Firebase CLI dan login dengan akun Google yang memiliki izin deploy ke project:

```bash
npm install -g firebase-tools
firebase login
cd jemaah-umroh
cd functions && npm install && cd ..
firebase deploy --only functions:scanKtpDocument --project umroh-app-database
```

Atur konfigurasi environment function sebelum deploy jika menggunakan lokasi atau model berbeda. Default:
- Function region: `asia-southeast1`
- Document AI location: `asia-southeast1`
- Vertex AI location: `asia-southeast1`
- Gemini model: `gemini-2.5-flash`

Variabel wajib:
- `DOCUMENT_AI_PROCESSOR_ID`: Processor ID dari Document AI

Salin `functions/.env.example` menjadi `functions/.env.umroh-app-database`, lalu isi Processor ID yang benar. File `.env.umroh-app-database` sudah diabaikan Git dan tidak boleh diunggah ke repository. Firebase CLI akan membaca file `.env.<project-id>` saat deploy. Jangan menaruh API key atau kredensial service account di `index.html`, GitHub, atau browser. Function menggunakan Application Default Credentials milik service account runtime.

## Biaya dan privasi

- Enterprise Document OCR memiliki jatah 1.000 halaman gratis per bulan, lalu tarif standar yang dipublikasikan Google sekitar US$1,50 per 1.000 halaman; harga dapat berubah dan pajak/kurs dapat berlaku.
- Gemini dijalankan melalui Vertex AI, bukan Gemini API free tier. Hanya teks hasil OCR yang dikirim ke model.
- Setiap pemindaian memproses satu gambar; hindari scan berulang jika tidak perlu.
- Foto tidak disimpan ke Cloud Storage atau Firestore oleh kode ini. Foto dan hasil OCR tetap merupakan data pribadi; akses dibatasi pada pengguna Firebase Authentication yang login.
- Hasil OCR tetap wajib diverifikasi petugas, terutama NIK, tanggal lahir, dan alamat.

## Catatan

Commit file konfigurasi dan source code ke GitHub **belum otomatis membuat atau mengaktifkan Cloud Function**. Deploy membutuhkan akses ke Google Cloud/Firebase Console, pembuatan processor, API enablement, dan IAM. Setelah function berhasil dideploy, tombol Pindai KTP di aplikasi akan memanggil layanan AI.
