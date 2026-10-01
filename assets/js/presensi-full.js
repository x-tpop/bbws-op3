// ============================================================
// PRESENSI-FULL.JS — Logic halaman presensi (Tahap 1-7)
// File: assets/js/presensi-full.js
// ============================================================

const presensiState = {
  lokasi: null,
  lokasiNama: null,
  fotoBase64: null,
  suratBase64: null,
  masuk: null,
  keluar: null,
  status: 'Hadir',
  facingMode: 'user',
  serverOffset: 0,
  isInRadius: false,
  kantorLat: null,
  kantorLng: null,
  kantorRadius: 500,
  autoCaptureTimer: null,
  autoCaptureActive: false,
  faceStableStart: null,
  faceStableTimer: null,
  currentFacingMode: 'user'
};

// ============================================================
// TAHAP 1: SERVER TIME SYNC (via Supabase)
// ============================================================
async function syncServerTime() {
  const badge = document.getElementById('serverBadge');
  const el = document.getElementById('serverTime');

  try {
    // Coba Supabase server time
    const { data, error } = await supabaseClient.rpc('get_server_time');
    
    if (!error && data) {
      const serverTime = new Date(data);
      presensiState.serverOffset = serverTime.getTime() - Date.now();
      
      if (badge) badge.classList.remove('error');
      if (el) el.textContent = 'Server OK';
      
      console.log('Server time (Supabase):', serverTime, 'Offset:', presensiState.serverOffset);
      return true;
    }

    throw new Error('Supabase time tidak tersedia');
    
  } catch (e) {
    // Fallback: coba WorldTimeAPI
    try {
      const res = await fetch('https://worldtimeapi.org/api/timezone/Asia/Jakarta', {
        signal: AbortSignal.timeout(3000)
      });
      const json = await res.json();
      const serverTime = new Date(json.datetime);
      presensiState.serverOffset = serverTime.getTime() - Date.now();
      
      if (badge) badge.classList.remove('error');
      if (el) el.textContent = 'Server OK';
      
      console.log('Server time (WorldTimeAPI):', serverTime);
      return true;
    } catch (e2) {
      // Last fallback: device time
      console.warn('Sync server time gagal, pakai device time');
      if (badge) badge.classList.add('error');
      if (el) el.textContent = 'Device Time';
      return false;
    }
  }
}

