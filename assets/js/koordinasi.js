// ============================================================
// KOORDINASI.JS — Koordinasi Juru, Krosda, Atasan
// ============================================================

let koordinasiState = {
  tanggal: new Date().toISOString().slice(0, 10),
  jenisFilter: 'semua',
  list: [],
  pegawaiMap: {},
  diMap: {},
  fotoBase64: null,
  lokasi: null
};

// ============================================================
// LOAD MASTER DATA
// ============================================================
async function loadMasterKoordinasi() {
  const [pegawaiList, diList] = await Promise.all([
    dbSelect('pegawai', { select: 'id_pegawai,nomor_identitas,nama,jabatan,id_di' }),
    dbSelect('di', { select: 'id_di,nama_di' })
  ]);

  koordinasiState.pegawaiMap = {};
  pegawaiList.forEach(p => { koordinasiState.pegawaiMap[p.id_pegawai] = p; });

  koordinasiState.diMap = {};
  diList.forEach(d => { koordinasiState.diMap[d.id_di] = d.nama_di; });
}

// ============================================================
// LOAD KOORDINASI
// ============================================================
async function loadKoordinasiData() {
  const session = getSession();
  if (!session) return;

  let query = supabaseClient
    .from('koordinasi')
    .select('*')
    .eq('tanggal', koordinasiState.tanggal)
    .order('created_at', { ascending: false });

  // Staf Pengamat: hanya koordinasi sendiri
  if (session.role === 'staf_pengamat' && session.id_pegawai) {
    query = query.eq('id_pegawai', session.id_pegawai);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Load koordinasi error:', error);
    return;
  }

  let list = data || [];
  if (koordinasiState.jenisFilter !== 'semua') {
    list = list.filter(k => k.jenis === koordinasiState.jenisFilter);
  }

  koordinasiState.list = list;
  renderKoordinasiList();
}

// ============================================================
// RENDER LIST
// ============================================================
function renderKoordinasiList() {
  const tbody = document.getElementById('koordinasiTbody');
  if (!tbody) return;

  const list = koordinasiState.list;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty">
            <i data-lucide="inbox"></i>
            <div>Belum ada koordinasi untuk tanggal ini.</div>
          </div>
        </td>
      </tr>`;
    if (window.refreshIcons) window.refreshIcons();
    return;
  }

  tbody.innerHTML = list.map(k => {
    const pegawai = koordinasiState.pegawaiMap[k.id_pegawai] || {};

    return `
      <tr>
        <td>
          <div style="font-weight:700">${pegawai.nama || '-'}</div>
          <div style="font-size:12px;color:var(--muted)">${pegawai.nomor_identitas || '-'}</div>
        </td>
        <td><span class="chip-o">${k.jenis}</span></td>
        <td>
          <div style="font-weight:600">${k.nama_pihak || '-'}</div>
          <div style="font-size:12px;color:var(--muted)">${k.instansi || '-'}</div>
        </td>
        <td style="max-width:280px">
          <div style="font-size:13px;font-weight:600">${k.topik || '-'}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">${k.hasil || ''}</div>
        </td>
        <td>
          ${k.foto_kegiatan ? `<img src="${k.foto_kegiatan}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;cursor:pointer" onclick="openFotoModal('${k.foto_kegiatan}', '${k.nama_pihak || ''}')">` : '<span style="color:var(--muted)">-</span>'}
        </td>
        <td><span class="badge b-ok"><span class="dot"></span>+${k.poin || 3}</span></td>
      </tr>
    `;
  }).join('');

  if (window.refreshIcons) window.refreshIcons();
}

// ============================================================
// BUKA FORM KOORDINASI
// ============================================================
function openFormKoordinasi() {
  const modal = document.getElementById('koordinasiModal');
  if (!modal) return;

  // Reset form
  document.getElementById('korJenis').value = '';
  document.getElementById('korNamaPihak').value = '';
  document.getElementById('korInstansi').value = '';
  document.getElementById('korHp').value = '';
  document.getElementById('korTopik').value = '';
  document.getElementById('korHasil').value = '';
  koordinasiState.fotoBase64 = null;

  // Reset preview
  document.getElementById('korPreview').hidden = true;
  document.getElementById('korCamWrap').hidden = false;
  document.getElementById('korBtnCapture').hidden = false;
  document.getElementById('korBtnRetake').hidden = true;
  document.getElementById('korBtnSubmit').hidden = true;

  modal.classList.add('open');

  // Init kamera & lokasi
  initCameraKoordinasi();
  initLocationKoordinasi();
}

function closeFormKoordinasi() {
  const modal = document.getElementById('koordinasiModal');
  if (modal) modal.classList.remove('open');
  if (typeof stopCamera === 'function') stopCamera();
}

// ============================================================
// KAMERA & LOKASI
// ============================================================
async function initCameraKoordinasi() {
  const video = document.getElementById('korVideo');
  if (!video) return;
  const ok = await startCamera(video, 'environment');
  if (!ok) {
    // Kalau gagal, sembunyikan kamera
    document.getElementById('korCamWrap').style.display = 'none';
  }
}

async function initLocationKoordinasi() {
  try {
    const loc = await getLocation();
    koordinasiState.lokasi = loc;
    const locText = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)} (±${Math.round(loc.accuracy)}m)`;
    const el = document.getElementById('korCamLoc');
    if (el) el.textContent = '📍 ' + locText;
  } catch (err) {
    const el = document.getElementById('korCamLoc');
    if (el) el.textContent = '📍 Gagal deteksi lokasi';
  }
}

