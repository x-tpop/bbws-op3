// ============================================================
// PRESENSI-FULL.JS — Logic halaman presensi (v18)
// Fitur: Server time, Geofence, Kompensasi waktu kerja (telat →
//        pulang wajib +X mnt), Hero + Minibar (gaya WhatsApp),
//        Pengajuan (Sakit/Izin/Dinas/Lupa Absen via pengajuan.js),
//        Timeline dinamis, Kunci segmented, Leaflet Map,
//        Guard presensi selesai, Checkout berfilter tanggal
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
  faceStableStart: null,
  pengaturan: {
    jam_masuk: '07:30',
    jam_pulang: '16:30',
    toleransi_terlambat: 15,
    batas_checkout_awal: 30,
    hari_kerja: '1,2,3,4,5',
    poin_tepat_waktu: 1,
    poin_terlambat: 0,
    poin_pulang_cepat: 0,
    poin_tidak_checkout: 0
  }
};

// ============================================================
// SERVER TIME
// ============================================================
async function syncServerTime() {
  const badge = document.getElementById('serverBadge');
  const el = document.getElementById('serverTime');

  try {
    const { data, error } = await supabaseClient.rpc('get_server_time');
    if (!error && data) {
      const serverTime = new Date(data);
      presensiState.serverOffset = serverTime.getTime() - Date.now();
      if (badge) badge.classList.remove('error');
      if (el) el.textContent = 'Server OK';
      console.log('Server time (Supabase):', serverTime);
      return true;
    }
    throw new Error('Supabase time tidak tersedia');
  } catch (e) {
    try {
      const res = await fetch('https://worldtimeapi.org/api/timezone/Asia/Jakarta', {
        signal: AbortSignal.timeout(3000)
      });
      const json = await res.json();
      const serverTime = new Date(json.datetime);
      presensiState.serverOffset = serverTime.getTime() - Date.now();
      if (badge) badge.classList.remove('error');
      if (el) el.textContent = 'Server OK';
      return true;
    } catch (e2) {
      if (badge) badge.classList.add('error');
      if (el) el.textContent = 'Device Time';
      return false;
    }
  }
}

function getServerNow() {
  return new Date(Date.now() + presensiState.serverOffset);
}

// ============================================================
// HELPER: jam pulang wajib (dengan kompensasi telat)
// ★ BARU v18: dipakai bersama oleh timeline, status & render
// ============================================================
function getPulangWajibMenit() {
  const p = presensiState.pengaturan;
  const [ph, pm] = p.jam_pulang.split(':').map(Number);
  let menitPulang = ph * 60 + pm;

  if (presensiState.masuk) {
    const [mh, mm] = p.jam_masuk.split(':').map(Number);
    const menitCheckin = presensiState.masuk.getHours() * 60 + presensiState.masuk.getMinutes();
    const telat = Math.max(0, menitCheckin - (mh * 60 + mm));
    menitPulang += telat;
  }
  return menitPulang;
}