// ============================================================
// TAHAP 1: GEOFENCE
// ============================================================
function getServerNow() {
  return new Date(Date.now() + presensiState.serverOffset);
}
function hitungJarak(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function checkGeofence(lat, lng) {
  if (!presensiState.kantorLat || !presensiState.kantorLng) {
    return { ok: true, jarak: 0, message: 'Lokasi bebas' };
  }
  const jarak = hitungJarak(lat, lng, presensiState.kantorLat, presensiState.kantorLng);
  const ok = jarak <= presensiState.kantorRadius;
  return {
    ok,
    jarak: Math.round(jarak),
    message: ok ? `Dalam radius (${Math.round(jarak)}m)` : `Di luar radius (${Math.round(jarak)}m)`
  };
}

// ============================================================
// REVERSE GEOCODING
// ============================================================
async function getNamaLokasi(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
      { headers: { 'Accept-Language': 'id' }, signal: AbortSignal.timeout(5000) }
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
      .replace('DI Yogyakarta', 'DIY');
    if (kota && provShort) return `${kota}, ${provShort}`;
    if (kota) return kota;
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch (e) {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

// ============================================================
// INIT UTAMA
// ============================================================
async function initPresensi() {
  console.log('=== Init Presensi (Full) ===');

  if (window.__presensiInit) {
    console.log('skip, sudah init');
    return;
  }
  window.__presensiInit = true;

  try {
    const session = getSession();
    if (!session) return;

    const pegawai = session.pegawai || {};
    const el = id => document.getElementById(id);

    // TAHAP 1: Sync server time
    await syncServerTime();

    // ============================================================
    // JAM LIVE (pakai server time)
    // ============================================================
    function tickPres() {
      const d = getServerNow();
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
      if (el('fsReviewTime')) el('fsReviewTime').textContent = hms + ' WIB';
    }
    tickPres();
    if (window.__presInterval) clearInterval(window.__presInterval);
    window.__presInterval = setInterval(tickPres, 1000);

    // ============================================================
    // CEK PRESENSI HARI INI
    // ============================================================
    const today = getServerNow().toISOString().slice(0, 10);
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
    // TAHAP 2: SEGMENTED CONTROL — ALUR BERCABANG
    // ============================================================
    const segButtons = document.querySelectorAll('.seg-btn');
    const ketWrap = el('ketWrap');
    const suratWrap = el('suratWrap');
    const camCard = document.querySelector('.card-camera');

    function updateFormByStatus(status) {
      const butuhKet = ['Izin', 'Sakit', 'Dinas Luar'].includes(status);
      if (ketWrap) ketWrap.style.display = butuhKet ? 'flex' : 'none';

      const butuhSurat = ['Izin', 'Sakit'].includes(status);
      if (suratWrap) suratWrap.style.display = butuhSurat ? 'flex' : 'none';

      const butuhKamera = !butuhSurat;
      if (camCard) {
        camCard.style.opacity = butuhKamera ? '1' : '0.5';
        camCard.style.pointerEvents = butuhKamera ? 'auto' : 'none';
      }

      const note = el('presNote');
      if (note) {
        if (butuhSurat) {
          note.textContent = `Silakan upload surat ${status.toLowerCase()}. Foto wajah tidak diperlukan.`;
        } else if (status === 'Dinas Luar') {
          note.textContent = 'Pastikan Anda berada di lokasi dinas. Foto dengan watermark GPS akan dicatat.';
        } else if (status === 'Kerja Gabungan') {
          note.textContent = 'Kerja Gabungan (QR) — Anda bisa presensi dari mana saja.';
        } else {
          note.textContent = 'Silakan lakukan check-in dengan foto berwatermark GPS.';
        }
      }
    }

    segButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        segButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        presensiState.status = btn.dataset.status;
        updateFormByStatus(presensiState.status);
      });
    });

    if (presensiState.status) {
      segButtons.forEach(b => {
        b.classList.toggle('active', b.dataset.status === presensiState.status);
      });
      updateFormByStatus(presensiState.status);
    }

    // ============================================================
    // TAHAP 2: UPLOAD SURAT
    // ============================================================
    const suratFile = el('suratFile');
    const fileUpload = el('fileUpload');
    const fuPreview = el('fuPreview');
    const fuPreviewImg = el('fuPreviewImg');
    const fuRemove = el('fuRemove');

    fileUpload?.addEventListener('click', () => suratFile?.click());

    suratFile?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 5 * 1024 * 1024) {
        toast('Ukuran file max 5 MB', 'warn');
        return;
      }

      const reader = new FileReader();
      reader.onload = async (ev) => {
        const compressed = await compressImage(ev.target.result, 1000, 0.6);
        presensiState.suratBase64 = compressed;

        if (fuPreviewImg) fuPreviewImg.src = compressed;
        if (fuPreview) fuPreview.hidden = false;
        if (fileUpload) fileUpload.style.display = 'none';
        toast('Surat berhasil diupload', 'success');
      };
      reader.readAsDataURL(file);
    });

    fuRemove?.addEventListener('click', () => {
      presensiState.suratBase64 = null;
      if (suratFile) suratFile.value = '';
      if (fuPreview) fuPreview.hidden = true;
      if (fileUpload) fileUpload.style.display = 'flex';
    });

    // ============================================================
