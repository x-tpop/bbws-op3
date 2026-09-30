// ============================================================
// PRESENSI.JS — Logic halaman presensi (v11 — iOS Modal)
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
// REVERSE GEOCODING
// ============================================================
async function getNamaLokasi(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
      { headers: { 'Accept-Language': 'id' } }
    );
    const data = await res.json();

    const addr = data.address || {};
    const kota = addr.city || addr.town || addr.village || addr.county || addr.state_district || '';
    const prov = addr.state || '';

    const provShort = prov
      .replace('Jawa Timur', 'Jatim')
      .replace('Jawa Tengah', 'Jateng')
      .replace('Jawa Barat', 'Jabar')
      .replace('DKI Jakarta', 'Jakarta')
      .replace('DI Yogyakarta', 'DIY')
      .replace('Banten', 'Banten')
      .replace('Bali', 'Bali');

    if (kota && provShort) return `${kota}, ${provShort}`;
    if (kota) return kota;
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch (e) {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

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
      const hms = [
        String(d.getHours()).padStart(2, '0'),
        String(d.getMinutes()).padStart(2, '0'),
        String(d.getSeconds()).padStart(2, '0')
      ].join(':');
      const hm = [
        String(d.getHours()).padStart(2, '0'),
        String(d.getMinutes()).padStart(2, '0')
      ].join(':');

      if (el('presClock')) el('presClock').textContent = hms;
      if (el('presDate')) el('presDate').textContent = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      if (el('camTime')) el('camTime').textContent = hms;
      if (el('camFsTime')) el('camFsTime').textContent = hm + ' WIB';
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
        if (data.status) presensiState.status = data.status;
      }
    } catch (e) { console.error(e); }

    renderPresensi();

    // ============================================================
    // SEGMENTED CONTROL
    // ============================================================
    const segButtons = document.querySelectorAll('.seg-btn');
    segButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        segButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        presensiState.status = btn.dataset.status;
        
        const ketWrap = el('ketWrap');
        if (ketWrap) {
          ketWrap.style.display = ['Izin', 'Sakit', 'Dinas Luar'].includes(presensiState.status) ? 'flex' : 'none';
        }
        
        console.log('Status:', presensiState.status);
      });
    });

    if (presensiState.status) {
      segButtons.forEach(b => {
        b.classList.toggle('active', b.dataset.status === presensiState.status);
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

    // Klik area kamera → buka fullscreen
    const camWrap = el('camWrap');
    if (camWrap) {
      camWrap.addEventListener('click', (e) => {
        if (e.target.closest('#btnCapture')) return;
        openFullscreenDirect();
      });
    }

    // ============================================================
    // INIT LOKASI + MAPS
    // ============================================================
    try {
      const loc = await getLocation();
      presensiState.lokasi = loc;
      const locText = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`;
      const locWithAcc = `${locText} (±${Math.round(loc.accuracy)}m)`;

      if (el('camLoc')) el('camLoc').textContent = locText;
      if (el('geoStatus')) el('geoStatus').textContent = locWithAcc;
      if (el('geoSub')) el('geoSub').textContent = locWithAcc;
      if (el('btnCapture')) el('btnCapture').disabled = false;

      const mapIframe = el('miniMap');
      if (mapIframe) {
        const d = 0.003;
        const bbox = `${loc.lng - d},${loc.lat - d},${loc.lng + d},${loc.lat + d}`;
        mapIframe.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${loc.lat},${loc.lng}`;
      }

      getNamaLokasi(loc.lat, loc.lng).then(nama => {
        if (el('camFsLoc')) el('camFsLoc').textContent = nama;
        if (el('geoStatus')) el('geoStatus').textContent = nama;
        if (el('geoSub')) el('geoSub').textContent = locWithAcc;
      });

      console.log('Location:', loc);
    } catch (err) {
      if (el('camLoc')) el('camLoc').textContent = 'Gagal deteksi';
      if (el('geoStatus')) el('geoStatus').textContent = err.message;
      console.error(err);
    }

    // ============================================================
    // PASANG HANDLER
    // ============================================================
    attachCaptureHandler(el('btnCapture'), el('video'));
    attachRetakeHandler(el('btnRetake'));
    attachSubmitHandler(el('btnSubmit'), session, pegawai, today);
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

  newBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

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

  newBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    presensiState.fotoBase64 = null;
    const el = id => document.getElementById(id);
    if (el('camPreview')) el('camPreview').hidden = true;
    if (el('camWrap')) el('camWrap').hidden = false;
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

  newBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!presensiState.fotoBase64 || !presensiState.lokasi) {
      toast('Foto atau lokasi belum siap', 'warn'); return;
    }

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

      if (tipe === 'masuk') {
        await dbInsert('presensi', {
          id_pegawai: session.id_pegawai,
          tanggal: today,
          jam_masuk: jam,
          lokasi_masuk: lokasiStr,
          foto_masuk: uploadResult.linkLh3,
          status: status,
          keterangan: ket || null,
          poin: status === 'Hadir' ? 1 : 0
        });
        presensiState.masuk = now;
      } else {
        await dbUpdate('presensi', 'id_pegawai', session.id_pegawai, {
          jam_keluar: jam,
          lokasi_keluar: lokasiStr,
          foto_keluar: uploadResult.linkLh3
        });
        presensiState.keluar = now;
      }

      renderPresensi();

      // Ambil nama kota untuk modal
      const namaKota = await getNamaLokasi(presensiState.lokasi.lat, presensiState.lokasi.lng);

      showSuksesModal({
        tipe: tipe,
        status: status,
        jam: jam.slice(0, 5),
        tanggal: now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        lokasi: lokasiStr,
        lokasiNama: namaKota,
        keterangan: ket
      });

      const el = id => document.getElementById(id);
      if (el('camPreview')) el('camPreview').hidden = true;
      if (el('camWrap')) el('camWrap').hidden = false;
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
// MODAL SUKSES — iOS Alert Sheet
// ============================================================
function showSuksesModal(data) {
  const modal = document.getElementById('suksesModal');
  if (!modal) return;

  const title = document.getElementById('suksesTitle');
  const msg = document.getElementById('suksesMsg');
  const date = document.getElementById('succDate');
  const time = document.getElementById('succTime');
  const status = document.getElementById('succStatus');
  const locName = document.getElementById('succLocName');
  const locCoords = document.getElementById('succLocCoords');
  const ketRow = document.getElementById('succKetRow');
  const ket = document.getElementById('succKet');

  if (title) title.textContent = data.tipe === 'masuk' ? 'Check-in Berhasil!' : 'Check-out Berhasil!';
  if (msg) msg.textContent = `Presensi ${data.tipe} Anda telah tercatat pada sistem e-kehadiran.`;
  if (date) date.textContent = data.tanggal || '—';
  if (time) time.textContent = (data.jam || '—') + ' WIB';
  if (status) status.textContent = data.status || '—';

  if (locName) locName.textContent = data.lokasiNama || data.lokasi || '—';
  if (locCoords) locCoords.textContent = data.lokasi || '—';

  if (data.keterangan && ketRow && ket) {
    ketRow.style.display = 'flex';
    ket.textContent = data.keterangan;
  } else if (ketRow) {
    ketRow.style.display = 'none';
  }

  modal.classList.add('open');
  if (window.refreshIcons) window.refreshIcons();
}

function closeSuksesModal() {
  document.getElementById('suksesModal')?.classList.remove('open');
}

// ============================================================
// FACE DETECTION — MediaPipe
// ============================================================
let faceDetector = null;
let faceDetectInterval = null;
let faceDetectionReady = false;

async function initFaceDetection(videoEl) {
  if (faceDetectionReady) {
    console.log('MediaPipe sudah siap');
    return true;
  }

  try {
    console.log('Loading MediaPipe...');
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0');

    const filesetResolver = await vision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
    );

    faceDetector = await vision.FaceDetector.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.5
    });

    faceDetectionReady = true;
    console.log('MediaPipe FaceDetector aktif');

    if (faceDetectInterval) clearInterval(faceDetectInterval);
    faceDetectInterval = setInterval(() => {
      if (!videoEl || videoEl.readyState < 2 || !faceDetector) return;
      try {
        const result = faceDetector.detectForVideo(videoEl, performance.now());
        const detected = result.detections && result.detections.length > 0;
        updateFaceUI(detected);
      } catch (e) {}
    }, 300);

    return true;
  } catch (e) {
    console.warn('MediaPipe init gagal:', e);
    return false;
  }
}

