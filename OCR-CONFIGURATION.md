# Konfigurasi OCR KTP — Shabar Tour

## Arsitektur yang digunakan

Endpoint callable `scanKtpDocument` berjalan sebagai Cloud Function di proyek Firebase `umroh-app-database`. Alurnya:

1. Foto KTP dikirim dari aplikasi ke Cloud Function.
2. Google Document AI membaca tulisan pada foto menggunakan processor yang telah dibuat di Google Cloud.
3. Teks hasil OCR dikirim ke Gemini melalui Vertex AI.
4. Gemini mengembalikan JSON terstruktur untuk diisikan ke formulir jemaah.

Foto tidak disimpan ke Cloud Storage oleh kode saat ini. Gemini menerima teks OCR, bukan foto KTP.

## Model Gemini

Default model telah diperbarui menjadi `gemini-3.5-flash`. Model ini mendukung GenerateContent API dan structured output serta tersedia di region `asia-southeast1` (Singapore).

Model lama `gemini-2.5-flash` telah mencapai tanggal retirement 20 Oktober 2026 dan tidak lagi menjadi default.

## Konfigurasi GitHub Actions

Workflow `.github/workflows/deploy-firebase-backend.yml` membuat file dotenv `functions/.env.umroh-app-database` secara otomatis dari GitHub repository variables sebelum deployment. File tersebut tidak disimpan ke repository.

Buka **GitHub → Settings → Secrets and variables → Actions → Variables → New repository variable** pada repository ini, lalu buat variabel berikut:

| Variable | Isi |
|---|---|
| `DOCUMENT_AI_PROJECT_ID` | Project ID tempat processor Document AI benar-benar berada. Isi `ocr-identity-app` hanya jika processor memang dibuat di sana; jika tidak, isi `umroh-app-database`. |
| `DOCUMENT_AI_PROCESSOR_ID` | ID processor Document AI saja, bukan seluruh resource path. |
| `DOCUMENT_AI_LOCATION` | Lokasi processor yang tampil di Document AI. Contoh `asia-southeast1` untuk Singapore. |
| `VERTEX_PROJECT_ID` | Project ID tempat Vertex AI akan dijalankan. Default yang disarankan: `umroh-app-database`. |
| `VERTEX_LOCATION` | `asia-southeast1`. |
| `GEMINI_MODEL` | `gemini-3.5-flash`. |

Tiga nilai terakhir boleh dibiarkan memakai default workflow jika nilainya sama dengan rekomendasi di atas. Namun, `DOCUMENT_AI_PROCESSOR_ID` harus diisi dengan ID processor yang benar sebelum OCR dapat bekerja. Project ID dan Processor ID bukan password atau private key, tetapi jangan memasukkan service-account JSON atau private key sebagai repository variable.

Untuk deployment manual dari komputer, salin `.env.example` menjadi `.env.umroh-app-database` di dalam folder `functions`, kemudian isi nilainya. Jangan commit file `.env.umroh-app-database`.

## Menemukan project ID, lokasi, dan processor ID

1. Buka Google Cloud Console dan pilih project yang berisi processor.
2. Buka **Document AI → Processors**.
3. Pilih processor yang dipakai untuk membaca KTP.
4. Catat **Processor ID** dan **Location** yang terlihat di halaman detail processor.
5. Isi `DOCUMENT_AI_PROJECT_ID` dengan Project ID pilihan tersebut.

Jangan menebak Processor ID atau lokasi. Jika processor berada di `ocr-identity-app`, maka isi `DOCUMENT_AI_PROJECT_ID=ocr-identity-app`; kode sekarang akan mengirim permintaan Document AI ke proyek tersebut secara eksplisit.

## API dan izin runtime

Pastikan API berikut aktif pada proyek yang sesuai:

- Proyek Document AI: `documentai.googleapis.com`.
- Proyek Vertex AI: `aiplatform.googleapis.com`.
- Proyek Firebase Functions: Cloud Functions, Cloud Build, dan Artifact Registry APIs (deployment Firebase CLI akan memeriksa/mengaktifkannya; billing Blaze harus aktif).

Cloud Function menggunakan **runtime service account** milik fungsi, bukan service account deployment GitHub Actions. Setelah fungsi pertama kali berhasil dibuat, buka detail `scanKtpDocument` dan lihat **Runtime service account**.

Berikan izin minimum kepada runtime service account tersebut:

- Pada proyek Document AI (misalnya `ocr-identity-app`): **Document AI API User** (`roles/documentai.apiUser`), agar fungsi dapat memanggil processor.
- Pada proyek Vertex AI (misalnya `umroh-app-database`): **Vertex AI User** (`roles/aiplatform.user`), agar fungsi dapat memanggil model Gemini.

Jika Document AI dan Vertex AI berada di proyek yang sama, kedua role dapat diberikan pada proyek itu. Jika berada di proyek berbeda, berikan setiap role pada proyek pemilik layanan masing-masing. Jangan memberikan Owner.

## Perilaku jika konfigurasi belum lengkap

Jika `DOCUMENT_AI_PROCESSOR_ID` belum diisi, fungsi akan mengembalikan error `failed-precondition` dengan arahan untuk mengatur project dan processor ID. Fungsi manajemen pengguna tidak bergantung pada Processor ID.

## Referensi

- Document AI regions: https://cloud.google.com/document-ai/docs/regions
- Document AI IAM roles: https://cloud.google.com/document-ai/docs/access-control/iam-roles
- Vertex AI Gemini model lifecycle: https://cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions
- Gemini 3.5 Flash: https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-5-flash
- Firebase Functions environment configuration: https://firebase.google.com/docs/functions/config-env