// TAHAP 3: OPEN FULLSCREEN (SUPER DEBUG)
// ============================================================
function openFullscreenDirect() {
  console.log('=== openFullscreenDirect ===');
  const el = id => document.getElementById(id);
  
  const modal = el('camFullscreen');
  console.log('1. Modal:', modal);
  
  if (!modal) {
    console.error('Modal camFullscreen TIDAK ADA di DOM!');
    alert('Error: Modal kamera tidak ditemukan. Coba refresh halaman.');
    return;
  }

  // Buka modal DULU
  modal.classList.add('open');
  console.log('2. Modal dibuka, class:', modal.className);

  // Tunggu 300ms agar modal ter-render
  setTimeout(async () => {
    const videoFs = el('videoFullscreen');
    console.log('3. VideoFullscreen:', videoFs);
    
    if (!videoFs) {
      console.error('VideoFullscreen TIDAK ADA!');
      alert('Error: Video element tidak ditemukan.');
      return;
    }

    // Coba pakai stream yang sudah ada
    if (window.cameraStream && window.cameraStream.active) {
      console.log('4. Pakai stream yang sudah ada');
      try {
        videoFs.srcObject = window.cameraStream;
        await videoFs.play();
        console.log('5. Stream attached & playing');
      } catch (e) {
        console.error('5. Error attach stream:', e);
      }
    } else {
      console.log('4. Stream tidak aktif, start camera baru...');
      try {
        const ok = await startCamera(videoFs, presensiState.facingMode);
        console.log('5. Start camera result:', ok);
        if (!ok) {
          alert('Gagal buka kamera. Pastikan izin kamera sudah diberikan.');
          return;
        }
      } catch (e) {
        console.error('5. Error startCamera:', e);
        alert('Error kamera: ' + e.message);
        return;
      }
    }

    // Reset mode
    const fsLiveMode = el('fsLiveMode');
    const fsReviewMode = el('fsReviewMode');
    const fsDockLive = el('fsDockLive');
    const fsDockReview = el('fsDockReview');
    if (fsLiveMode) fsLiveMode.hidden = false;
    if (fsReviewMode) fsReviewMode.hidden = true;
    if (fsDockLive) fsDockLive.hidden = false;
    if (fsDockReview) fsDockReview.hidden = true;

    // Set nama lokasi
    if (presensiState.lokasi) {
      getNamaLokasi(presensiState.lokasi.lat, presensiState.lokasi.lng).then(nama => {
        if (el('camFsLoc')) el('camFsLoc').textContent = nama;
      });
    }

    // Face detection
    try {
      initFaceDetection(videoFs);
      console.log('6. Face detection initialized');
    } catch (e) {
      console.warn('6. Face detection error:', e);
    }

    if (window.refreshIcons) window.refreshIcons();
    console.log('=== Fullscreen ready ===');
  }, 300);
}

    // ============================================================
    // TAHAP 1: INIT LOKASI + GEOFENCE
    // ============================================================
    try {
      const loc = await getLocation();
      presensiState.lokasi = loc;
      const locText = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`;
      const locWithAcc = `${locText} (±${Math.round(loc.accuracy)}m)`;

      if (el('camLoc')) el('camLoc').textContent = locText;
      if (el('geoStatus')) el('geoStatus').textContent = 'Mendeteksi nama lokasi...';
      if (el('geoSub')) el('geoSub').textContent = locWithAcc;
      if (el('btnCapture')) el('btnCapture').disabled = false;

      const mapIframe = el('miniMap');
      if (mapIframe) {
        const d = 0.003;
        const bbox = `${loc.lng - d},${loc.lat - d},${loc.lng + d},${loc.lat + d}`;
        mapIframe.src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${loc.lat},${loc.lng}`;
      }

      getNamaLokasi(loc.lat, loc.lng).then(nama => {
        presensiState.lokasiNama = nama;
        if (el('camFsLoc')) el('camFsLoc').textContent = nama;
        if (el('geoStatus')) el('geoStatus').textContent = nama;
        if (el('geoSub')) el('geoSub').textContent = locWithAcc;
        if (el('fsReviewLoc')) el('fsReviewLoc').textContent = nama;
      });

      const geofence = checkGeofence(loc.lat, loc.lng);
      presensiState.isInRadius = geofence.ok;

      const badge = el('geofenceBadge');
      const badgeText = el('geofenceText');
      const lcIcon = el('lcIcon');

      if (badge && badgeText) {
        if (geofence.ok) {
          badge.classList.remove('warn');
          badge.classList.add('ok');
          badgeText.textContent = geofence.message;
        } else {
          badge.classList.remove('ok');
          badge.classList.add('warn');
          badgeText.textContent = 'Di luar radius';
        }
      }

      if (lcIcon && !geofence.ok) lcIcon.classList.add('warn');

      console.log('Location:', loc, 'Geofence:', geofence);
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
    attachSubmitHandler(el('btnSubmit'), session, pegawai);
    attachFullscreenHandlers();

    if (window.refreshIcons) window.refreshIcons();
    console.log('=== Presensi loaded ===');

  } catch (err) {
    console.error('Presensi error:', err);
  }
}

