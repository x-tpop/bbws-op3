// ============================================================
// VERIFIKASI.JS — Verifikasi Presensi + Pengajuan (v2)
// Tab 1: Presensi harian (Layak / Tidak Layak)
// Tab 2: Pengajuan (Sakit/Izin/Dinas/Lupa Absen) —
//        Setujui / Revisi / Tolak; saat disetujui otomatis
//        menulis/melengkapi tabel presensi.
// File: assets/js/verifikasi.js
// ============================================================

let verifikasiState = {
  // ★ PATCH: localDateStr() — toISOString() = UTC, jam 00:00–06:59
  // WIB menampilkan presensi KEMARIN
  tanggal: localDateStr(),
  statusFilter: 'belum',
  list: [],
  pegawaiMap: {},
  diMap: {},
  // ★ BARU: tab pengajuan
  tab: 'presensi',
  pjStatusFilter: 'menunggu',
  pjList: []
};

// ============================================================
// LOAD MASTER DATA
// ============================================================
async function loadMasterVerifikasi() {
  const [pegawaiList, diList] = await Promise.all([
    dbSelect('pegawai', { select: 'id_pegawai,nomor_identitas,nama,jabatan,id_di,krosda' }),
    dbSelect('di', { select: 'id_di,nama_di' })
  ]);

  verifikasiState.pegawaiMap = {};
  pegawaiList.forEach(p => { verifikasiState.pegawaiMap[p.id_pegawai] = p; });

  verifikasiState.diMap = {};
  diList.forEach(d => { verifikasiState.diMap[d.id_di] = d.nama_di; });
}

// ★ Helper: staf_pengamat hanya melihat pegawai DI-nya
function vrfScopeIds() {
  const session = getSession();
  if (session?.role === 'staf_pengamat' && session.pegawai?.id_di) {
    return Object.values(verifikasiState.pegawaiMap)
      .filter(p => p.id_di === session.pegawai.id_di)
      .map(p => p.id_pegawai);
  }
  return null; // admin/ppk: semua
}

// ============================================================
// LOAD PRESENSI (Tab 1)
// ============================================================
async function loadPresensiVerifikasi() {
  const session = getSession();
  if (!session) return;

  let query = supabaseClient
    .from('presensi')
    .select('*')
    .eq('tanggal', verifikasiState.tanggal)
    .order('created_at', { ascending: false });

  const scopeIds = vrfScopeIds();
  if (scopeIds) {
    if (scopeIds.length === 0) { verifikasiState.list = []; renderVerifikasiList(); return; }
    query = query.in('id_pegawai', scopeIds);
  }

  const { data, error } = await query;
  if (error) { console.error('Load presensi error:', error); return; }

  let list = data || [];
  if (verifikasiState.statusFilter === 'belum') {
    list = list.filter(p => !p.status_verifikasi);
  } else if (verifikasiState.statusFilter === 'layak') {
    list = list.filter(p => p.status_verifikasi === 'Layak');
  } else if (verifikasiState.statusFilter === 'tidak_layak') {
    list = list.filter(p => p.status_verifikasi === 'Tidak Layak');
  }

  verifikasiState.list = list;
  renderVerifikasiList();
}

// ============================================================
// ★ BARU v2: LOAD PENGAJUAN (Tab 2)
// ============================================================
async function loadPengajuanVerifikasi() {
  let query = supabaseClient
    .from('pengajuan')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  const scopeIds = vrfScopeIds();
  if (scopeIds) {
    if (scopeIds.length === 0) { verifikasiState.pjList = []; renderPengajuanList(); return; }
    query = query.in('id_pegawai', scopeIds);
  }

  const { data, error } = await query;
  if (error) { console.error('Load pengajuan error:', error); return; }

  let list = data || [];
  if (verifikasiState.pjStatusFilter !== 'semua') {
    const map = { menunggu: 'Menunggu', disetujui: 'Disetujui', revisi: 'Revisi', ditolak: 'Ditolak' };
    list = list.filter(p => p.status === map[verifikasiState.pjStatusFilter]);
  }

  verifikasiState.pjList = list;
  renderPengajuanList();
}

