// ============================================================
// PRESENSI.JS — Logic halaman presensi
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

  try {
    const session = getSession();
    const pegawai = session?.pegawai || {};
    const today = new Date().toISOString().slice(0, 10);

    console.log('Session:', session);
    console.log('Today:', today);

    // ============================================================
    // RENDER JAM & TANGGAL
    // ============================================================
    function tickPres() {
      const d = new Date();
      const hms = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const clock = document.getElementById('presClock');
      const dateEl = document.getElementById('presDate');
      const camTime = document.getElementById('camTime');
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
    const video = document.getElementById('video');
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
      const camLoc = document.getElementById('camLoc');
      const geoStatus = document.getElementById('geoStatus');
      if (camLoc) camLoc.textContent = '📍 ' + locText;
      if (geoStatus) geoStatus.textContent = 'Lokasi terdeteksi: ' + locText;
      const btnCapture = document.getElementById('btnCapture');
      if (btnCapture) btnCapture.disabled = false;
      console.log('Location:', loc);
    } catch (err) {
      const camLoc = document.getElementById('camLoc');
      const geoStatus = document.getElementById('geoStatus');
      if (camLoc) camLoc.textContent = '📍 Gagal deteksi lokasi';
      if (geoStatus) geoStatus.textContent = err.message;
      console.error('Location error:', err);
    }

    // ============================================================
    // EVENT: CAPTURE
    // ============================================================
    const btnCapture = document.getElementById('btnCapture');
    if (btnCapture) {
      btnCapture.addEventListener('click', async () => {
        if (!presensiState.lokasi) { toast('Lokasi belum terdeteksi', 'warn'); return; }
        const v = document.getElementById('video');
        const base64 = await captureWithWatermark(v, presensiState.lokasi);
        const compressed = await compressImage(base64, CONFIG.FOTO_MAX_WIDTH, CONFIG.FOTO_QUALITY);
        presensiState.fotoBase64 = compressed;

        document.getElementById('previewImg').src = compressed;
        document.getElementById('camPreview').hidden = false;
        document.getElementById('camWrap').hidden = true;
        btnCapture.hidden = true;
        document.getElementById('btnRetake').hidden = false;
        document.getElementById('btnSubmit').hidden = false;
        toast('Foto berhasil diambil', 'success');
      });
    }

    // ============================================================
    // EVENT: RETAKE
    // ============================================================
    const btnRetake = document.getElementById('btnRetake');
    if (btnRetake) {
      btnRetake.addEventListener('click', () => {
        presensiState.fotoBase64 = null;
        document.getElementById('camPreview').hidden = true;
        document.getElementById('camWrap').hidden = false;
        document.getElementById('btnCapture').hidden = false;
        btnRetake.hidden = true;
        document.getElementById('btnSubmit').hidden = true;
      });
    }

    // ============================================================
    // EVENT: SUBMIT
    // ============================================================
    const btnSubmit = document.getElementById('btnSubmit');
    if (btnSubmit) {
      btnSubmit.addEventListener('click', async () => {
        if (!presensiState.fotoBase64 || !presensiState.lokasi) {
          toast('Foto atau lokasi belum siap', 'warn');
          return;
        }

        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite"></span> Mengirim...';

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

          // Reset
          document.getElementById('camPreview').hidden = true;
          document.getElementById('camWrap').hidden = false;
          document.getElementById('btnCapture').hidden = false;
          document.getElementById('btnRetake').hidden = true;
          document.getElementById('btnSubmit').hidden = true;
          presensiState.fotoBase64 = null;

        } catch (err) {
          console.error(err);
          toast('Gagal: ' + err.message, 'error');
        } finally {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = '<i data-lucide="check"></i>Kirim Presensi';
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