// ============================================================
// TAHAP 3: HANDLER CAPTURE (dari halaman utama)
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
// TAHAP 3: OPEN FULLSCREEN
// ============================================================
function openFullscreenDirect() {
  const el = id => document.getElementById(id);
  const modal = el('camFullscreen');
  const videoFs = el('videoFullscreen');
  if (!modal || !videoFs) return;

  // Reset mode
  if (el('fsLiveMode')) el('fsLiveMode').hidden = false;
  if (el('fsReviewMode')) el('fsReviewMode').hidden = true;
  if (el('fsDockLive')) el('fsDockLive').hidden = false;
  if (el('fsDockReview')) el('fsDockReview').hidden = true;

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
// TAHAP 4: FACE DETECTION (MediaPipe) + AUTO-CAPTURE
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
        handleAutoCapture(detected, videoEl);
      } catch (e) {}
    }, 200);

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

// ============================================================
// TAHAP 4: AUTO-CAPTURE (1.5s setelah wajah stabil)
// ============================================================
function handleAutoCapture(detected, videoEl) {
  // Jangan auto-capture kalau sudah dalam mode review
  if (presensiState.fotoBase64) return;

  const ring = document.getElementById('autoCaptureRing');
  const progress = document.getElementById('acrProgress');
  const text = document.getElementById('acrText');

  if (detected) {
    if (!presensiState.faceStableStart) {
      presensiState.faceStableStart = Date.now();
    }

    const elapsed = Date.now() - presensiState.faceStableStart;
    const remaining = Math.max(0, 1500 - elapsed);

    // Update ring
    if (ring) ring.hidden = false;
    if (text) text.textContent = (remaining / 1000).toFixed(1);
    if (progress) {
      const circumference = 276.46;
      const offset = circumference * (remaining / 1500);
      progress.style.strokeDashoffset = offset;
    }

    // Auto-capture saat sudah 1.5 detik
    if (elapsed >= 1500) {
      console.log('Auto-capture triggered');
      presensiState.faceStableStart = null;
      if (ring) ring.hidden = true;
      
      // Trigger shutter
      const shutter = document.getElementById('btnFsCapture');
      if (shutter) shutter.click();
    }
  } else {
    presensiState.faceStableStart = null;
    if (ring) ring.hidden = true;
  }
}

