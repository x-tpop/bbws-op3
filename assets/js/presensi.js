// ============================================================
// PRESENSI.JS — Logic halaman presensi (v2)
// ============================================================

const presensiState = {
  lokasi: null,
  fotoBase64: null,
  masuk: null,
  keluar: null,
  status: 'Hadir',
  facingMode: 'user',
  fullscreenStream: null
};

// ============================================================
// INIT
// ============================================================
async function initPresensi() {
  console.log('=== Init Presensi ===');

  if (window.__presensiInit) {
    console.log('skip, sudah init');
    return;
  }
  window.__presensiInit = true;

  try {
    const session = getSession();
    if (!session) return;

    const pegawai = session.pegawai || {};
    const today = new Date().toISOString().slice(0, 10);
    const el = id => document.getElementById(id);

    // ============================================================
    // JAM & TANGGAL
    // ============================================================
    function tickPres() {
      const d = new Date();
      const hms = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (el('presClock')) el('presClock').textContent = hms;
      if (el('presDate')) el('presDate').textContent = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      if (el('camTime')) el('camTime').textContent = '🕐 ' + hms + ' WIB';
      if (el('camFsTime')) el('camFsTime').textContent = '🕐 ' + hms + ' WIB';
    }
    tickPres();
    if (window.__presInterval) clearInterval(window.__presInterval);
    window.__presInterval = setInterval(tickPres, 1000);

    // ============================================================
    // CEK PRESENSI HARI INI
    // ============================================================
    try {
      const { data } = await supabaseClient
        .from('presensi')
        .select('*')
        .eq('id_pegawai', session.id_pegawai)
        .eq('tanggal', today)
        .maybeSingle();

      if (data) {
        presensiState.masuk = data.jam_masuk ? new Date(today + 'T' + data.jam_masuk) : null;
        presensiState.keluar = data.jam_keluar ? new Date(today + 'T' + data.jam_keluar) : null;
        if (data.status) {
          presensiState.status = data.status;
          if (el('presStatus')) el('presStatus').value = data.status;
        }
      }
    } catch (e) { console.error(e); }

    renderPresensi();

    // ============================================================
    // STATUS CHANGE → tampilkan keterangan
    // ============================================================
    const statusSel = el('presStatus');
    if (statusSel) {
      statusSel.addEventListener('change', () => {
        presensiState.status = statusSel.value;
        const ketWrap = el('ketWrap');
        if (ketWrap) {
          ketWrap.style.display = ['Izin', 'Sakit', 'Dinas Luar'].includes(statusSel.value) ? 'flex' : 'none';
        }
      });
    }

    // ============================================================
    // INIT KAMERA
    // ============================================================
    const video = el('video');
    if (video) {
      const ok = await startCamera(video, presensiState.facingMode);
      console.log('Camera:', ok);
      if (!ok) toast('Gagal akses kamera', 'error');
    }

    // ============================================================
    // INIT LOKASI + MAPS
    // ============================================================
    try {
      const loc = await getLocation();
      presensiState.lokasi = loc;
      const locText = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)} (±${Math.round(loc.accuracy)}m)`;
      if (el('camLoc')) el('camLoc').textContent = '📍 ' + locText;
      if (el('camFsLoc')) el('camFsLoc').textContent = '📍 ' + locText;
      if (el('geoStatus')) el('geoStatus').textContent = locText;
      if (el('btnCapture')) el('btnCapture').disabled = false;

      // Embed mini maps (OpenStreetMap)
      const mapIframe = el('miniMap');
      if (mapIframe) {
        const d = 0.003; // zoom level
        const bbox = `${loc.lng - d},${loc.lat - d},${loc.lng + d},${loc.lat + d}`;
        mapIframe.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${loc.lat},${loc.lng}`;
      }

      console.log('Location:', loc);
    } catch (err) {
      if (el('camLoc')) el('camLoc').textContent = '📍 Gagal deteksi lokasi';
      if (el('geoStatus')) el('geoStatus').textContent = err.message;
      console.error(err);
    }

    // ============================================================
    // EVENT: CAPTURE
    // ============================================================
    attachCaptureHandler(el('btnCapture'), el('video'));

    // ============================================================
    // EVENT: RETAKE
    // ============================================================
    attachRetakeHandler(el('btnRetake'));

    // ============================================================
    // EVENT: SUBMIT
    // ============================================================
    attachSubmitHandler(el('btnSubmit'), session, pegawai, today);

    // ============================================================
    // EVENT: FULLSCREEN CAMERA
    // ============================================================
    attachFullscreenHandlers();

    if (window.refreshIcons) window.refreshIcons();
    console.log('=== Presensi loaded ===');

  } catch (err) {
    console.error('Presensi error:', err);
  }
}

