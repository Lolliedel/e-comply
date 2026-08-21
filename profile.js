// ============================================================================
//  My Profile — shared across every role (Super Admin, Dean, Department
//  Head, Faculty, Student). Reads the signed-in session, loads that
//  person's own record from the right table, and lets them edit their
//  name and upload a profile photo.
// ============================================================================

function $(id) { return document.getElementById(id); }

let profile = null;   // session profile (from session.js)
let record = null;    // full row from app_users_report / students_report
let profilePictureDataUrl = null;

function showToast(message, isError = false) {
  const toast = $("toast");
  const msg = $("toastMsg");
  msg.textContent = message;
  toast.classList.toggle("bg-[#B3432B]", isError);
  toast.classList.toggle("bg-[#14432A]", !isError);
  toast.classList.remove("hidden");
  toast.classList.add("flex");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.classList.add("hidden"); toast.classList.remove("flex"); }, 3200);
}

function initials(first, last) { return ((first?.[0] || "") + (last?.[0] || "")).toUpperCase(); }

function renderAvatarPreview() {
  const el = $("avatarPreview");
  if (profilePictureDataUrl) {
    el.innerHTML = `<img src="${profilePictureDataUrl}" class="w-full h-full object-cover">`;
  } else {
    el.textContent = initials($("firstName").value, $("lastName").value) || "—";
  }
}

// ── Photo upload (center-cropped to a square, downsized before storing) ──

function handlePhotoUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Please choose an image file.", true);
    e.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const minSide = Math.min(img.width, img.height);
      const sx = (img.width - minSide) / 2;
      const sy = (img.height - minSide) / 2;
      ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
      profilePictureDataUrl = canvas.toDataURL("image/jpeg", 0.85);
      renderAvatarPreview();
    };
    img.onerror = () => showToast("Couldn't read that image file.", true);
    img.src = reader.result;
  };
  reader.onerror = () => showToast("Couldn't read that file.", true);
  reader.readAsDataURL(file);
}

// ── Load / render ──────────────────────────────────────────────────────

async function loadOwnRecord() {
  const table = profile.role === "student" ? "students_report" : "app_users_report";
  try {
    const { data, error } = await sb.from(table).select("*").eq("id", profile.id).single();
    if (error) throw error;
    record = data;
    renderForm();
    $("loadingState").classList.add("hidden");
    $("appShell").classList.remove("hidden");
  } catch (err) {
    console.error("Couldn't load profile:", err);
    $("loadingState").textContent = `Couldn't load your profile: ${err.message || err}`;
  }
}

function renderForm() {
  const isStudent = profile.role === "student";

  $("lastName").value = record.last_name || "";
  $("firstName").value = record.first_name || "";
  $("usernameDisplay").textContent = record.username || "—";
  $("designationDisplay").textContent = profile.designation;
  $("roleLine").textContent = isStudent ? `Student${(record.section_name || record.section) ? " · " + (record.section_name || record.section) : ""}` : profile.designation;
  $("departmentDisplay").textContent = record.department || "—";

  $("middleInitialRow").classList.toggle("hidden", isStudent);
  $("collegeDisplayRow").classList.toggle("hidden", isStudent);
  if (!isStudent) {
    $("middleInitial").value = record.middle_initial || "";
    $("collegeDisplay").textContent = record.college || "—";
  }

  profilePictureDataUrl = record.profile_picture || null;
  renderAvatarPreview();
}

// ── Save ────────────────────────────────────────────────────────────────

async function handleSave(ev) {
  ev.preventDefault();
  const lastName = $("lastName").value.trim();
  const firstName = $("firstName").value.trim();
  if (!lastName || !firstName) {
    showToast("Last name and first name can't be empty.", true);
    return;
  }

  const isStudent = profile.role === "student";
  const table = isStudent ? "students" : "app_users";
  const payload = {
    last_name: lastName,
    first_name: firstName,
    profile_picture: profilePictureDataUrl,
  };
  if (!isStudent) payload.middle_initial = $("middleInitial").value.trim() || null;

  const btn = $("saveBtn");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Saving…";

  try {
    const { error } = await sb.from(table).update(payload).eq("id", profile.id);
    if (error) throw error;

    // Keep the session's cached name in sync so sidebars on other pages
    // pick up the change without needing to sign in again.
    profile.first_name = firstName;
    profile.last_name = lastName;
    setPortalSession(profile);

    showToast("Profile updated.");
  } catch (err) {
    console.error("Failed to save profile:", err);
    showToast(`Couldn't save: ${err.message || err}`, true);
  }
  btn.disabled = false;
  btn.textContent = original;
}

// ── Startup ─────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  if (typeof getPortalSession !== "function") {
    $("loadingState").textContent = "session.js is missing or out of date. Re-download it and reload.";
    return;
  }
  profile = getPortalSession();
  if (!profile) { window.location.href = "index.html"; return; }

  if (typeof sb === "undefined") {
    $("loadingState").textContent = "Database connection not found — supabaseClient.js did not load. Check the browser console.";
    return;
  }

  $("backLink").href = PORTAL_ROUTES[profile.designation] || "index.html";
  $("profileForm")?.addEventListener("submit", handleSave);
  $("uploadPhotoBtn")?.addEventListener("click", () => $("photoFileInput")?.click());
  $("photoFileInput")?.addEventListener("change", handlePhotoUpload);
  $("removePhotoBtn")?.addEventListener("click", () => {
    profilePictureDataUrl = null;
    $("photoFileInput").value = "";
    renderAvatarPreview();
  });

  loadOwnRecord();
});