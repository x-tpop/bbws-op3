// ============================================================
// PRESENSI-FULL.JS v21 — PANEL LIGHT (senada tema PUPR)
// • Tombol CHECK-IN / CHECK-OUT (mockup light)
// • Map OSM light + GPS pill melayang (nama lokasi + koordinat)
// • State D/E pengajuan (Disetujui→kunci · Menunggu→alert kuning)
// • Kolom tanggal_mulai/tanggal_selesai · Status Menunggu/Disetujui
// • FIX A: statusInfo.warna · FIX B: akun sendiri di pool
// File: assets/js/presensi-full.js
// ============================================================

const presensiState = {
  lokasi: null, lokasiNama: null, fotoBase64: null, suratBase64: null,
  masuk: null, keluar: null, status: 'Hadir', facingMode: 'user',
  serverOffset: 0, isInRadius: false,
  kantorLat: null, kantorLng: null, kantorRadius: 500,
  faceStableStart: null,
  pengajuanAktif: null,                       // State D/E
  pengaturan: {
    jam_masuk: '07:30', jam_pulang: '16:30', toleransi_terlambat: 15,
    batas_checkout_awal: 30, hari_kerja: '1,2,3,4,5',
    poin_tepat_waktu: 1, poin_terlambat: 0, poin_pulang_cepat: 0, poin_tidak_checkout: 0,
    telat_sedang_menit: 30, telat_berat_menit: 60,
    poin_telat_ringan: 10, poin_telat_sedang: 15, poin_telat_berat: 25
  }
};

// ---------- HELPERS ----------
function gdDirect(url, sz = 600) {
  if (!url) return null;
  if (url.includes('drive.google.com') && !url.includes('thumbnail')) {
    const m = url.match(/[-\w]{25,}/);
    if (m) return `https://drive.google.com/thumbnail?id=${m[0]}&sz=w${sz}`;
  }
  return url;
}
function hEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function presensiEntryGuard() {
  if (!isHariKerja()) { toast('Hari ini bukan hari kerja', 'warn'); return false; }
  if (presensiState.masuk && presensiState.keluar) { toast('Presensi hari ini sudah selesai', 'warn'); return false; }
  if (presensiState.masuk && !presensiState.keluar) {
    const cek = isCheckoutAllowed();
    if (!cek.allowed) {
      toast(cek.telat > 0
        ? `Pulang wajib ${cek.batasJam} WIB (kompensasi telat +${cek.telat} mnt)`
        : `Checkout baru bisa dari ${cek.batasJam} WIB`, 'warn');
      return false;
    }
  }
  return true;
}

// ---------- SERVER TIME ----------
async function syncServerTime() {
  const el = document.getElementById('serverTime');
  try {
    const { data, error } = await supabaseClient.rpc('get_server_time');
    if (!error && data) {
      presensiState.serverOffset = new Date(data).getTime() - Date.now();
      if (el) el.textContent = 'Server OK';
      return true;
    }
    throw new Error('no');
  } catch (e) {
    try {
      const res = await fetch('https://worldtimeapi.org/api/timezone/Asia/Jakarta', { signal: AbortSignal.timeout(3000) });
      const json = await res.json();
      presensiState.serverOffset = new Date(json.datetime).getTime() - Date.now();
      if (el) el.textContent = 'Server OK';
      return true;
    } catch (e2) {
      if (el) el.textContent = 'Device Time';
      return false;
    }
  }
}
function getServerNow() { return new Date(Date.now() + presensiState.serverOffset); }

// ---------- KOMPENSASI ----------
function getPulangWajibMenit() {
  const p = presensiState.pengaturan;
  const [ph, pm] = p.jam_pulang.split(':').map(Number);
  let menitPulang = ph * 60 + pm;
  if (presensiState.masuk) {
    const [mh, mm] = p.jam_masuk.split(':').map(Number);
    const c = presensiState.masuk.getHours() * 60 + presensiState.masuk.getMinutes();
    menitPulang += Math.max(0, c - (mh * 60 + mm));
  }
  return menitPulang;
}
function fmtMenit(m) { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }

// ---------- LOAD PENGATURAN ----------
async function loadAppSettings() {
  try {
    const { data, error } = await supabaseClient.from('pengaturan').select('kunci, nilai');
    if (error) throw error;
    const s = {};
    (data || []).forEach(r => { s[r.kunci] = r.nilai; });
    const P = presensiState.pengaturan;
    if (s.jam_masuk) P.jam_masuk = s.jam_masuk;
    if (s.jam_pulang) P.jam_pulang = s.jam_pulang;
    if (s.toleransi_terlambat) P.toleransi_terlambat = parseInt(s.toleransi_terlambat);
    if (s.batas_checkout_awal) P.batas_checkout_awal = parseInt(s.batas_checkout_awal);
    if (s.hari_kerja) P.hari_kerja = s.hari_kerja;
    if (s.poin_tepat_waktu) P.poin_tepat_waktu = parseInt(s.poin_tepat_waktu);
    if (s.poin_terlambat) P.poin_terlambat = parseInt(s.poin_terlambat);
    if (s.poin_pulang_cepat) P.poin_pulang_cepat = parseInt(s.poin_pulang_cepat);
    if (s.poin_tidak_checkout) P.poin_tidak_checkout = parseInt(s.poin_tidak_checkout);
    if (s.telat_sedang_menit) P.telat_sedang_menit = parseInt(s.telat_sedang_menit);
    if (s.telat_berat_menit) P.telat_berat_menit = parseInt(s.telat_berat_menit);
    if (s.poin_telat_ringan) P.poin_telat_ringan = parseInt(s.poin_telat_ringan);
    if (s.poin_telat_sedang) P.poin_telat_sedang = parseInt(s.poin_telat_sedang);
    if (s.poin_telat_berat) P.poin_telat_berat = parseInt(s.poin_telat_berat);
    if (s.kantor_lat) presensiState.kantorLat = parseFloat(s.kantor_lat);
    if (s.kantor_lng) presensiState.kantorLng = parseFloat(s.kantor_lng);
    if (s.radius_kantor) presensiState.kantorRadius = parseInt(s.radius_kantor);
    window.APP_SETTINGS = s;
    return s;
  } catch (err) {
    console.warn('Load pengaturan gagal, pakai default:', err);
    return presensiState.pengaturan;
  }
}