function fmtMenit(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// ============================================================
// UPDATE TIMELINE PROGRESS BAR DINAMIS
// ★ PATCH v18: ujung timeline mengikuti jam pulang WAJIB
// (kompensasi telat) — masuk 08:10 → track memanjang ke 16:40
// ============================================================
function updateTimelineProgress() {
  const fill = document.getElementById('timelineFill');
  if (!fill) return;

  const p = presensiState.pengaturan;
  const now = getServerNow();
  const menitSekarang = now.getHours() * 60 + now.getMinutes();

  const [mh, mm] = p.jam_masuk.split(':').map(Number);
  const menitMasuk = mh * 60 + mm;
  const menitPulang = getPulangWajibMenit(); // ★ sudah termasuk kompensasi

  let persen = 0;

  if (presensiState.masuk) {
    const menitCheckin = presensiState.masuk.getHours() * 60 + presensiState.masuk.getMinutes();
    const totalDurasi = menitPulang - menitCheckin;
    const elapsed = menitSekarang - menitCheckin;
    persen = totalDurasi > 0 ? Math.min(100, Math.max(0, (elapsed / totalDurasi) * 100)) : 100;
  } else {
    if (menitSekarang < menitMasuk) persen = 0;
    else if (menitSekarang > menitPulang) persen = 100;
    else persen = ((menitSekarang - menitMasuk) / (menitPulang - menitMasuk)) * 100;
  }

  if (presensiState.keluar) persen = 100;

  fill.style.width = persen + '%';
  fill.style.background = persen >= 100
    ? 'linear-gradient(90deg, #007AFF 0%, #0051D5 100%)'
    : 'linear-gradient(90deg, #34C759 0%, #30B750 100%)';
}

// ============================================================
// LOAD PENGATURAN JAM KERJA
// ============================================================
async function loadAppSettings() {
  try {
    const { data, error } = await supabaseClient
      .from('pengaturan')
      .select('kunci, nilai');

    if (error) throw error;

    const s = {};
    (data || []).forEach(r => { s[r.kunci] = r.nilai; });

    if (s.jam_masuk) presensiState.pengaturan.jam_masuk = s.jam_masuk;
    if (s.jam_pulang) presensiState.pengaturan.jam_pulang = s.jam_pulang;
    if (s.toleransi_terlambat) presensiState.pengaturan.toleransi_terlambat = parseInt(s.toleransi_terlambat);
    if (s.batas_checkout_awal) presensiState.pengaturan.batas_checkout_awal = parseInt(s.batas_checkout_awal);
    if (s.hari_kerja) presensiState.pengaturan.hari_kerja = s.hari_kerja;
    if (s.poin_tepat_waktu) presensiState.pengaturan.poin_tepat_waktu = parseInt(s.poin_tepat_waktu);
    if (s.poin_terlambat) presensiState.pengaturan.poin_terlambat = parseInt(s.poin_terlambat);
    if (s.poin_pulang_cepat) presensiState.pengaturan.poin_pulang_cepat = parseInt(s.poin_pulang_cepat);
    if (s.poin_tidak_checkout) presensiState.pengaturan.poin_tidak_checkout = parseInt(s.poin_tidak_checkout);

    if (s.kantor_lat) presensiState.kantorLat = parseFloat(s.kantor_lat);
    if (s.kantor_lng) presensiState.kantorLng = parseFloat(s.kantor_lng);
    if (s.radius_kantor) presensiState.kantorRadius = parseInt(s.radius_kantor);

    window.APP_SETTINGS = s;
    console.log('Pengaturan dimuat:', presensiState.pengaturan);
    return s;

  } catch (err) {
    console.warn('Load pengaturan gagal, pakai default:', err);
    return presensiState.pengaturan;
  }
}

// ============================================================
// CEK STATUS PRESENSI
// ★ PATCH v18: untuk checkout, baseline = jam pulang WAJIB
// (jam_pulang + telat check-in). Hadir 08:10 → checkout 16:40
// dihitung TEPAT WAKTU; 16:35 = pulang cepat 5 mnt.
// ============================================================
function getPresensiStatus(jamStr, tipe = 'masuk') {
  const p = presensiState.pengaturan;
  const [h, m] = jamStr.split(':').map(Number);
  const menitSekarang = h * 60 + m;

  if (tipe === 'masuk') {
    const [jh, jm] = p.jam_masuk.split(':').map(Number);
    const batasMasuk = jh * 60 + jm;
    const batasToleransi = batasMasuk + p.toleransi_terlambat;

    if (menitSekarang <= batasMasuk) {
      return { status: 'tepat_waktu', label: 'Tepat Waktu', poin: p.poin_tepat_waktu, warna: 'hijau' };
    } else if (menitSekarang <= batasToleransi) {
      const telat = menitSekarang - batasMasuk;
      return { status: 'toleransi', label: `Toleransi +${telat}m`, poin: p.poin_tepat_waktu, warna: 'kuning' };
    } else {
      const telat = menitSekarang - batasMasuk;
      return { status: 'terlambat', label: `Terlambat ${telat}m`, poin: p.poin_terlambat, warna: 'merah' };
    }
  } else {
    const batasPulang = getPulangWajibMenit(); // ★ termasuk kompensasi
    const telat = batasPulang - (parseInt(p.jam_pulang) * 60);

    if (menitSekarang >= batasPulang) {
      return {
        status: 'tepat_waktu',
        label: telat > 0 ? `Tepat Waktu (kompensasi +${telat}m)` : 'Tepat Waktu',
        poin: p.poin_tepat_waktu,
        warna: 'hijau'
      };
    } else {
      const cepat = batasPulang - menitSekarang;
      return { status: 'pulang_cepat', label: `Pulang Cepat ${cepat}m`, poin: p.poin_pulang_cepat, warna: 'oranye' };
    }
  }
}

// ============================================================
// CEK BOLEH CHECKOUT
// ★ PATCH v18 (kompensasi waktu kerja):
// - Tanpa telat  : boleh checkout dari (jam_pulang - batas_checkout_awal)
// - Dengan telat : boleh checkout dari jam PULANG WAJIB
//                  (jam_pulang + telat) — hadir 08:10 → pulang 16:40
// Berlaku untuk presensi normal & Kerja Gabungan (QR).
// ============================================================
function isCheckoutAllowed() {
  const p = presensiState.pengaturan;
  const [jh, jm] = p.jam_masuk.split(':').map(Number);
  const menitMasukStd = jh * 60 + jm;
  const menitPulang = getPulangWajibMenit();

  let telat = 0;
  if (presensiState.masuk) {
    const menitCheckin = presensiState.masuk.getHours() * 60 + presensiState.masuk.getMinutes();
    telat = Math.max(0, menitCheckin - menitMasukStd);
  }

  // Telat → batas = pulang wajib; tepat waktu → batas = pulang - buffer
  const batas = telat > 0 ? menitPulang : (menitPulang - p.batas_checkout_awal);

  const now = getServerNow();
  const menitSekarang = now.getHours() * 60 + now.getMinutes();

  return {
    allowed: menitSekarang >= batas,
    batasJam: fmtMenit(batas),
    pulangWajibJam: fmtMenit(menitPulang),
    telat,
    menitSekarang
  };
}

// ============================================================
// CEK HARI KERJA
// ============================================================
function isHariKerja() {
  const p = presensiState.pengaturan;
  const hariKerja = p.hari_kerja.split(',');
  const today = getServerNow().getDay() || 7;
  return hariKerja.includes(String(today));
}

// ============================================================
// GEOFENCE
// ============================================================
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
// INIT PETA LEAFLET
// ============================================================
let miniMap = null;
let userMarker = null;
let officeCircle = null;

function initMiniMap(lat, lng) {
  if (!window.L) {
    console.warn('Leaflet belum dimuat');
    return;
  }

  if (!miniMap) {
    miniMap = L.map('miniMap', {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      tap: false,
      attributionControl: true
    }).setView([lat, lng], 16);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    }).addTo(miniMap);
  } else {
    miniMap.setView([lat, lng], 16);
  }

  if (userMarker) userMarker.remove();
  userMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: 'user-marker-icon',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    })
  }).addTo(miniMap);

  if (officeCircle) officeCircle.remove();
  officeCircle = null;
  if (presensiState.kantorLat && presensiState.kantorLng) {
    officeCircle = L.circle([presensiState.kantorLat, presensiState.kantorLng], {
      radius: presensiState.kantorRadius,
      color: '#007AFF',
      weight: 1.5,
      fillColor: '#007AFF',
      fillOpacity: 0.08
    }).addTo(miniMap);
  }

  setTimeout(() => { if (miniMap) miniMap.invalidateSize(); }, 150);
  setTimeout(() => { if (miniMap) miniMap.invalidateSize(); }, 600);
}