// ============================================================
// HANDLER: CAPTURE
// ============================================================
function attachCaptureHandler(btn, videoEl) {
  if (!btn) return;
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);

  newBtn.addEventListener('click', async () => {
    if (!presensiState.lokasi) { toast('Lokasi belum terdeteksi', 'warn'); return; }

    const v = videoEl || document.getElementById('video');
    if (!v) { toast('Video tidak ditemukan', 'error'); return; }

    try {
      const base64 = await captureWithWatermark(v, presensiState.lokasi, 'Presensi');
      const compressed = await compressImage(base64, CONFIG.FOTO_MAX_WIDTH, CONFIG.FOTO_QUALITY);
      presensiState.fotoBase64 = compressed;

      const el = id => document.getElementById(id);
      if (el('previewImg')) el('previewImg').src = compressed;
      if (el('camPreview')) el('camPreview').hidden = false;
      if (el('camWrap')) el('camWrap').hidden = true;
      if (newBtn) newBtn.hidden = true;
      if (el('btnRetake')) el('btnRetake').hidden = false;
      if (el('btnSubmit')) el('btnSubmit').hidden = false;
      if (el('infoAfter')) el('infoAfter').hidden = false;

      toast('Foto berhasil diambil', 'success');
    } catch (err) {
      console.error(err);
      toast('Gagal ambil foto: ' + err.message, 'error');
    }
  });
}

// ============================================================
// HANDLER: RETAKE
// ============================================================
function attachRetakeHandler(btn) {
  if (!btn) return;
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);

  newBtn.addEventListener('click', () => {
    presensiState.fotoBase64 = null;
    const el = id => document.getElementById(id);
    if (el('camPreview')) el('camPreview').hidden = true;
    if (el('camWrap')) el('camWrap').hidden = false;
    if (el('btnCapture')) el('btnCapture').hidden = false;
    if (newBtn) newBtn.hidden = true;
    if (el('btnSubmit')) el('btnSubmit').hidden = true;
    if (el('infoAfter')) el('infoAfter').hidden = true;
  });
}

