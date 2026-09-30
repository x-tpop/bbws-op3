// ============================================================
// CAMERA.JS — Kamera, Watermark, Kompresi, Upload
// ============================================================

let cameraStream = null;

// ============================================================
// START CAMERA
// ============================================================
async function startCamera(videoElement, facingMode = 'user') {
  try {
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    videoElement.srcObject = cameraStream;
    await videoElement.play();
    return true;
  } catch (err) {
    console.error('Camera error:', err);
    return false;
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
}

// ============================================================
// GEOLOKASI
// ============================================================
function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error('Geolokasi tidak didukung browser'));
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      }),
      err => reject(new Error('Gagal ambil lokasi: ' + err.message)),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

// ============================================================
// WATERMARK + CAPTURE
// ============================================================
async function captureWithWatermark(videoElement, lokasi, keterangan = '') {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  ctx.drawImage(videoElement, 0, 0);

  // Watermark background
  const wmH = 130;
  ctx.fillStyle = 'rgba(30, 58, 138, 0.85)';
  ctx.fillRect(0, canvas.height - wmH, canvas.width, wmH);

  // Border kuning
  ctx.fillStyle = '#FBB917';
  ctx.fillRect(0, canvas.height - wmH - 4, canvas.width, 4);

  // Timestamp
  const now = new Date();
  const timestamp = now.toLocaleString('id-ID', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });

  // Teks
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('📍 ' + lokasi.lat.toFixed(6) + ', ' + lokasi.lng.toFixed(6), 20, canvas.height - wmH + 35);

  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('🕐 ' + timestamp + ' WIB', 20, canvas.height - wmH + 68);

  ctx.font = '600 16px sans-serif';
  ctx.fillStyle = '#FBB917';
  ctx.fillText('BBWS Brantas — Portal Pegawai', 20, canvas.height - wmH + 100);

  if (keterangan) {
    ctx.font = '500 14px sans-serif';
    ctx.fillStyle = '#E0E7FF';
    ctx.fillText(keterangan, 20, canvas.height - wmH + 122);
  }

  return canvas.toDataURL('image/jpeg', CONFIG.FOTO_QUALITY);
}

// ============================================================
// KOMPRESI
// ============================================================
function compressImage(base64, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      if (w > maxWidth) { h = (h * maxWidth) / w; w = maxWidth; }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = base64;
  });
}

// ============================================================
// UPLOAD KE APPS SCRIPT
// ============================================================
async function uploadFoto(base64, namaFile, folderPath) {
  try {
    const response = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'uploadFoto',
        base64: base64,
        namaFile: namaFile,
        folderPath: folderPath
      })
    });
    return await response.json();
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Expose global
window.startCamera = startCamera;
window.stopCamera = stopCamera;
window.getLocation = getLocation;
window.captureWithWatermark = captureWithWatermark;
window.compressImage = compressImage;
window.uploadFoto = uploadFoto;