function stopFaceDetection() {
  if (faceDetectInterval) { clearInterval(faceDetectInterval); faceDetectInterval = null; }
  if (faceDetector) { try { faceDetector.close(); } catch (e) {} faceDetector = null; }
  faceDetectionReady = false;
  presensiState.faceStableStart = null;
  
  const guide = document.getElementById('faceGuide');
  const ring = document.getElementById('autoCaptureRing');
  guide?.classList.remove('detected');
  if (ring) ring.hidden = true;
}
// ============================================================
// TAHAP 4: FULLSCREEN HANDLERS (close, capture, switch)
// ============================================================
function attachFullscreenHandlers() {
  const el = id => document.getElementById(id);

  // ===== TUTUP FULLSCREEN =====
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

  // ===== CAPTURE DARI FULLSCREEN =====
  const btnCapFs = el('btnFsCapture');
  if (btnCapFs) {
    const newBtn = btnCapFs.cloneNode(true);
    btnCapFs.parentNode.replaceChild(newBtn, btnCapFs);
    newBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await captureFromFullscreen();
    });
  }

  // ===== GANTI KAMERA =====
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

  // ===== REVIEW: FOTO ULANG =====
  const btnReviewRetake = el('btnReviewRetake');
  if (btnReviewRetake) {
    const newBtn = btnReviewRetake.cloneNode(true);
    btnReviewRetake.parentNode.replaceChild(newBtn, btnReviewRetake);
    newBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Kembali ke live mode
      presensiState.fotoBase64 = null;
      el('fsLiveMode').hidden = false;
      el('fsReviewMode').hidden = true;
      el('fsDockLive').hidden = false;
      el('fsDockReview').hidden = true;
      
      const videoFs = el('videoFullscreen');
      if (videoFs && window.cameraStream) {
        videoFs.srcObject = window.cameraStream;
        videoFs.play();
        initFaceDetection(videoFs);
      }
    });
  }

  // ===== REVIEW: GUNAKAN FOTO =====
  const btnReviewUse = el('btnReviewUse');
  if (btnReviewUse) {
    const newBtn = btnReviewUse.cloneNode(true);
    btnReviewUse.parentNode.replaceChild(newBtn, btnReviewUse);
    newBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Tutup fullscreen, lanjut ke submit
      el('camFullscreen')?.classList.remove('open');
      stopFaceDetection();
      
      // Tampilkan preview di halaman utama
      const previewImg = el('previewImg');
      const camPreview = el('camPreview');
      const camWrap = el('camWrap');
      const btnRetake = el('btnRetake');
      const btnSubmit = el('btnSubmit');
      const infoAfter = el('infoAfter');
      
      if (previewImg) previewImg.src = presensiState.fotoBase64;
      if (camPreview) camPreview.hidden = false;
      if (camWrap) camWrap.hidden = true;
      if (btnRetake) btnRetake.hidden = false;
      if (btnSubmit) btnSubmit.hidden = false;
      if (infoAfter) infoAfter.hidden = false;
      
      toast('Foto siap dikirim', 'success');
    });
  }
}

// ============================================================
// TAHAP 5: CAPTURE + FREEZE FRAME (REVIEW MODE)
// ============================================================
async function captureFromFullscreen() {
  const el = id => document.getElementById(id);
  const videoFs = el('videoFullscreen');
  
  if (!videoFs) { toast('Video tidak ditemukan', 'error'); return; }
  if (!presensiState.lokasi) { toast('Lokasi belum terdeteksi', 'warn'); return; }

  try {
    // Capture dengan watermark
    const base64 = await captureWithWatermark(videoFs, presensiState.lokasi, 'Presensi');
    const compressed = await compressImage(base64, CONFIG.FOTO_MAX_WIDTH, CONFIG.FOTO_QUALITY);
    presensiState.fotoBase64 = compressed;

    // Stop face detection
    stopFaceDetection();

    // Matikan live mode, tampilkan review mode
    el('fsLiveMode').hidden = true;
    el('fsReviewMode').hidden = false;
    el('fsDockLive').hidden = true;
    el('fsDockReview').hidden = false;

    // Set gambar review
    const reviewImg = el('fsReviewImg');
    if (reviewImg) reviewImg.src = compressed;

    // Set info review (lokasi + waktu)
    if (el('fsReviewLoc')) {
      el('fsReviewLoc').textContent = presensiState.lokasiNama || 
        `${presensiState.lokasi.lat.toFixed(6)}, ${presensiState.lokasi.lng.toFixed(6)}`;
    }
    
    const d = getServerNow();
    const hms = [
      String(d.getHours()).padStart(2, '0'),
      String(d.getMinutes()).padStart(2, '0'),
      String(d.getSeconds()).padStart(2, '0')
    ].join(':');
    if (el('fsReviewTime')) el('fsReviewTime').textContent = hms + ' WIB';

    // Haptic feedback (kalau didukung)
    if (navigator.vibrate) navigator.vibrate(50);

    console.log('Foto di-capture, masuk mode review');

  } catch (err) {
    console.error('Capture error:', err);
    toast('Gagal ambil foto: ' + err.message, 'error');
  }
}