// ============================================================
// HANDLER: SUBMIT
// ============================================================
function attachSubmitHandler(btn, session, pegawai, today) {
  if (!btn) return;
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);

  newBtn.addEventListener('click', async () => {
    if (!presensiState.fotoBase64 || !presensiState.lokasi) {
      toast('Foto atau lokasi belum siap', 'warn'); return;
    }

    // Cek keterangan jika status butuh
    const status = presensiState.status;
    const ketEl = document.getElementById('presKet');
    const ket = ketEl ? ketEl.value.trim() : '';

    if (['Izin', 'Sakit', 'Dinas Luar'].includes(status) && !ket) {
      toast('Keterangan wajib diisi untuk status ' + status, 'warn');
      return;
    }

    newBtn.disabled = true;
    newBtn.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite"></span> Mengirim...';

    try {
      const now = new Date();
      const tipe = !presensiState.masuk ? 'masuk' : 'keluar';
      const timestamp = now.toISOString().replace(/[:.]/g, '-');
      const namaFile = `presensi_${session.username}_${today}_${tipe}_${timestamp}.jpg`;
      const folderPath = `Presensi/${today.slice(0, 7)}/DI-${pegawai.id_di || 'X'}`;

      const uploadResult = await uploadFoto(presensiState.fotoBase64, namaFile, folderPath);
      if (!uploadResult.success) throw new Error(uploadResult.error || 'Upload gagal');

      const jam = now.toTimeString().slice(0, 8);
      const lokasiStr = `${presensiState.lokasi.lat.toFixed(6)}, ${presensiState.lokasi.lng.toFixed(6)}`;

      let savedData = null;

      if (tipe === 'masuk') {
        const [result] = await dbInsert('presensi', {
          id_pegawai: session.id_pegawai,
          tanggal: today,
          jam_masuk: jam,
          lokasi_masuk: lokasiStr,
          foto_masuk: uploadResult.linkLh3,
          status: status,
          keterangan: ket || null,
          poin: status === 'Hadir' ? 1 : 0
        });
        savedData = result;
        presensiState.masuk = now;
      } else {
        const [result] = await dbUpdate('presensi', 'id_pegawai', session.id_pegawai, {
          jam_keluar: jam,
          lokasi_keluar: lokasiStr,
          foto_keluar: uploadResult.linkLh3
        });
        savedData = result;
        presensiState.keluar = now;
      }

      renderPresensi();

      // ============================================================
      // TAMPILKAN MODAL SUKSES
      // ============================================================
      showSuksesModal({
        tipe: tipe,
        status: status,
        jam: jam.slice(0, 5),
        tanggal: now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        lokasi: lokasiStr,
        keterangan: ket
      });

      // Reset UI
      const el = id => document.getElementById(id);
      if (el('camPreview')) el('camPreview').hidden = true;
      if (el('camWrap')) el('camWrap').hidden = false;
      if (el('btnCapture')) el('btnCapture').hidden = false;
      if (el('btnRetake')) el('btnRetake').hidden = true;
      if (newBtn) newBtn.hidden = true;
      if (el('infoAfter')) el('infoAfter').hidden = true;
      presensiState.fotoBase64 = null;

    } catch (err) {
      console.error(err);
      toast('Gagal: ' + err.message, 'error');
    } finally {
      newBtn.disabled = false;
      newBtn.innerHTML = '<i data-lucide="check"></i>Kirim Presensi';
      if (window.refreshIcons) window.refreshIcons();
    }
  });
}

// ============================================================
// MODAL SUKSES
// ============================================================
function showSuksesModal(data) {
  const modal = document.getElementById('suksesModal');
  if (!modal) return;

  const title = document.getElementById('suksesTitle');
  const msg = document.getElementById('suksesMsg');
  const detail = document.getElementById('suksesDetail');

  if (title) title.textContent = data.tipe === 'masuk' ? 'Check-in Berhasil!' : 'Check-out Berhasil!';
  if (msg) msg.textContent = `Presensi ${data.tipe} Anda telah tercatat.`;

  if (detail) {
    detail.innerHTML = `
      <div class="row"><span>Tanggal</span><b>${data.tanggal}</b></div>
      <div class="row"><span>Jam ${data.tipe === 'masuk' ? 'Masuk' : 'Keluar'}</span><b>${data.jam} WIB</b></div>
      <div class="row"><span>Status</span><b>${data.status}</b></div>
      ${data.keterangan ? `<div class="row"><span>Keterangan</span><b>${data.keterangan}</b></div>` : ''}
      <div class="row"><span>Lokasi</span><b style="font-size:12px">${data.lokasi}</b></div>
    `;
  }

  modal.classList.add('open');
  if (window.refreshIcons) window.refreshIcons();
}

function closeSuksesModal() {
  document.getElementById('suksesModal')?.classList.remove('open');
}

