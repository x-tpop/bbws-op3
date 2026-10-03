// ============================================================
// PENGAJUAN.JS — Sakit / Izin / Dinas Luar / Lupa Absen
// Kuota: maks 4×/bulan (semua jenis gabung) — cek di client
// Verifikasi: admin / staf_pengamat (halaman Verifikasi — nanti)
// ============================================================

const PJ_MAX_BULAN = 4;

const PJ_META = {
  'Sakit':      { fotoWajib:false, suratWajib:true,  rentang:true  },
  'Izin':       { fotoWajib:false, suratWajib:true,  rentang:true  },
  'Dinas Luar': { fotoWajib:true,  suratWajib:false, rentang:true  },
  'Lupa Absen': { fotoWajib:true,  suratWajib:false, rentang:false }
};

const pjState = {
  session: null, jenis: null,
  fotoBase64: null, suratBase64: null,
  kuotaTerpakai: 0
};

function pjEl(id){ return document.getElementById(id); }

async function initPengajuan(session){
  pjState.session = session || getSession();
  if (!pjState.session) return;

  await pjRefreshQuota();

  // Ikon aksi cepat
  document.querySelectorAll('[data-pengajuan]').forEach(btn => {
    const nb = btn.cloneNode(true);
    btn.parentNode.replaceChild(nb, btn);
    nb.addEventListener('click', () => openPengajuan(nb.dataset.pengajuan));
  });

  // Modal
  pjEl('pjBtnClose')?.addEventListener('click', pjClose);
  pjEl('pjModal')?.addEventListener('click', e => { if (e.target === pjEl('pjModal')) pjClose(); });
  pjEl('pjBtnFotoCam')?.addEventListener('click', () => pjEl('pjFotoCamInput')?.click());
  pjEl('pjBtnFotoGal')?.addEventListener('click', () => pjEl('pjFotoGalInput')?.click());
  pjEl('pjBtnSurat')?.addEventListener('click', () => pjEl('pjSuratInput')?.click());
  pjEl('pjFotoRemove')?.addEventListener('click', pjResetFoto);
  pjEl('pjSuratRemove')?.addEventListener('click', pjResetSurat);

  const readImg = (inputId, cb) => {
    const inp = pjEl(inputId);
    if (!inp) return;
    inp.addEventListener('change', e => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) { toast('Ukuran file max 8 MB', 'warn'); return; }
      const reader = new FileReader();
      reader.onload = async ev => cb(await compressImage(ev.target.result, 1000, 0.7));
      reader.readAsDataURL(f);
    });
  };
  readImg('pjFotoCamInput', b64 => { pjState.fotoBase64 = b64; pjShowFoto(b64); });
  readImg('pjFotoGalInput', b64 => { pjState.fotoBase64 = b64; pjShowFoto(b64); });
  readImg('pjSuratInput',   b64 => { pjState.suratBase64 = b64; pjShowSurat(b64); });

  pjEl('pjBtnSubmit')?.addEventListener('click', submitPengajuan);
}

async function pjRefreshQuota(){
  try {
    const s = pjState.session;
    const ym = localDateStr().slice(0, 7);
    const [y, m] = ym.split('-').map(Number);
    const endStr = localDateStr(new Date(y, m, 0));
    const { count } = await supabaseClient.from('pengajuan')
      .select('*', { count: 'exact', head: true })
      .eq('id_pegawai', s.id_pegawai)
      .gte('tanggal_mulai', ym + '-01')
      .lte('tanggal_mulai', endStr);
    pjState.kuotaTerpakai = count || 0;
  } catch (e) { pjState.kuotaTerpakai = 0; }

  const badge = pjEl('pjQuota');
  if (badge) {
    badge.textContent = `${pjState.kuotaTerpakai}/${PJ_MAX_BULAN} terpakai`;
    badge.classList.toggle('full', pjState.kuotaTerpakai >= PJ_MAX_BULAN);
  }
  const m2 = pjEl('pjQuotaModal');
  if (m2) m2.textContent = `${pjState.kuotaTerpakai}/${PJ_MAX_BULAN} terpakai bulan ini`;
}

function openPengajuan(jenis){
  const meta = PJ_META[jenis];
  if (!meta) return;
  if (pjState.kuotaTerpakai >= PJ_MAX_BULAN) {
    toast(`Kuota pengajuan habis (maks ${PJ_MAX_BULAN}×/bulan)`, 'warn');
    return;
  }
  pjState.jenis = jenis;
  pjState.fotoBase64 = null;
  pjState.suratBase64 = null;

  pjEl('pjTitle').textContent = 'Pengajuan — ' + jenis;
  pjEl('pjJenisBadge').textContent = jenis;
  pjEl('pjAlasan').value = '';

  const today = localDateStr();
  pjEl('pjTanggal').value = today;
  pjEl('pjTanggalSelesai').value = today;
  pjEl('pjJamHadir').value = '';
  pjEl('pjJamPulang').value = '';

  pjResetFoto(); pjResetSurat();

  pjEl('pjSelesaiWrap').hidden = !meta.rentang;
  pjEl('pjJamWrap').hidden = meta.rentang;
  pjEl('pjSuratWrap').style.display = (jenis === 'Sakit' || jenis === 'Izin') ? 'flex' : 'none';
  pjEl('pjFotoWrap').style.display  = meta.fotoWajib ? 'flex' : 'none';
  pjEl('pjSuratReq').style.display  = meta.suratWajib ? '' : 'none';
  pjEl('pjFotoReq').style.display   = meta.fotoWajib ? '' : 'none';

  pjEl('pjModal').classList.add('open');
  if (window.refreshIcons) window.refreshIcons();
}

