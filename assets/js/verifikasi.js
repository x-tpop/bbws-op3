// ============================================================
// VERIFIKASI.JS — Verifikasi Presensi
// ============================================================

let verifikasiState = {
  tanggal: new Date().toISOString().slice(0, 10),
  statusFilter: 'belum',
  list: [],
  pegawaiMap: {},
  diMap: {}
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

// ============================================================
// LOAD PRESENSI
// ============================================================
async function loadPresensiVerifikasi() {
  const session = getSession();
  if (!session) return;

  let query = supabaseClient
    .from('presensi')
    .select('*')
    .eq('tanggal', verifikasiState.tanggal)
    .order('created_at', { ascending: false });

  // Staf Pengamat: filter DI-nya
  if (session.role === 'staf_pengamat' && session.pegawai?.id_di) {
    const pegawaiIds = Object.values(verifikasiState.pegawaiMap)
      .filter(p => p.id_di === session.pegawai.id_di)
      .map(p => p.id_pegawai);
    if (pegawaiIds.length > 0) {
      query = query.in('id_pegawai', pegawaiIds);
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error('Load presensi error:', error);
    return;
  }

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
// RENDER
// ============================================================
function renderVerifikasiList() {
  const tbody = document.getElementById('verifTbody');
  if (!tbody) return;

  const list = verifikasiState.list;

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty">
            <i data-lucide="inbox"></i>
            <div>Tidak ada presensi yang perlu diverifikasi.</div>
          </div>
        </td>
      </tr>`;
    if (window.refreshIcons) window.refreshIcons();
    return;
  }

  tbody.innerHTML = list.map(p => {
    const pegawai = verifikasiState.pegawaiMap[p.id_pegawai] || {};
    const diNama = verifikasiState.diMap[pegawai.id_di] || '-';

    let statusBadge = '<span class="badge b-wait"><span class="dot"></span>Belum</span>';
    if (p.status_verifikasi === 'Layak') {
      statusBadge = '<span class="badge b-ok"><span class="dot"></span>Layak</span>';
    } else if (p.status_verifikasi === 'Tidak Layak') {
      statusBadge = '<span class="badge b-rev"><span class="dot"></span>Tidak Layak</span>';
    }

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
// AKSI VERIFIKASI
// ============================================================
async function verifikasiPresensi(idPresensi, status) {
  let catatan = '';

  if (status === 'Tidak Layak') {
    catatan = prompt('Alasan tidak layak:');
    if (catatan === null) return;
    if (!catatan.trim()) {
      toast('Alasan wajib diisi untuk "Tidak Layak"', 'warn');
      return;
    }
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
// INIT
// ============================================================
async function initVerifikasi() {
  await loadMasterVerifikasi();
  await loadPresensiVerifikasi();

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
}

// Expose global
window.initVerifikasi = initVerifikasi;
window.verifikasiPresensi = verifikasiPresensi;
window.loadPresensiVerifikasi = loadPresensiVerifikasi;