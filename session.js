// ============================================================================
//  Shared portal session helper
//  Include this AFTER supabaseClient.js and BEFORE each page's own script.
//
//  Session lives in sessionStorage only — it's cleared when the tab closes
//  or on logout. There's no server-side session/token yet; this is a
//  prototype-level gate suitable for an internal tool, not a replacement
//  for real auth if this is ever exposed on the open internet.
// ============================================================================

const PORTAL_SESSION_KEY = "portal_session";

// Where each designation lands after signing in / when a guard redirects them.
const PORTAL_ROUTES = {
  "Super Admin": "superadmin.html",
  "Campus Administrator": "campusadmin.html",
  "Quality Assurance": "qa.html",
  "Department Head": "depthead.html",
  "Dean": "dean.html", // same underlying app as depthead.html (shares depthead.js), own landing page
  "Faculty": "faculty.html",
  "Student": "student.html",
};

function getPortalSession() {
  try {
    const raw = sessionStorage.getItem(PORTAL_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setPortalSession(profile) {
  sessionStorage.setItem(PORTAL_SESSION_KEY, JSON.stringify(profile));
}

function clearPortalSession() {
  sessionStorage.removeItem(PORTAL_SESSION_KEY);
}

// Call at the very top of a protected page's startup. Redirects to
// index.html if there's no session, or if the session's role doesn't match
// what this page is for. Returns the profile object on success (call site
// should stop / return if this returns null).
function requirePortalRole(allowedDesignation) {
  return requirePortalRoleAny([allowedDesignation]);
}

// Same as requirePortalRole, but accepts any of several roles — used by
// pages like the syllabus editor that both Department Head and Faculty
// can open.
function requirePortalRoleAny(allowedDesignations) {
  const profile = getPortalSession();
  if (!profile || !allowedDesignations.includes(profile.designation)) {
    console.warn(
      `requirePortalRoleAny(${JSON.stringify(allowedDesignations)}) rejected session:`,
      profile ? `found designation "${profile.designation}" instead` : "no session found"
    );
    clearPortalSession();
    redirectToLogin();
    return null;
  }
  try { sessionStorage.removeItem("portal_redirect_guard"); } catch { /* ignore */ }
  return profile;
}

function portalLogout() {
  clearPortalSession();
  window.location.href = "index.html";
}

// Sends the browser back to index.html — but first checks whether this has
// happened too many times in the last few seconds. If a session and a
// destination page ever disagree about whether it's valid (e.g. sessionStorage
// isn't persisting reliably — common when opening files directly via
// file:// instead of a local server), the two pages can otherwise bounce
// the browser between them forever with no visible error. This breaks that
// loop and shows a clear message instead of redirecting silently again.
function redirectToLogin() {
  const GUARD_KEY = "portal_redirect_guard";
  const now = Date.now();
  let hits = [];
  try { hits = JSON.parse(sessionStorage.getItem(GUARD_KEY) || "[]"); } catch { hits = []; }
  hits = hits.filter((t) => now - t < 4000); // only count recent bounces
  hits.push(now);

  if (hits.length > 4) {
    sessionStorage.removeItem(GUARD_KEY);
    document.title = "Sign-in error";
    document.documentElement.innerHTML = `
      <body style="font-family:system-ui,sans-serif;background:#FAF7EF;color:#1B2116;padding:24px;">
        <div style="max-width:420px;margin:80px auto;text-align:center;">
          <h2 style="font-size:18px;">Sign-in redirect loop detected</h2>
          <p style="font-size:14px;color:#6B7060;margin-top:8px;">
            This page and the sign-in page kept sending the browser back and forth.
            This usually means session storage isn't persisting between pages —
            common if these files are opened directly (file://) instead of through
            a local server like Live Server. Try opening the site through
            http://127.0.0.1 instead, or check the browser console for details.
          </p>
          <a href="index.html" style="display:inline-block;margin-top:16px;color:#8A6A0C;font-weight:600;text-decoration:underline;">
            Try signing in again
          </a>
        </div>
      </body>`;
    return;
  }

  try { sessionStorage.setItem(GUARD_KEY, JSON.stringify(hits)); } catch { /* storage unavailable — nothing more we can do */ }
  window.location.href = "index.html";
}

function getFormattedFullName(u) {
  if (!u) return "";
  const first = (u.first_name || u.firstName || "").trim();
  const rawMi = u.middle_initial || u.middleInitial || u.mi || "";
  const mi = rawMi ? rawMi.trim().toUpperCase().replace(/\.$/, "") + "." : "";
  const last = (u.last_name || u.lastName || "").trim();
  return [first, mi, last].filter(Boolean).join(" ");
}

window.openSampleSchoolIds = function(role) {
  const session = typeof getPortalSession === "function" ? getPortalSession() : null;
  if (session && typeof QRClient !== "undefined" && typeof QRClient.openIdCardModal === "function") {
    QRClient.openIdCardModal({ user: session });
  } else if (typeof QRClient !== "undefined" && typeof QRClient.openSampleSchoolIdModal === "function") {
    QRClient.openSampleSchoolIdModal(role);
  } else {
    console.warn("QRClient library not loaded yet.");
  }
};