// ============================================================
// RENDER TAB 1 — PRESENSI
// ============================================================
function renderVerifikasiList() {
  const tbody = document.getElementById('verifTbody');
  if (!tbody) return;

  const list = verifikasiState.list;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="6">
        <div class="empty"><i data-lucide="inbox"></i><div>Tidak ada presensi yang perlu diverifikasi.</div></div>
      </td></tr>`;
    if (window.refreshIcons) window.refreshIcons();
    return;
  }

  tbody.innerHTML = list.map(p => {
    const pegawai = verifikasiState.pegawaiMap[p.id_pegawai] || {};
    const diNama = verifikasiState.diMap[pegawai.id_di] || '-';

    let statusBadge = '<span class="badge b-wait"><span class="dot"></span>Belum</span>';
    if (p.status_verifikasi === 'Layak') statusBadge = '<span class="badge b-ok"><span class="dot"></span>Layak</span>';
    else if (p.status_verifikasi === 'Tidak Layak') statusBadge = '<span class="badge b-rev"><span class="dot"></span>Tidak Layak</span>';

    const jamMasuk = p.jam_masuk ? p.jam_masuk.slice(0, 5) : '-';
    const jamKeluar = p.jam_keluar ? p.jam_keluar.slice(0, 5) : '-';

    return `
      <tr>
        <td>
          <div style="font-weight:700">${pegawai.nama || '-'}</div>
          <div style="font-size:12px;color:var(--muted)">${pegawai.nomor_identitas || '-'}</div>
        </td>
        <td>
          <div>${pegawai.jabatan || '-'}</div>
          <div style="font-size:12px;color:var(--muted)">${diNama}</div>
        </td>
        <td>
          <div><b>Masuk:</b> ${jamMasuk}</div>
          <div><b>Keluar:</b> ${jamKeluar}</div>
          <div style="font-size:11px;color:var(--muted)">${p.status || '-'}</div>
        </td>
        <td>
          ${p.foto_masuk ? `<img src="${p.foto_masuk}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;cursor:pointer" onclick="openFotoModal('${p.foto_masuk}', '${pegawai.nama}')">` : '<span style="color:var(--muted)">-</span>'}
        </td>
        <td>${statusBadge}</td>
        <td>
          ${!p.status_verifikasi ? `
            <button class="btn btn-green sm" onclick="verifikasiPresensi('${p.id_presensi}', 'Layak')"><i data-lucide="check"></i>Layak</button>
            <button class="btn btn-red sm" onclick="verifikasiPresensi('${p.id_presensi}', 'Tidak Layak')" style="margin-left:6px"><i data-lucide="x"></i>Tolak</button>
          ` : `<span style="font-size:12px;color:var(--muted)">Sudah diverifikasi</span>`}
        </td>
      </tr>
    `;
  }).join('');

  if (window.refreshIcons) window.refreshIcons();
}

// ============================================================
// ★ BARU v2: RENDER TAB 2 — PENGAJUAN
// ============================================================
function renderPengajuanList() {
  const tbody = document.getElementById('pjTbody');
  if (!tbody) return;

  const list = verifikasiState.pjList;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="6">
        <div class="empty"><i data-lucide="inbox"></i><div>Tidak ada pengajuan pada filter ini.</div></div>
      </td></tr>`;
    if (window.refreshIcons) window.refreshIcons();
    return;
  }

  const badgeFor = st => ({
    'Menunggu': '<span class="badge b-wait"><span class="dot"></span>Menunggu</span>',
    'Disetujui': '<span class="badge b-ok"><span class="dot"></span>Disetujui</span>',
    'Revisi':    '<span class="badge b-rev"><span class="dot"></span>Revisi</span>',
    'Ditolak':   '<span class="badge b-deny"><span class="dot"></span>Ditolak</span>'
  }[st] || '-');

  tbody.innerHTML = list.map(pj => {
    const pegawai = verifikasiState.pegawaiMap[pj.id_pegawai] || {};
    const diNama = verifikasiState.diMap[pegawai.id_di] || '-';

    const tanggal = pj.tanggal_selesai && pj.tanggal_selesai !== pj.tanggal_mulai
      ? `${pj.tanggal_mulai} → ${pj.tanggal_selesai}`
      : pj.tanggal_mulai;

    const jamInfo = pj.jenis === 'Lupa Absen'
      ? `<div style="font-size:11.5px">Hadir: <b>${pj.jam_hadir || '-'}</b> · Pulang: <b>${pj.jam_pulang || '-'}</b></div>`
      : '';

    const lampiran = [
      pj.foto ? `<img src="${pj.foto}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;cursor:pointer" onclick="openFotoModal('${pj.foto}', '${pegawai.nama}')">` : '',
      pj.surat ? `<img src="${pj.surat}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;cursor:pointer;margin-left:4px" onclick="openFotoModal('${pj.surat}', 'Surat ${pegawai.nama}')">` : ''
    ].join('') || '<span style="color:var(--muted)">-</span>';

    const aksi = pj.status === 'Menunggu' ? `
      <button class="btn btn-green sm" onclick="verifikasiPengajuan('${pj.id}', 'Disetujui')"><i data-lucide="check"></i>Setujui</button>
      <button class="btn btn-orange sm" onclick="verifikasiPengajuan('${pj.id}', 'Revisi')" style="margin-left:4px"><i data-lucide="pencil"></i>Revisi</button>
      <button class="btn btn-red sm" onclick="verifikasiPengajuan('${pj.id}', 'Ditolak')" style="margin-left:4px"><i data-lucide="x"></i>Tolak</button>
    ` : (pj.catatan_verifikasi
      ? `<div style="font-size:11.5px;color:var(--muted);max-width:160px">"${pj.catatan_verifikasi}"</div>`
      : '<span style="font-size:12px;color:var(--muted)">Selesai</span>');

    return `
      <tr>
        <td>
          <div style="font-weight:700">${pegawai.nama || '-'}</div>
          <div style="font-size:12px;color:var(--muted)">${diNama}</div>
        </td>
        <td><span class="chip-o">${pj.jenis}</span></td>
        <td>
          <div style="font-weight:600">${tanggal}</div>
          ${jamInfo}
          <div style="font-size:11.5px;color:var(--muted);max-width:200px">${(pj.alasan || '').slice(0, 80)}${(pj.alasan || '').length > 80 ? '…' : ''}</div>
        </td>
        <td>${lampiran}</td>
        <td>${badgeFor(pj.status)}</td>
        <td>${aksi}</td>
      </tr>
    `;
  }).join('');

  if (window.refreshIcons) window.refreshIcons();
}

