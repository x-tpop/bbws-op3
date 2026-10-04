// ============================================================
// PENGAJUAN.JS v2.3 — Sakit / Izin / Dinas Luar / Lupa Absen
// PATCH v2.3:
//  • Delegasi klik [data-pengajuan] dipasang SAAT FILE LOAD
//    (tidak tergantung initPresensi — tombol selalu hidup)
//  • Binding elemen modal SEKALI saja (modal di luar section,
//    tidak dirender ulang SPA → flag __pjElBound anti-numpuk)
//  • openPengajuan: null-guard + toast diagnosis bila markup hilang
//  • Judul modal dinamis: "Pengajuan {jenis}"
//  • Status 'Menunggu/Disetujui' + kolom tanggal_mulai
//    (selaras verifikasi.js v2.1)
// Butuh helper: dbInsert, uploadFoto, compressImage, toast,
//               getSession, localDateStr, CONFIG
// ============================================================

const PJ_JENIS = {
  'Sakit':      { rentang:true,  jam:false, fotoWajib:true,  noSurat:false, surat:true  },
  'Izin':       { rentang:true,  jam:false, fotoWajib:false, noSurat:false, surat:false },
  'Dinas Luar': { rentang:true,  jam:false, fotoWajib:false, noSurat:true,  surat:true  },
  'Lupa Absen': { rentang:false, jam:true,  fotoWajib:false, noSurat:false, surat:false }
};
const PJ_KUOTA = 4;
const pjState = { jenis:null, session:null, foto:null, surat:null, terpakai:0, busy:false };

function pjEl(id){ return document.getElementById(id); }

// ============================================================
// ★ v2.3: DELEGASI KLIK GLOBAL — dipasang saat file dimuat.
// Dokumen selalu ada; tombol boleh muncul belakangan (SPA).
// ============================================================
if (!window.__pjDocBound) {
  window.__pjDocBound = true;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pengajuan]');
    if (!b) return;
    e.preventDefault();
    openPengajuan(b.dataset.pengajuan);
  });
  console.log('[pengajuan] delegasi klik aktif');
}

// ============================================================
// INIT — dipanggil initPresensi; aman dipanggil berulang.
// ★ v2.3: modal berada DI LUAR section (persisten), jadi binding
// elemennya cukup SEKALI — flag di elemen modal anti-numpuk.
// ============================================================
async function initPengajuan(session) {
  pjState.session = session;

  const modal = pjEl('pjModal');
  if (modal && !modal.dataset.pjElBound) {
    modal.dataset.pjElBound = '1';

    pjEl('pjBtnClose')?.addEventListener('click', closePengajuan);
    modal.addEventListener('click', e => { if (e.target === modal) closePengajuan(); });

    pjEl('pjTanggal')?.addEventListener('change', updateDurasi);
    pjEl('pjTanggalSelesai')?.addEventListener('change', updateDurasi);

    pjEl('pjBtnFotoCam')?.addEventListener('click', () => pjEl('pjFotoCamInput')?.click());
    pjEl('pjBtnFotoGal')?.addEventListener('click', () => pjEl('pjFotoGalInput')?.click());
    pjEl('pjBtnSurat')?.addEventListener('click', () => pjEl('pjSuratInput')?.click());
    pjEl('pjFotoRemove')?.addEventListener('click', clearPjFoto);
    pjEl('pjSuratRemove')?.addEventListener('click', clearPjSurat);

    bindPjFileInput('pjFotoCamInput', setPjFoto);
    bindPjFileInput('pjFotoGalInput', setPjFoto);
    bindPjFileInput('pjSuratInput',  setPjSurat);

    pjEl('pjBtnSubmit')?.addEventListener('click', submitPengajuan);

    console.log('[pengajuan] elemen modal ter-bound');
  }

  await refreshQuota();
}