// ============================================================
// ★ BARU v18: HERO + MINIBAR (gaya profil WhatsApp)
// Foto profil pop-out di cover; saat scroll >200px, minibar
// sticky muncul dari atas berisi foto kecil + nama + jam live.
// ============================================================
function initHeroUI(pegawai, session) {
  const el = id => document.getElementById(id);
  const nama = pegawai.nama || session.nama_lengkap || 'Pegawai';

  if (el('heroNama')) el('heroNama').textContent = nama;
  if (el('miniNama')) el('miniNama').textContent = nama;
  if (el('heroJabatan')) el('heroJabatan').textContent = pegawai.jabatan || session.role || '-';
  if (el('heroNpk')) el('heroNpk').textContent = pegawai.nomor_identitas || session.username || '—';

  const av = pegawai.link_foto_2 || pegawai.link_foto_1;
  if (av) ['heroAvatar', 'miniAvatar'].forEach(id => { const i = el(id); if (i) i.src = av; });

  const bar = el('presMiniBar');
  if (window.__heroScrollHandler) window.removeEventListener('scroll', window.__heroScrollHandler);
  if (bar) {
    window.__heroScrollHandler = () => {
      if (!document.body.contains(bar)) return; // halaman sudah diganti (SPA)
      bar.classList.toggle('show', window.scrollY > 200);
    };
    window.addEventListener('scroll', window.__heroScrollHandler, { passive: true });
    window.__heroScrollHandler();
  }
}

