// ============================================================
// ADMIN.JS — Halaman Pengaturan Admin
// File: assets/js/admin.js
// ============================================================

async function initAdmin() {
  console.log('=== Init Admin ===');

  const el = id => document.getElementById(id);

  // Cek role admin
  const session = getSession();
  if (!session || session.role !== 'admin') {
    toast('Akses ditolak. Hanya admin.', 'error');
    setTimeout(() => go('dashboard'), 1500);
    return;
  }

  // ============================================================
  // LOAD PENGATURAN DARI SUPABASE
  // ============================================================
  async function loadPengaturan() {
    try {
      const { data, error } = await supabaseClient
        .from('pengaturan')
        .select('kunci, nilai, tipe');

      if (error) throw error;

      const settings = {};
      (data || []).forEach(row => { settings[row.kunci] = row.nilai; });

      console.log('Loaded settings:', settings);

      // Set ke form
      if (el('setJamMasuk')) el('setJamMasuk').value = settings.jam_masuk || '07:30';
      if (el('setJamPulang')) el('setJamPulang').value = settings.jam_pulang || '16:30';
      if (el('setToleransi')) el('setToleransi').value = settings.toleransi_terlambat || '15';
      if (el('setBatasCheckout')) el('setBatasCheckout').value = settings.batas_checkout_awal || '30';
      if (el('setRadius')) el('setRadius').value = settings.radius_kantor || '500';
      if (el('setKantorLat')) el('setKantorLat').value = settings.kantor_lat || '-8.443032';
      if (el('setKantorLng')) el('setKantorLng').value = settings.kantor_lng || '114.194004';
      if (el('setPoinTepat')) el('setPoinTepat').value = settings.poin_tepat_waktu || '1';
      if (el('setPoinTerlambat')) el('setPoinTerlambat').value = settings.poin_terlambat || '0';
      if (el('setPoinPulangCepat')) el('setPoinPulangCepat').value = settings.poin_pulang_cepat || '0';
      if (el('setPoinTidakCheckout')) el('setPoinTidakCheckout').value = settings.poin_tidak_checkout || '0';

      // Set hari kerja
      const hariKerja = (settings.hari_kerja || '1,2,3,4,5').split(',');
      document.querySelectorAll('#daysGrid input[type="checkbox"]').forEach(cb => {
        cb.checked = hariKerja.includes(cb.value);
      });

      if (el('adminBadgeText')) el('adminBadgeText').textContent = 'Tersimpan';

    } catch (err) {
      console.error('Load pengaturan error:', err);
      toast('Gagal load pengaturan: ' + err.message, 'error');
    }
  }

  // ============================================================
  // SIMPAN PENGATURAN
  // ============================================================
  async function savePengaturan() {
    const btn = el('btnSaveSettings');
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .8s linear infinite"></span> Menyimpan...';

    try {
      // Kumpulkan hari kerja
      const hariKerja = [...document.querySelectorAll('#daysGrid input:checked')]
        .map(cb => cb.value)
        .join(',');

      // Data yang akan disimpan
      const updates = [
        { kunci: 'jam_masuk', nilai: el('setJamMasuk').value },
        { kunci: 'jam_pulang', nilai: el('setJamPulang').value },
        { kunci: 'toleransi_terlambat', nilai: el('setToleransi').value },
        { kunci: 'batas_checkout_awal', nilai: el('setBatasCheckout').value },
        { kunci: 'hari_kerja', nilai: hariKerja },
        { kunci: 'radius_kantor', nilai: el('setRadius').value },
        { kunci: 'kantor_lat', nilai: el('setKantorLat').value },
        { kunci: 'kantor_lng', nilai: el('setKantorLng').value },
        { kunci: 'poin_tepat_waktu', nilai: el('setPoinTepat').value },
        { kunci: 'poin_terlambat', nilai: el('setPoinTerlambat').value },
        { kunci: 'poin_pulang_cepat', nilai: el('setPoinPulangCepat').value },
        { kunci: 'poin_tidak_checkout', nilai: el('setPoinTidakCheckout').value }
      ];

      // Update satu per satu
      for (const item of updates) {
        const { error } = await supabaseClient
          .from('pengaturan')
          .update({ nilai: item.nilai, updated_at: new Date().toISOString() })
          .eq('kunci', item.kunci);

        if (error) throw error;
      }

      toast('Pengaturan berhasil disimpan ✓', 'success');
      if (el('adminBadgeText')) el('adminBadgeText').textContent = 'Tersimpan';

      // Reload pengaturan global di sesi
      await loadGlobalSettings();

    } catch (err) {
      console.error('Save error:', err);
      toast('Gagal menyimpan: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Simpan Pengaturan';
    }
  }

  // ============================================================
  // RESET KE DEFAULT
  // ============================================================
  function resetKeDefault() {
    if (!confirm('Reset semua pengaturan ke nilai default?')) return;

    el('setJamMasuk').value = '07:30';
    el('setJamPulang').value = '16:30';
    el('setToleransi').value = '15';
    el('setBatasCheckout').value = '30';
    el('setRadius').value = '500';
    el('setKantorLat').value = '-8.443032';
    el('setKantorLng').value = '114.194004';
    el('setPoinTepat').value = '1';
    el('setPoinTerlambat').value = '0';
    el('setPoinPulangCepat').value = '0';
    el('setPoinTidakCheckout').value = '0';

    document.querySelectorAll('#daysGrid input').forEach(cb => {
      cb.checked = ['1','2','3','4','5'].includes(cb.value);
    });

    toast('Form direset. Klik Simpan untuk menerapkan.', 'info');
  }

  // ============================================================
  // EVENT HANDLERS
  // ============================================================
  el('btnSaveSettings')?.addEventListener('click', savePengaturan);
  el('btnResetSettings')?.addEventListener('click', resetKeDefault);

  // ============================================================
  // LOAD DATA
  // ============================================================
  await loadPengaturan();

  console.log('=== Admin loaded ===');
}

// ============================================================
// LOAD GLOBAL SETTINGS (dipanggil dari halaman lain)
// ============================================================
async function loadGlobalSettings() {
  try {
    const { data, error } = await supabaseClient
      .from('pengaturan')
      .select('kunci, nilai');

    if (error) throw error;

    const settings = {};
    (data || []).forEach(row => { settings[row.kunci] = row.nilai; });

    window.APP_SETTINGS = settings;
    console.log('Global settings loaded:', settings);
    return settings;

  } catch (err) {
    console.error('Load global settings error:', err);
    return {};
  }
}

// ============================================================
// EXPOSE GLOBAL
// ============================================================
window.initAdmin = initAdmin;
window.loadGlobalSettings = loadGlobalSettings;