// ============================================================
// TAHAP 6: SUBMIT PRESENSI
// ============================================================
function attachSubmitHandler(btn, session, pegawai) {
  if (!btn) return;
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);

  newBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await submitPresensi(newBtn, session, pegawai);
  });
}

async function submitPresensi(btn, session, pegawai) {
  const el = id => document.getElementById(id);
  const status = presensiState.status;
  const ketEl = el('presKet');
  const ket = ketEl ? ketEl.value.trim() : '';

  // ============================================================
  // VALIDASI
  // ============================================================
  if (['Izin', 'Sakit'].includes(status)) {
    // Wajib surat untuk Izin/Sakit
    if (!presensiState.suratBase64) {
      toast('Surat pendukung wajib diupload untuk ' + status, 'warn');
      return;
    }
    if (!ket) {
      toast('Keterangan wajib diisi untuk ' + status, 'warn');
      return;
    }
  } else {
    // Hadir/Dinas/QR wajib foto
    if (!presensiState.fotoBase64) {
      toast('Foto wajib diambil terlebih dahulu', 'warn');
      return;
    }
    if (!presensiState.lokasi) {
      toast('Lokasi belum terdeteksi', 'warn');
      return;
    }
  }

  // ============================================================
  // GEOFENCE CHECK (kecuali Dinas Luar / QR)
  // ============================================================
  if (status === 'Hadir' && !presensiState.isInRadius) {
    const konfirmasi = confirm(
      'Anda berada di luar radius kantor. Tetap lanjutkan presensi Hadir?'
    );
    if (!konfirmasi) return;
  }

  // ============================================================
  // SHOW LOADING
  // ============================================================
  showLoading('Mengirim presensi...');
  btn.disabled = true;

  try {
    const now = getServerNow();
    const today = now.toISOString().slice(0, 10);
    const tipe = !presensiState.masuk ? 'masuk' : 'keluar';
    const timestamp = now.toISOString().replace(/[:.]/g, '-');

    let fotoUrl = null;
    let suratUrl = null;

    // ============================================================
    // UPLOAD FOTO (jika ada)
    // ============================================================
    if (presensiState.fotoBase64) {
      const namaFile = `presensi_${session.username}_${today}_${tipe}_${timestamp}.jpg`;
      const folderPath = `Presensi/${today.slice(0, 7)}/DI-${pegawai.id_di || 'X'}`;
      
      const uploadResult = await uploadFoto(presensiState.fotoBase64, namaFile, folderPath);
      if (!uploadResult.success) throw new Error(uploadResult.error || 'Upload foto gagal');
      fotoUrl = uploadResult.linkLh3;
    }

    // ============================================================
    // UPLOAD SURAT (jika ada)
    // ============================================================
    if (presensiState.suratBase64) {
      const namaFile = `surat_${session.username}_${today}_${timestamp}.jpg`;
      const folderPath = `Surat/${today.slice(0, 7)}/DI-${pegawai.id_di || 'X'}`;
      
      const uploadResult = await uploadFoto(presensiState.suratBase64, namaFile, folderPath);
      if (!uploadResult.success) throw new Error(uploadResult.error || 'Upload surat gagal');
      suratUrl = uploadResult.linkLh3;
    }

    // ============================================================
    // SIMPAN KE SUPABASE
    // ============================================================
    const jam = [
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join(':');
    
    const lokasiStr = presensiState.lokasi 
      ? `${presensiState.lokasi.lat.toFixed(6)}, ${presensiState.lokasi.lng.toFixed(6)}`
      : null;

    if (tipe === 'masuk') {
      await dbInsert('presensi', {
        id_pegawai: session.id_pegawai,
        tanggal: today,
        jam_masuk: jam,
        lokasi_masuk: lokasiStr,
        foto_masuk: fotoUrl,
        surat: suratUrl,
        status: status,
        keterangan: ket || null,
        poin: status === 'Hadir' ? 1 : 0
      });
      presensiState.masuk = now;
    } else {
      await dbUpdate('presensi', 'id_pegawai', session.id_pegawai, {
        jam_keluar: jam,
        lokasi_keluar: lokasiStr,
        foto_keluar: fotoUrl
      });
      presensiState.keluar = now;
    }

    // ============================================================
    // HIDE LOADING & TAMPILKAN MODAL SUKSES
    // ============================================================
    hideLoading();

    showSuksesModal({
      tipe: tipe,
      status: status,
      jam: jam.slice(0, 5),
      tanggal: now.toLocaleDateString('id-ID', { 
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' 
      }),
      lokasi: lokasiStr || 'Lokasi tidak tersedia',
      lokasiNama: presensiState.lokasiNama || 'Lokasi tidak diketahui',
      keterangan: ket
    });

    // ============================================================
    // TAHAP 7: RESET & UPDATE STATE
    // ============================================================
    resetPresensiForm();
    renderPresensi();

  } catch (err) {
    hideLoading();
    console.error('Submit error:', err);
    toast('Gagal: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// TAHAP 7: RESET FORM
// ============================================================
function resetPresensiForm() {
  const el = id => document.getElementById(id);
  
  // Reset foto
  presensiState.fotoBase64 = null;
  if (el('camPreview')) el('camPreview').hidden = true;
  if (el('camWrap')) el('camWrap').hidden = false;
  if (el('btnRetake')) el('btnRetake').hidden = true;
  if (el('btnSubmit')) el('btnSubmit').hidden = true;
  if (el('infoAfter')) el('infoAfter').hidden = true;
  
  // Reset surat
  presensiState.suratBase64 = null;
  if (el('suratFile')) el('suratFile').value = '';
  if (el('fuPreview')) el('fuPreview').hidden = true;
  if (el('fileUpload')) el('fileUpload').style.display = 'flex';
  
  // Reset keterangan
  if (el('presKet')) el('presKet').value = '';
}

// ============================================================
// TAHAP 6: MODAL SUKSES
// ============================================================
function showSuksesModal(data) {
  const modal = document.getElementById('suksesModal');
  if (!modal) return;

  const el = id => document.getElementById(id);

  if (el('suksesTitle')) {
    el('suksesTitle').textContent = data.tipe === 'masuk' ? 'Check-in Berhasil!' : 'Check-out Berhasil!';
  }
  if (el('suksesMsg')) {
    el('suksesMsg').textContent = `Presensi ${data.tipe} Anda telah tercatat pada sistem e-kehadiran.`;
  }
  if (el('succDate')) el('succDate').textContent = data.tanggal || '—';
  if (el('succTimeLabel')) {
    el('succTimeLabel').textContent = data.tipe === 'masuk' ? 'Jam Masuk' : 'Jam Keluar';
  }
  if (el('succTime')) el('succTime').textContent = (data.jam || '—') + ' WIB';
  if (el('succStatus')) el('succStatus').textContent = data.status || '—';
  if (el('succLocName')) el('succLocName').textContent = data.lokasiNama || '—';
  if (el('succLocCoords')) el('succLocCoords').textContent = data.lokasi || '—';

  // Keterangan (jika ada)
  const ketRow = el('succKetRow');
  const ket = el('succKet');
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
// TAHAP 6: LOADING OVERLAY
// ============================================================
function showLoading(text = 'Memproses...') {
  const overlay = document.getElementById('loadingOverlay');
  const txt = document.getElementById('loadingText');
  if (txt) txt.textContent = text;
  if (overlay) overlay.classList.add('open');
}

function hideLoading() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.remove('open');
}

// ============================================================
// TAHAP 7: RENDER PRESENSI (update timeline)
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
// EXPOSE GLOBAL
// ============================================================
window.initPresensi = initPresensi;
window.renderPresensi = renderPresensi;
window.closeSuksesModal = closeSuksesModal;
window.initFaceDetection = initFaceDetection;
window.stopFaceDetection = stopFaceDetection;
window.getNamaLokasi = getNamaLokasi;
window.openFullscreenDirect = openFullscreenDirect;
window.showLoading = showLoading;
window.hideLoading = hideLoading;
