// ============================================================
// SUPABASE CLIENT + HELPER
// ============================================================

const supabaseClient = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);

// ============================================================
// ★ PATCH: UTIL TANGGAL WIB
// Fix bug UTC: toISOString() menghasilkan tanggal kemarin
// untuk jam 00:00–06:59 WIB. Gunakan ini di semua tempat.
// ============================================================
function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
window.localDateStr = localDateStr;

// ============================================================
// HELPER: SELECT
// ============================================================
async function dbSelect(tabel, options = {}) {
  let query = supabaseClient.from(tabel).select(options.select || '*');

  if (options.eq) {
    Object.entries(options.eq).forEach(([key, val]) => {
      query = query.eq(key, val);
    });
  }

  if (options.in) {
    Object.entries(options.in).forEach(([key, arr]) => {
      query = query.in(key, arr);
    });
  }

  if (options.order) {
    query = query.order(options.order.column, {
      ascending: options.order.ascending !== false
    });
  }

  if (options.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// ============================================================
// HELPER: INSERT
// ============================================================
async function dbInsert(tabel, data) {
  const { data: result, error } = await supabaseClient
    .from(tabel)
    .insert(data)
    .select();

  if (error) throw error;
  return result;
}

// ============================================================
// ★ PATCH: HELPER: UPDATE
// Tambah parameter `extraEq` — WAJIB dipakai untuk checkout
// presensi agar tidak menimpa seluruh riwayat.
// ============================================================
async function dbUpdate(tabel, kolomId, idValue, data, extraEq = {}) {
  let query = supabaseClient
    .from(tabel)
    .update(data)
    .eq(kolomId, idValue);

  Object.entries(extraEq).forEach(([k, v]) => {
    query = query.eq(k, v);
  });

  const { data: result, error } = await query.select();
  if (error) throw error;

  // Safety net: peringatkan jika update menyentuh >1 baris
  if (result && result.length > 1) {
    console.warn(`⚠️ dbUpdate: ${result.length} baris ter-update di "${tabel}" — kemungkinan filter kurang spesifik!`);
  }
  return result;
}

// ============================================================
// HELPER: DELETE
// ============================================================
async function dbDelete(tabel, kolomId, idValue) {
  const { error } = await supabaseClient
    .from(tabel)
    .delete()
    .eq(kolomId, idValue);

  if (error) throw error;
  return true;
}

// Expose global
window.supabaseClient = supabaseClient;
window.dbSelect = dbSelect;
window.dbInsert = dbInsert;
window.dbUpdate = dbUpdate;
window.dbDelete = dbDelete;
