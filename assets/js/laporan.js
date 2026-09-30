// ============================================================
// LAPORAN.JS — Laporan Harian
// ============================================================

let laporanState = {
  tanggal: new Date().toISOString().slice(0, 10),
  statusFilter: 'semua',
  list: [],
  pegawaiMap: {},
  fotoBase64: null,
  lokasi: null
};

// ============================================================
// LOAD MASTER DATA
// ============================================================
async function loadMasterLaporan() {
  const pegawaiList = await dbSelect('pegawai', { select: 'id_pegawai,nomor_identitas,nama,jabatan,id_di' });
  laporanState.pegawaiMap = {};
  pegawaiList.forEach(p => { laporanState.pegawaiMap[p.id_pegawai] = p; });
}

// ============================================================
// LOAD LAPORAN
// ============================================================
async function loadLaporanData() {
  const session = getSession();
  if (!session) return;

  let query = supabaseClient
    .from('laporan')
    .select('*')
    .eq('tanggal', laporanState.tanggal)
    .order('created_at', { ascending: false });

  // Staf Pengamat/PPA/Pekarya: hanya laporan sendiri
  if (session.role !== 'admin' && session.role !== 'ppk') {
    if (session.id_pegawai) {
      query = query.eq('id_pegawai', session.id_pegawai);
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error('Load laporan error:', error);
    return;
  }

  let list = data || [];
  if (laporanState.statusFilter !== 'semua') {
    list = list.filter(l => l.status === laporanState.statusFilter);
  }

  laporanState.list = list;
  renderLaporanList();
}

// ============================================================
// RENDER LIST
// ============================================================
function renderLaporanList() {
  const tbody = document.getElementById('laporanTbody');
  if (!tbody) return;

  const list = laporanState.list;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4">
          <div class="empty">
            <i data-lucide="inbox"></i>
            <div>Belum ada laporan untuk tanggal ini.</div>
          </div>
        </td>
      </tr>`;
    if (window.refreshIcons) window.refreshIcons();
    return;
  }

  tbody.innerHTML = list.map(l => {
    let statusBadge = '<span class="badge b-wait"><span class="dot"></span>Menunggu</span>';
    if (l.status === 'Disetujui') {
      statusBadge = '<span class="badge b-ok"><span class="dot"></span>Disetujui</span>';
    } else if (l.status === 'Revisi') {
      statusBadge = '<span class="badge b-rev"><span class="dot"></span>Revisi</span>';
    }

    return `
      <tr>
        <td style="max-width:220px">
          <div style="font-weight:700">${l.judul || '-'}</div>
          <div style="font-size:12px;color:var(--muted)">${l.jenis_laporan || '-'} · ${l.tanggal}</div>
        </td>
        <td><span class="chip-o">${l.jenis_laporan || '-'}</span></td>
        <td>${statusBadge}</td>
        <td>
          ${l.foto_kegiatan ? `<img src="${l.foto_kegiatan}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;cursor:pointer" onclick="openFotoModal('${l.foto_kegiatan}', 'Laporan')">` : '<span style="color:var(--muted)">-</span>'}
        </td>
      </tr>
    `;
  }).join('');

  if (window.refreshIcons) window.refreshIcons();
}

// ============================================================
// KAMERA & LOKASI
// ============================================================
async function initCameraLaporan() {
  const video = document.getElementById('lapVideo');
  if (!video) return;
  const ok = await startCamera(video, 'environment');
  if (!ok) {
    const wrap = document.getElementById('lapCamWrap');
    if (wrap) wrap.style.display = 'none';
  }
}

async function initLocationLaporan() {
  try {
    const loc = await getLocation();
    laporanState.lokasi = loc;
    const locText = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`;
    const el = document.getElementById('lapCamLoc');
    if (el) el.textContent = '📍 ' + locText;
  } catch (err) {
    const el = document.getElementById('lapCamLoc');
    if (el) el.textContent = '📍 Gagal deteksi lokasi';
  }
}

// ============================================================
// CAPTURE
// ============================================================
async function captureLaporan() {
  if (!laporanState.lokasi) {
    toast('Lokasi belum terdeteksi', 'warn');
    return;
  }
  const video = document.getElementById('lapVideo');
  const base64 = await captureWithWatermark(video, laporanState.lokasi, 'Laporan');
  const compressed = await compressImage(base64, CONFIG.FOTO_MAX_WIDTH, CONFIG.FOTO_QUALITY);
  laporanState.fotoBase64 = compressed;

  document.getElementById('lapPreviewImg').src = compressed;
  document.getElementById('lapPreview').hidden = false;
  document.getElementById('lapCamWrap').hidden = true;
  document.getElementById('lapBtnCapture').hidden = true;
  document.getElementById('lapBtnRetake').hidden = false;
  toast('Foto berhasil diambil', 'success');
}