function pjClose(){ pjEl('pjModal')?.classList.remove('open'); }

function pjShowFoto(b64){
  pjEl('pjFotoPreviewImg').src = b64;
  pjEl('pjFotoPreview').hidden = false;
  pjEl('pjFotoBtns').style.display = 'none';
}
function pjResetFoto(){
  pjState.fotoBase64 = null;
  if (pjEl('pjFotoPreview')) pjEl('pjFotoPreview').hidden = true;
  if (pjEl('pjFotoBtns')) pjEl('pjFotoBtns').style.display = 'flex';
  const a = pjEl('pjFotoCamInput'), b = pjEl('pjFotoGalInput');
  if (a) a.value = ''; if (b) b.value = '';
}
function pjShowSurat(b64){
  pjEl('pjSuratPreviewImg').src = b64;
  pjEl('pjSuratPreview').hidden = false;
  pjEl('pjSuratBtns').style.display = 'none';
}
function pjResetSurat(){
  pjState.suratBase64 = null;
  if (pjEl('pjSuratPreview')) pjEl('pjSuratPreview').hidden = true;
  if (pjEl('pjSuratBtns')) pjEl('pjSuratBtns').style.display = 'flex';
  const a = pjEl('pjSuratInput'); if (a) a.value = '';
}

async function submitPengajuan(){
  const meta = PJ_META[pjState.jenis];
  if (!meta) return;

  const alasan  = (pjEl('pjAlasan')?.value || '').trim();
  const tanggal = pjEl('pjTanggal')?.value;
  if (!tanggal) { toast('Tanggal wajib diisi', 'warn'); return; }

  let tanggalSelesai = tanggal;
  if (meta.rentang) {
    tanggalSelesai = pjEl('pjTanggalSelesai')?.value || tanggal;
    if (tanggalSelesai < tanggal) { toast('Tanggal selesai < tanggal mulai', 'warn'); return; }
  }

  let jamHadir = null, jamPulang = null;
  if (!meta.rentang) {
    jamHadir  = pjEl('pjJamHadir')?.value  || null;
    jamPulang = pjEl('pjJamPulang')?.value || null;
    if (!jamHadir && !jamPulang) { toast('Isi minimal jam hadir atau jam pulang', 'warn'); return; }
  }

  if (!alasan || alasan.length < 10) { toast('Tuliskan alasan minimal 10 karakter', 'warn'); return; }
  if (meta.fotoWajib  && !pjState.fotoBase64)  { toast('Foto wajib diupload', 'warn'); return; }
  if (meta.suratWajib && !pjState.suratBase64) { toast('Surat pendukung wajib diupload', 'warn'); return; }
  if (pjState.kuotaTerpakai >= PJ_MAX_BULAN)   { toast('Kuota pengajuan bulan ini habis', 'warn'); return; }

  const btn = pjEl('pjBtnSubmit');
  btn.disabled = true;
  if (pjEl('pjLoading')) pjEl('pjLoading').hidden = false;

  try {
    const s = pjState.session;
    const ym = tanggal.slice(0, 7);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const folder = `Pengajuan/${ym}/DI-${s.pegawai?.id_di || 'X'}`;

    let fotoUrl = null, suratUrl = null;
    if (pjState.fotoBase64) {
      const up = await uploadFoto(pjState.fotoBase64, `pengajuan_${s.username}_${tanggal}_${ts}.jpg`, folder);
      if (!up.success) throw new Error(up.error || 'Upload foto gagal');
      fotoUrl = up.linkLh3;
    }
    if (pjState.suratBase64) {
      const up = await uploadFoto(pjState.suratBase64, `surat_${s.username}_${tanggal}_${ts}.jpg`, folder);
      if (!up.success) throw new Error(up.error || 'Upload surat gagal');
      suratUrl = up.linkLh3;
    }

    await dbInsert('pengajuan', {
      id_pegawai: s.id_pegawai,
      jenis: pjState.jenis,
      tanggal_mulai: tanggal,
      tanggal_selesai: tanggalSelesai,
      jam_hadir: jamHadir,
      jam_pulang: jamPulang,
      alasan: alasan,
      foto: fotoUrl,
      surat: suratUrl,
      status: 'Menunggu'
    });

    toast('Pengajuan terkirim — menunggu verifikasi', 'success');
    pjClose();
    await pjRefreshQuota();

  } catch (err) {
    console.error(err);
    toast('Gagal: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    if (pjEl('pjLoading')) pjEl('pjLoading').hidden = true;
  }
}

window.initPengajuan = initPengajuan;
window.openPengajuan = openPengajuan;
window.pjClose = pjClose;