// ============================================================
// CAPTURE
// ============================================================
async function captureKoordinasi() {
  if (!koordinasiState.lokasi) {
    toast('Lokasi belum terdeteksi', 'warn');
    return;
  }

  const video = document.getElementById('korVideo');
  const base64 = await captureWithWatermark(video, koordinasiState.lokasi, 'Koordinasi');
  const compressed = await compressImage(base64, CONFIG.FOTO_MAX_WIDTH, CONFIG.FOTO_QUALITY);
  koordinasiState.fotoBase64 = compressed;

  document.getElementById('korPreviewImg').src = compressed;
  document.getElementById('korPreview').hidden = false;
  document.getElementById('korCamWrap').hidden = true;
  document.getElementById('korBtnCapture').hidden = true;
  document.getElementById('korBtnRetake').hidden = false;
  document.getElementById('korBtnSubmit').hidden = false;
  toast('Foto berhasil diambil', 'success');
}

// ============================================================
// SUBMIT
// ============================================================
async function submitKoordinasi() {
  const jenis = document.getElementById('korJenis').value;
  const namaPihak = document.getElementById('korNamaPihak').value.trim();
  const instansi = document.getElementById('korInstansi').value.trim();
  const noHp = document.getElementById('korHp').value.trim();
  const topik = document.getElementById('korTopik').value.trim();
  const hasil = document.getElementById('korHasil').value.trim();

  if (!jenis) { toast('Pilih jenis koordinasi', 'warn'); return; }
  if (!namaPihak) { toast('Nama pihak wajib diisi', 'warn'); return; }
  if (!topik) { toast('Topik wajib diisi', 'warn'); return; }

  const btn = document.getElementById('korBtnSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite"></span> Menyimpan...';

  try {
    const session = getSession();
    let fotoUrl = null;

    // Upload foto jika ada
    if (koordinasiState.fotoBase64) {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-');
      const namaFile = `koordinasi_${session.username}_${koordinasiState.tanggal}_${timestamp}.jpg`;
      const folderPath = `Koordinasi/${koordinasiState.tanggal.slice(0, 7)}/DI-${session.pegawai?.id_di || 'X'}`;
      
      const uploadResult = await uploadFoto(koordinasiState.fotoBase64, namaFile, folderPath);
      if (uploadResult.success) {
        fotoUrl = uploadResult.linkLh3;
      }
    }

    // Simpan ke Supabase
    await dbInsert('koordinasi', {
      id_pegawai: session.id_pegawai,
      tanggal: koordinasiState.tanggal,
      jenis: jenis,
      nama_pihak: namaPihak,
      instansi: instansi || null,
      topik: topik,
      hasil: hasil || null,
      foto_kegiatan: fotoUrl,
      poin: 3
    });

    toast('Koordinasi berhasil disimpan', 'success');
    closeFormKoordinasi();
    await loadKoordinasiData();

  } catch (err) {
    console.error(err);
    toast('Gagal: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="check"></i>Simpan Koordinasi';
    if (window.refreshIcons) window.refreshIcons();
  }
}

// ============================================================
// INIT
// ============================================================
async function initKoordinasi() {
  await loadMasterKoordinasi();
  await loadKoordinasiData();

  // Filter tanggal
  const tglInput = document.getElementById('korTanggal');
  if (tglInput) {
    tglInput.value = koordinasiState.tanggal;
    tglInput.addEventListener('change', async (e) => {
      koordinasiState.tanggal = e.target.value;
      await loadKoordinasiData();
    });
  }

  // Filter jenis
  const jenisSelect = document.getElementById('korFilterJenis');
  if (jenisSelect) {
    jenisSelect.addEventListener('change', async (e) => {
      koordinasiState.jenisFilter = e.target.value;
      await loadKoordinasiData();
    });
  }

  // Tombol refresh
  document.getElementById('korRefresh')?.addEventListener('click', loadKoordinasiData);

  // Tombol tambah
  document.getElementById('korBtnTambah')?.addEventListener('click', openFormKoordinasi);

  // Tombol close modal
  document.getElementById('korBtnClose')?.addEventListener('click', closeFormKoordinasi);

  // Tombol capture
  document.getElementById('korBtnCapture')?.addEventListener('click', captureKoordinasi);

  // Tombol retake
  document.getElementById('korBtnRetake')?.addEventListener('click', () => {
    koordinasiState.fotoBase64 = null;
    document.getElementById('korPreview').hidden = true;
    document.getElementById('korCamWrap').hidden = false;
    document.getElementById('korBtnCapture').hidden = false;
    document.getElementById('korBtnRetake').hidden = true;
    document.getElementById('korBtnSubmit').hidden = true;
  });

  // Tombol submit
  document.getElementById('korBtnSubmit')?.addEventListener('click', submitKoordinasi);
}

// ============================================================
// EXPOSE GLOBAL
// ============================================================
window.initKoordinasi = initKoordinasi;
window.openFormKoordinasi = openFormKoordinasi;
window.closeFormKoordinasi = closeFormKoordinasi;
window.submitKoordinasi = submitKoordinasi;
window.captureKoordinasi = captureKoordinasi;
window.loadKoordinasiData = loadKoordinasiData;