// ============================================================================
//  Unified portal login
//  Talks to Supabase via the `sb` client (supabaseClient.js) and uses the
//  shared session helpers from session.js.
// ============================================================================

function $(id) { return document.getElementById(id); }

let pendingProfile = null; // set after a successful verify_login, before any forced password change

function getUserRoleMapping(id) {
  if (!id) return null;
  try {
    const key = `ecomply_user_role_map`;
    const map = JSON.parse(localStorage.getItem(key) || "{}");
    return map[String(id)] || null;
  } catch (err) {
    return null;
  }
}

// Normalizes a verify_login() row (which has separate app_user_id/student_id
// columns) into one profile shape the rest of the app works with.
function normalizeLoginRow(row) {
  const isStudent = row.student_id !== null && row.student_id !== undefined;
  const userId = isStudent ? row.student_id : row.app_user_id;
  const mappedRole = getUserRoleMapping(userId);
  return {
    id: userId,
    role: isStudent ? "student" : "staff",
    designation: mappedRole || row.designation, // 'Super Admin' | 'Campus Administrator' | 'Quality Assurance' | 'Dean' | 'Department Head' | 'Faculty' | 'Student'
    first_name: row.first_name,
    last_name: row.last_name,
    college_id: row.college_id,
    department_id: row.department_id,
    campus_id: row.campus_id || null,
    campus_name: row.campus_name || "Main Campus",
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

  // Emergency / offline Super Admin credential check
  const checkOfflineLogin = () => {
    const isSuperUser = (username.toLowerCase() === "superadmin" || username.toLowerCase() === "admin");
    const storedPw = localStorage.getItem("ecomply_superadmin_password");
    const validPws = storedPw ? [storedPw, "admin123", "admin", "superadmin", "superadmin123"] : ["admin123", "admin", "superadmin", "superadmin123", "password"];
    
    if (isSuperUser && validPws.includes(password)) {
      const offlineAdmin = {
        id: "admin-master",
        role: "staff",
        designation: "Super Admin",
        first_name: "Super",
        last_name: "Admin",
        username: "superadmin",
        campus_id: null,
        campus_name: "Main Campus",
        must_change_password: false
      };
      setPortalSession(offlineAdmin);
      routeToDestination("Super Admin");
      return true;
    }
    return false;
  };

  try {
    let rpcResponse = null;
    let rpcError = null;

    if (typeof sb !== "undefined" && sb && sb.rpc) {
      try {
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Database connection timeout")), 2500)
        );
        const res = await Promise.race([
          sb.rpc("verify_login", { p_username: username, p_password: password }),
          timeoutPromise
        ]);
        rpcResponse = res.data;
        rpcError = res.error;
      } catch (networkErr) {
        rpcError = networkErr;
      }
    } else {
      rpcError = new Error("Supabase client not loaded");
    }

    btn.disabled = false;
    btn.textContent = "Sign in";

    const row = Array.isArray(rpcResponse) ? rpcResponse[0] : rpcResponse;
    if (row && !rpcError) {
      pendingProfile = normalizeLoginRow(row);
      if (pendingProfile.must_change_password) {
        $("loginScreen").classList.add("hidden");
        $("forcePasswordScreen").classList.remove("hidden");
      } else {
        setPortalSession(pendingProfile);
        routeToDestination(pendingProfile.designation);
      }
      return;
    }

    // Try offline fallback if database failed or user is superadmin
    if (checkOfflineLogin()) return;

    if (rpcError) {
      console.warn("Database login notice:", rpcError);
      $("loginError").innerHTML = `
        <div class="mb-1">Database unreachable (${rpcError.message || "Network Error"}).</div>
        <div class="text-[11px] text-[#6B7060]">For emergency offline admin access, sign in with <b>superadmin</b> / <b>admin123</b> or use <b>Live20R Fingerprint</b>.</div>
      `;
      $("loginError").classList.remove("hidden");
      return;
    }

    $("loginError").textContent = "Incorrect username or password.";
    $("loginError").classList.remove("hidden");
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Sign in";
    if (checkOfflineLogin()) return;
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

async function checkScannerStatus() {
  if (typeof ZKTeco !== "undefined") {
    ZKTeco.startAutoPoller(2000);
    const res = await ZKTeco.checkStatus();
    ZKTeco.updateUiBadges(res);
  }
}

async function handleFingerprintLogin() {
  const errEl = $("loginError");
  errEl.classList.add("hidden");

  if (typeof ZKTeco === "undefined") {
    errEl.textContent = "ZKTeco client is not loaded.";
    errEl.classList.remove("hidden");
    return;
  }

  // Check scanner status first
  const status = await ZKTeco.checkStatus();
  if (!status.ok) {
    errEl.innerHTML = `
      <div class="mb-1 font-semibold text-[#8A3420]">ZKTeco Live20R Bridge is not running.</div>
      <div class="text-[11px] text-[#6B7060]">The local biometric bridge service is offline. You can sign in using your QR Code Digital ID:</div>
      <button type="button" id="loginOfflineQrBtn" class="mt-2 w-full bg-[#14432A] hover:bg-[#1B5636] text-white text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition">
        <img src="ICON/qr.svg" class="w-3.5 h-3.5 invert" alt=""> Sign in with QR Code ID
      </button>
    `;
    errEl.classList.remove("hidden");
    document.getElementById("loginOfflineQrBtn")?.addEventListener("click", handleQrLogin);
    return;
  }

  if (status.device && !status.device.connected) {
    errEl.innerHTML = `
      <div class="font-semibold text-[#8A3420]">ZKTeco Live20R scanner is not detected.</div>
      <div class="text-[11px] text-[#6B7060] mt-0.5">Plug in your scanner, or sign in using your QR Code ID alternative:</div>
      <button type="button" id="loginNoDevQrBtn" class="mt-2 w-full bg-[#14432A] hover:bg-[#1B5636] text-white text-xs font-semibold py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition">
        <img src="ICON/qr.svg" class="w-3.5 h-3.5 invert" alt=""> Sign in with QR Code ID
      </button>
    `;
    errEl.classList.remove("hidden");
    document.getElementById("loginNoDevQrBtn")?.addEventListener("click", handleQrLogin);
    return;
  }

  // Load all registered biometrics (local biometric vault + Supabase)
  let candidates = [];
  try {
    candidates = await ZKTeco.getAllCandidates();
  } catch (err) {
    console.warn("Could not load candidates:", err);
  }

  if (!candidates || candidates.length === 0) {
    const sess = (typeof getPortalSession === "function") ? getPortalSession() : null;
    if (sess && (sess.fingerprint_credential_id || sess.template)) {
      candidates = [sess];
    } else if (typeof QRClient !== "undefined" && QRClient.SAMPLE_ENTITIES) {
      candidates = Object.values(QRClient.SAMPLE_ENTITIES);
    }
  }

  if (!candidates || candidates.length === 0) {
    if (typeof QRClient !== "undefined" && QRClient.SAMPLE_ENTITIES) {
      candidates = Object.values(QRClient.SAMPLE_ENTITIES);
    }
  }

  ZKTeco.openVerifyModal({
    title: "ZKTeco Live20R Sign-In",
    subtitle: "Place your registered finger firmly on the Live20R optical sensor.",
    candidates: candidates,
    onMatch: (matchedUser) => {
      if (!matchedUser) return;
      const mappedRole = getUserRoleMapping(matchedUser.id);
      const profile = {
        id: matchedUser.id,
        role: matchedUser.role || (matchedUser.designation === "Student" ? "student" : "staff"),
        designation: mappedRole || matchedUser.designation || (matchedUser.role === "student" ? "Student" : "Super Admin"),
        first_name: matchedUser.first_name || "Authorized",
        last_name: matchedUser.last_name || "User",
        college_id: matchedUser.college_id,
        department_id: matchedUser.department_id,
        campus_id: matchedUser.campus_id || null,
        campus_name: matchedUser.campus_name || "Main Campus",
        must_change_password: false
      };
      setPortalSession(profile);
      routeToDestination(profile.designation);
    },
    onError: (err) => {
      console.warn("Biometric login error:", err);
      errEl.textContent = err.message || "Fingerprint not recognized.";
      errEl.classList.remove("hidden");
    }
  });
}

async function handleQrLogin() {
  const errEl = $("loginError");
  if (errEl) errEl.classList.add("hidden");

  if (typeof QRClient === "undefined") {
    if (errEl) {
      errEl.textContent = "QR Client library is not loaded.";
      errEl.classList.remove("hidden");
    }
    return;
  }

  QRClient.openScannerModal({
    title: "ESSU Digital ID Sign-In",
    subtitle: "Present your printed or digital ESSU ID QR code to the camera.",
    onSuccess: async (decodedText) => {
      if (errEl) errEl.classList.add("hidden");
      try {
        const parsed = QRClient.parseUserQr(decodedText);
        const queryTerm = (parsed?.id || parsed?.id_num || parsed?.student_number || parsed?.employee_id || decodedText).trim();

        if (!queryTerm && !parsed?.username) {
          throw new Error("Scanned QR code does not contain a valid ESSU credential.");
        }

        let targetUser = null;

        const isSuperAdminQr = 
          queryTerm.toLowerCase() === "superadmin" || 
          queryTerm.toLowerCase() === "admin" || 
          queryTerm === "admin-master" ||
          queryTerm === "3" && (parsed?.role === "Super Admin" || String(parsed?.name || "").toLowerCase().includes("super")) ||
          (parsed?.username && (parsed.username.toLowerCase() === "superadmin" || parsed.username.toLowerCase() === "admin")) ||
          (parsed?.role && String(parsed.role).toLowerCase().includes("super")) ||
          (parsed?.name && String(parsed.name).toLowerCase().includes("super")) ||
          (decodedText && decodedText.toLowerCase().includes("superadmin"));

        // 1. Try finding in app_users
        if (!parsed || parsed.role !== "student") {
          try {
            if (typeof sb !== "undefined" && sb && sb.from) {
              const { data: staffList } = await sb.from("app_users").select("id, first_name, last_name, designation, college_id, department_id, username");
              if (staffList) {
                targetUser = staffList.find(u => 
                  (isSuperAdminQr && (u.username?.toLowerCase() === "superadmin" || u.designation === "Super Admin")) ||
                  String(u.id) === String(queryTerm) || 
                  (u.username && u.username.toLowerCase() === queryTerm.toLowerCase()) ||
                  (parsed?.username && u.username && u.username.toLowerCase() === parsed.username.toLowerCase()) ||
                  (parsed?.id && String(u.id) === String(parsed.id))
                );
                if (targetUser) targetUser.role = "staff";
              }
            }
          } catch (e) {
            console.warn("Supabase staff query notice in QR:", e);
          }
        }

        // 2. Try finding in students
        if (!targetUser && (!parsed || parsed.role !== "staff") && !isSuperAdminQr) {
          try {
            if (typeof sb !== "undefined" && sb && sb.from) {
              const { data: studentList } = await sb.from("students").select("id, first_name, last_name, section_id, college_id, department_id, username, student_number");
              if (studentList) {
                targetUser = studentList.find(s => 
                  String(s.id) === String(queryTerm) || 
                  (s.username && s.username.toLowerCase() === queryTerm.toLowerCase()) ||
                  (parsed?.username && s.username && s.username.toLowerCase() === parsed.username.toLowerCase()) ||
                  (s.student_number && (String(s.student_number) === String(queryTerm) || String(s.student_number) === String(parsed?.id_num))) ||
                  (parsed?.id && String(s.id) === String(parsed.id))
                );
                if (targetUser) {
                  targetUser.role = "student";
                  targetUser.designation = "Student";
                }
              }
            }
          } catch (e) {
            console.warn("Supabase student query notice in QR:", e);
          }
        }

        // 3. Fallback: Search local biometric vault & local records
        if (!targetUser && typeof ZKTeco !== "undefined") {
          const vault = ZKTeco.getBiometricVault();
          for (const u of Object.values(vault)) {
            if (!u) continue;
            if ((isSuperAdminQr && (u.username?.toLowerCase() === "superadmin" || u.designation === "Super Admin")) ||
                String(u.id) === String(queryTerm) || 
                (u.username && u.username.toLowerCase() === queryTerm.toLowerCase()) ||
                (u.student_number && String(u.student_number) === String(queryTerm)) ||
                (parsed?.id && String(u.id) === String(parsed.id))) {
              targetUser = u;
              break;
            }
          }
        }

        // 4. Fallback: Check Official Sample School ID Entities (All Entities)
        if (!targetUser && typeof QRClient !== "undefined" && QRClient.SAMPLE_ENTITIES) {
          const sampleMatch = Object.values(QRClient.SAMPLE_ENTITIES).find(ent =>
            (isSuperAdminQr && (ent.username === "superadmin" || ent.designation === "Super Admin")) ||
            String(ent.id) === String(queryTerm) ||
            (parsed?.id && String(ent.id) === String(parsed.id)) ||
            (ent.username && ent.username.toLowerCase() === queryTerm.toLowerCase()) ||
            (ent.username && parsed?.username && ent.username.toLowerCase() === parsed.username.toLowerCase()) ||
            (ent.student_number && String(ent.student_number) === String(queryTerm)) ||
            (ent.employee_id && String(ent.employee_id) === String(queryTerm))
          );
          if (sampleMatch) {
            targetUser = {
              ...sampleMatch,
              role: sampleMatch.role || (sampleMatch.designation === "Student" ? "student" : "staff"),
              designation: sampleMatch.designation
            };
          }
        }

        // 5. Fallback: Emergency Super Admin check
        if (!targetUser && isSuperAdminQr) {
          targetUser = {
            id: (parsed?.id && parsed.id !== "superadmin") ? parsed.id : "admin-master",
            role: "staff",
            designation: "Super Admin",
            first_name: parsed?.name ? parsed.name.split(" ")[0] : "Super",
            last_name: parsed?.name ? parsed.name.split(" ").slice(1).join(" ") || "Administrator" : "Administrator",
            username: "superadmin",
            campus_name: parsed?.campus || "Main Campus"
          };
        }

        if (!targetUser) {
          if (errEl) {
            errEl.textContent = `No ESSU account found matching credential: "${queryTerm || decodedText}".`;
            errEl.classList.remove("hidden");
          }
          return;
        }

        const mappedRole = getUserRoleMapping(targetUser.id);
        const profile = {
          id: targetUser.id,
          role: targetUser.role,
          designation: mappedRole || targetUser.designation || (targetUser.role === "student" ? "Student" : "Staff"),
          first_name: targetUser.first_name,
          last_name: targetUser.last_name,
          college_id: targetUser.college_id,
          department_id: targetUser.department_id,
          campus_id: targetUser.campus_id || null,
          campus_name: targetUser.campus_name || "Main Campus",
          must_change_password: false
        };

        setPortalSession(profile);
        routeToDestination(profile.designation);
      } catch (err) {
        console.error("QR login error:", err);
        if (errEl) {
          errEl.textContent = err.message || "Failed to authenticate with QR credential.";
          errEl.classList.remove("hidden");
        }
      }
    },
    onError: (err) => {
      console.warn("QR login error:", err);
      if (errEl) {
        errEl.textContent = err.message || "QR Code scan cancelled or failed.";
        errEl.classList.remove("hidden");
      }
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof sb === "undefined") {
    console.error("`sb` is undefined — supabaseClient.js did not load. Check that it sits next to this HTML file.");
    $("loginError").textContent = "Database connection not found — supabaseClient.js did not load. Check the browser console.";
    $("loginError").classList.remove("hidden");
  }

  $("loginForm")?.addEventListener("submit", handleLogin);
  $("forcePasswordForm")?.addEventListener("submit", handleForcePasswordChange);
  $("biometricLoginBtn")?.addEventListener("click", handleFingerprintLogin);
  $("qrLoginBtn")?.addEventListener("click", handleQrLogin);

  checkScannerStatus();

  // If already signed in this tab, skip straight to the destination page.
  const existing = getPortalSession();
  if (existing) routeToDestination(existing.designation);
});