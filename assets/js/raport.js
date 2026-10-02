// ============================================================
// RAPORT.JS — Raport Kinerja PPA & Pekarya (v2 PATCHED)
// Sumber: presensi, laporan (rutin), Kerja Gabungan/QR
//         (presensi.status='Kerja Gabungan'), monitoring (tugas staf)
// Periode: bulanan / triwulan / tahunan + kalender kehadiran
//          + cetak format instansi
// File: assets/js/raport.js
// ============================================================

// ★ PATCH: fallback localDateStr — bila supabase.js belum versi patch,
// fungsi ini tetap tersedia (mencegah "localDateStr is not defined")
if (typeof localDateStr !== 'function') {
  window.localDateStr = function (d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
}

// ---------- KONFIGURASI PENILAIAN (ubah di sini bila kebijakan berubah) ----------
const RP_BOBOT = {
  kehadiran: 40,   // (hadir + izin + sakit) / hari kerja efektif
  ketepatan: 15,   // (tepat + toleransi) / total masuk
  laporan:   20,   // min(laporan/target, 1)
  kg:        15,   // minggu dengan >=1 Kerja Gabungan / total minggu efektif (wajib 1/minggu)
  monitoring: 10   // min(jumlah monitoring dari staf / minggu efektif, 1)
};
const RP_GRADE = [
  { min: 90, predikat: 'Sangat Baik', cls: 'g-green' },
  { min: 80, predikat: 'Baik',        cls: 'g-blue'  },
  { min: 70, predikat: 'Cukup',       cls: 'g-orange'},
  { min: 60, predikat: 'Kurang',      cls: 'g-red'   },
  { min: 0,  predikat: 'Sangat Kurang', cls: 'g-red' }
];
const RP_JABATAN_PPA     = 'Petugas Pintu Air';
const RP_JABATAN_PEKARYA = 'Pekarya Pengairan';
const RP_BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const RP_TW_ID    = ['Triwulan I (Jan–Mar)','Triwulan II (Apr–Jun)','Triwulan III (Jul–Sep)','Triwulan IV (Okt–Des)'];
const RP_TAHUN_MIN = 2024;
// ----------------------------------------------------------------------------------

const raportState = {
  tipe: 'bulanan',
  bulan: new Date().getMonth(),
  tahun: new Date().getFullYear(),
  tw: Math.floor(new Date().getMonth() / 3),
  filterDi: 'semua',
  filterJenis: 'semua',
  pegawaiList: [],
  diMap: {},
  pengaturan: {},
  start: null,
  end: null,
  label: '',
  days: [],      // tanggal hari kerja efektif (sudah lewat)
  weekKeys: [],  // kunci minggu ISO efektif
  hasil: [],
  isManager: false,
  detailAktif: null
};

function rpEl(id) { return document.getElementById(id); }
function rpEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function rpFmt(n) { return Number(n || 0).toFixed(1); }

// Minggu ISO (Senin awal) → kunci "YYYY-Wn"
function rpWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((t - y0) / 86400000) + 1) / 7);
  return t.getUTCFullYear() + '-W' + wk;
}

function rpGrade(score) {
  return RP_GRADE.find(g => score >= g.min) || RP_GRADE[RP_GRADE.length - 1];
}

// ============================================================
// MASTER DATA
// ============================================================
async function loadRaportMaster() {
  const [pegawaiList, diList] = await Promise.all([
    dbSelect('pegawai', { select: 'id_pegawai,nomor_identitas,nama,jabatan,id_di' }),
    dbSelect('di', { select: 'id_di,nama_di' })
  ]);
  raportState.pegawaiList = pegawaiList || [];
  raportState.diMap = {};
  (diList || []).forEach(d => { raportState.diMap[d.id_di] = d.nama_di; });

  try {
    const { data } = await supabaseClient.from('pengaturan').select('kunci,nilai');
    const s = {};
    (data || []).forEach(r => { s[r.kunci] = r.nilai; });
    raportState.pengaturan = s;
  } catch (e) { raportState.pengaturan = {}; }
}