async function refreshQuota() {
  try {
    const s = pjState.session || getSession();
    if (!s) return;
    const n = new Date();
    const awal = `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`;
    const { data } = await supabaseClient.from('pengajuan')
      .select('id').eq('id_pegawai', s.id_pegawai)
      .in('status', ['Menunggu','Disetujui'])
      .gte('tanggal_mulai', awal);
    pjState.terpakai = (data || []).length;
    const q = pjEl('pjQuotaModal');
    if (q) q.textContent = `${pjState.terpakai}/${PJ_KUOTA} terpakai bulan ini`;
  } catch (e) { console.warn('[pengajuan] quota:', e); }
}

function openPengajuan(jenis) {
  const cfg = PJ_JENIS[jenis];
  if (!cfg) { toast('Jenis pengajuan tidak dikenal: ' + jenis, 'error'); return; }

  // ★ v2.3: markup hilang → pesan jelas, bukan crash senyap
  if (!pjEl('pjModal') || !pjEl('pjJenisBadge')) {
    console.error('[pengajuan] pjModal / pjJenisBadge tidak ditemukan di DOM!');
    toast('Form pengajuan tidak tersedia — markup pjModal hilang', 'error');
    return;
  }

  pjState.jenis = jenis; pjState.foto = null; pjState.surat = null;

  pjEl('pjJenisBadge').textContent = jenis;
  // ★ v2.3: judul dinamis
  const t = pjEl('pjTitle'); if (t) t.textContent = 'Pengajuan ' + jenis;

  pjEl('pjAlasan').value = '';
  const noSurat = pjEl('pjNoSurat'); if (noSurat) noSurat.value = '';
  const today = localDateStr();
  pjEl('pjTanggal').value = today;
  pjEl('pjTanggalSelesai').value = today;
  pjEl('pjJamHadir').value = '';
  pjEl('pjJamPulang').value = '';

  pjEl('pjSelesaiWrap').style.display = cfg.rentang ? '' : 'none';
  pjEl('pjJamWrap').hidden = !cfg.jam;
  pjEl('pjNoSuratWrap').style.display = cfg.noSurat ? '' : 'none';
  pjEl('pjFotoReq').style.display = cfg.fotoWajib ? '' : 'none';
  pjEl('pjSuratWrap').style.display = cfg.surat ? '' : 'none';
  clearPjFoto(); clearPjSurat();

  updateDurasi();
  refreshQuota();
  pjEl('pjModal').classList.add('open');
  if (window.refreshIcons) window.refreshIcons();
  console.log('[pengajuan] modal dibuka:', jenis);
}

function closePengajuan() { pjEl('pjModal')?.classList.remove('open'); }

function updateDurasi() {
  const cfg = PJ_JENIS[pjState.jenis] || {};
  const d = pjEl('pjDurasi');
  if (!d) return;
  if (!cfg.rentang) { d.value = '1 hari'; return; }
  const a = pjEl('pjTanggal').value, b = pjEl('pjTanggalSelesai').value;
  if (!a || !b) { d.value = '—'; return; }
  const diff = Math.round((new Date(b) - new Date(a)) / 86400000) + 1; // inklusif
  d.value = diff > 0 ? `${diff} hari` : '⚠ tanggal tidak valid';
}

function bindPjFileInput(id, cb) {
  const inp = pjEl(id); if (!inp) return;
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0]; if (!f) return;
    try {
      const b64 = await fileToBase64(f);
      const comp = await compressImage(b64, CONFIG.FOTO_MAX_WIDTH, CONFIG.FOTO_QUALITY);
      cb(comp);
    } catch (e) { toast('Gagal memuat gambar', 'error'); }
    inp.value = '';
  });
}
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej;
    r.readAsDataURL(file);
  });
}
function setPjFoto(b64)  { pjState.foto = b64;  const i = pjEl('pjFotoPreviewImg');  if (i) i.src = b64;  pjEl('pjFotoPreview').hidden = false; }
function clearPjFoto()   { pjState.foto = null; pjEl('pjFotoPreview').hidden = true; }
function setPjSurat(b64) { pjState.surat = b64; const i = pjEl('pjSuratPreviewImg'); if (i) i.src = b64; pjEl('pjSuratPreview').hidden = false; }
function clearPjSurat()  { pjState.surat = null; pjEl('pjSuratPreview').hidden = true; }