function updateFaceUI(detected) {
  const guide = document.getElementById('faceGuide');
  const label = document.querySelector('#faceStatus .face-label');
  if (detected) {
    guide?.classList.add('detected');
    if (label) label.textContent = 'Wajah terdeteksi ✓';
  } else {
    guide?.classList.remove('detected');
    if (label) label.textContent = 'Posisikan wajah Anda di dalam oval';
  }
}

function stopFaceDetection() {
  if (faceDetectInterval) { clearInterval(faceDetectInterval); faceDetectInterval = null; }
  if (faceDetector) { try { faceDetector.close(); } catch (e) {} faceDetector = null; }
  faceDetectionReady = false;
  document.getElementById('faceGuide')?.classList.remove('detected');
}

// ============================================================
// FULLSCREEN CAMERA
// ============================================================
function attachFullscreenHandlers() {
  const el = id => document.getElementById(id);

  const btnClose = el('btnFsClose');
  if (btnClose) {
    const newBtn = btnClose.cloneNode(true);
    btnClose.parentNode.replaceChild(newBtn, btnClose);
    newBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el('camFullscreen')?.classList.remove('open');
      stopFaceDetection();
    });
  }

  const btnCapFs = el('btnFsCapture');
  if (btnCapFs) {
    const newBtn = btnCapFs.cloneNode(true);
    btnCapFs.parentNode.replaceChild(newBtn, btnCapFs);
    newBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const videoFs = el('videoFullscreen');
      if (!videoFs || !presensiState.lokasi) return;
      try {
        const base64 = await captureWithWatermark(videoFs, presensiState.lokasi, 'Presensi');
        const compressed = await compressImage(base64, CONFIG.FOTO_MAX_WIDTH, CONFIG.FOTO_QUALITY);
        presensiState.fotoBase64 = compressed;
        if (el('previewImg')) el('previewImg').src = compressed;
        if (el('camPreview')) el('camPreview').hidden = false;
        if (el('camWrap')) el('camWrap').hidden = true;
        if (el('btnRetake')) el('btnRetake').hidden = false;
        if (el('btnSubmit')) el('btnSubmit').hidden = false;
        if (el('infoAfter')) el('infoAfter').hidden = false;
        el('camFullscreen')?.classList.remove('open');
        stopFaceDetection();
        toast('Foto berhasil diambil', 'success');
      } catch (err) {
        toast('Gagal ambil foto', 'error');
      }
    });
  }

  const btnSwitch = el('btnFsSwitch');
  if (btnSwitch) {
    const newBtn = btnSwitch.cloneNode(true);
    btnSwitch.parentNode.replaceChild(newBtn, btnSwitch);
    newBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      presensiState.facingMode = presensiState.facingMode === 'user' ? 'environment' : 'user';
      const videoFs = el('videoFullscreen');
      if (videoFs) {
        await startCamera(videoFs, presensiState.facingMode);
        stopFaceDetection();
        initFaceDetection(videoFs);
      }
      toast('Kamera: ' + (presensiState.facingMode === 'user' ? 'Depan' : 'Belakang'), 'info');
    });
  }
}

function openFullscreenDirect() {
  const el = id => document.getElementById(id);
  const modal = el('camFullscreen');
  const videoFs = el('videoFullscreen');
  if (!modal || !videoFs) return;

  if (window.cameraStream) {
    videoFs.srcObject = window.cameraStream;
    videoFs.play();
  } else {
    startCamera(videoFs, presensiState.facingMode);
  }

  modal.classList.add('open');

  if (presensiState.lokasi) {
    getNamaLokasi(presensiState.lokasi.lat, presensiState.lokasi.lng).then(nama => {
      if (el('camFsLoc')) el('camFsLoc').textContent = nama;
    });
  }

  initFaceDetection(videoFs);
}

// ============================================================
// RENDER PRESENSI
// ============================================================
function renderPresensi() {
  const fmt = d => d ? [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0')
  ].join(':') : '—';
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
window.initFaceDetection = initFaceDetection;
window.stopFaceDetection = stopFaceDetection;
window.getNamaLokasi = getNamaLokasi;
window.openFullscreenDirect = openFullscreenDirect;