// ============================================================
// PERIODE & HARI/MINGGU EFEKTIF
// ============================================================
function rpResolveRange() {
  const { tipe, bulan, tahun, tw } = raportState;
  let start, end, label;

  if (tipe === 'bulanan') {
    start = `${tahun}-${String(bulan + 1).padStart(2, '0')}-01`;
    const last = new Date(tahun, bulan + 1, 0).getDate();
    end = `${tahun}-${String(bulan + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    label = `${RP_BULAN_ID[bulan]} ${tahun}`;
  } else if (tipe === 'triwulan') {
    const m0 = tw * 3;
    start = `${tahun}-${String(m0 + 1).padStart(2, '0')}-01`;
    const last = new Date(tahun, m0 + 3, 0).getDate();
    end = `${tahun}-${String(m0 + 3).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    label = `Triwulan ${['I','II','III','IV'][tw]} ${tahun}`;
  } else {
    start = `${tahun}-01-01`;
    end = `${tahun}-12-31`;
    label = `Tahun ${tahun}`;
  }
  raportState.start = start;
  raportState.end = end;
  raportState.label = label;
}

function rpBuildEffective() {
  const hk = new Set((raportState.pengaturan.hari_kerja || '1,2,3,4,5').split(','));
  const today = localDateStr();
  const days = [];
  const d = new Date(raportState.start + 'T00:00:00');
  const end = new Date(raportState.end + 'T00:00:00');
  while (d <= end) {
    const ds = localDateStr(d);
    const dow = d.getDay() || 7;
    if (hk.has(String(dow)) && ds <= today) days.push(ds); // hari depan belum dinilai
    d.setDate(d.getDate() + 1);
  }
  raportState.days = days;
  raportState.weekKeys = [...new Set(days.map(rpWeekKey))];
}

// ============================================================
// TARGET PEGAWAI
// ============================================================
function rpTargets() {
  if (!raportState.isManager) {
    const s = getSession();
    return s?.id_pegawai ? [{ id_pegawai: s.id_pegawai, nama: s.pegawai?.nama || s.nama_lengkap, nomor_identitas: s.pegawai?.nomor_identitas, jabatan: s.pegawai?.jabatan || s.role, id_di: s.pegawai?.id_di }] : [];
  }
  let list = raportState.pegawaiList.filter(p =>
    [RP_JABATAN_PPA, RP_JABATAN_PEKARYA].includes(p.jabatan));
  const s = getSession();
  if (s?.role === 'staf_pengamat' && s?.pegawai?.id_di) {
    list = list.filter(p => p.id_di === s.pegawai.id_di); // staf hanya DI-nya
  }
  if (raportState.filterDi !== 'semua') list = list.filter(p => p.id_di === raportState.filterDi);
  if (raportState.filterJenis === 'PPA') list = list.filter(p => p.jabatan === RP_JABATAN_PPA);
  if (raportState.filterJenis === 'Pekarya') list = list.filter(p => p.jabatan === RP_JABATAN_PEKARYA);
  return list;
}

// ============================================================
// SKOR PER PEGAWAI
// ★ PATCH: return ganda dihapus — kini SATU return yang memuat
// peta kalender (cal). Versi sebelumnya punya return patch +
// return lama menumpuk (dead code) dan fungsi kalender tidak ada.
// ============================================================
function rpScore(target, presRows, lapCount, monRows) {
  const N = raportState.days.length;
  const W = raportState.weekKeys.length;

  const hadir = presRows.filter(r => r.jam_masuk && ['Hadir', 'Dinas Luar', 'Kerja Gabungan'].includes(r.status)).length;
  const izin = presRows.filter(r => r.status === 'Izin').length;
  const sakit = presRows.filter(r => r.status === 'Sakit').length;
  const tepat = presRows.filter(r => ['tepat_waktu', 'toleransi'].includes(r.status_kehadiran)).length;
  const terlambat = presRows.filter(r => r.status_kehadiran === 'terlambat').length;
  const pulangCepat = presRows.filter(r => r.status_kehadiran_keluar === 'pulang_cepat').length;
  const tidakCheckout = presRows.filter(r => r.jam_masuk && !r.jam_keluar).length;
  const absen = Math.max(0, N - hadir - izin - sakit);

  // Kerja Gabungan per minggu
  const kgDates = presRows.filter(r => r.status === 'Kerja Gabungan' && r.tanggal).map(r => r.tanggal);
  const kgWeeks = [...new Set(kgDates.map(rpWeekKey))].filter(k => raportState.weekKeys.includes(k));

  // --- Skor ---
  const sKehadiran = N > 0 ? Math.min((hadir + izin + sakit) / N, 1) * RP_BOBOT.kehadiran : 0;

  let sKetepatan;
  if (hadir + izin + sakit === 0) sKetepatan = 0;              // absen total
  else if (tepat + terlambat > 0) sKetepatan = (tepat / (tepat + terlambat)) * RP_BOBOT.ketepatan;
  else sKetepatan = RP_BOBOT.ketepatan;                        // hanya izin/sakit → tak ada data ketepatan

  const targetLaporan = parseInt(raportState.pengaturan.raport_target_laporan) || N; // default 1×/hari kerja
  const sLaporan = targetLaporan > 0 ? Math.min(lapCount / targetLaporan, 1) * RP_BOBOT.laporan : RP_BOBOT.laporan;

  const sKG = W > 0 ? Math.min(kgWeeks.length / W, 1) * RP_BOBOT.kg : RP_BOBOT.kg;
  const sMon = W > 0 ? Math.min(monRows.length / W, 1) * RP_BOBOT.monitoring : RP_BOBOT.monitoring;

  const total = sKehadiran + sKetepatan + sLaporan + sKG + sMon;

  // ★ peta tanggal → baris presensi (untuk kalender kehadiran)
  const cal = {};
  presRows.forEach(r => { if (r && r.tanggal) cal[r.tanggal] = r; });

  return {
    target,
    N, W,
    hadir, izin, sakit, absen, tepat, terlambat, pulangCepat, tidakCheckout,
    kgCount: kgDates.length, kgWeeks: kgWeeks.length,
    lapCount, monCount: monRows.length, monPoin: monRows.reduce((a, m) => a + (m.poin || 0), 0),
    sKehadiran, sKetepatan, sLaporan, sKG, sMon, total,
    grade: rpGrade(total),
    cal,
    absenDates: raportState.days.filter(d =>
      !presRows.some(r => r.tanggal === d && (r.jam_masuk || ['Izin', 'Sakit'].includes(r.status)))).slice(0, 10),
    monNotes: monRows.slice(0, 5).map(m => m.catatan)
  };
}

// ============================================================
// COMPUTE UTAMA
// ============================================================
async function computeRaport() {
  rpResolveRange();
  rpBuildEffective();

  const targets = rpTargets();
  if (!targets.length) { raportState.hasil = []; rpRenderAll(); return; }

  const ids = [...new Set(targets.map(t => t.id_pegawai))];
  const { start, end } = raportState;

  const [presRes, monRes] = await Promise.all([
    supabaseClient.from('presensi')
      .select('id_pegawai,tanggal,jam_masuk,jam_keluar,status,status_kehadiran,status_kehadiran_keluar,poin')
      .in('id_pegawai', ids).gte('tanggal', start).lte('tanggal', end),
    supabaseClient.from('monitoring')
      .select('id_target,poin,jenis,catatan,tanggal')
      .in('id_target', ids).gte('tanggal', start).lte('tanggal', end)
  ]);

  const presRows = presRes.data || [];
  const monRows = monRes.data || [];

  // Laporan — fallback bila kolom tanggal tidak ada
  let lapRows = [];
  try {
    const { data, error } = await supabaseClient.from('laporan')
      .select('id_pegawai,tanggal').in('id_pegawai', ids).gte('tanggal', start).lte('tanggal', end);
    if (error) throw error;
    lapRows = data || [];
  } catch (e) {
    console.warn('Laporan tanpa filter tanggal (kolom tanggal tidak tersedia?):', e.message);
    try {
      const { data } = await supabaseClient.from('laporan').select('id_pegawai').in('id_pegawai', ids);
      lapRows = data || [];
    } catch (e2) { lapRows = []; }
  }

  const byPres = {}, byLap = {}, byMon = {};
  presRows.forEach(r => { (byPres[r.id_pegawai] ||= []).push(r); });
  lapRows.forEach(r => { (byLap[r.id_pegawai] ||= []).push(r); });
  monRows.forEach(r => { (byMon[r.id_target] ||= []).push(r); });

  raportState.hasil = targets
    .map(t => rpScore(t, byPres[t.id_pegawai] || [], (byLap[t.id_pegawai] || []).length, byMon[t.id_pegawai] || []))
    .sort((a, b) => b.total - a.total);

  rpRenderAll();
}

// ============================================================
// RENDER
// ============================================================
function rpRenderAll() {
  const meta = rpEl('rpMeta');
  if (meta) meta.textContent = `Periode: ${raportState.label} · Hari kerja efektif: ${raportState.days.length} · Minggu efektif: ${raportState.weekKeys.length}`;

  if (raportState.isManager) {
    rpEl('rpSummaryCard').hidden = false;
    rpEl('rpListCard').hidden = false;
    rpEl('rpSelfCard').hidden = true;
    rpRenderSummary();
    rpRenderList();
  } else {
    rpEl('rpSummaryCard').hidden = true;
    rpEl('rpListCard').hidden = true;
    rpEl('rpSelfCard').hidden = false;
    rpRenderSelf();
  }
}

function rpRenderSummary() {
  const h = raportState.hasil;
  const box = rpEl('rpSummary');
  if (!h.length) {
    box.innerHTML = `<div class="rp-sum-box" style="grid-column:1/-1"><small>Tidak ada pegawai pada filter ini</small></div>`;
    return;
  }
  const avg = h.reduce((a, x) => a + x.total, 0) / h.length;
  const avgHadir = h.reduce((a, x) => a + (x.N ? (x.hadir + x.izin + x.sakit) / x.N : 0), 0) / h.length * 100;
  const best = h[0];
  // ★ PATCH: guard nama kosong/null
  const bestFirst = (best.target.nama || '—').split(' ')[0];
  box.innerHTML = `
    <div class="rp-sum-box"><b>${h.length}</b><small>Pegawai Dinilai</small></div>
    <div class="rp-sum-box"><b>${rpFmt(avg)}</b><small>Rata-rata Skor</small></div>
    <div class="rp-sum-box"><b>${Math.round(avgHadir)}%</b><small>Rata Kehadiran</small></div>
    <div class="rp-sum-box"><b>${rpFmt(best.total)}</b><small>Terbaik: ${rpEsc(bestFirst)}</small></div>`;
}

function rpRenderList() {
  const tbody = rpEl('rpTbody');
  const h = raportState.hasil;
  if (!h.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:32px;color:#8E8E93">Tidak ada data pegawai untuk periode/filter ini.</td></tr>`;
    return;
  }
  tbody.innerHTML = h.map((x, i) => `
    <tr>
      <td style="color:#8E8E93">${i + 1}</td>
      <td class="rp-name"><b>${rpEsc(x.target.nama)}</b><small>${rpEsc(x.target.nomor_identitas || '-')}</small></td>
      <td>${rpEsc(x.target.jabatan === RP_JABATAN_PPA ? 'PPA' : 'Pekarya')}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis">${rpEsc(raportState.diMap[x.target.id_di] || '-')}</td>
      <td>${x.N ? Math.round((x.hadir + x.izin + x.sakit) / x.N * 100) : 0}%${x.absen ? ` <span style="color:#C41E18;font-size:11px">(${x.absen} absen)</span>` : ''}</td>
      <td>${x.lapCount}</td>
      <td>${x.kgWeeks}/${x.W}</td>
      <td>${x.monCount}</td>
      <td class="rp-score">${rpFmt(x.total)}</td>
      <td><span class="rp-grade ${x.grade.cls}">${x.grade.predikat}</span></td>
      <td><button type="button" class="rp-detail-btn" data-rpidx="${i}">Detail</button></td>
    </tr>`).join('');
}

// ============================================================
// ★ PATCH BARU: KALENDER KEHADIRAN
// (sebelumnya cal dikirim dari rpScore tapi tidak pernah dirender)
// ============================================================
function rpMonthsInRange() {
  const s = new Date(raportState.start + 'T00:00:00');
  const e = new Date(raportState.end + 'T00:00:00');
  const out = [];
  const d = new Date(s.getFullYear(), s.getMonth(), 1);
  while (d <= e) { out.push({ y: d.getFullYear(), m: d.getMonth() }); d.setMonth(d.getMonth() + 1); }
  return out;
}

function rpMonthCalHTML(x, y, m) {
  const today = localDateStr();
  const dim = new Date(y, m + 1, 0).getDate();
  const off = (new Date(y, m, 1).getDay() + 6) % 7; // Senin=0
  const hkSet = new Set((raportState.pengaturan.hari_kerja || '1,2,3,4,5').split(','));
  const DOW = ['Sn', 'Sl', 'Rb', 'Km', 'Jm', 'Sb', 'Mg'];

  let cells = DOW.map(d => `<div class="rp-cal-dow">${d}</div>`).join('');
  for (let i = 0; i < off; i++) cells += '<div></div>';

  for (let day = 1; day <= dim; day++) {
    const ds = `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dowN = new Date(y, m, day).getDay() || 7;
    const isWork = hkSet.has(String(dowN));
    const row = x.cal[ds];

    let cls = 'c-off', txt = '·', title = ds + ': bukan hari kerja';
    if (row) {
      const st = row.status;
      if (st === 'Kerja Gabungan')                    { cls = 'c-kg';        txt = 'KG'; title = `${ds}: Kerja Gabungan`; }
      else if (st === 'Dinas Luar')                   { cls = 'c-dinas';     txt = 'DL'; title = `${ds}: Dinas Luar`; }
      else if (st === 'Izin')                         { cls = 'c-izin';      txt = 'I';  title = `${ds}: Izin`; }
      else if (st === 'Sakit')                        { cls = 'c-sakit';     txt = 'S';  title = `${ds}: Sakit`; }
      else if (row.status_kehadiran === 'terlambat')  { cls = 'c-telat';     txt = 'T';  title = `${ds}: Terlambat (masuk ${row.jam_masuk || '-'})`; }
      else if (row.status_kehadiran === 'toleransi')  { cls = 'c-toleransi'; txt = '✓';  title = `${ds}: Toleransi (masuk ${row.jam_masuk || '-'})`; }
      else                                            { cls = 'c-tepat';     txt = '✓';  title = `${ds}: Hadir tepat waktu (masuk ${row.jam_masuk || '-'})`; }
    } else if (isWork && ds > today) {
      cls = 'c-future'; txt = ''; title = ds + ': belum berjalan';
    } else if (isWork) {
      cls = 'c-absen'; txt = '✕'; title = ds + ': Absen (tanpa presensi)';
    }
    cells += `<div class="rp-cal-cell ${cls}" title="${rpEsc(title)}">${txt}</div>`;
  }

  return `<div class="rp-cal-month">
    <div class="rp-cal-title">${RP_BULAN_ID[m]} ${y}</div>
    <div class="rp-cal-grid">${cells}</div>
  </div>`;
}

function rpCalendarHTML(x) {
  // Rekap per jenis status untuk legend
  const cnt = { tepat: 0, telat: 0, izin: 0, sakit: 0, dinas: 0, kg: 0 };
  Object.values(x.cal).forEach(r => {
    const st = r.status;
    if (st === 'Izin') cnt.izin++;
    else if (st === 'Sakit') cnt.sakit++;
    else if (st === 'Dinas Luar') cnt.dinas++;
    else if (st === 'Kerja Gabungan') cnt.kg++;
    else if (r.status_kehadiran === 'terlambat') cnt.telat++;
    else cnt.tepat++;
  });

  const legend = `<div class="rp-legend">
    <span><i style="background:#34C759"></i>Hadir ${cnt.tepat}</span>
    <span><i style="background:#FFCC00"></i>Toleransi</span>
    <span><i style="background:#FF3B30"></i>Telat ${cnt.telat}</span>
    <span><i style="background:#FF9500"></i>Izin ${cnt.izin}</span>
    <span><i style="background:#FF6482"></i>Sakit ${cnt.sakit}</span>
    <span><i style="background:#007AFF"></i>Dinas ${cnt.dinas}</span>
    <span><i style="background:#AF52DE"></i>KG ${cnt.kg}</span>
    <span><i style="background:#fff;border:1.5px solid #FF3B30"></i>Absen ${x.absen}</span>
  </div>`;

  const blocks = rpMonthsInRange().map(({ y, m }) => rpMonthCalHTML(x, y, m)).join('');
  return `<div class="rp-cal-sec">
    <div class="rp-cal-head">
      <span class="rp-cal-title-k">Kalender Kehadiran</span>
      ${legend}
    </div>
    <div class="rp-cal-months">${blocks}</div>
  </div>`;
}

// ============================================================
// DETAIL (modal manager + tampilan pegawai)
// ★ PATCH: kalender disisipkan setelah identitas; tabel dibungkus
// .rp-scroll agar tidak meluber di layar HP
// ============================================================
function rpDetailHTML(x) {
  const t = x.target;
  const comp = [
    ['1. Kehadiran', RP_BOBOT.kehadiran, x.sKehadiran, `${x.hadir} hadir · ${x.izin} izin · ${x.sakit} sakit · ${x.absen} absen dari ${x.N} hari kerja`],
    ['2. Ketepatan Waktu', RP_BOBOT.ketepatan, x.sKetepatan, `${x.tepat} tepat/toleransi · ${x.terlambat} terlambat`],
    ['3. Laporan Rutin', RP_BOBOT.laporan, x.sLaporan, `${x.lapCount} laporan periode ini`],
    ['4. Kerja Gabungan (QR)', RP_BOBOT.kg, x.sKG, `${x.kgWeeks} dari ${x.W} minggu terpenuhi (${x.kgCount}× KG) — wajib 1×/minggu`],
    ['5. Tugas dari Staf', RP_BOBOT.monitoring, x.sMon, `${x.monCount}× monitoring · ${x.monPoin} poin`]
  ].map(([nm, maks, perolehan, ket]) => `
    <tr><td>${nm}</td><td class="num">${maks}</td><td class="num">${rpFmt(perolehan)}</td><td style="font-size:11.5px;color:#8E8E93">${ket}</td></tr>`).join('');

  const absenHTML = x.absenDates.length
    ? `<div class="rp-notes" style="background:#FEECEB;color:#7A1410"><b>Tanggal tanpa presensi (max 10):</b><span class="rp-absen-list">${x.absenDates.map(rpEsc).join(' · ')}</span></div>` : '';
  const monHTML = x.monNotes.length
    ? `<div class="rp-notes"><b>Catatan monitoring staf (5 terakhir):</b>${x.monNotes.map(n => '• ' + rpEsc(n)).join('<br>')}</div>` : '';

  return `
    <div class="rp-id-grid">
      <div><small>Nama</small><b>${rpEsc(t.nama)}</b></div>
      <div><small>Nomor Identitas</small><b>${rpEsc(t.nomor_identitas || '-')}</b></div>
      <div><small>Jabatan</small><b>${rpEsc(t.jabatan || '-')}</b></div>
      <div><small>DI</small><b>${rpEsc(raportState.diMap[t.id_di] || '-')}</b></div>
    </div>
    ${rpCalendarHTML(x)}
    <div class="rp-scroll">
      <table class="rp-comp-table">
        <thead><tr><th>Komponen</th><th style="text-align:right">Maks</th><th style="text-align:right">Perolehan</th><th>Keterangan</th></tr></thead>
        <tbody>${comp}
          <tr class="rp-total"><td>JUMLAH</td><td class="num">100</td><td class="num">${rpFmt(x.total)}</td>
          <td><span class="rp-grade ${x.grade.cls}">${x.grade.predikat}</span></td></tr>
        </tbody>
      </table>
    </div>
    ${x.pulangCepat || x.tidakCheckout ? `<div class="rp-notes" style="background:#F2F2F7;color:#3C3C43"><b>Catatan tambahan:</b>Pulang cepat: ${x.pulangCepat}× · Tidak checkout: ${x.tidakCheckout}×</div>` : ''}
    ${absenHTML}${monHTML}`;
}

function rpRenderSelf() {
  const box = rpEl('rpSelf');
  const h = raportState.hasil;
  if (!h.length) {
    box.innerHTML = `<div style="padding:24px;color:#8E8E93;font:500 13px -apple-system,sans-serif">Raport tidak tersedia. Pastikan akun Anda terhubung dengan data pegawai.</div>`;
    rpEl('rpSelfDetail').innerHTML = '';
    return;
  }
  const x = h[0];
  box.innerHTML = `
    <div class="rp-big-score">${rpFmt(x.total)}</div>
    <span class="rp-grade ${x.grade.cls}">${x.grade.predikat}</span>
    <div style="font:600 13px -apple-system,sans-serif;color:#000">${rpEsc(x.target.nama)}</div>
    <div style="font:500 12px -apple-system,sans-serif;color:#8E8E93">${rpEsc(raportState.label)} · Skor dari 100</div>`;
  rpEl('rpSelfDetail').innerHTML = `<div class="card card-ios"><div class="card-head"><span class="kicker">Rincian Penilaian</span>
    <button type="button" class="rp-btn-ghost" id="rpSelfPrint"><i data-lucide="printer"></i>Cetak</button></div>
    ${rpDetailHTML(x)}</div>`;
  rpEl('rpSelfPrint')?.addEventListener('click', () => rpPrint(x));
  if (window.refreshIcons) window.refreshIcons();
}

// ============================================================
// CETAK (format resmi instansi)
// ============================================================
function rpKopHTML() {
  return `<div class="pr-kop">
    <h1>BALAI BESAR WILAYAH SUNGAI BRANTAS</h1>
    <h2>Direktorat Jenderal Sumber Daya Air — Kementerian Pekerjaan Umum dan Perumahan Rakyat</h2>
  </div>`;
}

function rpPrint(x) {
  const s = getSession();
  const penilai = s?.pegawai?.nama || s?.nama_lengkap || '..............................';
  const t = x.target;
  const rows = [
    ['1. Kehadiran', RP_BOBOT.kehadiran, rpFmt(x.sKehadiran), `${x.hadir} hadir, ${x.izin} izin, ${x.sakit} sakit, ${x.absen} absen (dari ${x.N} hari kerja)`],
    ['2. Ketepatan Waktu', RP_BOBOT.ketepatan, rpFmt(x.sKetepatan), `${x.tepat} tepat/toleransi, ${x.terlambat} terlambat`],
    ['3. Laporan Rutin', RP_BOBOT.laporan, rpFmt(x.sLaporan), `${x.lapCount} laporan`],
    ['4. Kerja Gabungan (QR)', RP_BOBOT.kg, rpFmt(x.sKG), `${x.kgWeeks}/${x.W} minggu terpenuhi (${x.kgCount}× KG), wajib 1×/minggu`],
    ['5. Tugas dari Staf (Monitoring)', RP_BOBOT.monitoring, rpFmt(x.sMon), `${x.monCount}× monitoring, ${x.monPoin} poin`]
  ].map(([a, b, c, d]) => `<tr><td>${a}</td><td class="num">${b}</td><td class="num">${c}</td><td>${rpEsc(d)}</td></tr>`).join('');

  rpEl('rpPrintArea').innerHTML = `
    ${rpKopHTML()}
    <div class="pr-title">RAPORT KINERJA PEGAWAI</div>
    <div class="pr-sub">Periode: ${rpEsc(raportState.label)}</div>
    <table class="pr-ident">
      <tr><td width="140">Nama</td><td width="20">:</td><td><b>${rpEsc(t.nama)}</b></td></tr>
      <tr><td>Nomor Identitas</td><td>:</td><td>${rpEsc(t.nomor_identitas || '-')}</td></tr>
      <tr><td>Jabatan</td><td>:</td><td>${rpEsc(t.jabatan || '-')}</td></tr>
      <tr><td>Unit Kerja (DI)</td><td>:</td><td>${rpEsc(raportState.diMap[t.id_di] || '-')}</td></tr>
    </table>
    <table class="pr-table">
      <tr><th width="32%">Komponen Penilaian</th><th width="10%">Bobot Maks.</th><th width="12%">Perolehan</th><th>Keterangan</th></tr>
      ${rows}
      <tr><th>JUMLAH</th><th class="num">100</th><th class="num">${rpFmt(x.total)}</th><th>Predikat: <b>${x.grade.predikat.toUpperCase()}</b></th></tr>
    </table>
    ${x.absenDates.length ? `<p style="font-size:10pt"><b>Tanggal tanpa presensi:</b> ${x.absenDates.map(rpEsc).join(', ')}${x.absenDates.length >= 10 ? ' …' : ''}</p>` : ''}
    ${x.monNotes.length ? `<p style="font-size:10pt"><b>Catatan monitoring:</b><br>${x.monNotes.map(n => '• ' + rpEsc(n)).join('<br>')}</p>` : ''}
    <div class="pr-sign">
      <div>
        <div>Dicetak pada ${rpEsc(localDateStr())}</div>
        <div style="margin-top:8px">Pejabat Penilai,</div>
        <div class="pr-sign-name">${rpEsc(penilai)}</div>
      </div>
    </div>`;
  window.print();
}

function rpPrintRekap() {
  const s = getSession();
  const penilai = s?.pegawai?.nama || s?.nama_lengkap || '..............................';
  const rows = raportState.hasil.map((x, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${rpEsc(x.target.nama)}</td>
      <td>${rpEsc(x.target.nomor_identitas || '-')}</td>
      <td>${rpEsc(x.target.jabatan === RP_JABATAN_PPA ? 'PPA' : 'Pekarya')}</td>
      <td>${rpEsc(raportState.diMap[x.target.id_di] || '-')}</td>
      <td class="num">${x.hadir}/${x.N}</td>
      <td class="num">${x.lapCount}</td>
      <td class="num">${x.kgWeeks}/${x.W}</td>
      <td class="num">${x.monCount}</td>
      <td class="num"><b>${rpFmt(x.total)}</b></td>
      <td>${x.grade.predikat}</td>
    </tr>`).join('');

  rpEl('rpPrintArea').innerHTML = `
    ${rpKopHTML()}
    <div class="pr-title">REKAP RAPORT KINERJA PEGAWAI</div>
    <div class="pr-sub">Periode: ${rpEsc(raportState.label)} — PPA &amp; Pekarya</div>
    <table class="pr-table">
      <tr><th>No</th><th>Nama</th><th>No. Identitas</th><th>Jenis</th><th>DI</th>
      <th>Hadir</th><th>Lapor</th><th>KG</th><th>Tugas</th><th>Skor</th><th>Predikat</th></tr>
      ${rows}
    </table>
    <div class="pr-sign">
      <div>
        <div>Dicetak pada ${rpEsc(localDateStr())}</div>
        <div style="margin-top:8px">Pejabat Penilai,</div>
        <div class="pr-sign-name">${rpEsc(penilai)}</div>
      </div>
    </div>`;
  window.print();
}

// ============================================================
// EVENT & INIT
// ============================================================
function rpFillYearSelect(sel) {
  const y = new Date().getFullYear();
  sel.innerHTML = '';
  for (let yy = y; yy >= RP_TAHUN_MIN; yy--) {
    sel.insertAdjacentHTML('beforeend', `<option value="${yy}">${yy}</option>`);
  }
  sel.value = y;
}

function rpSyncControls() {
  rpEl('rpCtrlBulan').hidden = raportState.tipe !== 'bulanan';
  rpEl('rpCtrlTW').hidden = raportState.tipe !== 'triwulan';
  rpEl('rpCtrlTahun').hidden = raportState.tipe !== 'tahunan';
}

async function initRaport() {
  console.log('=== Init Raport ===');
  const session = getSession();
  if (!session) return;

  raportState.isManager = ['admin', 'ppk', 'staf_pengamat'].includes(session.role);
  rpEl('rpCtrlManager').hidden = !raportState.isManager;

  await loadRaportMaster();

  // Isi select periode
  rpEl('rpBulan').innerHTML = RP_BULAN_ID.map((b, i) =>
    `<option value="${i}" ${i === raportState.bulan ? 'selected' : ''}>${b}</option>`).join('');
  rpEl('rpTW').innerHTML = RP_TW_ID.map((t, i) =>
    `<option value="${i}" ${i === raportState.tw ? 'selected' : ''}>${t}</option>`).join('');
  rpFillYearSelect(rpEl('rpTahunB'));
  rpFillYearSelect(rpEl('rpTahunT'));
  rpFillYearSelect(rpEl('rpTahunY'));

  // Isi filter DI (manager)
  if (raportState.isManager) {
    rpEl('rpFilterDI').innerHTML = `<option value="semua">Semua DI</option>` +
      Object.entries(raportState.diMap).map(([id, nm]) => `<option value="${id}">${rpEsc(nm)}</option>`).join('');
  }

  rpSyncControls();

  // Tabs periode
  rpEl('rpTabs').querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      rpEl('rpTabs').querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      raportState.tipe = btn.dataset.tipe;
      rpSyncControls();
      computeRaport();
    });
  });

  rpEl('rpBulan')?.addEventListener('change', e => { raportState.bulan = +e.target.value; computeRaport(); });
  rpEl('rpTahunB')?.addEventListener('change', e => { raportState.tahun = +e.target.value; computeRaport(); });
  rpEl('rpTW')?.addEventListener('change', e => { raportState.tw = +e.target.value; computeRaport(); });
  rpEl('rpTahunT')?.addEventListener('change', e => { raportState.tahun = +e.target.value; computeRaport(); });
  rpEl('rpTahunY')?.addEventListener('change', e => { raportState.tahun = +e.target.value; computeRaport(); });
  rpEl('rpFilterDI')?.addEventListener('change', e => { raportState.filterDi = e.target.value; computeRaport(); });
  rpEl('rpFilterJenis')?.addEventListener('change', e => { raportState.filterJenis = e.target.value; computeRaport(); });
  rpEl('rpRefresh')?.addEventListener('click', computeRaport);
  rpEl('rpPrintRekap')?.addEventListener('click', rpPrintRekap);

  // Klik detail (delegasi pada tbody)
  rpEl('rpTbody')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-rpidx]');
    if (!btn) return;
    const x = raportState.hasil[+btn.dataset.rpidx];
    if (!x) return;
    raportState.detailAktif = x;
    rpEl('rpModalTitle').textContent = `Raport — ${x.target.nama}`;
    rpEl('rpModalBody').innerHTML = rpDetailHTML(x);
    rpEl('rpModal').classList.add('open');
    if (window.refreshIcons) window.refreshIcons();
  });

  rpEl('rpModalClose')?.addEventListener('click', () => rpEl('rpModal').classList.remove('open'));
  rpEl('rpModal')?.addEventListener('click', e => {
    if (e.target === rpEl('rpModal')) rpEl('rpModal').classList.remove('open');
  });
  rpEl('rpModalPrint')?.addEventListener('click', () => {
    if (raportState.detailAktif) rpPrint(raportState.detailAktif);
  });

  await computeRaport();
  if (window.refreshIcons) window.refreshIcons();
  console.log('=== Raport loaded ===');
}

// ============================================================
// EXPOSE GLOBAL
// ============================================================
window.initRaport = initRaport;
window.computeRaport = computeRaport;