// ============================================================
// INIT UTAMA
// ============================================================
async function initPresensi() {
  console.log('=== Init Presensi (Full v18) ===');

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

    await loadAppSettings();
    await syncServerTime();

    // ============================================================
    // JAM LIVE + TIMELINE PROGRESS
    // ★ PATCH v18: jam live juga di minibar
    // ============================================================
    function tickPres() {
      const d = getServerNow();
      const hms = [String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0'), String(d.getSeconds()).padStart(2,'0')].join(':');
      const hm = [String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0')].join(':');
      if (el('presClock')) el('presClock').textContent = hms;
      if (el('presDate')) el('presDate').textContent = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      if (el('miniClock')) el('miniClock').textContent = hm;          // ★ BARU
      if (el('camTime')) el('camTime').textContent = hms;
      if (el('camFsTime')) el('camFsTime').textContent = hm + ' WIB';
      if (el('fsReviewTime')) el('fsReviewTime').textContent = hms + ' WIB';

      updateTimelineProgress();
    }
    tickPres();
    if (window.__presInterval) clearInterval(window.__presInterval);
    window.__presInterval = setInterval(tickPres, 1000);

    // ============================================================
    // CEK PRESENSI HARI INI
    // ★ PATCH v18: status dari DB dipaksa ke domain segmented baru
    // (Hadir / Kerja Gabungan) — Sakit/Izin/Dinas kini lewat
    // Pengajuan, bukan presensi langsung.
    // ============================================================
    const today = localDateStr(getServerNow());
    try {
      const { data } = await supabaseClient
        .from('presensi').select('*')
        .eq('id_pegawai', session.id_pegawai)
        .eq('tanggal', today).maybeSingle();
      if (data) {
        presensiState.masuk = data.jam_masuk ? new Date(today + 'T' + data.jam_masuk) : null;
        presensiState.keluar = data.jam_keluar ? new Date(today + 'T' + data.jam_keluar) : null;
        if (data.status) {
          presensiState.status = ['Hadir', 'Kerja Gabungan'].includes(data.status)
            ? data.status : 'Hadir';
        }
      }
    } catch (e) { console.error(e); }

    renderPresensi();

    // ============================================================
    // SEGMENTED CONTROL — hanya Hadir & Kerja Gabungan (QR)
    // ★ PATCH v18: Sakit/Izin/Dinas Luar/Lupa Absen pindah ke
    // modal Pengajuan (pengajuan.js). ketWrap/suratWrap tidak
    // ada lagi di HTML — fungsi disederhanakan & null-safe.
    // ============================================================
    const segButtons = document.querySelectorAll('.seg-btn');
    const segmented = el('segmentedStatus');
    const camCard = document.querySelector('.card-camera');

    function updateFormByStatus(status) {
      const note = el('presNote');
      if (note) {
        if (status === 'Kerja Gabungan') {
          note.textContent = 'Kerja Gabungan (QR) — Anda bisa presensi dari mana saja.';
        } else {
          note.textContent = 'Silakan lakukan check-in dengan foto berwatermark GPS.';
        }
      }

      updateWatermarkData();
    }

    segButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (segmented && segmented.classList.contains('locked')) {
          toast('Status terkunci setelah check-in', 'warn');
          return;
        }
        segButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        presensiState.status = btn.dataset.status;
        updateFormByStatus(presensiState.status);
      });
    });

    if (presensiState.status) {
      segButtons.forEach(b => b.classList.toggle('active', b.dataset.status === presensiState.status));
      updateFormByStatus(presensiState.status);
    }

    // Kunci segmented saat sudah check-in & belum checkout
    // ★ PATCH v18: b.disabled dihapus — klik diteruskan ke guard JS
    // agar toast "Status terkunci" tampil
    if (presensiState.masuk && !presensiState.keluar && segmented) {
      segmented.classList.add('locked');
      console.log('Segmented terkunci:', presensiState.status);
    }

    // ============================================================
    // INIT LOKASI + GEOFENCE + PETA
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

      initMiniMap(loc.lat, loc.lng);

      getNamaLokasi(loc.lat, loc.lng).then(nama => {
        presensiState.lokasiNama = nama;
        if (el('camFsLoc')) el('camFsLoc').textContent = nama;
        if (el('geoStatus')) el('geoStatus').textContent = nama;
        if (el('geoSub')) el('geoSub').textContent = locWithAcc;
        if (el('fsReviewLoc')) el('fsReviewLoc').textContent = nama;
        updateWatermarkData();
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
    attachCaptureHandler(el('btnCapture'));
    attachRetakeHandler(el('btnRetake'));
    attachSubmitHandler(el('btnSubmit'), session, pegawai);
    attachFullscreenHandlers();

    updateWatermarkData();
    if (window.__wmInterval) clearInterval(window.__wmInterval);
    window.__wmInterval = setInterval(updateWatermarkData, 1000);

    // ============================================================
    // ★ BARU v18: HERO + MINIBAR + PENGAJUAN
    // ============================================================
    initHeroUI(pegawai, session);
    if (typeof window.initPengajuan === 'function') {
      try { await window.initPengajuan(session); }
      catch (e) { console.warn('initPengajuan gagal:', e); }
    }

    if (window.refreshIcons) window.refreshIcons();
    console.log('=== Presensi loaded ===');

  } catch (err) {
    console.error('Presensi error:', err);
  }
}