// ============================================================
// AKSI VERIFIKASI — PRESENSI (Tab 1, tidak berubah)
// ============================================================
async function verifikasiPresensi(idPresensi, status) {
  let catatan = '';

  if (status === 'Tidak Layak') {
    catatan = prompt('Alasan tidak layak:');
    if (catatan === null) return;
    if (!catatan.trim()) { toast('Alasan wajib diisi untuk "Tidak Layak"', 'warn'); return; }
  } else {
    if (!confirm('Verifikasi presensi ini sebagai LAYAK?')) return;
  }

  try {
    const session = getSession();

    await dbUpdate('presensi', 'id_presensi', idPresensi, {
      status_verifikasi: status,
      diverifikasi_oleh: session.id_pegawai,
      catatan_verifikasi: catatan || null,
      poin: status === 'Layak' ? 1 : -2
    });

    toast(`Presensi berhasil diverifikasi: ${status}`, 'success');
    await loadPresensiVerifikasi();

  } catch (err) {
    console.error('Verifikasi error:', err);
    toast('Gagal verifikasi: ' + err.message, 'error');
  }
}

// ============================================================
// ★ BARU v2: AKSI VERIFIKASI — PENGAJUAN
// Disetujui → tulis ke tabel presensi:
//  • Lupa Absen  : lengkapi jam_masuk/jam_keluar pada tanggal tsb
//  • Sakit/Izin/Dinas Luar : buat/lengkapi record per tanggal (rentang)
// ============================================================
async function verifikasiPengajuan(idPengajuan, status) {
  let catatan = '';
  if (status !== 'Disetujui') {
    catatan = prompt(status === 'Revisi' ? 'Catatan revisi:' : 'Alasan penolakan:');
    if (catatan === null) return;
    if (!catatan.trim()) { toast('Catatan wajib diisi', 'warn'); return; }
  } else {
    if (!confirm('Setujui pengajuan ini? Data presensi akan diperbarui otomatis.')) return;
  }

  try {
    const session = getSession();

    // Ambil data pengajuan
    const { data: pj, error: ePj } = await supabaseClient
      .from('pengajuan').select('*').eq('id', idPengajuan).maybeSingle();
    if (ePj) throw ePj;
    if (!pj) throw new Error('Pengajuan tidak ditemukan');
    if (pj.status !== 'Menunggu') { toast('Pengajuan sudah diproses', 'warn'); return; }

    // 1. Update status pengajuan
    const { error: eUpd } = await supabaseClient
      .from('pengajuan')
      .update({
        status,
        verified_by: session.id_pegawai || session.username,
        verified_at: new Date().toISOString(),
        catatan_verifikasi: catatan || null
      })
      .eq('id', idPengajuan);
    if (eUpd) throw eUpd;

    // 2. Disetujui → tulis ke presensi
    if (status === 'Disetujui') {
      const dates = [];
      const d0 = new Date(pj.tanggal_mulai + 'T00:00:00');
      const d1 = new Date((pj.tanggal_selesai || pj.tanggal_mulai) + 'T00:00:00');
      for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
        dates.push(localDateStr(d));
      }

      for (const tgl of dates) {
        // Cek existing record presensi tanggal tsb
        const { data: exist } = await supabaseClient
          .from('presensi').select('id_presensi')
          .eq('id_pegawai', pj.id_pegawai)
          .eq('tanggal', tgl).maybeSingle();

        if (pj.jenis === 'Lupa Absen') {
          // Lengkapi jam yang lupa — jangan timpa yang sudah ada
          const payload = {
            status_verifikasi: 'Layak',
            diverifikasi_oleh: session.id_pegawai,
            catatan_verifikasi: `Lupa absen disetujui: ${pj.alasan}`.slice(0, 250)
          };
          if (pj.jam_hadir) {
            payload.jam_masuk = pj.jam_hadir.length === 5 ? pj.jam_hadir + ':00' : pj.jam_hadir;
            payload.status_kehadiran = 'tepat_waktu';
            payload.catatan_kehadiran = 'Lupa Absen (disetujui)';
          }
          if (pj.jam_pulang) {
            payload.jam_keluar = pj.jam_pulang.length === 5 ? pj.jam_pulang + ':00' : pj.jam_pulang;
          }

          if (exist) {
            await dbUpdate('presensi', 'id_presensi', exist.id_presensi, payload);
          } else {
            await dbInsert('presensi', {
              id_pegawai: pj.id_pegawai,
              tanggal: tgl,
              status: 'Hadir',
              poin: 0,
              ...payload
            });
          }
        } else {
          // Sakit / Izin / Dinas Luar — record per tanggal
          const payload = {
            status: pj.jenis,
            keterangan: pj.alasan,
            status_verifikasi: 'Layak',
            diverifikasi_oleh: session.id_pegawai,
            catatan_verifikasi: `${pj.jenis} disetujui via pengajuan`
          };
          if (pj.surat) payload.surat = pj.surat;
          if (pj.foto) payload.foto_masuk = pj.foto;

          if (exist) {
            await dbUpdate('presensi', 'id_presensi', exist.id_presensi, payload);
          } else {
            await dbInsert('presensi', {
              id_pegawai: pj.id_pegawai,
              tanggal: tgl,
              poin: 0,
              ...payload
            });
          }
        }
      }
    }

    toast(`Pengajuan ${status.toLowerCase()}${status === 'Disetujui' ? ' — presensi diperbarui' : ''}`, 'success');
    await loadPengajuanVerifikasi();

  } catch (err) {
    console.error('Verifikasi pengajuan error:', err);
    toast('Gagal: ' + err.message, 'error');
  }
}

