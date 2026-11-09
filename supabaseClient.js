// ============================================================================
//  Supabase client
//  Fill in your project's URL and anon (public) key below — both are found
//  in Supabase → Project Settings → API. The anon key is safe to expose in
//  browser code; it is constrained by the Row Level Security policies in
//  schema.sql.
// ============================================================================

const SUPABASE_URL = "https://nljbbepcbwjdteoxjafv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5samJiZXBjYndqZHRlb3hqYWZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3MTA0ODQsImV4cCI6MjEwMjI4NjQ4NH0.u-cFr02_vPERva28YJ3wNteX5z8DH_-oNCGcK2WImzo";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================================
//  QR‑Code helpers
//  Each user (student or app_user) gets a unique qr_token stored in their row.
//  The token is a random string we generate — no JWT dependency needed since
//  this is a pure browser app.
// ============================================================================

/**
 * Generate a cryptographically random token string.
 */
function generateQrToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Ensure the given user has a qr_token. If they don't have one yet, create
 * one now and persist it. Returns the token string.
 *
 * @param {'student'|'staff'} role
 * @param {string|number} userId
 */
async function ensureUserQrToken(role, userId) {
  const table = role === 'student' ? 'students' : 'app_users';

  // Fetch existing token
  const { data, error } = await sb
    .from(table)
    .select('id, qr_token')
    .eq('id', userId)
    .single();

  if (error) { console.error('ensureUserQrToken fetch error:', error); return null; }

  if (data.qr_token) return data.qr_token; // already has one

  // Generate and store a new token
  const token = generateQrToken();
  const { error: updateErr } = await sb
    .from(table)
    .update({
      qr_token: token,
      qr_created_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (updateErr) { console.error('ensureUserQrToken update error:', updateErr); return null; }
  return token;
}

/**
 * Verify a scanned QR token against both user tables.
 * Returns { profile } on success, or null if not found / expired.
 *
 * The returned profile is shaped identically to what normalizeLoginRow()
 * produces in login.js, so setPortalSession() + routeToDestination() just work.
 */
async function verifyQrToken(token) {
  if (!token) return null;

  // ── Check students table ────────────────────────────────────────────────
  const { data: student } = await sb
    .from('students')
    .select('id, first_name, last_name, college_id, department_id, must_change_password, qr_token, qr_created_at')
    .eq('qr_token', token)
    .single();

  if (student) {
    return {
      id: student.id,
      role: 'student',
      designation: 'Student',
      first_name: student.first_name,
      last_name: student.last_name,
      college_id: student.college_id,
      department_id: student.department_id,
      campus_id: null,
      campus_name: 'Main Campus',
      must_change_password: student.must_change_password || false,
    };
  }

  // ── Check app_users table ───────────────────────────────────────────────
  const { data: appUser } = await sb
    .from('app_users')
    .select('id, first_name, last_name, college_id, department_id, designation, must_change_password, qr_token, qr_created_at')
    .eq('qr_token', token)
    .single();

  if (appUser) {
    return {
      id: appUser.id,
      role: 'staff',
      designation: appUser.designation,
      first_name: appUser.first_name,
      last_name: appUser.last_name,
      college_id: appUser.college_id,
      department_id: appUser.department_id,
      campus_id: null,
      campus_name: 'Main Campus',
      must_change_password: appUser.must_change_password || false,
    };
  }

  return null; // token not found in either table
}
