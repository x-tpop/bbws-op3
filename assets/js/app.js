// ============================================================
// APP.JS — Router + Logic Shell (FIXED)
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

// Isi data session ke shell
$$('.js-nama').forEach(el => el.textContent = namaLengkap);
$$('.js-role').forEach(el => el.textContent = session.role);

// Avatar
if (pegawai.link_foto_2 || pegawai.link_foto_1) {
  $$('.js-avatar').forEach(el => el.src = pegawai.link_foto_2 || pegawai.link_foto_1);
}

// ============================================================
// DAFTAR HALAMAN + FUNGSI INIT
// ============================================================
const PAGES = {
  dashboard:  { k: 'Portal Pegawai', t: 'Dashboard',                file: 'pages/dashboard.html',  init: 'initDashboard',  roles: ['*'] },
  presensi:   { k: 'E-Kehadiran',    t: 'Presensi',                 file: 'pages/presensi.html',   init: 'initPresensi',   roles: ['*'] },
  verifikasi: { k: 'Verifikasi',     t: 'Verifikasi Presensi',      file: 'pages/verifikasi.html', init: 'initVerifikasi', roles: ['admin','ppk','staf_pengamat'] },
  monitoring: { k: 'Monitoring',     t: 'Monitoring PPA & Pekarya', file: 'pages/monitoring.html', init: 'initMonitoring', roles: ['admin','ppk','staf_pengamat'] },
  koordinasi: { k: 'Koordinasi',     t: 'Koordinasi Juru & Krosda', file: 'pages/koordinasi.html', init: 'initKoordinasi', roles: ['admin','ppk','staf_pengamat'] },
  laporan:    { k: 'Laporan',        t: 'Laporan Harian',           file: 'pages/laporan.html',    init: 'initLaporan',    roles: ['*'] },
  biodata:    { k: 'Profil Pegawai', t: 'Biodata',                  file: 'pages/biodata.html',    init: null,             roles: ['*'] }
};

// ============================================================
// SEMBUNYIKAN MENU SESUAI ROLE
// ============================================================
Object.entries(PAGES).forEach(([key, page]) => {
  if (page.roles[0] === '*') return;
  if (!page.roles.includes(session.role)) {
    document.querySelector(`[data-page="${key}"]`)?.remove();
    document.querySelector(`#bnav [data-page="${key}"]`)?.remove();
  }
});

// ============================================================
// CLEANUP: Bersihkan interval & stream saat pindah halaman
// ============================================================
function cleanupPage() {
  // Clear semua interval yang kita daftarkan
  if (window.__presInterval) { clearInterval(window.__presInterval); window.__presInterval = null; }
  if (window.__dashInterval) { clearInterval(window.__dashInterval); window.__dashInterval = null; }

  // Stop kamera
  if (typeof window.stopCamera === 'function') {
    try { window.stopCamera(); } catch (e) {}
  }

  // Reset flag init
  window.__presensiInit = false;
  window.__dashboardInit = false;
}

// ============================================================
// ROUTER
// ============================================================
let currentPage = null;

async function go(pageName) {
  if (!PAGES[pageName]) {
    console.warn('Halaman tidak dikenal:', pageName);
    return;
  }

  currentPage = pageName;
  const page = PAGES[pageName];

  // Cleanup halaman sebelumnya
  cleanupPage();

  // Update sidebar & bottom nav
  $$('.nav-btn').forEach(b => b.classList.toggle('on', b.dataset.page === pageName));
  $$('.bnav-item').forEach(b => b.classList.toggle('on', b.dataset.page === pageName));

  // Update judul
  $('#tbKicker').textContent = page.k;
  $('#tbTitle').textContent = page.t;

  // Update URL hash
  location.hash = pageName;

  // Scroll ke atas
  window.scrollTo(0, 0);

  // ============================================================
  // CLONE CONTAINER — bersihkan listener & state halaman lama
  // ============================================================
  const oldContainer = document.getElementById('pageContainer');
  const container = oldContainer.cloneNode(false); // clone tanpa child
  oldContainer.parentNode.replaceChild(container, oldContainer);

  // Show loading
  container.innerHTML = `
    <div style="text-align:center;padding:60px;color:var(--muted)">
      <div style="display:inline-block;width:32px;height:32px;border:3px solid var(--line);border-top-color:var(--blue);border-radius:50%;animation:spin .8s linear infinite"></div>
      <p style="margin-top:12px;font-weight:600">Memuat halaman...</p>
    </div>`;

  try {
    // 1. Fetch HTML
    const res = await fetch(page.file + '?v=' + Date.now());
    if (!res.ok) throw new Error('Gagal memuat halaman: ' + res.status);
    const html = await res.text();

    // 2. Inject HTML
    container.innerHTML = html;

    // 3. Jalankan <script> di dalam HTML (jika ada)
    const scripts = container.querySelectorAll('script');
    for (const oldScript of scripts) {
      const newScript = document.createElement('script');
      [...oldScript.attributes].forEach(attr => {
        newScript.setAttribute(attr.name, attr.value);
      });
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    }

    // 4. Panggil init function halaman
    const initFn = page.init;
    console.log('Router:', pageName, '| init:', initFn);

    if (initFn && typeof window[initFn] === 'function') {
      console.log('→ Memanggil', initFn);
      await window[initFn]();
    } else if (initFn) {
      console.warn('✗ Init function TIDAK ditemukan:', initFn);
    }

    refreshIcons();

  } catch (err) {
    console.error('Router error:', err);
    container.innerHTML = `
      <div class="card">
        <div class="empty">
          <i data-lucide="alert-circle"></i>
          <div>Gagal memuat halaman: ${err.message}</div>
        </div>
      </div>`;
    refreshIcons();
  }
}

// ============================================================
// EVENT: Klik menu
// ============================================================
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-page]');
  if (btn) {
    e.preventDefault();
    go(btn.dataset.page);
    return;
  }
});

// ============================================================
// EVENT: Logout
// ============================================================
$('#btnLogout').addEventListener('click', () => {
  if (confirm('Keluar dari Portal Pegawai?')) logout();
});

// ============================================================
// JAM
// ============================================================
function tick() {
  const d = new Date();
  const hm = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
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
// INIT
// ============================================================
const initialPage = location.hash.replace('#', '') || 'dashboard';
go(PAGES[initialPage] ? initialPage : 'dashboard');

// Handle back/forward browser
window.addEventListener('hashchange', () => {
  const p = location.hash.replace('#', '');
  if (p && p !== currentPage && PAGES[p]) go(p);
});

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
