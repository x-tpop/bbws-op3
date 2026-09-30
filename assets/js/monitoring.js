// ============================================================
// MONITORING.JS — Monitoring PPA & Pekarya
// ============================================================

let monitoringState = {
  tanggal: new Date().toISOString().slice(0, 10),
  jenisFilter: 'semua',
  list: [],
  pegawaiMap: {},
  diMap: {},
  targetList: [],
  fotoBase64: null,
  lokasi: null
};

// ============================================================
// LOAD MASTER DATA
// ============================================================
async function loadMasterMonitoring() {
  const [pegawaiList, diList] = await Promise.all([
    dbSelect('pegawai', { select: 'id_pegawai,nomor_identitas,nama,jabatan,id_di,krosda' }),
    dbSelect('di', { select: 'id_di,nama_di' })
  ]);

  monitoringState.pegawaiMap = {};
  pegawaiList.forEach(p => { monitoringState.pegawaiMap[p.id_pegawai] = p; });

  monitoringState.diMap = {};
  diList.forEach(d => { monitoringState.diMap[d.id_di] = d.nama_di; });

  // Target: PPA & Pekarya di DI Staf Pengamat
  const session = getSession();
  if (session?.pegawai?.id_di) {
    monitoringState.targetList = pegawaiList.filter(p =>
      p.id_di === session.pegawai.id_di &&
      ['Petugas Pintu Air', 'Pekarya Pengairan'].includes(p.jabatan)
    );
  } else {
    monitoringState.targetList = pegawaiList.filter(p =>
      ['Petugas Pintu Air', 'Pekarya Pengairan'].includes(p.jabatan)
    );
  }
}

// ============================================================
// LOAD MONITORING
// ============================================================
async function loadMonitoringData() {
  const session = getSession();
  if (!session) return;

  let query = supabaseClient
    .from('monitoring')
    .select('*')
    .eq('tanggal', monitoringState.tanggal)
    .order('created_at', { ascending: false });

  // Staf Pengamat: hanya monitoring sendiri
  if (session.role === 'staf_pengamat' && session.id_pegawai) {
    query = query.eq('id_pegawai', session.id_pegawai);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Load monitoring error:', error);
    return;
  }

  let list = data || [];
  if (monitoringState.jenisFilter !== 'semua') {
    list = list.filter(m => m.jenis === monitoringState.jenisFilter);
  }

  monitoringState.list = list;
  renderMonitoringList();
}

// ============================================================
// RENDER LIST
// ============================================================
function renderMonitoringList() {
  const tbody = document.getElementById('monitoringTbody');
  if (!tbody) return;

  const list = monitoringState.list;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty">
            <i data-lucide="inbox"></i>
            <div>Belum ada monitoring untuk tanggal ini.</div>
          </div>
        </td>
      </tr>`;
    if (window.refreshIcons) window.refreshIcons();
    return;
  }

  tbody.innerHTML = list.map(m => {
    const pegawai = monitoringState.pegawaiMap[m.id_pegawai] || {};
    const target = monitoringState.pegawaiMap[m.id_target] || {};

    return `
      <tr>
        <td>
          <div style="font-weight:700">${pegawai.nama || '-'}</div>
          <div style="font-size:12px;color:var(--muted)">${pegawai.nomor_identitas || '-'}</div>
        </td>
        <td><span class="chip-o">${m.jenis}</span></td>
        <td>
          <div style="font-weight:600">${target.nama || '-'}</div>
          <div style="font-size:12px;color:var(--muted)">${target.jabatan || '-'}</div>
        </td>
        <td style="max-width:250px">
          <div style="font-size:13px">${m.catatan || '-'}</div>
        </td>
        <td>
          ${m.foto_kegiatan ? `<img src="${m.foto_kegiatan}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;cursor:pointer" onclick="openFotoModal('${m.foto_kegiatan}', '${target.nama}')">` : '<span style="color:var(--muted)">-</span>'}
        </td>
        <td><span class="badge b-ok"><span class="dot"></span>+${m.poin || 2}</span></td>
      </tr>
    `;
  }).join('');

  if (window.refreshIcons) window.refreshIcons();
}

// ============================================================
// BUKA FORM MONITORING
// ============================================================
function openFormMonitoring() {
  const modal = document.getElementById('monitoringModal');
  if (!modal) return;

  // Isi dropdown target
  const targetSelect = document.getElementById('monTarget');
  targetSelect.innerHTML = '<option value="">Pilih target...</option>' +
    monitoringState.targetList
      .sort((a, b) => a.nama.localeCompare(b.nama))
      .map(p => `<option value="${p.id_pegawai}">${p.nama} — ${p.jabatan}</option>`)
      .join('');

  // Reset form
  document.getElementById('monJenis').value = '';
  document.getElementById('monTarget').value = '';
  document.getElementById('monCatatan').value = '';
  monitoringState.fotoBase64 = null;
  document.getElementById('monPreview').hidden = true;
  document.getElementById('monCamWrap').hidden = false;
  document.getElementById('monBtnCapture').hidden = false;
  document.getElementById('monBtnRetake').hidden = true;
  document.getElementById('monBtnSubmit').hidden = true;

  modal.classList.add('open');

  // Init kamera & lokasi
  initCameraMonitoring();
  initLocationMonitoring();
}

function closeFormMonitoring() {
  const modal = document.getElementById('monitoringModal');
  if (modal) modal.classList.remove('open');
  if (typeof stopCamera === 'function') stopCamera();
}

// ============================================================
// KAMERA & LOKASI MONITORING
// ============================================================
async function initCameraMonitoring() {
  const video = document.getElementById('monVideo');
  if (!video) return;
  const ok = await startCamera(video, 'environment');
  if (!ok) toast('Gagal akses kamera', 'error');
}

async function initLocationMonitoring() {
  try {
    const loc = await getLocation();
    monitoringState.lokasi = loc;
    const locText = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)} (±${Math.round(loc.accuracy)}m)`;
    const el = document.getElementById('monCamLoc');
    if (el) el.textContent = '📍 ' + locText;
  } catch (err) {
    const el = document.getElementById('monCamLoc');
    if (el) el.textContent = '📍 Gagal deteksi lokasi';
  }
}

