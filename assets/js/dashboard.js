// ============================================================
// DASHBOARD.JS (PATCHED)
// ============================================================

async function initDashboard() {
  console.log('=== Init Dashboard ===');

  try {
    const session = getSession();
    if (!session) return;

    const pegawai = session.pegawai || {};
    const namaLengkap = pegawai.nama || session.nama_lengkap || 'Pegawai';

    document.querySelectorAll('.js-jabatan').forEach(el => el.textContent = pegawai.jabatan || session.role);
    document.querySelectorAll('.js-nomor').forEach(el => el.textContent = pegawai.nomor_identitas || session.username);

    const greetWord = document.getElementById('greetWord');
    const greetName = document.getElementById('greetName');
    const h = new Date().getHours();
    if (greetWord) greetWord.textContent = h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 19 ? 'Selamat sore' : 'Selamat malam';
    if (greetName) greetName.textContent = namaLengkap.split(' ')[0];

    if (pegawai.link_foto_2 || pegawai.link_foto_1) {
      document.querySelectorAll('.js-avatar').forEach(el => el.src = pegawai.link_foto_2 || pegawai.link_foto_1);
    }

    if (pegawai.id_di) {
      const { data } = await supabaseClient.from('di').select('nama_di').eq('id_di', pegawai.id_di).maybeSingle();
      if (data) document.querySelectorAll('.js-di').forEach(el => el.textContent = data.nama_di);
    }

    function tickDash() {
      const d = new Date();
      // ★ PATCH: format manual — toLocaleTimeString('id-ID') menghasilkan
      // pemisah titik "14.30.15" (inkonsisten dengan jam halaman presensi)
      const hms = [String(d.getHours()).padStart(2,'0'), String(d.getMinutes()).padStart(2,'0'), String(d.getSeconds()).padStart(2,'0')].join(':');
      const clock = document.getElementById('dashClock');
      const dateEl = document.getElementById('dashDate');
      if (clock) clock.textContent = hms;
      if (dateEl) dateEl.textContent = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    tickDash();
    if (window.__dashInterval) clearInterval(window.__dashInterval);
    window.__dashInterval = setInterval(tickDash, 1000);

    // ★ PATCH: localDateStr() menggantikan toISOString().slice(0,10) —
    // toISOString() = UTC, sehingga jam 00:00–06:59 WIB dashboard
    // membaca presensi KEMARIN (status & stHadir salah sejak dini hari)
    const today = localDateStr();

    if (session.id_pegawai) {
      const { data } = await supabaseClient.from('presensi').select('*')
        .eq('id_pegawai', session.id_pegawai).eq('tanggal', today).maybeSingle();

      const stateEl = document.getElementById('dashPresState');
      const actionsEl = document.getElementById('dashPresActions');

      if (data?.jam_masuk) {
        const jamMasuk = data.jam_masuk.slice(0, 5);
        if (data.jam_keluar) {
          if (stateEl) stateEl.textContent = `Presensi selesai. Masuk ${jamMasuk}, keluar ${data.jam_keluar.slice(0,5)}.`;
          if (actionsEl) actionsEl.innerHTML = '<span class="badge b-ok"><span class="dot"></span>Selesai</span>';
        } else {
          if (stateEl) stateEl.textContent = `Sudah check-in pukul ${jamMasuk}. Jangan lupa check-out.`;
          if (actionsEl) actionsEl.innerHTML = '<span class="badge b-ok"><span class="dot"></span>Hadir</span>';
        }
      } else {
        if (stateEl) stateEl.textContent = 'Anda belum melakukan presensi hari ini.';
      }
    }

    if (pegawai.tanggal_mulai_sda || pegawai.tanggal_mulai_bbws) {
      const mulai = new Date(pegawai.tanggal_mulai_sda || pegawai.tanggal_mulai_bbws);
      // ★ PATCH: hitung tahun kalender — rumus lama (bagi 365 hari)
      // meleset ±1 hari per tahun kabisat
      const now = new Date();
      let tahun = now.getFullYear() - mulai.getFullYear();
      const mdiff = now.getMonth() - mulai.getMonth();
      if (mdiff < 0 || (mdiff === 0 && now.getDate() < mulai.getDate())) tahun--;
      if (tahun < 0) tahun = 0;
      const el = document.getElementById('stMasa');
      if (el) el.textContent = tahun + ' thn';
    }

    if (session.id_pegawai) {
      const startBulan = today.slice(0, 7) + '-01';

      // ★ PATCH: filter berdasarkan STATUS, bukan jam_masuk —
      // record Izin/Sakit tetap terisi jam_masuk (waktu submit),
      // jadi filter lama menghitung Izin/Sakit sebagai "hadir".
      // Sesuaikan daftar status bila kebijakan berbeda.
      const { count } = await supabaseClient.from('presensi').select('*', { count: 'exact', head: true })
        .eq('id_pegawai', session.id_pegawai).gte('tanggal', startBulan)
        .in('status', ['Hadir', 'Dinas Luar', 'Kerja Gabungan']);
      const el = document.getElementById('stHadir');
      if (el) el.textContent = (count || 0) + 'x';

      const { count: countLap } = await supabaseClient.from('laporan').select('*', { count: 'exact', head: true })
        .eq('id_pegawai', session.id_pegawai);
      const elLap = document.getElementById('stLapor');
      if (elLap) elLap.textContent = countLap || 0;
    }

    if (window.refreshIcons) window.refreshIcons();
    console.log('=== Dashboard loaded ===');

  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

window.initDashboard = initDashboard;