// ============================================================
// SUBMIT
// ============================================================
async function submitLaporan() {
  const judul = document.getElementById('lapJudul').value.trim();
  const jenis = document.getElementById('lapJenis').value;
  const sifat = document.getElementById('lapSifat').value;
  const tanggal = document.getElementById('lapTanggal').value;
  const isi = document.getElementById('lapIsi').value.trim();

  if (!judul || judul.length < 8) { toast('Judul minimal 8 karakter', 'warn'); return; }
  if (!jenis) { toast('Pilih jenis laporan', 'warn'); return; }
  if (!isi || isi.length < 20) { toast('Uraian minimal 20 karakter', 'warn'); return; }

  const btn = document.getElementById('lapBtnSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite"></span> Mengirim...';

  try {
    const session = getSession();
    let fotoUrl = null;

    // Upload foto jika ada
    if (laporanState.fotoBase64) {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-');
      const namaFile = `laporan_${session.username}_${tanggal}_${timestamp}.jpg`;
      const folderPath = `Laporan/${tanggal.slice(0, 7)}/DI-${session.pegawai?.id_di || 'X'}`;
      
      const uploadResult = await uploadFoto(laporanState.fotoBase64, namaFile, folderPath);
      if (uploadResult.success) {
        fotoUrl = uploadResult.linkLh3;
      }
    }

    // Simpan ke Supabase
    await dbInsert('laporan', {
      id_pegawai: session.id_pegawai,
      tanggal: tanggal,
      jenis_laporan: jenis,
      judul: judul,
      isi_laporan: isi,
      sifat: sifat,
      foto_kegiatan: fotoUrl,
      status: 'Menunggu'
    });

    toast('Laporan berhasil dikirim', 'success');

    // Reset form
    document.getElementById('lapJudul').value = '';
    document.getElementById('lapJenis').value = '';
    document.getElementById('lapSifat').value = 'Normal';
    document.getElementById('lapIsi').value = '';
    document.getElementById('lapCount').textContent = '0';
    laporanState.fotoBase64 = null;
    document.getElementById('lapPreview').hidden = true;
    document.getElementById('lapCamWrap').hidden = false;
    document.getElementById('lapBtnCapture').hidden = false;
    document.getElementById('lapBtnRetake').hidden = true;

    await loadLaporanData();

  } catch (err) {
    console.error(err);
    toast('Gagal: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="send"></i>Kirim Laporan';
    if (window.refreshIcons) window.refreshIcons();
  }
}

// ============================================================
// INIT
// ============================================================
async function initLaporan() {
  // Set tanggal default
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('lapTanggal').value = today;
  document.getElementById('lapFilterTanggal').value = laporanState.tanggal;

  await loadMasterLaporan();
  await loadLaporanData();

  // Counter textarea
  document.getElementById('lapIsi')?.addEventListener('input', (e) => {
    document.getElementById('lapCount').textContent = e.target.value.length;
  });

  // Filter tanggal
  document.getElementById('lapFilterTanggal')?.addEventListener('change', async (e) => {
    laporanState.tanggal = e.target.value;
    await loadLaporanData();
  });

  // Filter status
  document.getElementById('lapFilterStatus')?.addEventListener('change', async (e) => {
    laporanState.statusFilter = e.target.value;
    await loadLaporanData();
  });

  // Tombol refresh
  document.getElementById('lapRefresh')?.addEventListener('click', loadLaporanData);

  // Tombol capture
  document.getElementById('lapBtnCapture')?.addEventListener('click', captureLaporan);

  // Tombol retake
  document.getElementById('lapBtnRetake')?.addEventListener('click', () => {
    laporanState.fotoBase64 = null;
    document.getElementById('lapPreview').hidden = true;
    document.getElementById('lapCamWrap').hidden = false;
    document.getElementById('lapBtnCapture').hidden = false;
    document.getElementById('lapBtnRetake').hidden = true;
  });

  // Tombol submit
  document.getElementById('lapBtnSubmit')?.addEventListener('click', submitLaporan);

  // Init kamera & lokasi
  await initCameraLaporan();
  await initLocationLaporan();
}

// ============================================================
// EXPOSE GLOBAL
// ============================================================
window.initLaporan = initLaporan;
window.submitLaporan = submitLaporan;
window.captureLaporan = captureLaporan;
window.loadLaporanData = loadLaporanData;