// ============================================================
// CAPTURE
// ============================================================
async function captureMonitoring() {
  if (!monitoringState.lokasi) {
    toast('Lokasi belum terdeteksi', 'warn');
    return;
  }

  const video = document.getElementById('monVideo');
  const base64 = await captureWithWatermark(video, monitoringState.lokasi, 'Monitoring');
  const compressed = await compressImage(base64, CONFIG.FOTO_MAX_WIDTH, CONFIG.FOTO_QUALITY);
  monitoringState.fotoBase64 = compressed;

  document.getElementById('monPreviewImg').src = compressed;
  document.getElementById('monPreview').hidden = false;
  document.getElementById('monCamWrap').hidden = true;
  document.getElementById('monBtnCapture').hidden = true;
  document.getElementById('monBtnRetake').hidden = false;
  document.getElementById('monBtnSubmit').hidden = false;
  toast('Foto berhasil diambil', 'success');
}

// ============================================================
// SUBMIT MONITORING
// ============================================================
async function submitMonitoring() {
  const jenis = document.getElementById('monJenis').value;
  const idTarget = document.getElementById('monTarget').value;
  const catatan = document.getElementById('monCatatan').value.trim();

  if (!jenis) { toast('Pilih jenis monitoring', 'warn'); return; }
  if (!idTarget) { toast('Pilih target monitoring', 'warn'); return; }
  if (!catatan) { toast('Catatan wajib diisi', 'warn'); return; }
  if (!monitoringState.fotoBase64) { toast('Foto wajib diambil', 'warn'); return; }

  const btn = document.getElementById('monBtnSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite"></span> Menyimpan...';

  try {
    const session = getSession();
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const namaFile = `monitoring_${session.username}_${monitoringState.tanggal}_${timestamp}.jpg`;
    const folderPath = `Monitoring/${monitoringState.tanggal.slice(0, 7)}/DI-${session.pegawai?.id_di || 'X'}`;

    // Upload foto ke Drive
    const uploadResult = await uploadFoto(monitoringState.fotoBase64, namaFile, folderPath);
    if (!uploadResult.success) throw new Error(uploadResult.error || 'Upload gagal');

    // Simpan ke Supabase
    await dbInsert('monitoring', {
      id_pegawai: session.id_pegawai,
      tanggal: monitoringState.tanggal,
      jenis: jenis,
      id_target: idTarget,
      catatan: catatan,
      foto_kegiatan: uploadResult.linkLh3,
      poin: 2
    });

    toast('Monitoring berhasil disimpan', 'success');
    closeFormMonitoring();
    await loadMonitoringData();

  } catch (err) {
    console.error(err);
    toast('Gagal: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="check"></i>Simpan Monitoring';
    if (window.refreshIcons) window.refreshIcons();
  }
}

// ============================================================
// INIT
// ============================================================
async function initMonitoring() {
  await loadMasterMonitoring();
  await loadMonitoringData();

  // Filter tanggal
  const tglInput = document.getElementById('monTanggal');
  if (tglInput) {
    tglInput.value = monitoringState.tanggal;
    tglInput.addEventListener('change', async (e) => {
      monitoringState.tanggal = e.target.value;
      await loadMonitoringData();
    });
  }

  // Filter jenis
  const jenisSelect = document.getElementById('monFilterJenis');
  if (jenisSelect) {
    jenisSelect.addEventListener('change', async (e) => {
      monitoringState.jenisFilter = e.target.value;
      await loadMonitoringData();
    });
  }

  // Tombol refresh
  document.getElementById('monRefresh')?.addEventListener('click', loadMonitoringData);

  // Tombol tambah
  document.getElementById('monBtnTambah')?.addEventListener('click', openFormMonitoring);

  // Tombol close modal
  document.getElementById('monBtnClose')?.addEventListener('click', closeFormMonitoring);

  // Tombol capture
  document.getElementById('monBtnCapture')?.addEventListener('click', captureMonitoring);

  // Tombol retake
  document.getElementById('monBtnRetake')?.addEventListener('click', () => {
    monitoringState.fotoBase64 = null;
    document.getElementById('monPreview').hidden = true;
    document.getElementById('monCamWrap').hidden = false;
    document.getElementById('monBtnCapture').hidden = false;
    document.getElementById('monBtnRetake').hidden = true;
    document.getElementById('monBtnSubmit').hidden = true;
  });

  // Tombol submit
  document.getElementById('monBtnSubmit')?.addEventListener('click', submitMonitoring);
}

// ============================================================
// EXPOSE GLOBAL
// ============================================================
window.initMonitoring = initMonitoring;
window.openFormMonitoring = openFormMonitoring;
window.closeFormMonitoring = closeFormMonitoring;
window.submitMonitoring = submitMonitoring;
window.captureMonitoring = captureMonitoring;
window.loadMonitoringData = loadMonitoringData;