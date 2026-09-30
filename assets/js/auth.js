// ============================================================
// AUTH — Login, Logout, Session
// ============================================================

const SESSION_KEY = 'op3_session';

// ============================================================
// LOGIN
// ============================================================
async function login(username, password) {
  try {
    const { data, error } = await supabaseClient
      .from('users')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .eq('aktif', true)
      .maybeSingle();

    if (error) {
      console.error('Login error:', error);
      return { success: false, message: 'Terjadi kesalahan: ' + error.message };
    }

    if (!data) {
      return { success: false, message: 'Username atau password salah!' };
    }

    // Ambil data pegawai (jika ada)
    let pegawaiData = null;
    if (data.id_pegawai) {
      const { data: peg } = await supabaseClient
        .from('pegawai')
        .select('*')
        .eq('id_pegawai', data.id_pegawai)
        .maybeSingle();
      pegawaiData = peg;
    }

    // Simpan session
    const session = {
      id_user: data.id_user,
      username: data.username,
      nama_lengkap: data.nama_lengkap,
      role: data.role,
      id_pegawai: data.id_pegawai,
      pegawai: pegawaiData,
      login_at: new Date().toISOString()
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(session));

    // Update last_login (fire & forget)
    supabaseClient
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id_user', data.id_user)
      .then(() => {});

    return { success: true, session };

  } catch (error) {
    console.error('Login exception:', error);
    return { success: false, message: 'Error: ' + error.message };
  }
}

// ============================================================
// LOGOUT
// ============================================================
function logout() {
  localStorage.removeItem(SESSION_KEY);
  window.location.href = 'index.html';
}

// ============================================================
// SESSION
// ============================================================
function getSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function requireLogin() {
  const session = getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }
  return session;
}

function hasRole(...roles) {
  const s = getSession();
  return s && roles.includes(s.role);
}

// Expose global
window.login = login;
window.logout = logout;
window.getSession = getSession;
window.requireLogin = requireLogin;
window.hasRole = hasRole;