// ---------- TIER KETERLAMBATAN ----------
function getTelatTier(menitTelat) {
  const P = presensiState.pengaturan;
  if (menitTelat <= 0)
    return { key: 'tepat', label: 'Tepat Waktu', poin: P.poin_tepat_waktu, cls: 't-ok', st: 'tepat_waktu' };
  if (menitTelat <= P.toleransi_terlambat)
    return { key: 'toleransi', label: `Toleransi +${menitTelat}m`, poin: P.poin_tepat_waktu, cls: 't-ok', st: 'toleransi' };
  if (menitTelat <= P.telat_sedang_menit)
    return { key: 'ringan', label: `Terlambat Ringan (${menitTelat}m)`, poin: P.poin_telat_ringan, cls: 't-warn', st: 'terlambat' };
  if (menitTelat <= P.telat_berat_menit)
    return { key: 'sedang', label: `Terlambat Sedang (${menitTelat}m)`, poin: P.poin_telat_sedang, cls: 't-warn', st: 'terlambat' };
  return { key: 'berat', label: 'Terlambat Berat', poin: P.poin_telat_berat, cls: 't-bad', st: 'terlambat' };
}

function getPresensiStatus(jamStr, tipe = 'masuk') {
  const p = presensiState.pengaturan;
  const [h, m] = jamStr.split(':').map(Number);
  const menit = h * 60 + m;

  if (tipe === 'masuk') {
    const [jh, jm] = p.jam_masuk.split(':').map(Number);
    const tier = getTelatTier(menit - (jh * 60 + jm));
    // FIX A: petakan tier → {status,label,poin,warna} agar status_kehadiran tersimpan di DB
    return {
      status: tier.st,        // tepat_waktu | toleransi | terlambat
      label: tier.label,
      poin: tier.poin,
      warna: tier.cls === 't-ok' ? 'hijau' : tier.cls === 't-bad' ? 'merah' : 'kuning'
    };
  }

  const batasPulang = getPulangWajibMenit();
  const telat = batasPulang - (parseInt(p.jam_pulang) * 60);
  if (menit >= batasPulang) {
    return { status: 'tepat_waktu',
      label: telat > 0 ? `Tepat Waktu (kompensasi +${telat}m)` : 'Tepat Waktu',
      poin: p.poin_tepat_waktu, warna: 'hijau' };
  }
  const cepat = batasPulang - menit;
  return { status: 'pulang_cepat', label: `Pulang Cepat ${cepat}m`,
    poin: p.poin_pulang_cepat, warna: 'oranye' };
}

function isCheckoutAllowed() {
  const p = presensiState.pengaturan;
  const [jh, jm] = p.jam_masuk.split(':').map(Number);
  const menitMasukStd = jh * 60 + jm;
  const menitPulang = getPulangWajibMenit();
  let telat = 0;
  if (presensiState.masuk) {
    const c = presensiState.masuk.getHours() * 60 + presensiState.masuk.getMinutes();
    telat = Math.max(0, c - menitMasukStd);
  }
  const batas = telat > 0 ? menitPulang : (menitPulang - p.batas_checkout_awal);
  const now = getServerNow();
  const menitSekarang = now.getHours() * 60 + now.getMinutes();
  return { allowed: menitSekarang >= batas, batasMenit: batas, batasJam: fmtMenit(batas),
           pulangWajibJam: fmtMenit(menitPulang), telat, menitSekarang };
}

function isHariKerja() {
  const hk = presensiState.pengaturan.hari_kerja.split(',');
  return hk.includes(String(getServerNow().getDay() || 7));
}