// ============================================================
// FULLSCREEN CAMERA
// ============================================================
function attachFullscreenHandlers() {
  const el = id => document.getElementById(id);

  // Buka fullscreen
  el('btnFullscreen')?.addEventListener('click', async () => {
    const modal = el('camFullscreen');
    const videoFs = el('videoFullscreen');
    if (!modal || !videoFs) return;

    // Pakai stream dari kamera utama
    if (window.cameraStream) {
      videoFs.srcObject = window.cameraStream;
      await videoFs.play();
    } else {
      const ok = await startCamera(videoFs, presensiState.facingMode);
      if (!ok) { toast('Gagal buka kamera fullscreen', 'error'); return; }
    }

    modal.classList.add('open');
    // Update lokasi
    if (presensiState.lokasi) {
      const locText = `${presensiState.lokasi.lat.toFixed(6)}, ${presensiState.lokasi.lng.toFixed(6)}`;
      if (el('camFsLoc')) el('camFsLoc').textContent = '📍 ' + locText;
    }
  });

  // Tutup fullscreen
  el('btnFsClose')?.addEventListener('click', () => {
    el('camFullscreen')?.classList.remove('open');
  });

  // Ambil foto dari fullscreen
  el('btnFsCapture')?.addEventListener('click', async () => {
    const videoFs = el('videoFullscreen');
    if (!videoFs) return;

    const base64 = await captureWithWatermark(videoFs, presensiState.lokasi, 'Presensi');
    const compressed = await compressImage(base64, CONFIG.FOTO_MAX_WIDTH, CONFIG.FOTO_QUALITY);
    presensiState.fotoBase64 = compressed;

    // Tampilkan preview di halaman utama
    if (el('previewImg')) el('previewImg').src = compressed;
    if (el('camPreview')) el('camPreview').hidden = false;
    if (el('camWrap')) el('camWrap').hidden = true;
    if (el('btnCapture')) el('btnCapture').hidden = true;
    if (el('btnRetake')) el('btnRetake').hidden = false;
    if (el('btnSubmit')) el('btnSubmit').hidden = false;
    if (el('infoAfter')) el('infoAfter').hidden = false;

    // Tutup fullscreen
    el('camFullscreen')?.classList.remove('open');

    toast('Foto berhasil diambil', 'success');
  });

  // Ganti kamera depan/belakang
  el('btnFsSwitch')?.addEventListener('click', async () => {
    presensiState.facingMode = presensiState.facingMode === 'user' ? 'environment' : 'user';
    const videoFs = el('videoFullscreen');
    if (videoFs) {
      await startCamera(videoFs, presensiState.facingMode);
    }
    toast('Kamera: ' + (presensiState.facingMode === 'user' ? 'Depan' : 'Belakang'), 'info');
  });
}

// ============================================================
// RENDER PRESENSI
// ============================================================
function renderPresensi() {
  const fmt = d => d ? d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—';
  const el = id => document.getElementById(id);

  if (el('ptMasukTime')) el('ptMasukTime').textContent = fmt(presensiState.masuk);
  if (el('ptKeluarTime')) el('ptKeluarTime').textContent = fmt(presensiState.keluar);
  if (el('ptMasuk')) el('ptMasuk').classList.toggle('done', !!presensiState.masuk);
  if (el('ptKeluar')) el('ptKeluar').classList.toggle('done', !!presensiState.keluar);
  if (el('ptl')) el('ptl').classList.toggle('on', !!presensiState.masuk);

  let note;
  if (!presensiState.masuk) {
    note = 'Anda belum melakukan presensi hari ini.';
  } else if (!presensiState.keluar) {
    note = `Sudah check-in pukul ${fmt(presensiState.masuk)}. Jangan lupa check-out sebelum pulang.`;
  } else {
    note = `Presensi selesai. Masuk ${fmt(presensiState.masuk)}, keluar ${fmt(presensiState.keluar)}.`;
  }

  if (el('presNote')) el('presNote').textContent = note;
}

// ============================================================
// EXPOSE
// ============================================================
window.initPresensi = initPresensi;
window.renderPresensi = renderPresensi;
window.closeSuksesModal = closeSuksesModal;
