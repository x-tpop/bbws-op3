// ============================================================
// APP.JS — Router + Logic Shell
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
// DAFTAR HALAMAN
// ============================================================
const PAGES = {
  dashboard:  { k: 'Portal Pegawai', t: 'Dashboard',                file: 'pages/dashboard.html',  roles: ['*'] },
  presensi:   { k: 'E-Kehadiran',    t: 'Presensi',                 file: 'pages/presensi.html',   roles: ['*'] },
  verifikasi: { k: 'Verifikasi',     t: 'Verifikasi Presensi',      file: 'pages/verifikasi.html', roles: ['admin','ppk','staf_pengamat'] },
  monitoring: { k: 'Monitoring',     t: 'Monitoring PPA & Pekarya', file: 'pages/monitoring.html', roles: ['admin','ppk','staf_pengamat'] },
  koordinasi: { k: 'Koordinasi',     t: 'Koordinasi Juru & Krosda', file: 'pages/koordinasi.html', roles: ['admin','ppk','staf_pengamat'] },
  laporan:    { k: 'Laporan',        t: 'Laporan Harian',           file: 'pages/laporan.html',    roles: ['*'] },
  biodata:    { k: 'Profil Pegawai', t: 'Biodata',                  file: 'pages/biodata.html',    roles: ['*'] }
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

  // Show loading
  const container = $('#pageContainer');
  container.innerHTML = `
    <div style="text-align:center;padding:60px;color:var(--muted)">
      <div style="display:inline-block;width:32px;height:32px;border:3px solid var(--line);border-top-color:var(--blue);border-radius:50%;animation:spin .8s linear infinite"></div>
      <p style="margin-top:12px;font-weight:600">Memuat halaman...</p>
    </div>`;

  try {
    // Fetch HTML
    const res = await fetch(page.file + '?v=' + Date.now());
    if (!res.ok) throw new Error('Gagal memuat halaman: ' + res.status);
    const html = await res.text();

    // Inject HTML
    container.innerHTML = html;

    // ============================================================
    // PENTING: JALANKAN <script> DI DALAM HTML
    // ============================================================
    const scripts = container.querySelectorAll('script');
    for (const oldScript of scripts) {
      const newScript = document.createElement('script');
      // Copy atribut
      [...oldScript.attributes].forEach(attr => {
        newScript.setAttribute(attr.name, attr.value);
      });
      // Copy isi
      newScript.textContent = oldScript.textContent;
      // Replace
      oldScript.parentNode.replaceChild(newScript, oldScript);
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
  $('#tbTime').textContent = d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + hm;
}
tick(); setInterval(tick, 1000);

// ============================================================
// TOAST
// ============================================================
function toast(msg, type = 'success') {
  const ic = { success: 'circle-check', info: 'info', warn: 'triangle-alert', error: 'circle-alert' }[type];
  const el = document.createElement('div');
  el.className = 'toast t-' + type;
  el.innerHTML = `<i data-lucide="${ic}"></i><div>${msg}</div>`;
  $('#toasts').append(el); refreshIcons();
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
  img.src = url;
  title.textContent = 'Foto — ' + (nama || '');
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
