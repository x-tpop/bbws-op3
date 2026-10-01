// ============================================================
// CAMERA.JS — Kamera, Watermark, Kompresi, Upload
// File: assets/js/camera.js
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
// CAPTURE DENGAN WATERMARK iOS FLOATING CARD
// ============================================================
async function captureWithWatermark(videoElement, lokasi, keterangan = '') {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  ctx.drawImage(videoElement, 0, 0);

  // Ambil data pegawai dari session
  const session = (typeof getSession === 'function') ? getSession() : null;
  const pegawai = session?.pegawai || {};
  const nama = pegawai.nama || session?.nama_lengkap || 'Pegawai';
  const jabatan = pegawai.jabatan || session?.role || '-';
  const status = window.presensiState?.status || 'Hadir';
  const lokasiNama = window.presensiState?.lokasiNama || null;

  // Waktu
  const d = (typeof getServerNow === 'function') ? getServerNow() : new Date();
  const jam = [String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0'), String(d.getSeconds()).padStart(2,'0')].join(':');
  const tgl = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });

  // ============================================================
  // DRAW WATERMARK iOS FLOATING CARD
  // ============================================================
  const W = canvas.width;
  const H = canvas.height;

  const padding = W * 0.04;
  const cardHeight = H * 0.13;          // lebih tinggi karena 3 baris
  const cardWidth = W - (padding * 2);
  const cardX = padding;
  const cardY = H - cardHeight - padding;
  const cornerRadius = W * 0.035;

  // 1. Shadow + Background Card
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 10;

  ctx.fillStyle = 'rgba(18, 18, 22, 0.72)';
  roundRect(ctx, cardX, cardY, cardWidth, cardHeight, cornerRadius);
  ctx.fill();

  ctx.restore();

  // 2. Border
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  roundRect(ctx, cardX, cardY, cardWidth, cardHeight, cornerRadius);
  ctx.stroke();
  ctx.restore();

  // 3. Logo PUPR (circle)
  const logoSize = cardHeight * 0.5;
  const logoX = cardX + padding * 0.9;
  const logoY = cardY + (cardHeight - logoSize) / 2;

  // Circle background putih
  ctx.save();
  ctx.beginPath();
  ctx.arc(logoX + logoSize/2, logoY + logoSize/2, logoSize/2, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();

  // Logo PUPR symbol (simplified)
  const cx = logoX + logoSize/2;
  const cy = logoY + logoSize/2;
  const r = logoSize * 0.38;

  ctx.save();
  // Yellow circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#FDB813';
  ctx.fill();

  // Blue diamond
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.75);
  ctx.lineTo(cx + r * 0.6, cy);
  ctx.lineTo(cx, cy + r * 0.75);
  ctx.lineTo(cx - r * 0.6, cy);
  ctx.closePath();
  ctx.fillStyle = '#003366';
  ctx.fill();

  // Yellow center
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = '#FDB813';
  ctx.fill();
  ctx.restore();

  // 4. Divider Line
  const divX = logoX + logoSize + padding * 0.6;
  const divY1 = cardY + cardHeight * 0.2;
  const divY2 = cardY + cardHeight * 0.8;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(divX, divY1);
  ctx.lineTo(divX, divY2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // 5. Text Info (right side)
  const textX = divX + padding * 0.7;
  const fontSize = W * 0.022;           // base font
  const fontSizeSmall = W * 0.018;
  const fontSizeLabel = W * 0.020;

  // ---- Baris 1: Nama + Jabatan ----
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${fontSize}px -apple-system, "SF Pro Text", sans-serif`;
  ctx.fillText(nama, textX, cardY + cardHeight * 0.22);

  // Jabatan (abu-abu)
  const namaWidth = ctx.measureText(nama).width;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.font = `500 ${fontSizeSmall}px -apple-system, sans-serif`;
  ctx.fillText('· ' + jabatan, textX + namaWidth + 8, cardY + cardHeight * 0.22);
  ctx.restore();

  // ---- Baris 2: Status Badge + Lokasi ----
  const row2Y = cardY + cardHeight * 0.52;

  // Status badge
  ctx.save();
  const badgeText = status;
  ctx.font = `bold ${fontSizeSmall}px -apple-system, sans-serif`;
  const badgeTextWidth = ctx.measureText(badgeText).width;
  const badgePaddingX = 10;
  const badgeHeight = fontSizeSmall * 2;
  const badgeWidth = badgeTextWidth + badgePaddingX * 2 + 12;

  // Badge color by status
  let badgeBg, badgeBorder, badgeTextColor;
  if (status === 'Izin') { badgeBg = 'rgba(255,149,0,.25)'; badgeBorder = 'rgba(255,149,0,.4)'; badgeTextColor = '#FFB340'; }
  else if (status === 'Sakit') { badgeBg = 'rgba(255,59,48,.25)'; badgeBorder = 'rgba(255,59,48,.4)'; badgeTextColor = '#FF6961'; }
  else if (status === 'Dinas Luar') { badgeBg = 'rgba(0,122,255,.25)'; badgeBorder = 'rgba(0,122,255,.4)'; badgeTextColor = '#64B5FF'; }
  else if (status === 'Kerja Gabungan') { badgeBg = 'rgba(175,82,222,.25)'; badgeBorder = 'rgba(175,82,222,.4)'; badgeTextColor = '#C77DFF'; }
  else { badgeBg = 'rgba(52,199,89,.25)'; badgeBorder = 'rgba(52,199,89,.4)'; badgeTextColor = '#4ADE80'; }

  // Badge background
  ctx.beginPath();
  roundRect(ctx, textX, row2Y - badgeHeight/2, badgeWidth, badgeHeight, badgeHeight/2);
  ctx.fillStyle = badgeBg;
  ctx.fill();
  ctx.strokeStyle = badgeBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Dot hijau
  ctx.beginPath();
  ctx.arc(textX + badgePaddingX, row2Y, 3, 0, Math.PI * 2);
  ctx.fillStyle = badgeTextColor;
  ctx.fill();

  // Teks status
  ctx.fillStyle = badgeTextColor;
  ctx.font = `bold ${fontSizeSmall}px -apple-system, sans-serif`;
  ctx.fillText(badgeText, textX + badgePaddingX + 10, row2Y);
  ctx.restore();

  // Lokasi + Koordinat
  ctx.save();
  ctx.textBaseline = 'middle';
  const locTextX = textX + badgeWidth + 8;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold ${fontSizeLabel}px -apple-system, sans-serif`;
  const locName = lokasiNama || `${lokasi.lat.toFixed(4)}, ${lokasi.lng.toFixed(4)}`;
  ctx.fillText(locName, locTextX, row2Y);

  const locNameWidth = ctx.measureText(locName).width;
  if (lokasiNama) {
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = `500 ${fontSizeSmall}px -apple-system, "SF Mono", monospace`;
    ctx.fillText(`(${lokasi.lat.toFixed(4)}, ${lokasi.lng.toFixed(4)})`, locTextX + locNameWidth + 6, row2Y);
  }
  ctx.restore();

  // ---- Baris 3: Waktu ----
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.font = `500 ${fontSizeSmall}px -apple-system, sans-serif`;
  ctx.fillText(`${tgl} • ${jam} WIB`, textX, cardY + cardHeight * 0.82);
  ctx.restore();

  return canvas.toDataURL('image/jpeg', CONFIG.FOTO_QUALITY);
}

// Helper: roundRect polyfill
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
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

// ============================================================
// EXPOSE GLOBAL
// ============================================================
window.startCamera = startCamera;
window.stopCamera = stopCamera;
window.getLocation = getLocation;
window.captureWithWatermark = captureWithWatermark;
window.compressImage = compressImage;
window.uploadFoto = uploadFoto;
