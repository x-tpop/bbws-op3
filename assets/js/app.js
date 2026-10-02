// ============================================================
// APP.JS — Router + Logic Shell (v5 — dynamic bnav + raport + role guard)
// ============================================================

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const refreshIcons = () => { if (window.lucide) lucide.createIcons(); };

// ============================================================
// CEK LOGIN
// ============================================================
const session = requireLogin();
if (!session) throw new Error('Not logged in');

const pegawai = session.pegawai || {};
const namaLengkap = pegawai.nama || session.nama_lengkap || 'Pegawai';

 $$('.js-nama').forEach(el => el.textContent = namaLengkap);
 $$('.js-role').forEach(el => el.textContent = session.role);

if (pegawai.link_foto_2 || pegawai.link_foto_1) {
  $$('.js-avatar').forEach(el => el.src = pegawai.link_foto_2 || pegawai.link_foto_1);
}

// ============================================================
// DAFTAR HALAMAN
// ============================================================
const PAGES = {
  dashboard:  { k: 'Portal Pegawai', t: 'Dashboard',                file: 'pages/dashboard.html',  init: 'initDashboard',  roles: ['*'] },
  presensi:   { k: 'E-Kehadiran',    t: 'Presensi',                 file: 'pages/presensi.html',   init: 'initPresensi',   roles: ['*'] },
  verifikasi: { k: 'Verifikasi',     t: 'Verifikasi Presensi',      file: 'pages/verifikasi.html', init: 'initVerifikasi', roles: ['admin','ppk','staf_pengamat'] },
  monitoring: { k: 'Monitoring',     t: 'Monitoring PPA & Pekarya', file: 'pages/monitoring.html', init: 'initMonitoring', roles: ['admin','ppk','staf_pengamat'] },
  raport:     { k: 'Raport Kinerja', t: 'Raport PPA & Pekarya',     file: 'pages/raport.html',     init: 'initRaport',     roles: ['*'] },
  koordinasi: { k: 'Koordinasi',     t: 'Koordinasi Juru & Krosda', file: 'pages/koordinasi.html', init: 'initKoordinasi', roles: ['admin','ppk','staf_pengamat'] },
  laporan:    { k: 'Laporan',        t: 'Laporan Harian',           file: 'pages/laporan.html',    init: 'initLaporan',    roles: ['*'] },
  biodata:    { k: 'Profil Pegawai', t: 'Biodata',                  file: 'pages/biodata.html',    init: null,             roles: ['*'] },
  admin:      { k: 'Administrasi',   t: 'Admin Panel',              file: 'pages/admin.html',      init: 'initAdmin',      roles: ['admin'] }
};

// ============================================================
// SEMBUNYIKAN MENU SESUAI ROLE (sidebar saja)
// ★ PATCH: bnav TIDAK lagi dihapus statis — dibangun dinamis
// oleh buildBnav() sesuai role (lihat blok berikutnya).
// ============================================================
Object.entries(PAGES).forEach(([key, page]) => {
  if (page.roles[0] === '*') return;
  if (!page.roles.includes(session.role)) {
    document.querySelector(`#sidebarNav [data-page="${key}"]`)?.remove();
  } else {
    const navEl = document.querySelector(`#sidebarNav [data-page="${key}"]`);
    if (navEl) navEl.style.display = '';
  }
});

// ============================================================
// ★ TAMBAHAN: BOTTOM NAV DINAMIS SESUAI ROLE
// PPA/Pekarya : Dashboard · Laporan · FAB · Raport · Profil
// Manajemen   : Dashboard · Monitor · FAB · Verif  · Profil
// ============================================================
const BNAV_LAYOUT = {
  pegawai: [
    { page: 'dashboard', icon: 'layout-dashboard', label: 'Dashboard' },
    { page: 'laporan',   icon: 'file-text',        label: 'Laporan'   },
    'FAB',
    { page: 'raport',    icon: 'award',            label: 'Raport'    },
    { page: 'biodata',   icon: 'user-round',       label: 'Profil'    }
  ],
  manajemen: [
    { page: 'dashboard',  icon: 'layout-dashboard', label: 'Dashboard' },
    { page: 'monitoring', icon: 'eye',              label: 'Monitor'   },
    'FAB',
    { page: 'verifikasi', icon: 'clipboard-check',  label: 'Verif'     },
    { page: 'biodata',    icon: 'user-round',       label: 'Profil'    }
  ]
};

