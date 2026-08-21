// ============================================================================
//  Student Portal — application logic
//  Talks to Supabase via the `sb` client (supabaseClient.js)
// ============================================================================

let profile = null; // set by session.js's requirePortalRole()

function $(id) { return document.getElementById(id); }

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

async function loadOwnRecord() {
  const { data, error } = await sb.from("students_report").select("*").eq("id", profile.id).single();
  if (error) {
    console.error("Couldn't load student record:", error);
    showToast(`Couldn't load your record: ${error.message}`, true);
    return;
  }
  renderProfile(data);
}

function renderProfile(s) {
  $("avatar").innerHTML = s.profile_picture
    ? `<img src="${s.profile_picture}" class="w-full h-full object-cover rounded-full">`
    : (initials(s.first_name, s.last_name) || "—");
  $("fullName").textContent = `${s.last_name}, ${s.first_name}`;
  $("section").textContent = s.section_name || s.section || "No section on file";
  $("headerDept").textContent = s.department || "No department assigned";

  if (s.esignature) {
    $("signatureIcon").textContent = "✎";
    $("signatureStatus").textContent = "On file";
    $("signatureStatus").className = "text-xs text-[#1F6F4A] font-semibold";
  }
  if (s.fingerprint_credential_id) {
    $("biometricIcon").textContent = "✅";
    $("biometricStatus").textContent = "On file";
    $("biometricStatus").className = "text-xs text-[#1F6F4A] font-semibold";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  profile = requirePortalRole("Student"); // redirects to index.html if not signed in as Student
  if (!profile) return;

  if (typeof sb === "undefined") {
    console.error("`sb` is undefined — supabaseClient.js did not load. Check that it sits next to this HTML file.");
    showToast("Database connection not found — supabaseClient.js did not load. Check the browser console.", true);
    return;
  }

  $("appShell").classList.remove("hidden");
  await loadOwnRecord();
});