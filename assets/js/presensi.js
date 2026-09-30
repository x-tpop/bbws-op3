// ============================================================
// PRESENSI.JS — Logic halaman presensi (FIXED)
// ============================================================

const presensiState = {
  lokasi: null,
  fotoBase64: null,
  masuk: null,
  keluar: null
};

// ============================================================
// INIT PRESENSI
// ============================================================
async function initPresensi() {
  console.log('=== Init Presensi ===');

  // Guard: jangan dobel init
  if (window.__presensiInit) {
    console.log('Presensi sudah di-init, skip.');
    return;
  }
  window.__presensiInit = true;

  try {
    const session = getSession();
    if (!session) {
      console.warn('No session');
      return;
    }

    const pegawai = session.pegawai || {};
    const today = new Date().toISOString().slice(0, 10);

    // Helper null-safe
    const el = id => document.getElementById(id);

    console.log('Session:', session);
    console.log('Today:', today);

    // ============================================================
    // RENDER JAM & TANGGAL
    // ============================================================
    function tickPres() {
      const d = new Date();
      const hms = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const clock = el('presClock');
      const dateEl = el('presDate');
      const camTime = el('camTime');
      if (clock) clock.textContent = hms;
      if (dateEl) dateEl.textContent = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      if (camTime) camTime.textContent = '🕐 ' + hms + ' WIB';
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
      }
    } catch (e) { console.error('Cek presensi error:', e); }

    renderPresensi();

    // ============================================================
    // INIT KAMERA
    // ============================================================
    const video = el('video');
    if (video) {
      const ok = await startCamera(video, 'user');
      console.log('Camera:', ok);
      if (!ok) toast('Gagal akses kamera. Pastikan izin diberikan.', 'error');
    }

    // ============================================================
    // INIT LOKASI
    // ============================================================
    try {
      const loc = await getLocation();
      presensiState.lokasi = loc;
      const locText = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)} (±${Math.round(loc.accuracy)}m)`;
      const camLoc = el('camLoc');
      const geoStatus = el('geoStatus');
      if (camLoc) camLoc.textContent = '📍 ' + locText;
      if (geoStatus) geoStatus.textContent = 'Lokasi terdeteksi: ' + locText;
      const btnCapture = el('btnCapture');
      if (btnCapture) btnCapture.disabled = false;
      console.log('Location:', loc);
    } catch (err) {
      const camLoc = el('camLoc');
      const geoStatus = el('geoStatus');
      if (camLoc) camLoc.textContent = '📍 Gagal deteksi lokasi';
      if (geoStatus) geoStatus.textContent = err.message;
      console.error('Location error:', err);
    }

    // ============================================================
    // EVENT: CAPTURE
    // ============================================================
    const btnCapture = el('btnCapture');
    if (btnCapture) {
      // Clone tombol untuk bersihkan listener lama
      const newBtn = btnCapture.cloneNode(true);
      btnCapture.parentNode.replaceChild(newBtn, btnCapture);

      newBtn.addEventListener('click', async () => {
        console.log('Capture clicked');
        if (!presensiState.lokasi) { toast('Lokasi belum terdeteksi', 'warn'); return; }

        const v = el('video');
        if (!v) { toast('Video tidak ditemukan', 'error'); return; }

        try {
          const base64 = await captureWithWatermark(v, presensiState.lokasi);
          const compressed = await compressImage(base64, CONFIG.FOTO_MAX_WIDTH, CONFIG.FOTO_QUALITY);
          presensiState.fotoBase64 = compressed;

          const previewImg = el('previewImg');
          const camPreview = el('camPreview');
          const camWrap = el('camWrap');
          const btnRetake = el('btnRetake');
          const btnSubmit = el('btnSubmit');

          if (previewImg) previewImg.src = compressed;
          if (camPreview) camPreview.hidden = false;
          if (camWrap) camWrap.hidden = true;
          if (newBtn) newBtn.hidden = true;
          if (btnRetake) btnRetake.hidden = false;
          if (btnSubmit) btnSubmit.hidden = false;

          toast('Foto berhasil diambil', 'success');
        } catch (err) {
          console.error('Capture error:', err);
          toast('Gagal ambil foto: ' + err.message, 'error');
        }
      });
    }

    // ============================================================
    // EVENT: RETAKE
    // ============================================================
    const btnRetake = el('btnRetake');
    if (btnRetake) {
      const newBtn = btnRetake.cloneNode(true);
      btnRetake.parentNode.replaceChild(newBtn, btnRetake);

      newBtn.addEventListener('click', () => {
        presensiState.fotoBase64 = null;
        const camPreview = el('camPreview');
        const camWrap = el('camWrap');
        const btnCapture = el('btnCapture');
        const btnSubmit = el('btnSubmit');

        if (camPreview) camPreview.hidden = true;
        if (camWrap) camWrap.hidden = false;
        if (btnCapture) btnCapture.hidden = false;
        if (newBtn) newBtn.hidden = true;
        if (btnSubmit) btnSubmit.hidden = true;
      });
    }

    // ============================================================
    // EVENT: SUBMIT
    // ============================================================
    const btnSubmit = el('btnSubmit');
    if (btnSubmit) {
      const newBtn = btnSubmit.cloneNode(true);
      btnSubmit.parentNode.replaceChild(newBtn, btnSubmit);

      newBtn.addEventListener('click', async () => {
        if (!presensiState.fotoBase64 || !presensiState.lokasi) {
          toast('Foto atau lokasi belum siap', 'warn');
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
              status: 'Hadir',
              poin: 1
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

          toast(`Check-${tipe} berhasil pada ${jam.slice(0, 5)} WIB`, 'success');
          renderPresensi();

          // Reset UI
          const camPreview = el('camPreview');
          const camWrap = el('camWrap');
          const btnCapture = el('btnCapture');
          const btnRetake = el('btnRetake');
          if (camPreview) camPreview.hidden = true;
          if (camWrap) camWrap.hidden = false;
          if (btnCapture) btnCapture.hidden = false;
          if (btnRetake) btnRetake.hidden = true;
          if (newBtn) newBtn.hidden = true;

          presensiState.fotoBase64 = null;

        } catch (err) {
          console.error('Submit error:', err);
          toast('Gagal: ' + err.message, 'error');
        } finally {
          newBtn.disabled = false;
          newBtn.innerHTML = '<i data-lucide="check"></i>Kirim Presensi';
          if (window.refreshIcons) window.refreshIcons();
        }
      });
    }

    if (window.refreshIcons) window.refreshIcons();
    console.log('=== Presensi loaded ===');

  } catch (err) {
    console.error('Presensi error:', err);
  }
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
// EXPOSE GLOBAL
// ============================================================
window.initPresensi = initPresensi;
window.renderPresensi = renderPresensi;
