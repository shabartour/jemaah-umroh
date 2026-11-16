#!/usr/bin/env python3
"""Add public-portal package fields to the existing Shabar Tour admin app.

Run from the repository root:
    python apply-package-portal-fields.py
Or pass a custom file:
    python apply-package-portal-fields.py --file path/to/index.html

The script creates a timestamped backup and refuses to patch if expected anchors
are absent or duplicated.
"""
from __future__ import annotations
import argparse
from datetime import datetime
from pathlib import Path
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--file', default='index.html', help='Path to the app index.html')
args = parser.parse_args()
path = Path(args.file)
if not path.is_file():
    sys.exit(f'File tidak ditemukan: {path.resolve()}')

source = path.read_text(encoding='utf-8')
if 'inputHotelMakkah' in source:
    sys.exit('Field portal paket sudah terpasang. Tidak ada perubahan dilakukan.')

replacements = [
    (
        '            <button id="btnSavePaket"',
        '''            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Hotel Makkah</label>
                <input type="text" id="inputHotelMakkah" placeholder="Nama hotel di Makkah"
                       class="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none">
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Hotel Madinah</label>
                <input type="text" id="inputHotelMadinah" placeholder="Nama hotel di Madinah"
                       class="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none">
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-700 mb-1">Kuota Kursi</label>
              <input type="number" id="inputKuotaKursi" min="1" step="1" placeholder="Contoh: 45"
                     class="w-full text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none">
            </div>

            <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
              <label class="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <input type="checkbox" id="inputPortalVisible" class="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500">
                Tampilkan paket di Portal Layanan Jemaah
              </label>
              <div>
                <label class="block text-xs font-semibold text-slate-700 mb-1">Status Publikasi Portal</label>
                <select id="inputStatusPaket"
                        class="w-full text-xs bg-white border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:outline-none">
                  <option value="draft">Draft — belum ditampilkan</option>
                  <option value="published">Dipublikasikan</option>
                  <option value="closed">Ditutup</option>
                  <option value="archived">Arsip</option>
                </select>
                <p class="mt-1 text-[10px] text-slate-500">Paket hanya tampil jika dicentang dan status publikasi = Dipublikasikan.</p>
              </div>
            </div>

            <button id="btnSavePaket"'''
    ),
    (
        "      document.getElementById('inputProgram').value = paket.program || paket.durasi || '';",
        """      document.getElementById('inputProgram').value = paket.program || paket.durasi || '';
      document.getElementById('inputHotelMakkah').value = paket.hotelMakkah || '';
      document.getElementById('inputHotelMadinah').value = paket.hotelMadinah || '';
      document.getElementById('inputKuotaKursi').value = Number.isFinite(Number(paket.kuotaKursi)) && Number(paket.kuotaKursi) > 0 ? String(paket.kuotaKursi) : '';
      document.getElementById('inputPortalVisible').checked = paket.portalVisible === true;
      document.getElementById('inputStatusPaket').value = ['draft', 'published', 'closed', 'archived'].includes(paket.statusPaket) ? paket.statusPaket : 'draft';"""
    ),
    (
        "      const program = document.getElementById('inputProgram').value.trim();",
        """      const program = document.getElementById('inputProgram').value.trim();
      const hotelMakkah = document.getElementById('inputHotelMakkah').value.trim();
      const hotelMadinah = document.getElementById('inputHotelMadinah').value.trim();
      const kuotaInput = document.getElementById('inputKuotaKursi').value;
      const kuotaKursi = kuotaInput === '' ? null : Number(kuotaInput);
      const portalVisible = document.getElementById('inputPortalVisible').checked;
      const statusPaket = document.getElementById('inputStatusPaket').value;

      if (kuotaKursi !== null && (!Number.isInteger(kuotaKursi) || kuotaKursi < 1)) {
        showAlert('Kuota kursi harus berupa bilangan bulat minimal 1.', 'error');
        return;
      }"""
    ),
    (
        "        program: program || '-',\n        updatedAt: serverTimestamp()",
        """        program: program || '-',
        hotelMakkah: hotelMakkah || '',
        hotelMadinah: hotelMadinah || '',
        kuotaKursi: kuotaKursi,
        portalVisible: portalVisible,
        statusPaket: statusPaket,
        updatedAt: serverTimestamp()"""
    ),
]

for old, new in replacements:
    count = source.count(old)
    if count != 1:
        sys.exit(f'Patch dibatalkan: anchor harus ditemukan tepat 1 kali, ditemukan {count}: {old[:90]!r}')
    source = source.replace(old, new, 1)

backup = path.with_name(path.name + '.backup-' + datetime.now().strftime('%Y%m%d-%H%M%S'))
backup.write_text(path.read_text(encoding='utf-8'), encoding='utf-8')
path.write_text(source, encoding='utf-8')
print(f'Berhasil memperbarui: {path.resolve()}')
print(f'Backup dibuat: {backup.resolve()}')
print('Field tambahan: hotelMakkah, hotelMadinah, kuotaKursi, portalVisible, statusPaket')
print('Default aman: portalVisible=false dan statusPaket=draft untuk paket baru.')