// ---------- GEOFENCE / GEOCODING ----------
function hitungJarak(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function checkGeofence(lat, lng) {
  if (!presensiState.kantorLat || !presensiState.kantorLng) return { ok: true, jarak: 0, message: 'Lokasi bebas' };
  const jarak = hitungJarak(lat, lng, presensiState.kantorLat, presensiState.kantorLng);
  const ok = jarak <= presensiState.kantorRadius;
  return { ok, jarak: Math.round(jarak), message: ok ? `Dalam radius (${Math.round(jarak)}m)` : `Di luar radius (${Math.round(jarak)}m)` };
}
async function getNamaLokasi(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`,
      { headers: { 'Accept-Language': 'id' }, signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const addr = data.address || {};
    const kota = addr.city || addr.town || addr.village || addr.county || addr.state_district || '';
    const provShort = (addr.state || '')
      .replace('Jawa Timur', 'Jatim').replace('Jawa Tengah', 'Jateng')
      .replace('Jawa Barat', 'Jabar').replace('DKI Jakarta', 'Jakarta').replace('DI Yogyakarta', 'DIY');
    if (kota && provShort) return `${kota}, ${provShort}`;
    if (kota) return kota;
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch (e) { return `${lat.toFixed(4)}, ${lng.toFixed(4)}`; }
}

// ---------- ★ v21 MAP LIGHT (OSM) + PIN BIRU ----------
let miniMap = null, userMarker = null;
function initMiniMap(lat, lng) {
  if (!window.L) return;
  if (!miniMap) {
    miniMap = L.map('miniMap', {
      zoomControl: false, dragging: false, scrollWheelZoom: false,
      doubleClickZoom: false, boxZoom: false, keyboard: false, tap: false,
      attributionControl: true
    }).setView([lat, lng], 16);
    // ★ v21: tile light senada tema (sebelumnya satelit Esri)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(miniMap);
  } else miniMap.setView([lat, lng], 16);

  if (userMarker) userMarker.remove();
  userMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: 'pin-biru',
      html: `<svg width="34" height="42" viewBox="0 0 34 42"><path d="M17 0C7.6 0 0 7.6 0 17c0 12.8 17 25 17 25s17-12.2 17-25C34 7.6 26.4 0 17 0z" fill="#1E3A8A"/><circle cx="17" cy="17" r="6.5" fill="#fff"/></svg>`,
      iconSize: [34, 42], iconAnchor: [17, 40]
    })
  }).addTo(miniMap);

  setTimeout(() => { if (miniMap) miniMap.invalidateSize(); }, 150);
  setTimeout(() => { if (miniMap) miniMap.invalidateSize(); }, 600);
}

// ---------- HERO COMPACT + ADMIN (hanya role admin) ----------
const heroState = { list: [], self: null, pool: [], idx: 0, q: '', di: 'ALL', isManager: false, viewingOther: false };

async function initHeroUI(pegawai, session) {
  const el = id => document.getElementById(id);
  const role = session.role || '';
  heroState.isManager = role === 'admin';       // staf_pengamat = tampilan sederhana
  heroState.idx = 0; heroState.q = ''; heroState.di = 'ALL'; heroState.viewingOther = false;

  heroState.self = {
    id_pegawai: session.id_pegawai,
    nama: pegawai.nama || session.nama_lengkap || 'Pegawai',
    jabatan: pegawai.jabatan || session.role || '—',
    id_di: pegawai.id_di,
    link_foto_1: pegawai.link_foto_1, link_foto_2: pegawai.link_foto_2, diNama: '—'
  };

  if (el('miniNama')) el('miniNama').textContent = heroState.self.nama;
  const resmiSelf = gdDirect(pegawai.link_foto_1 || pegawai.link_foto_2);
  if (resmiSelf && el('miniAvatar')) el('miniAvatar').src = resmiSelf;

  if (heroState.isManager) {
    if (el('phAdmin')) el('phAdmin').hidden = false;
    el('presHero')?.classList.add('mgr');
    try {
      const [pw, dw] = await Promise.all([
        supabaseClient.from('pegawai').select('id_pegawai,nama,jabatan,id_di,link_foto_1,link_foto_2')
          .in('jabatan', ['Petugas Pintu Air', 'Pekarya Pengairan']),
        supabaseClient.from('di').select('id_di,nama_di')
      ]);
      const diNama = {};
      (dw.data || []).forEach(d => { diNama[d.id_di] = d.nama_di; });
      let list = (pw.data || []).map(p => ({ ...p, diNama: diNama[p.id_di] || '—' }));
      list.sort((a, b) => (a.nama || '').localeCompare(b.nama || '', 'id'));

      // FIX B: akun sendiri (admin juga pegawai) selalu ada di pool
      if (session.id_pegawai &&
          !list.some(x => String(x.id_pegawai) === String(session.id_pegawai))) {
        list.unshift({
          id_pegawai: session.id_pegawai,
          nama: heroState.self.nama,
          jabatan: heroState.self.jabatan,
          id_di: heroState.self.id_di,
          link_foto_1: heroState.self.link_foto_1,
          link_foto_2: heroState.self.link_foto_2,
          diNama: diNama[session.pegawai?.id_di] || '—'
        });
      }
      heroState.list = list;

      const dis = [...new Set(list.map(p => p.id_di).filter(Boolean))];
      if (el('phChips')) el('phChips').innerHTML =
        `<button class="px-chip active" data-di="ALL">ALL</button>` +
        dis.map(id => `<button class="px-chip" data-di="${hEsc(id)}">${hEsc(diNama[id] || id)}</button>`).join('');
    } catch (e) { console.warn('Hero: gagal muat petugas', e); }
  } else if (pegawai.id_di) {
    try {
      const { data } = await supabaseClient.from('di').select('nama_di').eq('id_di', pegawai.id_di).maybeSingle();
      if (data?.nama_di) heroState.self.diNama = data.nama_di;
    } catch (e) {}
  }

  function goRaport(p) {
    sessionStorage.setItem('rpTargetId', p.id_pegawai);
    document.querySelector('.nav-btn[data-page="raport"]')?.click()
      || document.querySelector('.bnav-item[data-page="raport"]')?.click();
  }

  function heroRender() {
    let pool = heroState.list.length ? heroState.list : [heroState.self];
    if (heroState.di !== 'ALL') pool = pool.filter(p => p.id_di === heroState.di);
    if (heroState.q) pool = pool.filter(p => (p.nama || '').toLowerCase().includes(heroState.q));
    if (!pool.length) pool = [heroState.self];
    heroState.pool = pool;
    heroState.idx = Math.max(0, Math.min(heroState.idx, pool.length - 1));
    const p = pool[heroState.idx];

    if (el('phNama')) el('phNama').textContent = (p.nama || '—').toUpperCase();
    if (el('phJabatan')) el('phJabatan').textContent = (p.jabatan || '—').toUpperCase();
    if (el('phWilayah')) el('phWilayah').textContent = (p.diNama || '—').toUpperCase();

    const sec = document.querySelector('section[data-page="presensi"]'), img = el('heroCutout');
    if (img) {
      const cut = gdDirect(p.link_foto_2), resmi = gdDirect(p.link_foto_1);
      img.onerror = () => { img.onerror = null; img.src = resmi || 'assets/img/logo-symbol.png'; sec?.classList.add('no-cutout'); };
      if (cut)        { img.src = cut; sec?.classList.remove('no-cutout'); }
      else if (resmi) { img.src = resmi; sec?.classList.add('no-cutout'); }
      else            { img.src = 'assets/img/logo-symbol.png'; sec?.classList.add('no-cutout'); }
    }
    const showArrows = heroState.isManager && pool.length > 1;
    if (el('phPrev')) el('phPrev').hidden = !showArrows;
    if (el('phNext')) el('phNext').hidden = !showArrows;

    heroState.viewingOther = heroState.isManager && String(p.id_pegawai) !== String(session.id_pegawai);
    updateActionButtons();
  }
  heroState.render = heroRender;
  heroRender();

  el('phPrev')?.addEventListener('click', e => { e.stopPropagation(); const n = heroState.pool.length; if (n < 2) return; heroState.idx = (heroState.idx - 1 + n) % n; heroRender(); });
  el('phNext')?.addEventListener('click', e => { e.stopPropagation(); const n = heroState.pool.length; if (n < 2) return; heroState.idx = (heroState.idx + 1) % n; heroRender(); });
  el('phSearchInput')?.addEventListener('input', e => { heroState.q = e.target.value.trim().toLowerCase(); heroState.idx = 0; heroRender(); });
  el('phChips')?.addEventListener('click', e => {
    const b = e.target.closest('.px-chip'); if (!b) return;
    el('phChips').querySelectorAll('.px-chip').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); heroState.di = b.dataset.di; heroState.idx = 0; heroRender();
  });
  el('phNama')?.addEventListener('click', () => {
    if (!heroState.isManager || !heroState.viewingOther) return;
    const p = heroState.pool?.[heroState.idx]; if (p) goRaport(p);
  });

  const bar = el('presMiniBar');
  if (window.__heroScrollHandler) window.removeEventListener('scroll', window.__heroScrollHandler);
  if (bar) {
    window.__heroScrollHandler = () => {
      if (!document.body.contains(bar)) return;
      bar.classList.toggle('show', window.scrollY > 240);
    };
    window.addEventListener('scroll', window.__heroScrollHandler, { passive: true });
    window.__heroScrollHandler();
  }
}

// ---------- ★ v21 CHECK-IN / CHECK-OUT + COUNTDOWN + ALERT ----------
function fmtCountdown(menit) {
  if (menit <= 0) return null;
  const h = Math.floor(menit / 60), m = menit % 60;
  return h > 0 ? `${h}j ${m}m lagi` : `${m}m lagi`;
}

function updateActionButtons() {
  const el = id => document.getElementById(id);
  const bH = el('btnHadir'), bP = el('btnPulang');
  if (!bH || !bP) return;

  const masuk = presensiState.masuk, keluar = presensiState.keluar;
  const rule = isCheckoutAllowed();
  const fmtT = d => d ? [String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0')].join(':') : '';

  const lH = el('hadirLabel'), sH = el('hadirSub');
  const lP = el('pulangLabel'), sP = el('pulangSub');
  const alert = el('lateAlert'), lb = el('lateLabel'), pn = el('latePoin');

  // ===== STATE D/E: pengajuan yang mencakup hari ini =====
  const pa = presensiState.pengajuanAktif;
  if (pa && !masuk) {
    const rentangTxt = (pa.tanggal_selesai && pa.tanggal_selesai !== pa.tanggal_mulai)
      ? `${pa.tanggal_mulai} s/d ${pa.tanggal_selesai}` : (pa.tanggal_mulai || '');

    // STATE D: Sakit/Izin Disetujui → presensi terkunci
    if (pa.status === 'Disetujui' && ['Sakit', 'Izin'].includes(pa.jenis)) {
      bH.disabled = true; bH.classList.remove('on'); bH.classList.add('off');
      lH.textContent = pa.jenis.toUpperCase();
      sH.textContent = 'disetujui ✓';
      bP.disabled = true; bP.classList.remove('on'); bP.classList.add('off');
      lP.textContent = 'CHECK-OUT';
      sP.textContent = '—';
      if (alert && lb && pn) {
        alert.hidden = false; alert.className = 'px-alert t-ok';
        lb.textContent = `${pa.jenis} (disetujui)`; pn.textContent = rentangTxt;
      }
      return;
    }
    // STATE E: Menunggu → alert kuning, presensi TETAP aktif
    if (pa.status === 'Menunggu' && alert && lb && pn) {
      alert.hidden = false; alert.className = 'px-alert t-warn';
      lb.textContent = `Pengajuan ${pa.jenis} menunggu verifikasi`;
      pn.textContent = 'Tetap lakukan presensi sampai disetujui';
    }
  }

  // ===== CHECK-IN =====
    const libur = !isHariKerja();
  if (!masuk) {
    if (libur) {
      bH.disabled = true; bH.classList.remove('on'); bH.classList.add('off');
      lH.textContent = 'CHECK-IN';
      sH.textContent = 'Hari libur';
    } else {
      bH.disabled = false;
      bH.classList.add('on'); bH.classList.remove('off');
      lH.textContent = 'CHECK-IN';
      sH.textContent = presensiState.status === 'Kerja Gabungan'
        ? 'Mode Kerja Gabungan' : 'Presensi Masuk';
    }
  }

  // ===== CHECK-OUT =====
  if (!masuk) {
    bP.disabled = true;
    bP.classList.remove('on'); bP.classList.add('off');
    lP.textContent = 'CHECK-OUT';
    sP.textContent = 'Belum Waktunya';
  } else if (!keluar) {
    lP.textContent = 'CHECK-OUT';
    if (rule.allowed) {
      bP.disabled = false;
      bP.classList.add('on'); bP.classList.remove('off');
      sP.textContent = 'Sekarang — presensi keluar';
    } else {
      bP.disabled = true;
      bP.classList.remove('on'); bP.classList.add('off');
      sP.textContent = fmtCountdown(rule.batasMenit - rule.menitSekarang) || 'Belum Waktunya';
    }
  } else {
    bP.disabled = true;
    bP.classList.remove('on'); bP.classList.add('off');
    lP.textContent = 'CHECK-OUT';
    sP.textContent = '✓ ' + fmtT(keluar);
  }

  // ===== ALERT: deteksi belum presensi / keterlambatan =====
  if (alert && lb && pn) {
    const alertPending = pa && !masuk && pa.status === 'Menunggu';
    if (!alertPending) {
      alert.hidden = false;

      if (libur) {
        alert.className = 'px-alert t-warn';
        lb.textContent = 'Bukan hari kerja';
        pn.textContent = 'Presensi dinonaktifkan hari ini';
      } else {
        const [jh, jm] = presensiState.pengaturan.jam_masuk.split(':').map(Number);
        // referensi telat: jam check-in (jika sudah) atau waktu sekarang (belum)
        const ref = masuk || getServerNow();
        const menitTelat = Math.max(0, (ref.getHours() * 60 + ref.getMinutes()) - (jh * 60 + jm));
        const tier = getTelatTier(menitTelat);

        alert.className = 'px-alert ' + tier.cls;

        // ★ SATU rantai if — tidak ada timpa-menimpa
        if (masuk && keluar) {
          // State C: siklus selesai — rekap hijau
          alert.className = 'px-alert t-ok';
          lb.textContent = 'Presensi hari ini selesai ✓';
          pn.textContent = `Masuk ${fmtT(masuk)} · Keluar ${fmtT(keluar)}`;
        } else if (!masuk && menitTelat <= 0) {
          // belum presensi & belum jam masuk
          lb.textContent = 'Anda belum Presensi hari ini';
          pn.textContent = `Poin: ${tier.poin} jika check-in sekarang`;
        } else if (menitTelat > 0) {
          // telat (baik belum maupun sudah check-in)
          lb.textContent = `Anda Terlambat ${menitTelat} menit`;
          pn.textContent = masuk
            ? `Poin: ${tier.poin}`
            : `Poin: ${tier.poin} jika check-in sekarang`;
        } else {
          // sudah check-in & tepat waktu (belum keluar)
          lb.textContent = 'Presensi hari ini tercatat ✓';
          pn.textContent = `Poin: ${tier.poin}`;
        }
      }
    }
  }
}

// ---------- REFRESH PENGAJUAN AKTIF ----------
async function refreshPengajuanAktif(sessionOverride) {
  const session = sessionOverride || getSession();
  if (!session) return;
  const today = localDateStr(getServerNow());
  try {
    const { data: pgs } = await supabaseClient.from('pengajuan')
      .select('jenis,status,tanggal_mulai,tanggal_selesai')
      .eq('id_pegawai', session.id_pegawai)
      .in('status', ['Menunggu', 'Disetujui'])
      .gte('tanggal_selesai', today);
    presensiState.pengajuanAktif =
      (pgs || []).find(p => (p.tanggal_mulai || '') <= today &&
                           today <= (p.tanggal_selesai || p.tanggal_mulai)) || null;
  } catch (e) {
    console.warn('cek pengajuan:', e);
    presensiState.pengajuanAktif = null;
  }
  updateActionButtons();
}

// ---------- INIT UTAMA ----------
async function initPresensi() {
  console.log('=== Init Presensi (Full v21) ===');
  if (window.__presensiInit) return;
  window.__presensiInit = true;

  try {
    const session = getSession();
    if (!session) return;
    const pegawai = session.pegawai || {};
    const el = id => document.getElementById(id);

    await loadAppSettings();
    await syncServerTime();

    // JAM LIVE + COUNTDOWN
    // ★ v21.2: jam tampil juga di chip header (pxClock) — terlihat
    // tanpa perlu scroll (minibar baru muncul setelah scroll 240px)
    function tickPres() {
      const d = getServerNow();
      const hm = [String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0')].join(':');
      if (el('miniClock')) el('miniClock').textContent = hm;
      if (el('pxClock')) el('pxClock').textContent = hm + ' WIB';
      updateActionButtons();
    }
    tickPres();
    if (window.__presInterval) clearInterval(window.__presInterval);
    window.__presInterval = setInterval(tickPres, 1000);

    // PRESENSI HARI INI
    const today = localDateStr(getServerNow());
    try {
      const { data } = await supabaseClient.from('presensi').select('*')
        .eq('id_pegawai', session.id_pegawai).eq('tanggal', today).maybeSingle();
      if (data) {
        presensiState.masuk = data.jam_masuk ? new Date(today + 'T' + data.jam_masuk) : null;
        presensiState.keluar = data.jam_keluar ? new Date(today + 'T' + data.jam_keluar) : null;
        if (data.status) presensiState.status =
          ['Hadir', 'Kerja Gabungan'].includes(data.status) ? data.status : 'Hadir';
      }
    } catch (e) { console.error(e); }

    // Muat pengajuan aktif SEBELUM render tombol pertama
    await refreshPengajuanAktif(session);

    updateActionButtons();

    // ---- LOKASI (dipisah agar bisa di-refresh) ----
    // ★ v21: nama lokasi (gpsLoc) + koordinat chip (gpsText) di pill melayang
    async function locateMe() {
      const btnG = el('btnRefreshGps');
      if (btnG) btnG.classList.add('spun');
      try {
        const loc = await getLocation();
        presensiState.lokasi = loc;
        initMiniMap(loc.lat, loc.lng);

        const g = checkGeofence(loc.lat, loc.lng);
        presensiState.isInRadius = g.ok;

        const ic = el('gpsIcon'), tx = el('gpsText'), nm = el('gpsLoc');
        if (tx) {
          tx.textContent = `GPS: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` +
            (g.ok ? '' : ' • Di luar radius kantor');
          tx.classList.toggle('bad', !g.ok);
        }
        if (ic) ic.classList.toggle('bad', !g.ok);
        if (nm) nm.textContent = 'Mendeteksi nama lokasi…';

        getNamaLokasi(loc.lat, loc.lng).then(nama => {
          presensiState.lokasiNama = nama;
          if (nm) nm.textContent = nama;              // → "Banyuwangi, Jatim"
          updateWatermarkData();
        });
      } catch (err) {
        const nm = el('gpsLoc'), tx = el('gpsText');
        if (nm) nm.textContent = 'Lokasi gagal dideteksi';
        if (tx) { tx.textContent = err.message; tx.classList.add('bad'); }
      } finally {
        if (btnG) setTimeout(() => btnG.classList.remove('spun'), 600);
      }
    }
    el('btnRefreshGps')?.addEventListener('click', locateMe);
    locateMe();

    // ---- TOMBOL CHECK-IN / CHECK-OUT ----
    el('btnHadir')?.addEventListener('click', () => {
      if (heroState.viewingOther) { toast('Anda sedang melihat data petugas lain — klik nama untuk buka Raport', 'info'); return; }
      if (presensiState.masuk) { toast('Anda sudah check-in hari ini', 'warn'); return; }
      if (presensiEntryGuard()) openFullscreenDirect();
    });
    el('btnPulang')?.addEventListener('click', () => {
      if (heroState.viewingOther) { toast('Checkout hanya untuk akun Anda sendiri', 'info'); return; }
      if (!presensiState.masuk) { toast('Belum check-in hari ini', 'warn'); return; }
      if (presensiState.keluar) { toast('Presensi hari ini sudah selesai', 'warn'); return; }
      if (presensiEntryGuard()) openFullscreenDirect();
    });

    // ---- ACCORDION STATUS KHUSUS ----
        // ★ default terbuka — kartu pengajuan langsung terlihat (sesuai mockup)
    el('accKhusus')?.classList.add('open');
    if (el('accBody')) el('accBody').hidden = false;
    el('accHead')?.addEventListener('click', () => {
      const acc = el('accKhusus'), body = el('accBody');
      const open = acc.classList.toggle('open');
      if (body) body.hidden = !open;
    });

    // ---- QR / KERJA GABUNGAN ----
    el('btnKerjaGabungan')?.addEventListener('click', () => {
      if (heroState.viewingOther) { toast('Presensi hanya untuk akun Anda sendiri', 'info'); return; }
      if (presensiState.masuk) { toast('Sudah check-in — QR hanya untuk check-in', 'warn'); return; }
      presensiState.status = 'Kerja Gabungan';
      el('btnKerjaGabungan')?.classList.add('active');
      const note = el('presNote');
      if (note) note.textContent = 'Mode Kerja Gabungan aktif — tekan CHECK-IN untuk scan & foto.';
      toast('Mode Kerja Gabungan (QR) aktif', 'success');
      if (presensiEntryGuard()) openFullscreenDirect();
    });

    // ---- REVIEW / SUBMIT / RETAKE ----
    attachRetakeHandler(el('btnRetake'));
    attachSubmitHandler(el('btnSubmit'), session, pegawai);
    attachFullscreenHandlers();

    updateWatermarkData();
    if (window.__wmInterval) clearInterval(window.__wmInterval);
    window.__wmInterval = setInterval(updateWatermarkData, 1000);

    initHeroUI(pegawai, session);
    if (typeof window.initPengajuan === 'function') {
      try { await window.initPengajuan(session); } catch (e) { console.warn('initPengajuan gagal:', e); }
    }

    if (window.refreshIcons) window.refreshIcons();
    console.log('=== Presensi loaded ===');
  } catch (err) {
    console.error('Presensi error:', err);
  }
}

// ---------- WATERMARK ----------
function updateWatermarkData() {
  const el = id => document.getElementById(id);
  const session = getSession();
  const pegawai = session?.pegawai || {};
  if (el('wmName')) el('wmName').textContent = pegawai.nama || session?.nama_lengkap || 'Pegawai';
  if (el('wmJabatan')) el('wmJabatan').textContent = pegawai.jabatan || session?.role || '-';
  if (el('wmStatus')) {
    const badge = el('wmStatus'), text = badge.querySelector('.sb-text');
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

// ---------- RETAKE ----------
function attachRetakeHandler(btn) {
  if (!btn) return;
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    presensiState.fotoBase64 = null;
    const el = id => document.getElementById(id);
    if (el('reviewCard')) el('reviewCard').hidden = true;
  });
}

// ---------- FULLSCREEN OPEN ----------
function openFullscreenDirect() {
  const el = id => document.getElementById(id);
  const modal = el('camFullscreen');
  if (!modal) { toast('Camera modal tidak tersedia', 'error'); return; }
  modal.classList.add('open');
  if (el('fsLiveMode')) el('fsLiveMode').hidden = false;
  if (el('fsReviewMode')) el('fsReviewMode').hidden = true;
  if (el('fsDockLive')) el('fsDockLive').hidden = false;
  if (el('fsDockReview')) el('fsDockReview').hidden = true;
  presensiState.fotoBase64 = null;
  updateWatermarkData();

  setTimeout(async () => {
    const videoFs = el('videoFullscreen');
    if (!videoFs) { toast('Video element tidak ditemukan', 'error'); return; }
    try {
      if (window.cameraStream && window.cameraStream.active) {
        videoFs.srcObject = window.cameraStream;
        await videoFs.play();
      } else {
        const ok = await startCamera(videoFs, presensiState.facingMode);
        if (!ok) { toast('Gagal buka kamera', 'error'); return; }
      }
    } catch (e) { console.error(e); toast('Gagal memuat kamera', 'error'); return; }

    if (presensiState.lokasi) {
      getNamaLokasi(presensiState.lokasi.lat, presensiState.lokasi.lng).then(nama => {
        if (el('camFsLoc')) el('camFsLoc').textContent = nama;
      });
    }
    try { initFaceDetection(videoFs); } catch (e) { console.warn(e); }
    if (window.refreshIcons) window.refreshIcons();
  }, 200);
}

// ---------- FACE DETECTION ----------
let faceDetector = null, faceDetectInterval = null, faceDetectionReady = false;
async function initFaceDetection(videoEl) {
  if (faceDetectionReady) return true;
  try {
    const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0');
    const filesetResolver = await vision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm");
    faceDetector = await vision.FaceDetector.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
        delegate: "GPU"
      },
      runningMode: "VIDEO", minDetectionConfidence: 0.5
    });
    faceDetectionReady = true;
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
  } catch (e) { console.warn('MediaPipe init gagal:', e); return false; }
}
function updateFaceUI(detected) {
  const guide = document.getElementById('faceGuide');
  const label = document.querySelector('#faceStatus .face-label');
  if (detected) { guide?.classList.add('detected'); if (label) label.textContent = 'Wajah terdeteksi ✓'; }
  else { guide?.classList.remove('detected'); if (label) label.textContent = 'Posisikan wajah Anda di dalam oval'; }
}
function handleAutoCapture(detected) {
  if (presensiState.fotoBase64) return;
  const ring = document.getElementById('autoCaptureRing');
  const progress = document.getElementById('acrProgress');
  const text = document.getElementById('acrText');
  if (detected) {
    if (!presensiState.faceStableStart) presensiState.faceStableStart = Date.now();
    const elapsed = Date.now() - presensiState.faceStableStart;
    const remaining = Math.max(0, 1500 - elapsed);
    if (ring) ring.hidden = false;
    if (text) text.textContent = (remaining / 1000).toFixed(1);
    if (progress) progress.style.strokeDashoffset = 276.46 * (remaining / 1500);
    if (elapsed >= 1500) {
      presensiState.faceStableStart = null;
      if (ring) ring.hidden = true;
      document.getElementById('btnFsCapture')?.click();
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
  document.getElementById('faceGuide')?.classList.remove('detected');
  const ring = document.getElementById('autoCaptureRing');
  if (ring) ring.hidden = true;
}

// ---------- FULLSCREEN HANDLERS ----------
function attachFullscreenHandlers() {
  const el = id => document.getElementById(id);

  const btnClose = el('btnFsClose');
  if (btnClose) {
    const n = btnClose.cloneNode(true); btnClose.parentNode.replaceChild(n, btnClose);
    n.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      el('camFullscreen')?.classList.remove('open');
      stopFaceDetection();
      if (typeof stopCamera === 'function') stopCamera();
      const v = el('videoFullscreen'); if (v) v.srcObject = null;
    });
  }

  const btnCapFs = el('btnFsCapture');
  if (btnCapFs) {
    const n = btnCapFs.cloneNode(true); btnCapFs.parentNode.replaceChild(n, btnCapFs);
    n.addEventListener('click', async (e) => { e.preventDefault(); e.stopPropagation(); await captureFromFullscreen(); });
  }

  const btnSwitch = el('btnFsSwitch');
  if (btnSwitch) {
    const n = btnSwitch.cloneNode(true); btnSwitch.parentNode.replaceChild(n, btnSwitch);
    n.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      presensiState.facingMode = presensiState.facingMode === 'user' ? 'environment' : 'user';
      const videoFs = el('videoFullscreen');
      if (videoFs) { await startCamera(videoFs, presensiState.facingMode); stopFaceDetection(); initFaceDetection(videoFs); }
      toast('Kamera: ' + (presensiState.facingMode === 'user' ? 'Depan' : 'Belakang'), 'info');
    });
  }

  const btnReviewRetake = el('btnReviewRetake');
  if (btnReviewRetake) {
    const n = btnReviewRetake.cloneNode(true); btnReviewRetake.parentNode.replaceChild(n, btnReviewRetake);
    n.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      presensiState.fotoBase64 = null;
      el('fsLiveMode').hidden = false; el('fsReviewMode').hidden = true;
      el('fsDockLive').hidden = false; el('fsDockReview').hidden = true;
      const videoFs = el('videoFullscreen');
      if (videoFs) {
        if (window.cameraStream && window.cameraStream.active) { videoFs.srcObject = window.cameraStream; videoFs.play(); }
        else await startCamera(videoFs, presensiState.facingMode);
        initFaceDetection(videoFs);
      }
    });
  }

  const btnReviewUse = el('btnReviewUse');
  if (btnReviewUse) {
    const n = btnReviewUse.cloneNode(true); btnReviewUse.parentNode.replaceChild(n, btnReviewUse);
    n.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      el('camFullscreen')?.classList.remove('open');
      stopFaceDetection();
      if (typeof stopCamera === 'function') stopCamera();
      const vFs = el('videoFullscreen'); if (vFs) vFs.srcObject = null;

      const previewImg = el('previewImg'), reviewCard = el('reviewCard');
      if (previewImg) previewImg.src = presensiState.fotoBase64;
      if (reviewCard) {
        reviewCard.hidden = false;
        reviewCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      toast('Foto siap dikirim', 'success');
    });
  }
}

// ---------- CAPTURE ----------
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
    el('fsLiveMode').hidden = true; el('fsReviewMode').hidden = false;
    el('fsDockLive').hidden = true; el('fsDockReview').hidden = false;
    const reviewImg = el('fsReviewImg');
    if (reviewImg) reviewImg.src = compressed;
    if (el('fsReviewLoc')) el('fsReviewLoc').textContent = presensiState.lokasiNama ||
      `${presensiState.lokasi.lat.toFixed(6)}, ${presensiState.lokasi.lng.toFixed(6)}`;
    const d = getServerNow();
    const hms = [String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0'), String(d.getSeconds()).padStart(2,'0')].join(':');
    if (el('fsReviewTime')) el('fsReviewTime').textContent = hms + ' WIB';
    if (navigator.vibrate) navigator.vibrate(50);
  } catch (err) { console.error(err); toast('Gagal ambil foto: ' + err.message, 'error'); }
}

// ---------- SUBMIT ----------
function attachSubmitHandler(btn, session, pegawai) {
  if (!btn) return;
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    await submitPresensi(newBtn, session, pegawai);
  });
}

async function submitPresensi(btn, session, pegawai) {
  const el = id => document.getElementById(id);
  const status = presensiState.status;

  if (presensiState.masuk && presensiState.keluar) { toast('Presensi hari ini sudah selesai', 'warn'); return; }
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

    if (presensiState.fotoBase64) {
      const namaFile = `presensi_${session.username}_${today}_${tipe}_${timestamp}.jpg`;
      const folderPath = `Presensi/${today.slice(0, 7)}/DI-${pegawai.id_di || 'X'}`;
      const up = await uploadFoto(presensiState.fotoBase64, namaFile, folderPath);
      if (!up.success) throw new Error(up.error || 'Upload foto gagal');
      fotoUrl = up.linkLh3;
    }

    const lokasiStr = `${presensiState.lokasi.lat.toFixed(6)}, ${presensiState.lokasi.lng.toFixed(6)}`;

    if (tipe === 'masuk') {
      await dbInsert('presensi', {
        id_pegawai: session.id_pegawai,
        tanggal: today,
        jam_masuk: jam,
        lokasi_masuk: lokasiStr,
        foto_masuk: fotoUrl,
        status: status,
        poin: poin,
        status_kehadiran: statusInfo.status,
        catatan_kehadiran: statusInfo.label
      });
      presensiState.masuk = now;
    } else {
      await dbUpdate('presensi', 'id_pegawai', session.id_pegawai, {
        jam_keluar: jam, lokasi_keluar: lokasiStr, foto_keluar: fotoUrl,
        poin_keluar: poin, status_kehadiran_keluar: statusInfo.status
      }, { tanggal: today });
      presensiState.keluar = now;
    }

    hideLoading();
    showSuksesModal({
      tipe, status, jam: jam.slice(0, 5),
      tanggal: now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      lokasi: lokasiStr, lokasiNama: presensiState.lokasiNama || 'Lokasi tidak diketahui',
      keterangan: '',
      // FIX: getPresensiStatus mengembalikan `warna` — pakai langsung
      statusInfo: { label: statusInfo.label, warna: statusInfo.warna }
    });

    resetPresensiForm();
    updateActionButtons();
  } catch (err) {
    hideLoading();
    console.error('Submit error:', err);
    toast('Gagal: ' + err.message, 'error');
  } finally { btn.disabled = false; }
}

function resetPresensiForm() {
  const el = id => document.getElementById(id);
  presensiState.fotoBase64 = null;
  if (el('reviewCard')) el('reviewCard').hidden = true;
  presensiState.suratBase64 = null;
  el('btnKerjaGabungan')?.classList.remove('active');
  if (presensiState.status === 'Kerja Gabungan') presensiState.status = 'Hadir';
}

// ---------- MODAL SUKSES / LOADING ----------
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
    const row = el('succStatusRow');
    if (row) {
      row.style.display = 'flex';
      const v = el('succStatusKehadiran');
      if (v) {
        v.textContent = data.statusInfo.label;
        v.style.color = data.statusInfo.warna === 'hijau' ? '#34C759'
                      : data.statusInfo.warna === 'merah' ? '#FF3B30' : '#FF9500';
      }
    }
  }
  const ketRow = el('succKetRow'), ket = el('succKet');
  if (data.keterangan && ketRow && ket) { ketRow.style.display = 'flex'; ket.textContent = data.keterangan; }
  else if (ketRow) ketRow.style.display = 'none';
  modal.classList.add('open');
}
function closeSuksesModal() { document.getElementById('suksesModal')?.classList.remove('open'); }
function showLoading(text = 'Memproses...') {
  const o = document.getElementById('loadingOverlay'), t = document.getElementById('loadingText');
  if (t) t.textContent = text;
  if (o) o.classList.add('open');
}
function hideLoading() { document.getElementById('loadingOverlay')?.classList.remove('open'); }

// ---------- EXPOSE ----------
window.initPresensi = initPresensi;
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
window.initHeroUI = initHeroUI;
window.presensiState = presensiState;
window.presensiEntryGuard = presensiEntryGuard;
window.gdDirect = gdDirect;
window.hEsc = hEsc;
window.heroState = heroState;
window.getTelatTier = getTelatTier;
// dipanggil dari pengajuan.js setelah submit
window.refreshPengajuanAktif = refreshPengajuanAktif;
