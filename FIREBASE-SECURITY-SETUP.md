# Pengamanan Firebase — Sistem Manajemen Jemaah Shabar Tour

## Standar dokumen pengguna

Setiap akun Firebase Authentication harus memiliki dokumen Firestore dengan ID dokumen sama persis dengan UID Authentication:

`users/{AUTH_UID}`

Field yang digunakan aplikasi:

| Field | Tipe | Keterangan |
|---|---|---|
| `nama` | string | Nama pengguna |
| `email` | string | Email akun |
| `role` | string | `Admin`, `Staff`, atau `Viewer` |
| `aktif` | boolean | Harus `true` agar dapat login ke aplikasi |

Contoh dokumen Admin pertama:

```json
{
  "nama": "Administrator Shabar Tour",
  "email": "admin@shabartour.id",
  "role": "Admin",
  "aktif": true
}
```

Buat dokumen ini secara manual melalui Firebase Console untuk akun yang sudah ada. Pastikan Document ID adalah UID dari Authentication, bukan email. Pastikan `aktif` bertipe Boolean, bukan string.

## Hak akses

| Operasi | Admin | Staff | Viewer |
|---|---:|---:|---:|
| Membaca jemaah dan paket | Ya | Ya | Ya |
| Menambah/mengubah jemaah | Ya | Ya | Tidak |
| Menghapus jemaah | Ya | Tidak | Tidak |
| Menambah/mengubah paket | Ya | Ya | Tidak |
| Menghapus paket | Ya | Tidak | Tidak |
| Mengelola akun pengguna | Ya | Tidak | Tidak |
| OCR KTP | Ya | Ya | Tidak |

Pembuatan akun baru hanya mengizinkan role Staff atau Viewer. Role Admin awal/berikutnya ditetapkan secara manual oleh pengelola proyek di Firestore. Akun Admin tidak dapat dinonaktifkan atau dihapus dari menu aplikasi.

## Urutan penerapan

### A. Persiapan kredensial deployment

Repository menyediakan GitHub Actions manual untuk deploy backend Firebase. Sebelum menjalankannya:

1. Pastikan dokumen Admin pertama ada di `users/{UID}`, dengan Document ID sama persis dengan UID pada Firebase Authentication.
2. Pastikan `role` bertipe string bernilai `Admin`, dan `aktif` bertipe Boolean bernilai `true`.
3. Jika ada akun Authentication lama lain yang masih perlu dipakai, buat juga dokumen `users/{UID}` masing-masing dengan role dan status aktif yang tepat. Akun tanpa dokumen profil akan ditolak saat login.
4. Buat service account khusus deployment pada Google Cloud untuk proyek `umroh-app-database`. Berikan izin deployment Firestore Rules dan Cloud Functions yang diperlukan, termasuk izin menggunakan service account runtime Functions. Terapkan prinsip hak akses minimum.
5. Simpan isi JSON key service account sebagai GitHub repository secret bernama `FIREBASE_SERVICE_ACCOUNT_UMROH_APP_DATABASE` melalui **Settings → Secrets and variables → Actions → New repository secret**. Jangan memasukkan JSON key ke source code, issue, commit, atau chat.

### B. Deploy backend

Setelah perubahan ini sudah berada di branch `main`:

1. Buka tab **Actions** pada repository GitHub.
2. Pilih workflow **Deploy Firebase backend**.
3. Klik **Run workflow** pada branch `main`.
4. Pilih konfirmasi `yes` hanya setelah dokumen Admin dan profil pengguna lama diperiksa.
5. Jalankan workflow dan periksa hasilnya. Workflow ini melakukan deploy `firestore.rules` dan Cloud Functions saja.

Alternatif menggunakan Firebase CLI dari komputer yang sudah login dengan akun Google berizin:

```bash
npm --prefix functions install
firebase deploy --only firestore:rules,functions --project umroh-app-database
```

### C. Deploy frontend

`firebase.json` pada repository ini belum memiliki konfigurasi Firebase Hosting. Karena itu workflow backend tidak menerbitkan `index.html`. Frontend perlu diterbitkan melalui hosting yang saat ini digunakan aplikasi. Jangan menganggap backend deployment otomatis memperbarui website.

Setelah backend dan frontend diterbitkan, login sebagai Admin dan uji menu Manajemen Pengguna. Buat akun uji Staff dan Viewer, lalu periksa hak aksesnya sebelum penggunaan staf secara luas.

## Catatan keamanan dan operasional

- Firestore Rules menolak seluruh penulisan langsung ke koleksi `users`. Pembuatan, penonaktifan, dan penghapusan akun dilakukan oleh Cloud Functions menggunakan Firebase Admin SDK.
- Cloud Function `scanKtpDocument` kini mensyaratkan profil aktif dengan role Admin atau Staff.
- Saat akun dinonaktifkan, field `aktif` diubah menjadi `false` lebih dahulu sehingga Firestore Rules menolak token yang masih tersisa; akun Authentication juga ditandai disabled.
- Firebase Web API key yang tertanam pada frontend bukan password Admin atau service-account key. Tetap batasi API key melalui pengaturan Google Cloud (HTTP referrer dan API restriction) sesuai domain hosting aplikasi.
- Jangan pernah menaruh service-account JSON atau private key di repository/frontend.
- Cloud Functions memerlukan billing dan konfigurasi Google Cloud/IAM yang sesuai untuk deploy dan menjalankan OCR.
- Jalankan pengujian role di staging/emulator terlebih dahulu bila memungkinkan. Periksa semua koleksi tambahan sebelum menerapkan Rules karena koleksi yang tidak disebutkan akan tertolak.