// ============================================================
// WATERMARK UPDATE
// ============================================================
function updateWatermarkData() {
  const el = id => document.getElementById(id);
  const session = getSession();
  const pegawai = session?.pegawai || {};

  if (el('wmName')) el('wmName').textContent = pegawai.nama || session?.nama_lengkap || 'Pegawai';
  if (el('wmJabatan')) el('wmJabatan').textContent = pegawai.jabatan || session?.role || '-';

  if (el('wmStatus')) {
    const badge = el('wmStatus');
    const text = badge.querySelector('.sb-text');
    const status = presensiState.status;
    if (text) text.textContent = status;

    badge.classList.remove('izin','sakit','dinas','qr');
    if (status === 'Izin') badge.classList.add('izin');
    else if (status === 'Sakit') badge.classList.add('sakit');
    else if (status === 'Dinas Luar') badge.classList.add('dinas');
    else if (status === 'Kerja Gabungan') badge.classList.add('qr');
  }

  if (presensiState.lokasi) {
    if (el('wmLocName')) el('wmLocName').textContent = presensiState.lokasiNama || 'Mendeteksi...';
    if (el('wmCoords')) el('wmCoords').textContent =
      `${presensiState.lokasi.lat.toFixed(6)}, ${presensiState.lokasi.lng.toFixed(6)}`;
  }

  if (el('wmTime')) {
    const d = getServerNow();
    const jam = [String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0'), String(d.getSeconds()).padStart(2,'0')].join(':');
    const tgl = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    el('wmTime').textContent = `${tgl} • ${jam} WIB`;
  }
}

// ============================================================
// HANDLER TOMBOL "BUKA KAMERA"
// ★ PATCH v18: pesan checkout menyebut jam pulang wajib
// saat ada kompensasi telat
// ============================================================
function attachCaptureHandler(btn) {
  if (!btn) return;
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);

  newBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isHariKerja()) {
      toast('Hari ini bukan hari kerja', 'warn');
      return;
    }

    // Guard presensi selesai — cegah checkout kedua
    if (presensiState.masuk && presensiState.keluar) {
      toast('Presensi hari ini sudah selesai', 'warn');
      return;
    }

    if (presensiState.masuk && !presensiState.keluar) {
      const cek = isCheckoutAllowed();
      if (!cek.allowed) {
        toast(cek.telat > 0
          ? `Pulang wajib ${cek.batasJam} WIB (kompensasi telat +${cek.telat} mnt)`
          : `Checkout baru bisa dari ${cek.batasJam} WIB`, 'warn');
        return;
      }
    }

    openFullscreenDirect();
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

    if (el('camPreview')) { el('camPreview').hidden = true; el('camPreview').style.display = 'none'; }
    if (el('camWrap')) { el('camWrap').hidden = false; el('camWrap').style.display = 'flex'; }
    if (el('btnRetake')) { el('btnRetake').hidden = true; el('btnRetake').style.display = 'none'; }
    if (el('btnSubmit')) { el('btnSubmit').hidden = true; el('btnSubmit').style.display = 'none'; }
    if (el('infoAfter')) { el('infoAfter').hidden = true; el('infoAfter').style.display = 'none'; }
  });
}

// ============================================================
// OPEN FULLSCREEN
// ============================================================
function openFullscreenDirect() {
  console.log('=== openFullscreenDirect ===');
  const el = id => document.getElementById(id);

  const modal = el('camFullscreen');
  if (!modal) {
    console.error('Modal camFullscreen TIDAK ADA!');
    toast('Camera modal tidak tersedia', 'error');
    return;
  }

  modal.classList.add('open');

  const fsLiveMode = el('fsLiveMode');
  const fsReviewMode = el('fsReviewMode');
  const fsDockLive = el('fsDockLive');
  const fsDockReview = el('fsDockReview');
  if (fsLiveMode) fsLiveMode.hidden = false;
  if (fsReviewMode) fsReviewMode.hidden = true;
  if (fsDockLive) fsDockLive.hidden = false;
  if (fsDockReview) fsDockReview.hidden = true;

  presensiState.fotoBase64 = null;
  updateWatermarkData();

  setTimeout(async () => {
    const videoFs = el('videoFullscreen');
    if (!videoFs) {
      console.error('VideoFullscreen TIDAK ADA!');
      toast('Video element tidak ditemukan', 'error');
      return;
    }

    try {
      if (window.cameraStream && window.cameraStream.active) {
        videoFs.srcObject = window.cameraStream;
        await videoFs.play();
        console.log('Stream attached');
      } else {
        const ok = await startCamera(videoFs, presensiState.facingMode);
        if (!ok) {
          toast('Gagal buka kamera', 'error');
          return;
        }
      }
    } catch (e) {
      console.error('Video stream error:', e);
      toast('Gagal memuat kamera', 'error');
      return;
    }

    if (presensiState.lokasi) {
      getNamaLokasi(presensiState.lokasi.lat, presensiState.lokasi.lng).then(nama => {
        if (el('camFsLoc')) el('camFsLoc').textContent = nama;
      });
    }

    try {
      initFaceDetection(videoFs);
    } catch (e) {
      console.warn('Face detection error:', e);
    }

    if (window.refreshIcons) window.refreshIcons();
    console.log('=== Fullscreen ready ===');
  }, 200);
}