// ============================================================
// SWITCH TAB
// ============================================================
function switchVerifikasiTab(tab) {
  verifikasiState.tab = tab;
  document.getElementById('vrfTabPresensi')?.classList.toggle('active', tab === 'presensi');
  document.getElementById('vrfTabPengajuan')?.classList.toggle('active', tab === 'pengajuan');
  const p1 = document.getElementById('vrfSecPresensi');
  const p2 = document.getElementById('vrfSecPengajuan');
  if (p1) p1.hidden = tab !== 'presensi';
  if (p2) p2.hidden = tab !== 'pengajuan';
}

// ============================================================
// INIT
// ============================================================
async function initVerifikasi() {
  await loadMasterVerifikasi();
  await loadPresensiVerifikasi();
  await loadPengajuanVerifikasi();

  const tglInput = document.getElementById('verifTanggal');
  if (tglInput) {
    tglInput.value = verifikasiState.tanggal;
    tglInput.addEventListener('change', async (e) => {
      verifikasiState.tanggal = e.target.value;
      await loadPresensiVerifikasi();
    });
  }

  const statusSelect = document.getElementById('verifStatus');
  if (statusSelect) {
    statusSelect.addEventListener('change', async (e) => {
      verifikasiState.statusFilter = e.target.value;
      await loadPresensiVerifikasi();
    });
  }

  document.getElementById('verifRefresh')?.addEventListener('click', loadPresensiVerifikasi);

  // ★ Tab pengajuan
  const pjSelect = document.getElementById('pjFilterStatus');
  if (pjSelect) {
    pjSelect.addEventListener('change', async (e) => {
      verifikasiState.pjStatusFilter = e.target.value;
      await loadPengajuanVerifikasi();
    });
  }
  document.getElementById('pjRefresh')?.addEventListener('click', loadPengajuanVerifikasi);

  document.getElementById('vrfTabPresensi')?.addEventListener('click', () => switchVerifikasiTab('presensi'));
  document.getElementById('vrfTabPengajuan')?.addEventListener('click', () => switchVerifikasiTab('pengajuan'));
}

// Expose global
window.initVerifikasi = initVerifikasi;
window.verifikasiPresensi = verifikasiPresensi;
window.verifikasiPengajuan = verifikasiPengajuan;
window.loadPresensiVerifikasi = loadPresensiVerifikasi;
window.loadPengajuanVerifikasi = loadPengajuanVerifikasi;
window.switchVerifikasiTab = switchVerifikasiTab;
