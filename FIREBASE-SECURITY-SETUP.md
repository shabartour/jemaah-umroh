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

1. Periksa dokumen Admin pertama di `users/{UID}` dan pastikan field `role = "Admin"` serta `aktif = true`.
2. Pastikan Firebase CLI sudah login ke akun yang memiliki akses proyek `umroh-app-database`.
3. Dari root repository, jalankan:

   ```bash
   npm --prefix functions install
   firebase deploy --only firestore:rules,functions
   ```

4. Setelah deployment berhasil, deploy ulang frontend `index.html` dan folder `assets` ke hosting aplikasi.
5. Login kembali sebagai Admin dan uji menu Manajemen Pengguna. Buat akun uji Staff dan Viewer sebelum memindahkan seluruh staf.

## Catatan keamanan dan operasional

- Firestore Rules menolak seluruh penulisan langsung ke koleksi `users`. Pembuatan, penonaktifan, dan penghapusan akun dilakukan oleh Cloud Functions menggunakan Firebase Admin SDK.
- Cloud Function `scanKtpDocument` kini mensyaratkan profil aktif dengan role Admin atau Staff.
- Saat akun dinonaktifkan, field `aktif` diubah menjadi `false` lebih dahulu sehingga Firestore Rules menolak token yang masih tersisa; akun Authentication juga ditandai disabled.
- Firebase Web API key yang tertanam pada frontend bukan password Admin atau service-account key. Tetap batasi API key melalui pengaturan Google Cloud (HTTP referrer dan API restriction) sesuai domain hosting aplikasi.
- Jangan pernah menaruh service-account JSON atau private key di repository/frontend.
- Cloud Functions memerlukan billing dan konfigurasi Google Cloud/IAM yang sesuai untuk deploy dan menjalankan OCR.
- Jalankan pengujian role di staging/emulator terlebih dahulu bila memungkinkan. Periksa semua koleksi tambahan sebelum menerapkan Rules karena koleksi yang tidak disebutkan akan tertolak.
