// ============================================================================
//  Unified portal login
//  Talks to Supabase via the `sb` client (supabaseClient.js) and uses the
//  shared session helpers from session.js.
// ============================================================================

function $(id) { return document.getElementById(id); }

let pendingProfile = null; // set after a successful verify_login, before any forced password change

// Normalizes a verify_login() row (which has separate app_user_id/student_id
// columns) into one profile shape the rest of the app works with.
function normalizeLoginRow(row) {
  const isStudent = row.student_id !== null && row.student_id !== undefined;
  return {
    id: isStudent ? row.student_id : row.app_user_id,
    role: isStudent ? "student" : "staff",
    designation: row.designation, // 'Super Admin' | 'Dean' | 'Department Head' | 'Faculty' | 'Student'
    first_name: row.first_name,
    last_name: row.last_name,
    college_id: row.college_id,
    department_id: row.department_id,
    must_change_password: row.must_change_password,
  };
}

async function handleLogin(ev) {
  ev.preventDefault();
  const username = $("loginUsername").value.trim();
  const password = $("loginPassword").value;
  $("loginError").classList.add("hidden");

  if (!username || !password) {
    $("loginError").textContent = "Enter your username and password.";
    $("loginError").classList.remove("hidden");
    return;
  }

  const btn = $("loginBtn");
  btn.disabled = true;
  btn.textContent = "Signing in…";

  try {
    const { data, error } = await sb.rpc("verify_login", { p_username: username, p_password: password });
    btn.disabled = false;
    btn.textContent = "Sign in";

    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) {
      $("loginError").textContent = "Incorrect username or password.";
      $("loginError").classList.remove("hidden");
      return;
    }

    pendingProfile = normalizeLoginRow(row);

    if (pendingProfile.must_change_password) {
      $("loginScreen").classList.add("hidden");
      $("forcePasswordScreen").classList.remove("hidden");
    } else {
      setPortalSession(pendingProfile);
      routeToDestination(pendingProfile.designation);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Sign in";
    console.error("Login failed:", err);
    $("loginError").textContent = `Couldn't reach the database: ${err.message || err}`;
    $("loginError").classList.remove("hidden");
  }
}

async function handleForcePasswordChange(ev) {
  ev.preventDefault();
  const pw = $("newPassword").value;
  const confirm = $("confirmPassword").value;
  const errEl = $("forcePasswordError");
  errEl.classList.add("hidden");

  if (pw.length < 8) { errEl.textContent = "Use at least 8 characters."; errEl.classList.remove("hidden"); return; }
  if (pw !== confirm) { errEl.textContent = "Passwords don't match."; errEl.classList.remove("hidden"); return; }

  const rpcName = pendingProfile.role === "student" ? "set_student_password" : "set_user_password";

  try {
    const { error } = await sb.rpc(rpcName, { p_id: pendingProfile.id, p_new_password: pw });
    if (error) { errEl.textContent = error.message; errEl.classList.remove("hidden"); return; }
    pendingProfile.must_change_password = false;
    setPortalSession(pendingProfile);
    $("forcePasswordScreen").classList.add("hidden");
    routeToDestination(pendingProfile.designation);
  } catch (err) {
    console.error("Password change failed:", err);
    errEl.textContent = `Couldn't reach the database: ${err.message || err}`;
    errEl.classList.remove("hidden");
  }
}

function routeToDestination(designation) {
  const page = PORTAL_ROUTES[designation];
  if (page) {
    window.location.href = page;
    return;
  }
  // Signed in successfully, but this role (e.g. "Dean") doesn't have a
  // dedicated portal page yet — say so clearly instead of a dead redirect.
  $("loginScreen").classList.add("hidden");
  $("forcePasswordScreen").classList.add("hidden");
  $("noPortalMessage").textContent = `There isn't a portal for the "${designation}" role yet. Ask your Super Admin about access.`;
  $("noPortalScreen").classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof sb === "undefined") {
    console.error("`sb` is undefined — supabaseClient.js did not load. Check that it sits next to this HTML file.");
    $("loginError").textContent = "Database connection not found — supabaseClient.js did not load. Check the browser console.";
    $("loginError").classList.remove("hidden");
  }

  $("loginForm")?.addEventListener("submit", handleLogin);
  $("forcePasswordForm")?.addEventListener("submit", handleForcePasswordChange);

  // If already signed in this tab, skip straight to the destination page.
  const existing = getPortalSession();
  if (existing) routeToDestination(existing.designation);
});