function buildBnav() {
  const bnav = document.getElementById('bnav');
  if (!bnav) return;

  const isManager = ['admin', 'ppk', 'staf_pengamat'].includes(session.role);
  const layout = isManager ? BNAV_LAYOUT.manajemen : BNAV_LAYOUT.pegawai;

  // Safety: jangan render item yang role-nya tak diizinkan
  const items = layout.filter(it =>
    it === 'FAB' ||
    PAGES[it.page]?.roles[0] === '*' ||
    PAGES[it.page]?.roles.includes(session.role)
  );

  bnav.innerHTML = items.map(it => {
    if (it === 'FAB') {
      return `<button class="bnav-fab" data-page="presensi" aria-label="Presensi">
        <i data-lucide="fingerprint"></i>
      </button>`;
    }
    return `<button class="bnav-item" data-page="${it.page}">
      <span class="bnav-ic"><i data-lucide="${it.icon}"></i></span>
      <span>${it.label}</span>
    </button>`;
  }).join('');
}
buildBnav();
refreshIcons();

// ============================================================
// STATE
// ============================================================
let currentPage = null;
let isNavigating = false;

// ============================================================
// CLEANUP
// ============================================================
function cleanupPage() {
  if (window.__presInterval) { clearInterval(window.__presInterval); window.__presInterval = null; }
  if (window.__dashInterval) { clearInterval(window.__dashInterval); window.__dashInterval = null; }
  if (window.__wmInterval) { clearInterval(window.__wmInterval); window.__wmInterval = null; }
  // ★ PATCH: matikan face-detection MediaPipe saat pindah halaman —
  // dulu interval 200ms-nya terus berjalan (memory leak antar halaman)
  if (typeof window.stopFaceDetection === 'function') {
    try { window.stopFaceDetection(); } catch (e) {}
  }
  // ★ PATCH: matikan stream kamera juga
  if (typeof window.stopCamera === 'function') {
    try { window.stopCamera(); } catch (e) {}
  }
  window.__presensiInit = false;
  window.__dashboardInit = false;
}

// ============================================================
// ROUTER
// ============================================================
async function go(pageName, isFromHash = false) {
  // ★ TAMBAHAN: validasi role di router — bukan hanya di menu.
  // Menutup akses via hash manual (mis. app.html#monitoring oleh pegawai).
  const pageDef = PAGES[pageName];
  if (!pageDef) {
    console.warn('Halaman tidak dikenal:', pageName);
    return;
  }
  if (pageDef.roles[0] !== '*' && !pageDef.roles.includes(session.role)) {
    toast('Anda tidak punya akses ke halaman ini', 'warn');
    if (pageName !== 'dashboard') return go('dashboard', true);
    return;
  }

  if (currentPage === pageName && !isFromHash) {
    console.log('Sudah di halaman', pageName, '— skip');
    return;
  }

  if (isNavigating) {
    console.log('Sedang navigasi — skip');
    return;
  }

  isNavigating = true;

  try {
    currentPage = pageName;
    const page = pageDef;

    cleanupPage();

    $$('.nav-btn').forEach(b => b.classList.toggle('on', b.dataset.page === pageName));
    $$('.bnav-item').forEach(b => b.classList.toggle('on', b.dataset.page === pageName));

    $('#tbKicker').textContent = page.k;
    $('#tbTitle').textContent = page.t;

    if (!isFromHash && location.hash !== '#' + pageName) {
      history.replaceState(null, '', '#' + pageName);
    }

    window.scrollTo(0, 0);

    const oldContainer = document.getElementById('pageContainer');
    const container = oldContainer.cloneNode(false);
    oldContainer.parentNode.replaceChild(container, oldContainer);

    container.innerHTML = `
      <div style="text-align:center;padding:60px;color:var(--muted)">
        <div style="display:inline-block;width:32px;height:32px;border:3px solid var(--line);border-top-color:var(--blue);border-radius:50%;animation:spin .8s linear infinite"></div>
        <p style="margin-top:12px;font-weight:600">Memuat halaman...</p>
      </div>`;

    const res = await fetch(page.file + '?v=' + Date.now());
    if (!res.ok) throw new Error('Gagal memuat halaman: ' + res.status);
    const html = await res.text();

    container.innerHTML = html;

    const scripts = container.querySelectorAll('script');
    for (const oldScript of scripts) {
      const newScript = document.createElement('script');
      [...oldScript.attributes].forEach(attr => newScript.setAttribute(attr.name, attr.value));
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    }

    const initFn = page.init;
    console.log('Router:', pageName, '| init:', initFn);

    if (initFn && typeof window[initFn] === 'function') {
      console.log('→ Memanggil', initFn);
      await window[initFn]();
    }

    refreshIcons();

  } catch (err) {
    console.error('Router error:', err);
    const container = document.getElementById('pageContainer');
    if (container) {
      container.innerHTML = `
        <div class="card">
          <div class="empty">
            <i data-lucide="alert-circle"></i>
            <div>Gagal memuat halaman: ${err.message}</div>
          </div>
        </div>`;
      refreshIcons();
    }
  } finally {
    isNavigating = false;
  }
}