async function submitPengajuan() {
  if (pjState.busy) return;
  const s = pjState.session || getSession();
  const cfg = PJ_JENIS[pjState.jenis];
  if (!cfg) return;
  const jenis = pjState.jenis;

  const alasan = pjEl('pjAlasan').value.trim();
  const tgl  = pjEl('pjTanggal').value;
  const tglS = cfg.rentang ? (pjEl('pjTanggalSelesai').value || tgl) : tgl;
  const durasi = cfg.rentang ? Math.max(1, Math.round((new Date(tglS) - new Date(tgl)) / 86400000) + 1) : 1;

  // ---- VALIDASI ----
  if (!tgl) return toast('Tanggal wajib diisi', 'warn');
  if (cfg.rentang && tglS < tgl) return toast('Tanggal akhir lebih awal dari tanggal mulai', 'warn');
  if (alasan.length < 10) return toast('Keterangan minimal 10 karakter', 'warn');
  if (cfg.fotoWajib && !pjState.foto) return toast(`Foto dokumen wajib untuk pengajuan ${jenis}`, 'warn');
  if (cfg.noSurat && !pjEl('pjNoSurat').value.trim()) return toast('No. Surat wajib diisi', 'warn');
  if (cfg.jam && !pjEl('pjJamHadir').value && !pjEl('pjJamPulang').value)
    return toast('Isi minimal salah satu jam (hadir/pulang)', 'warn');
  if (pjState.terpakai >= PJ_KUOTA) return toast('Kuota pengajuan bulan ini habis (4×)', 'error');

  pjState.busy = true;
  const btn = pjEl('pjBtnSubmit'); btn.disabled = true;
  const ld = pjEl('pjLoading'); if (ld) ld.hidden = false;

  try {
    // Anti-duplikat: Lupa Absen hanya jika tanggal itu belum ada jam masuk
    if (jenis === 'Lupa Absen') {
      const { data: ex } = await supabaseClient.from('presensi')
        .select('jam_masuk').eq('id_pegawai', s.id_pegawai).eq('tanggal', tgl).maybeSingle();
      if (ex?.jam_masuk) throw new Error('Tanggal tersebut sudah memiliki presensi masuk');
    }

    // Upload lampiran
    let fotoUrl = null, suratUrl = null;
    const stamp = Date.now();
    const folder = `Pengajuan/${tgl.slice(0,7)}/DI-${s.pegawai?.id_di || 'X'}`;
    if (pjState.foto) {
      const up = await uploadFoto(pjState.foto, `pg_${s.username}_${tgl}_${stamp}.jpg`, folder);
      if (!up.success) throw new Error(up.error || 'Upload foto gagal');
      fotoUrl = up.linkLh3;
    }
    if (pjState.surat) {
      const up = await uploadFoto(pjState.surat, `pg_surat_${s.username}_${tgl}_${stamp}.jpg`, folder);
      if (!up.success) throw new Error(up.error || 'Upload surat gagal');
      suratUrl = up.linkLh3;
    }

    await dbInsert('pengajuan', {
      id_pegawai: s.id_pegawai,
      jenis,
      tanggal_mulai: tgl,
      tanggal_selesai: tglS,
      durasi,
      jam_hadir: pjEl('pjJamHadir').value || null,
      jam_pulang: pjEl('pjJamPulang').value || null,
      no_surat: pjEl('pjNoSurat').value.trim() || null,
      alasan,
      foto: fotoUrl,
      surat: suratUrl,
      status: 'Menunggu'
    });

    closePengajuan();
    toast('Pengajuan terkirim — menunggu verifikasi', 'success');
    await refreshQuota();
    // Halaman presensi langsung sadar ada pengajuan pending hari ini
    if (typeof window.refreshPengajuanAktif === 'function') {
      try { await window.refreshPengajuanAktif(); } catch (e) {}
    }
  } catch (err) {
    toast('Gagal: ' + err.message, 'error');
  } finally {
    pjState.busy = false; btn.disabled = false;
    if (ld) ld.hidden = true;
  }
}

window.initPengajuan = initPengajuan;
window.closePengajuan = closePengajuan;
window.openPengajuan = openPengajuan;
window.refreshPengajuanQuota = refreshQuota;