// ============================================================
// FACE DETECTION
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
    console.log('MediaPipe aktif');

    if (faceDetectInterval) clearInterval(faceDetectInterval);
    faceDetectInterval = setInterval(() => {
      if (!videoEl || videoEl.readyState < 2 || !faceDetector) return;
      try {
        const result = faceDetector.detectForVideo(videoEl, performance.now());
        const detected = result.detections && result.detections.length > 0;
        updateFaceUI(detected);
        handleAutoCapture(detected);
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

function handleAutoCapture(detected) {
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

    if (ring) ring.hidden = false;
    if (text) text.textContent = (remaining / 1000).toFixed(1);
    if (progress) {
      const circumference = 276.46;
      const offset = circumference * (remaining / 1500);
      progress.style.strokeDashoffset = offset;
    }

    if (elapsed >= 1500) {
      console.log('Auto-capture triggered');
      presensiState.faceStableStart = null;
      if (ring) ring.hidden = true;
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
// FULLSCREEN HANDLERS
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
      if (typeof stopCamera === 'function') stopCamera();
      const v = el('videoFullscreen');
      if (v) v.srcObject = null;
    });
  }

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

  const btnReviewRetake = el('btnReviewRetake');
  if (btnReviewRetake) {
    const newBtn = btnReviewRetake.cloneNode(true);
    btnReviewRetake.parentNode.replaceChild(newBtn, btnReviewRetake);
    newBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      presensiState.fotoBase64 = null;
      el('fsLiveMode').hidden = false;
      el('fsReviewMode').hidden = true;
      el('fsDockLive').hidden = false;
      el('fsDockReview').hidden = true;

      const videoFs = el('videoFullscreen');
      if (videoFs) {
        if (window.cameraStream && window.cameraStream.active) {
          videoFs.srcObject = window.cameraStream;
          videoFs.play();
        } else {
          await startCamera(videoFs, presensiState.facingMode);
        }
        initFaceDetection(videoFs);
      }
    });
  }

  const btnReviewUse = el('btnReviewUse');
  if (btnReviewUse) {
    const newBtn = btnReviewUse.cloneNode(true);
    btnReviewUse.parentNode.replaceChild(newBtn, btnReviewUse);
    newBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      el('camFullscreen')?.classList.remove('open');
      stopFaceDetection();
      if (typeof stopCamera === 'function') stopCamera();
      const vFs = el('videoFullscreen');
      if (vFs) vFs.srcObject = null;

      const previewImg = el('previewImg');
      const camPreview = el('camPreview');
      const camWrap = el('camWrap');
      const btnRetake = el('btnRetake');
      const btnSubmit = el('btnSubmit');
      const infoAfter = el('infoAfter');

      if (previewImg) previewImg.src = presensiState.fotoBase64;
      if (camPreview) { camPreview.hidden = false; camPreview.style.display = 'block'; }
      if (camWrap) { camWrap.hidden = true; camWrap.style.display = 'none'; }
      if (btnRetake) { btnRetake.hidden = false; btnRetake.style.display = 'flex'; }
      if (btnSubmit) { btnSubmit.hidden = false; btnSubmit.style.display = 'flex'; }
      if (infoAfter) { infoAfter.hidden = false; infoAfter.style.display = 'flex'; }

      toast('Foto siap dikirim', 'success');
    });
  }
}