// ============================================================
// EVENT: Klik menu
// ============================================================
document.addEventListener('click', e => {
  // ★ PATCH: batasi ke button/a/.clickable — sebelumnya SEMUA elemen
  // ber-atribut data-page cocok, termasuk <section data-page="presensi">
  // yang membungkus seluruh halaman (klik di mana saja = preventDefault).
  // Jika ada card/div yang bisa diklik di halaman lain, beri class="clickable".
  const btn = e.target.closest('button[data-page], a[data-page], .clickable[data-page]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();

  const pageName = btn.dataset.page;
  console.log('Menu klik:', pageName);
  go(pageName);
});

// ============================================================
// EVENT: Logout (sidebar + topbar mobile)
// ★ TAMBAHAN: #btnLogoutMobile — sidebar tersembunyi di HP,
// tanpa ini pegawai tidak punya cara keluar di mode mobile.
// ============================================================
 $$('#btnLogout, #btnLogoutMobile').forEach(b => b?.addEventListener('click', () => {
  if (confirm('Keluar dari Portal Pegawai?')) logout();
}));

// ============================================================
// JAM
// ============================================================
function tick() {
  const d = new Date();
  // ★ PATCH: format manual (toLocaleTimeString 'id-ID' memakai pemisah
  // titik "14.30" — inkonsisten dengan presClock "14:30:15")
  const hm = [String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0')].join(':');
  const el = $('#tbTime');
  if (el) el.textContent = d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + hm;
}
tick();
if (window.__tbInterval) clearInterval(window.__tbInterval);
window.__tbInterval = setInterval(tick, 1000);

// ============================================================
// TOAST
// ============================================================
function toast(msg, type = 'success') {
  const ic = { success: 'circle-check', info: 'info', warn: 'triangle-alert', error: 'circle-alert' }[type];
  const el = document.createElement('div');
  el.className = 'toast t-' + type;
  el.innerHTML = `<i data-lucide="${ic}"></i><div>${msg}</div>`;
  const toastBox = $('#toasts');
  if (toastBox) toastBox.append(el);
  refreshIcons();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 3400);
}

// ============================================================
// MODAL FOTO
// ============================================================
function openFotoModal(url, nama) {
  const modal = document.getElementById('fotoModal');
  const img = document.getElementById('fotoModalImg');
  const title = document.getElementById('fotoModalTitle');
  if (!modal) return;
  if (img) img.src = url;
  if (title) title.textContent = 'Foto — ' + (nama || '');
  modal.classList.add('open');
}

function closeFotoModal() {
  document.getElementById('fotoModal')?.classList.remove('open');
}

// ============================================================
// AUTO-HIDE BOTTOM NAV
// ============================================================
let lastY = window.scrollY;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  const bnav = document.getElementById('bnav');
  if (!bnav) return;
  if (y > lastY + 6 && y > 100) {
    bnav.classList.add('hide');
  } else if (y < lastY - 6) {
    bnav.classList.remove('hide');
  }
  lastY = y;
}, { passive: true });

// ============================================================
// INIT — Load halaman pertama
// ============================================================
const initialPage = location.hash.replace('#', '') || 'dashboard';
go(PAGES[initialPage] ? initialPage : 'dashboard', true);

// ============================================================
// EXPOSE GLOBAL
// ============================================================
window.refreshIcons = refreshIcons;
window.toast = toast;
window.go = go;
window.openFotoModal = openFotoModal;
window.closeFotoModal = closeFotoModal;
window.getSession = getSession;
window.logout = logout;
window.supabaseClient = supabaseClient;
window.CONFIG = CONFIG;
window.cleanupPage = cleanupPage;
