// ============================================================
// VERIFIKASI.JS — Verifikasi Presensi + Pengajuan (v2.1)
// PATCH v2.1:
//  • Kolom pengajuan diselaraskan: tanggal_mulai/tanggal_selesai
//  • Status Indonesia: Menunggu/Disetujui/Revisi/Ditolak
//  • "Layak" TIDAK menimpa poin tier; "Tidak Layak" = poin -2
//  • Approve Sakit/Izin/Dinas: skip hari libur & hari yang sudah
//    ada check-in asli (anti-timpa)
//  • Escape atribut onclick (nama dengan apostrof aman)
// File: assets/js/verifikasi.js
// ============================================================

let verifikasiState = {
  tanggal: localDateStr(),
  statusFilter: 'belum',
  list: [],
  pegawaiMap: {},
  diMap: {},
  pengaturan: {},          // ★ v2.1: utk hari kerja saat approve rentang
  tab: 'presensi',
  pjStatusFilter: 'menunggu',
  pjList: []
};

// ---------- helper kecil ----------
function vrfAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
}

// ============================================================
// LOAD MASTER DATA
// ============================================================
async function loadMasterVerifikasi() {
  const [pegawaiList, diList, setRes] = await Promise.all([
    dbSelect('pegawai', { select: 'id_pegawai,nomor_identitas,nama,jabatan,id_di,krosda' }),
    dbSelect('di', { select: 'id_di,nama_di' }),
    supabaseClient.from('pengaturan').select('kunci,nilai')
  ]);

  verifikasiState.pegawaiMap = {};
  (pegawaiList || []).forEach(p => { verifikasiState.pegawaiMap[p.id_pegawai] = p; });

  verifikasiState.diMap = {};
  (diList || []).forEach(d => { verifikasiState.diMap[d.id_di] = d.nama_di; });

  verifikasiState.pengaturan = {};
  ((setRes && setRes.data) || []).forEach(r => { verifikasiState.pengaturan[r.kunci] = r.nilai; });
}

// Helper: staf_pengamat hanya melihat pegawai DI-nya
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
// LOAD PENGAJUAN (Tab 2)
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
    const namaAman = vrfAttr(pegawai.nama || '-');

    return `
      <tr>
        <td>
          <div style="font-weight:700">${vrfAttr(pegawai.nama || '-')}</div>
          <div style="font-size:12px;color:var(--muted)">${vrfAttr(pegawai.nomor_identitas || '-')}</div>
        </td>
        <td>
          <div>${vrfAttr(pegawai.jabatan || '-')}</div>
          <div style="font-size:12px;color:var(--muted)">${vrfAttr(diNama)}</div>
        </td>
        <td>
          <div><b>Masuk:</b> ${jamMasuk}</div>
          <div><b>Keluar:</b> ${jamKeluar}</div>
          <div style="font-size:11px;color:var(--muted)">${vrfAttr(p.status || '-')}</div>
        </td>
        <td>
          ${p.foto_masuk ? `<img src="${vrfAttr(p.foto_masuk)}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;cursor:pointer" onclick="openFotoModal('${vrfAttr(p.foto_masuk)}', '${namaAman}')">` : '<span style="color:var(--muted)">-</span>'}
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
// RENDER TAB 2 — PENGAJUAN
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
    const namaAman = vrfAttr(pegawai.nama || '-');

    // ★ v2.1: kolom tanggal_mulai
    const tanggal = pj.tanggal_selesai && pj.tanggal_selesai !== pj.tanggal_mulai
      ? `${pj.tanggal_mulai} → ${pj.tanggal_selesai}`
      : (pj.tanggal_mulai || '-');
    const durasiTxt = pj.durasi && pj.durasi > 1 ? ` <span class="badge b-wait">${pj.durasi} hari</span>` : '';

    const jamInfo = pj.jenis === 'Lupa Absen'
      ? `<div style="font-size:11.5px">Hadir: <b>${pj.jam_hadir || '-'}</b> · Pulang: <b>${pj.jam_pulang || '-'}</b></div>`
      : '';

    const lampiran = [
      pj.foto ? `<img src="${vrfAttr(pj.foto)}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;cursor:pointer" onclick="openFotoModal('${vrfAttr(pj.foto)}', '${namaAman}')">` : '',
      pj.surat ? `<img src="${vrfAttr(pj.surat)}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;margin-left:4px;cursor:pointer" onclick="openFotoModal('${vrfAttr(pj.surat)}', 'Surat ${namaAman}')">` : ''
    ].join('') || '<span style="color:var(--muted)">-</span>';

    const aksi = pj.status === 'Menunggu' ? `
      <button class="btn btn-green sm" onclick="verifikasiPengajuan('${pj.id}', 'Disetujui')"><i data-lucide="check"></i>Setujui</button>
      <button class="btn btn-orange sm" onclick="verifikasiPengajuan('${pj.id}', 'Revisi')" style="margin-left:4px"><i data-lucide="pencil"></i>Revisi</button>
      <button class="btn btn-red sm" onclick="verifikasiPengajuan('${pj.id}', 'Ditolak')" style="margin-left:4px"><i data-lucide="x"></i>Tolak</button>
    ` : (pj.catatan_verifikasi
      ? `<div style="font-size:11.5px;color:var(--muted);max-width:160px">"${vrfAttr(pj.catatan_verifikasi)}"</div>`
      : '<span style="font-size:12px;color:var(--muted)">Selesai</span>');

    return `
      <tr>
        <td>
          <div style="font-weight:700">${vrfAttr(pegawai.nama || '-')}</div>
          <div style="font-size:12px;color:var(--muted)">${vrfAttr(diNama)}</div>
        </td>
        <td><span class="chip-o">${vrfAttr(pj.jenis)}</span></td>
        <td>
          <div style="font-weight:600">${tanggal}${durasiTxt}</div>
          ${jamInfo}
          <div style="font-size:11.5px;color:var(--muted);max-width:200px">${vrfAttr((pj.alasan || '').slice(0, 80))}${(pj.alasan || '').length > 80 ? '…' : ''}</div>
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
// AKSI VERIFIKASI — PRESENSI (Tab 1)
// ★ v2.1: "Layak" TIDAK menimpa poin (poin tier dari submit
//   tetap utuh — mis. Terlambat Berat = 25). "Tidak Layak" = -2.
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

    const payload = {
      status_verifikasi: status,
      diverifikasi_oleh: session.id_pegawai,
      catatan_verifikasi: catatan || null
    };
    if (status === 'Tidak Layak') payload.poin = -2; // penalti; Layak = biarkan poin tier

    await dbUpdate('presensi', 'id_presensi', idPresensi, payload);

    toast(`Presensi berhasil diverifikasi: ${status}`, 'success');
    await loadPresensiVerifikasi();

  } catch (err) {
    console.error('Verifikasi error:', err);
    toast('Gagal verifikasi: ' + err.message, 'error');
  }
}

