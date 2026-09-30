// ============================================================
// SUPABASE CLIENT + HELPER
// ============================================================

const supabaseClient = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);

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
// HELPER: UPDATE
// ============================================================
async function dbUpdate(tabel, kolomId, idValue, data) {
  const { data: result, error } = await supabaseClient
    .from(tabel)
    .update(data)
    .eq(kolomId, idValue)
    .select();

  if (error) throw error;
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