// ============================================================
// CAPTURE + FREEZE FRAME
// ============================================================
async function captureFromFullscreen() {
  const el = id => document.getElementById(id);
  const videoFs = el('videoFullscreen');

  if (!videoFs) { toast('Video tidak ditemukan', 'error'); return; }
  if (!presensiState.lokasi) { toast('Lokasi belum terdeteksi', 'warn'); return; }

  try {
    const base64 = await captureWithWatermark(videoFs, presensiState.lokasi, 'Presensi');
    const compressed = await compressImage(base64, CONFIG.FOTO_MAX_WIDTH, CONFIG.FOTO_QUALITY);
    presensiState.fotoBase64 = compressed;

    stopFaceDetection();

    el('fsLiveMode').hidden = true;
    el('fsReviewMode').hidden = false;
    el('fsDockLive').hidden = true;
    el('fsDockReview').hidden = false;

    const reviewImg = el('fsReviewImg');
    if (reviewImg) reviewImg.src = compressed;

    if (el('fsReviewLoc')) {
      el('fsReviewLoc').textContent = presensiState.lokasiNama ||
        `${presensiState.lokasi.lat.toFixed(6)}, ${presensiState.lokasi.lng.toFixed(6)}`;
    }

    const d = getServerNow();
    const hms = [String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0'), String(d.getSeconds()).padStart(2,'0')].join(':');
    if (el('fsReviewTime')) el('fsReviewTime').textContent = hms + ' WIB';

    if (navigator.vibrate) navigator.vibrate(50);
    console.log('Masuk mode review');
  } catch (err) {
    console.error('Capture error:', err);
    toast('Gagal ambil foto: ' + err.message, 'error');
  }
}

// ============================================================
// SUBMIT
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

  // Guard presensi selesai (double protection)
  if (presensiState.masuk && presensiState.keluar) {
    toast('Presensi hari ini sudah selesai', 'warn');
    return;
  }

  // ★ PATCH v18: validasi disederhanakan — segmented hanya Hadir/QR.
  // Sakit/Izin/Dinas/Lupa Absen kini lewat modal Pengajuan
  // (pengajuan.js), bukan lewat form presensi.
  if (!presensiState.fotoBase64) { toast('Foto wajib diambil', 'warn'); return; }
  if (!presensiState.lokasi) { toast('Lokasi belum terdeteksi', 'warn'); return; }

  if (status === 'Hadir' && !presensiState.isInRadius) {
    if (!confirm('Anda berada di luar radius kantor. Tetap lanjutkan presensi Hadir?')) return;
  }

  const now = getServerNow();
  const jam = [String(now.getHours()).padStart(2,'0'), String(now.getMinutes()).padStart(2,'0'), String(now.getSeconds()).padStart(2,'0')].join(':');
  const tipe = !presensiState.masuk ? 'masuk' : 'keluar';

  const statusInfo = getPresensiStatus(jam, tipe);
  const poin = statusInfo.poin;

  showLoading('Mengirim presensi...');
  btn.disabled = true;

  try {
    const today = localDateStr(now);
    const timestamp = now.toISOString().replace(/[:.]/g, '-');

    let fotoUrl = null;
    let suratUrl = null;

    if (presensiState.fotoBase64) {
      const namaFile = `presensi_${session.username}_${today}_${tipe}_${timestamp}.jpg`;
      const folderPath = `Presensi/${today.slice(0, 7)}/DI-${pegawai.id_di || 'X'}`;
      const uploadResult = await uploadFoto(presensiState.fotoBase64, namaFile, folderPath);
      if (!uploadResult.success) throw new Error(uploadResult.error || 'Upload foto gagal');
      fotoUrl = uploadResult.linkLh3;
    }

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
        poin: poin,
        status_kehadiran: statusInfo.status,
        catatan_kehadiran: statusInfo.label
      });
      presensiState.masuk = now;
    } else {
      // Checkout WAJIB berfilter tanggal — jangan pernah hapus filter ini
      await dbUpdate('presensi', 'id_pegawai', session.id_pegawai, {
        jam_keluar: jam,
        lokasi_keluar: lokasiStr,
        foto_keluar: fotoUrl,
        poin_keluar: poin,
        status_kehadiran_keluar: statusInfo.status
      }, { tanggal: today });
      presensiState.keluar = now;
    }

    hideLoading();

    showSuksesModal({
      tipe: tipe,
      status: status,
      jam: jam.slice(0, 5),
      tanggal: now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      lokasi: lokasiStr || 'Lokasi tidak tersedia',
      lokasiNama: presensiState.lokasiNama || 'Lokasi tidak diketahui',
      keterangan: ket,
      statusInfo: statusInfo
    });

    resetPresensiForm();
    renderPresensi();
    updateTimelineProgress();

  } catch (err) {
    hideLoading();
    console.error('Submit error:', err);
    toast('Gagal: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// RESET FORM
// ============================================================
function resetPresensiForm() {
  const el = id => document.getElementById(id);

  presensiState.fotoBase64 = null;
  if (el('camPreview')) { el('camPreview').hidden = true; el('camPreview').style.display = 'none'; }
  if (el('camWrap')) { el('camWrap').hidden = false; el('camWrap').style.display = 'flex'; }
  if (el('btnRetake')) { el('btnRetake').hidden = true; el('btnRetake').style.display = 'none'; }
  if (el('btnSubmit')) { el('btnSubmit').hidden = true; el('btnSubmit').style.display = 'none'; }
  if (el('infoAfter')) { el('infoAfter').hidden = true; el('infoAfter').style.display = 'none'; }

  presensiState.suratBase64 = null;

  if (el('presKet')) el('presKet').value = '';
}

// ============================================================
// MODAL SUKSES
// ============================================================
function showSuksesModal(data) {
  const modal = document.getElementById('suksesModal');
  if (!modal) return;

  const el = id => document.getElementById(id);

  if (el('suksesTitle')) el('suksesTitle').textContent = data.tipe === 'masuk' ? 'Check-in Berhasil!' : 'Check-out Berhasil!';
  if (el('suksesMsg')) el('suksesMsg').textContent = `Presensi ${data.tipe} Anda telah tercatat pada sistem e-kehadiran.`;
  if (el('succDate')) el('succDate').textContent = data.tanggal || '—';
  if (el('succTimeLabel')) el('succTimeLabel').textContent = data.tipe === 'masuk' ? 'Jam Masuk' : 'Jam Keluar';
  if (el('succTime')) el('succTime').textContent = (data.jam || '—') + ' WIB';
  if (el('succStatus')) el('succStatus').textContent = data.status || '—';
  if (el('succLocName')) el('succLocName').textContent = data.lokasiNama || '—';
  if (el('succLocCoords')) el('succLocCoords').textContent = data.lokasi || '—';

  if (data.statusInfo) {
    const statusRow = el('succStatusRow');
    if (statusRow) {
      statusRow.style.display = 'flex';
      const statusVal = el('succStatusKehadiran');
      if (statusVal) {
        statusVal.textContent = data.statusInfo.label;
        statusVal.style.color = data.statusInfo.warna === 'hijau' ? '#34C759'
                              : data.statusInfo.warna === 'kuning' ? '#FF9500'
                              : data.statusInfo.warna === 'merah' ? '#FF3B30'
                              : '#FF9500';
      }
    }
  }

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
// LOADING
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
// RENDER PRESENSI
// ★ PATCH v18: mengisi kartu "Hitung Waktu Kerja"
// (compStd / compTelat / compWajib) + catatan kompensasi
// ============================================================
function renderPresensi() {
  const fmt = d => d ? [String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0')].join(':') : '—';
  const el = id => document.getElementById(id);

  if (el('ptMasukTime')) el('ptMasukTime').textContent = fmt(presensiState.masuk);
  if (el('ptKeluarTime')) el('ptKeluarTime').textContent = fmt(presensiState.keluar);
  if (el('ptMasuk')) el('ptMasuk').classList.toggle('done', !!presensiState.masuk);
  if (el('ptKeluar')) el('ptKeluar').classList.toggle('done', !!presensiState.keluar);
  if (el('ptl')) el('ptl').classList.toggle('on', !!presensiState.masuk);

  const p = presensiState.pengaturan;
  const rule = isCheckoutAllowed();

  // ★ Kartu kompensasi
  if (el('compStd')) el('compStd').textContent = `${p.jam_masuk} – ${p.jam_pulang}`;
  if (el('compTelat')) el('compTelat').textContent = rule.telat > 0 ? `+${rule.telat} mnt` : '0 mnt';
  if (el('compWajib')) el('compWajib').textContent =
    presensiState.masuk ? `${rule.pulangWajibJam} WIB` : '—';

  let note;
  if (!presensiState.masuk) {
    note = `Silakan check-in. Jam masuk ${p.jam_masuk} WIB (toleransi ${p.toleransi_terlambat} mnt). Terlambat dikompensasi di jam pulang.`;
  } else if (!presensiState.keluar) {
    if (!rule.allowed) {
      note = `Check-in ${fmt(presensiState.masuk)}. Pulang wajib ${rule.pulangWajibJam} WIB${rule.telat > 0 ? ` (kompensasi +${rule.telat} mnt)` : ''}.`;
    } else {
      note = `Check-in ${fmt(presensiState.masuk)}. Jangan lupa check-out.`;
    }
  } else {
    note = `Presensi selesai. Masuk ${fmt(presensiState.masuk)}, keluar ${fmt(presensiState.keluar)}.`;
  }

  if (el('presNote')) el('presNote').textContent = note;

  updateTimelineProgress();
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
window.loadAppSettings = loadAppSettings;
window.getPresensiStatus = getPresensiStatus;
window.isCheckoutAllowed = isCheckoutAllowed;
window.isHariKerja = isHariKerja;
window.updateWatermarkData = updateWatermarkData;
window.updateTimelineProgress = updateTimelineProgress;
window.initHeroUI = initHeroUI;            // ★ BARU v18
window.presensiState = presensiState;      // dibaca camera.js untuk watermark