// ============================================================
// AKSI VERIFIKASI — PENGAJUAN
// ★ v2.1:
//  • kolom tanggal_mulai/tanggal_selesai
//  • Sakit/Izin/Dinas: hanya hari kerja efektif, skip hari yang
//    sudah ada jam_masuk asli (anti-timpa)
//  • Lupa Absen: lengkapi jam tanpa menimpa yang sudah ada
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
      // Rentang tanggal (inklusif)
      const d0 = new Date((pj.tanggal_mulai || pj.tanggal) + 'T00:00:00');
      const d1 = new Date((pj.tanggal_selesai || pj.tanggal_mulai || pj.tanggal) + 'T00:00:00');

      // ★ Filter hari kerja utk Sakit/Izin/Dinas (Lupa Absen = 1 tanggal pasti)
      const hkSet = new Set((verifikasiState.pengaturan.hari_kerja || '1,2,3,4,5').split(','));
      const dates = [];
      for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
        if (pj.jenis !== 'Lupa Absen' && !hkSet.has(String(d.getDay() || 7))) continue; // skip libur
        dates.push(localDateStr(d));
      }
      if (!dates.length) {
        toast('Tidak ada hari kerja efektif pada rentang ini', 'warn');
        await loadPengajuanVerifikasi();
        return;
      }

      let ditulis = 0, dilewati = 0;

      for (const tgl of dates) {
        const { data: exist } = await supabaseClient
          .from('presensi').select('id_presensi,jam_masuk,status')
          .eq('id_pegawai', pj.id_pegawai)
          .eq('tanggal', tgl).maybeSingle();

        // ★ Anti-timpa: hari yang sudah ada check-in asli tidak disentuh
        if (pj.jenis !== 'Lupa Absen' && exist && exist.jam_masuk) { dilewati++; continue; }

        if (pj.jenis === 'Lupa Absen') {
          const payload = {
            status_verifikasi: 'Layak',
            diverifikasi_oleh: session.id_pegawai,
            catatan_verifikasi: `Lupa absen disetujui: ${pj.alasan}`.slice(0, 250)
          };
          if (pj.jam_hadir && !exist?.jam_masuk) {
            payload.jam_masuk = pj.jam_hadir.length === 5 ? pj.jam_hadir + ':00' : pj.jam_hadir;
            payload.status = 'Hadir';
            payload.status_kehadiran = 'tepat_waktu';
            payload.catatan_kehadiran = 'Lupa Absen (disetujui)';
          }
          if (pj.jam_pulang && !exist?.jam_keluar) {
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
          ditulis++;
        } else {
          // Sakit / Izin / Dinas Luar — record per tanggal
          const payload = {
            status: pj.jenis,
            keterangan: pj.alasan,
            status_verifikasi: 'Layak',
            diverifikasi_oleh: session.id_pegawai,
            catatan_verifikasi: `${pj.jenis} disetujui via pengajuan${pj.no_surat ? ' (No. ' + pj.no_surat + ')' : ''}`
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
          ditulis++;
        }
      }

      toast(`Disetujui — ${ditulis} hari ditulis${dilewati ? `, ${dilewati} dilewati (sudah ada presensi)` : ''}`, 'success');
    } else {
      toast(`Pengajuan ${status.toLowerCase()}`, status === 'Ditolak' ? 'warn' : 'success');
    }

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
