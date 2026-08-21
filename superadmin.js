// ============================================================================
//  Super Admin Panel — application logic
//  Talks to Supabase via the `sb` client created in supabaseClient.js
// ============================================================================

const DESIGNATIONS = ["Dean", "Department Head", "Faculty"];

let colleges = [];      // [{id, name}]
let departments = [];   // [{id, name}]
let users = [];         // rows from app_users_report
let editingUserId = null; // set while the Create User form is in "edit an existing account" mode

// ── Helpers ──────────────────────────────────────────────────────────────

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
  showToast._t = setTimeout(() => {
    toast.classList.add("hidden");
    toast.classList.remove("flex");
  }, 3200);
}

function initials(first, last) {
  return ((first?.[0] || "") + (last?.[0] || "")).toUpperCase();
}
function formatName(u) {
  const mi = u.middle_initial ? u.middle_initial.toUpperCase() + "." : "";
  return `${u.last_name}, ${u.first_name} ${mi}`.trim();
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function randomPassword(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function slugifyUsername(first, last) {
  const base = `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "");
  return base;
}

async function dedupeUsername(base) {
  let candidate = base;
  let suffix = 1;
  const taken = new Set(users.map((u) => u.username));
  while (taken.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix++;
  }
  return candidate;
}

// ── View switching ──────────────────────────────────────────────────────

function showView(view) {
  ["home", "maintenance", "forms", "create", "reports"].forEach((v) => {
    $(`view-${v}`)?.classList.toggle("hidden", v !== view);
  });
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  if (view === "home") renderHome();
  if (view === "maintenance") renderMaintenance();
  if (view === "forms") renderFormsOverview();
  if (view === "reports") renderReports();
}

// ── Data loading ────────────────────────────────────────────────────────

async function loadColleges() {
  const { data, error } = await sb.from("colleges").select("*").order("name");
  if (error) { console.error(error); showToast("Couldn't load colleges.", true); return; }
  colleges = data;
}

async function loadDepartments() {
  const { data, error } = await sb.from("departments").select("*").order("name");
  if (error) { console.error(error); showToast("Couldn't load departments.", true); return; }
  departments = data;
}

async function loadUsers() {
  const { data, error } = await sb.from("app_users_report").select("*").order("created_at", { ascending: false });
  if (error) { console.error(error); showToast("Couldn't load users.", true); return; }
  users = data;
}

async function refreshAll() {
  await Promise.all([loadColleges(), loadDepartments(), loadUsers()]);
  populateSelect($("collegeSelect"), colleges);
  populateSelect($("departmentSelect"), departments);
  const activeView = document.querySelector(".nav-btn.active")?.dataset.view || "home";
  showView(activeView);
}

function populateSelect(select, items) {
  if (!select) return;
  const current = select.value;
  select.innerHTML =
    `<option value="">Select…</option>` +
    items.map((i) => `<option value="${i.id}">${i.name}</option>`).join("");
  if (items.some((i) => i.id === current)) select.value = current;
}

// ── Home ────────────────────────────────────────────────────────────────

function renderHome() {
  $("statTotal").textContent = users.length;
  $("statColleges").textContent = colleges.length;
  $("statDepartments").textContent = departments.length;
  $("statPending").textContent = users.filter((u) => u.must_change_password).length;

  DESIGNATIONS.forEach((d, i) => {
    const el = $(`statDesig${i}`);
    if (el) el.textContent = users.filter((u) => u.designation === d).length;
  });

  const recent = users.slice(0, 5);
  $("recentList").innerHTML =
    recent.length === 0
      ? `<div class="text-center py-5 text-[#6B7060] text-sm">No accounts yet. Create the first one from Create User.</div>`
      : recent.map((u) => `
        <div class="flex items-center gap-3 py-2.5">
          <div class="w-8 h-8 rounded-full text-white text-xs font-bold font-display flex items-center justify-center shrink-0 bg-[#1F6F4A]">${initials(u.first_name, u.last_name)}</div>
          <div class="flex-1">
            <div class="text-sm font-semibold">${formatName(u)}</div>
            <div class="font-mono text-xs text-[#6B7060]">@${u.username}</div>
          </div>
          <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#FBF3D9] text-[#8A6A0C]">${u.designation}</span>
        </div>
      `).join("");
}

// ── Forms (maintenance: College / Department) ──────────────────────────

function renderMaintenance() {
  renderChipList("collegeChips", colleges, "colleges");
  renderDepartmentChips();

  const newDeptCollege = $("newDepartmentCollegeSelect");
  if (newDeptCollege) {
    const current = newDeptCollege.value;
    newDeptCollege.innerHTML = `<option value="">College…</option>` +
      colleges.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    if (colleges.some((c) => c.id === current)) newDeptCollege.value = current;
  }
}

function renderChipList(containerId, items, table) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = items.length
    ? items.map((i) => `
        <span class="inline-flex items-center gap-2 bg-white border border-[#E3DFC8] rounded-full pl-3 pr-2 py-1.5 text-sm mr-2 mb-2">
          ${i.name}
          <button data-table="${table}" data-id="${i.id}" class="chip-delete text-[#B3432B] hover:opacity-70 text-xs leading-none">✕</button>
        </span>
      `).join("")
    : `<div class="text-sm text-[#6B7060]">No items yet — add the first one below.</div>`;
}

// Departments get their own renderer (not the generic chip list) because
// each row needs an inline College picker — this is what scopes a Dean's
// authority to their own college, so it needs to be settable even for
// departments that already existed before this link was added.
function renderDepartmentChips() {
  const el = $("departmentChips");
  if (!el) return;
  el.innerHTML = departments.length
    ? departments.map((d) => `
        <div class="flex items-center gap-2 mb-2">
          <span class="flex-1 bg-white border border-[#E3DFC8] rounded-lg px-3 py-2 text-sm">${d.name}</span>
          <select data-id="${d.id}" class="dept-college-select border border-[#DEDACE] rounded-lg px-2 py-2 text-xs bg-white">
            <option value="">No college set</option>
            ${colleges.map((c) => `<option value="${c.id}" ${c.id === d.college_id ? "selected" : ""}>${c.name}</option>`).join("")}
          </select>
          <button data-table="departments" data-id="${d.id}" class="chip-delete text-[#B3432B] hover:opacity-70 text-xs leading-none px-1">✕</button>
        </div>
      `).join("")
    : `<div class="text-sm text-[#6B7060]">No items yet — add the first one below.</div>`;

  el.querySelectorAll(".dept-college-select").forEach((select) => {
    select.addEventListener("change", async (e) => {
      const { error } = await sb.from("departments").update({ college_id: e.target.value || null }).eq("id", e.target.dataset.id);
      if (error) { showToast(`Couldn't update college: ${error.message}`, true); return; }
      await loadDepartments();
      renderDepartmentChips();
      showToast("Department's college updated.");
    });
  });
}

// ── Forms (read-only, institution-wide) ─────────────────────────────────
// Super Admin only sees this — editing status/remarks happens in the Dean,
// Department Head, and Faculty portals.

const FORMS_OVERVIEW_TYPES = ["Return of Assessment", "Attendance", "Course Guide", "Syllabus and Course Guide", "Acceptance of Course Guide"];
let formsOverviewCourses = [];
let formsOverviewSubmissions = [];
let activeFormsOverviewType = FORMS_OVERVIEW_TYPES[0];

async function loadFormsOverviewData() {
  try {
    const { data: courseData, error: courseErr } = await sb.from("courses_report").select("*");
    if (courseErr) throw courseErr;
    formsOverviewCourses = courseData || [];

    if (formsOverviewCourses.length === 0) { formsOverviewSubmissions = []; return; }
    const courseIds = formsOverviewCourses.map((c) => c.id);
    const { data: subData, error: subErr } = await sb.from("form_submissions_report").select("*").in("course_id", courseIds);
    if (subErr) throw subErr;
    formsOverviewSubmissions = subData || [];
  } catch (err) {
    console.error("Failed to load forms overview:", err);
    showToast(`Couldn't load forms: ${err.message || err}`, true);
    formsOverviewCourses = [];
    formsOverviewSubmissions = [];
  }
}

function buildFormsOverviewTabs() {
  const el = $("formsOverviewTabs");
  if (!el) return;
  el.innerHTML = FORMS_OVERVIEW_TYPES.map((t) => `
    <button type="button" data-type="${t}" class="forms-overview-tab-btn ${t === activeFormsOverviewType ? "bg-[#14432A] text-white" : "bg-white text-[#1B2116]"} border border-[#DEDACE] text-sm px-3.5 py-2 rounded-lg transition">${t}</button>
  `).join("");
  el.querySelectorAll(".forms-overview-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFormsOverviewType = btn.dataset.type;
      renderFormsOverview();
    });
  });
}

async function renderFormsOverview() {
  if (formsOverviewCourses.length === 0 && formsOverviewSubmissions.length === 0) {
    await loadFormsOverviewData();
  }
  buildFormsOverviewTabs();

  const body = $("formsOverviewBody");
  const empty = $("formsOverviewEmpty");
  const table = body.closest("table");

  if (formsOverviewCourses.length === 0) {
    body.innerHTML = "";
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  table.classList.remove("hidden");
  empty.classList.add("hidden");

  body.innerHTML = formsOverviewCourses.map((c) => {
    const existing = formsOverviewSubmissions.find((f) => f.course_id === c.id && f.requirement_type === activeFormsOverviewType);
    const status = existing?.status || "Pending";
    const statusColor = status === "Approved" ? "bg-[#E1EEE6] text-[#1F6F4A]" : status === "Submitted" ? "bg-[#FBF3D9] text-[#8A6A0C]" : "bg-[#F0EDDE] text-[#6B7060]";
    return `
      <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]">
        <td class="px-4 py-3">
          <div class="font-semibold">${c.course_number}</div>
          <div class="text-xs text-[#6B7060]">${c.course_description}</div>
        </td>
        <td class="px-4 py-3">${c.department || "—"}</td>
        <td class="px-4 py-3">${c.section_name || "—"}</td>
        <td class="px-4 py-3">${c.faculty_first_name ? `${c.faculty_first_name} ${c.faculty_last_name}` : "Unassigned"}</td>
        <td class="px-4 py-3"><span class="text-xs font-semibold px-2.5 py-0.5 rounded-full ${statusColor}">${status}</span></td>
        <td class="px-4 py-3 text-[#6B7060]">${existing?.remarks || "—"}</td>
      </tr>
    `;
  }).join("");
}

async function addMaintenanceItem(table, name, inputEl, selectEl, extraFields = {}) {
  const clean = name.trim();
  if (!clean) return false;
  try {
    const { data, error } = await sb.from(table).insert({ name: clean, ...extraFields }).select().single();
    if (error) {
      console.error(`Failed to add ${table} item:`, error);
      showToast(
        error.code === "23505" ? "That item already exists." : `Couldn't add that item: ${error.message}`,
        true
      );
      return false;
    }
    inputEl.value = "";
    if (table === "colleges") await loadColleges(); else await loadDepartments();
    populateSelect($("collegeSelect"), colleges);
    populateSelect($("departmentSelect"), departments);
    renderMaintenance();
    if (selectEl && data) {
      selectEl.value = data.id;
      updateCredentialPreview();
    }
    showToast(`"${clean}" added.`);
    return true;
  } catch (err) {
    // Catches network/config failures (e.g. supabaseClient.js still has the
    // placeholder URL/key) that never make it back as a Supabase {error}.
    console.error(`Unexpected error adding ${table} item:`, err);
    showToast(`Couldn't reach the database: ${err.message || err}`, true);
    return false;
  }
}

async function deleteMaintenanceItem(table, id) {
  try {
    const { error } = await sb.from(table).delete().eq("id", id);
    if (error) {
      console.error(`Failed to delete ${table} item:`, error);
      showToast(`Couldn't remove that item: ${error.message}`, true);
      return;
    }
    if (table === "colleges") await loadColleges(); else await loadDepartments();
    populateSelect($("collegeSelect"), colleges);
    populateSelect($("departmentSelect"), departments);
    renderMaintenance();
    showToast("Item removed.");
  } catch (err) {
    console.error(`Unexpected error deleting ${table} item:`, err);
    showToast(`Couldn't reach the database: ${err.message || err}`, true);
  }
}

function wireInlineQuickAdd({ toggleBtn, row, input, addBtn, table, select }) {
  const toggleEl = $(toggleBtn);
  const rowEl = $(row);
  const inputEl = $(input);
  const addBtnEl = $(addBtn);
  const selectEl = $(select);
  if (!toggleEl || !rowEl || !inputEl || !addBtnEl) return;

  toggleEl.addEventListener("click", () => {
    const hidden = rowEl.classList.toggle("hidden");
    if (!hidden) inputEl.focus();
  });
  const submit = async () => {
    if (!inputEl.value.trim()) { inputEl.focus(); return; }
    const originalLabel = addBtnEl.textContent;
    addBtnEl.disabled = true;
    addBtnEl.textContent = "Adding…";
    const ok = await addMaintenanceItem(table, inputEl.value, inputEl, selectEl);
    addBtnEl.disabled = false;
    addBtnEl.textContent = originalLabel;
    if (ok) rowEl.classList.add("hidden");
  };
  addBtnEl.addEventListener("click", submit);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    if (e.key === "Escape") { inputEl.value = ""; rowEl.classList.add("hidden"); }
  });
}

// ── Create User ─────────────────────────────────────────────────────────

// ── E-signature pad ─────────────────────────────────────────────────────
// A lightweight canvas signature capture — no external library needed.
// Uses the Pointer Events API so mouse, touch, and stylus all work the same way.

let signatureCtx = null;
let signatureHasInk = false;
let signatureDrawing = false;

function initSignaturePad() {
  const canvas = $("signaturePad");
  if (!canvas) return;

  // Deliberately do NOT size the canvas from getBoundingClientRect() here —
  // this panel starts hidden behind the Home view, and a hidden element
  // measures as 0×0, which silently made every stroke land off-canvas.
  // Instead the canvas keeps the fixed internal resolution set by its
  // width/height HTML attributes, and we translate pointer coordinates
  // into that resolution live, on every event — which is always measured
  // correctly because drawing can only happen while the canvas is visible.
  signatureCtx = canvas.getContext("2d");
  signatureCtx.lineWidth = 2.25;
  signatureCtx.lineCap = "round";
  signatureCtx.lineJoin = "round";
  signatureCtx.strokeStyle = "#1B2116";

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    return { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY };
  };

  canvas.addEventListener("pointerdown", (e) => {
    signatureDrawing = true;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = pos(e);
    signatureCtx.beginPath();
    signatureCtx.moveTo(x, y);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!signatureDrawing) return;
    const { x, y } = pos(e);
    signatureCtx.lineTo(x, y);
    signatureCtx.stroke();
    if (!signatureHasInk) {
      signatureHasInk = true;
      $("signatureStatus").textContent = "Signature captured.";
      updateCredentialPreview();
    }
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((evt) =>
    canvas.addEventListener(evt, () => { signatureDrawing = false; })
  );

  $("clearSignatureBtn")?.addEventListener("click", clearSignaturePad);
  $("uploadSignatureBtn")?.addEventListener("click", () => $("signatureFileInput")?.click());
  $("signatureFileInput")?.addEventListener("change", handleSignatureFileUpload);
}

function clearSignaturePad() {
  const canvas = $("signaturePad");
  if (!canvas || !signatureCtx) return;
  signatureCtx.clearRect(0, 0, canvas.width, canvas.height);
  signatureHasInk = false;
  const fileInput = $("signatureFileInput");
  if (fileInput) fileInput.value = "";
  $("signatureStatus").textContent = "Have the user sign above with a mouse, or upload a signature image.";
  updateCredentialPreview();
}

function handleSignatureFileUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("Please choose an image file for the signature.", true);
    e.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const canvas = $("signaturePad");
      signatureCtx.clearRect(0, 0, canvas.width, canvas.height);
      // Fit the uploaded image inside the pad, preserving aspect ratio, centered.
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      signatureCtx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      signatureHasInk = true;
      $("signatureStatus").textContent = `Loaded "${file.name}" as the signature.`;
      updateCredentialPreview();
    };
    img.onerror = () => showToast("Couldn't read that image file.", true);
    img.src = reader.result;
  };
  reader.onerror = () => showToast("Couldn't read that file.", true);
  reader.readAsDataURL(file);
}

function getSignatureDataUrl() {
  const canvas = $("signaturePad");
  if (!canvas || !signatureHasInk) return null;
  return canvas.toDataURL("image/png");
}

// ── Biometric (WebAuthn) ────────────────────────────────────────────────
// Uses the browser's native platform authenticator (Windows Hello, Touch ID/
// Face ID, Android fingerprint) — no external SDK. Requires HTTPS or
// localhost/127.0.0.1.

let fingerprintCredentialId = null;

async function registerFingerprint() {
  const btn = $("fingerprintBtn");
  const icon = $("fingerprintIcon");
  const label = $("fingerprintLabel");
  const status = $("fingerprintStatus");
  if (!btn) return;

  status.classList.remove("text-[#B3432B]");

  if (!window.PublicKeyCredential) {
    status.textContent = "Biometric registration isn't supported in this browser.";
    status.classList.add("text-[#B3432B]");
    return;
  }

  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      status.textContent = "No fingerprint or biometric sensor detected on this device.";
      status.classList.add("text-[#B3432B]");
      return;
    }

    icon.textContent = "⏳";
    label.textContent = "Scanning…";
    status.textContent = "Follow your device prompt to scan the fingerprint.";

    const employeeUsername = $("username")?.value.trim() || "pending-user";
    const firstName = $("firstName")?.value.trim() || "";
    const lastName = $("lastName")?.value.trim() || "";

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "Super Admin — Access Control" },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: employeeUsername,
          displayName: `${firstName} ${lastName}`.trim() || "New user",
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },
          { alg: -257, type: "public-key" },
        ],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
        timeout: 60000,
        attestation: "none",
      },
    });

    fingerprintCredentialId = credential.id;
    icon.textContent = "✅";
    label.textContent = "Fingerprint Registered";
    status.textContent = "Biometric credential captured for this user.";
    btn.disabled = true;
    btn.classList.add("opacity-70", "cursor-not-allowed");
    updateCredentialPreview();
  } catch (err) {
    icon.textContent = "🔒";
    label.textContent = "Register Fingerprint";
    status.textContent = err.name === "NotAllowedError"
      ? "Fingerprint registration was cancelled."
      : "Could not register fingerprint. Please try again.";
    status.classList.add("text-[#B3432B]");
  }
}

function resetIdentityCapture() {
  clearSignaturePad();
  fingerprintCredentialId = null;
  const btn = $("fingerprintBtn");
  const icon = $("fingerprintIcon");
  const label = $("fingerprintLabel");
  const status = $("fingerprintStatus");
  if (btn) { btn.disabled = false; btn.classList.remove("opacity-70", "cursor-not-allowed"); }
  if (icon) icon.textContent = "🔒";
  if (label) label.textContent = "Register Fingerprint";
  if (status) { status.textContent = "Not yet registered"; status.classList.remove("text-[#B3432B]"); }
  updateCredentialPreview();
}

function updateCredentialPreview() {
  const lastName = $("lastName").value.trim();
  const firstName = $("firstName").value.trim();
  const mi = $("middleInitial").value.trim();
  const designation = $("designationSelect").value;
  const username = $("username").value.trim();
  const password = $("tempPassword").value;

  $("credAvatar").textContent = initials(firstName, lastName) || "—";
  $("credName").textContent = (lastName || firstName) ? `${lastName || "—"}, ${firstName || "—"} ${mi ? mi.toUpperCase() + "." : ""}`.trim() : "Full name";
  $("credDesignation").textContent = designation || "Designation";
  $("credUsername").textContent = username || "username";
  $("credPassword").textContent = password || "••••••••";

  const sigFlag = $("credSignatureFlag");
  if (sigFlag) {
    sigFlag.textContent = signatureHasInk ? "✎ Signature captured" : "✎ No signature";
    sigFlag.className = signatureHasInk ? "text-[#1F6F4A] font-semibold" : "text-[#B9B2A0]";
  }
  const bioFlag = $("credBiometricFlag");
  if (bioFlag) {
    bioFlag.textContent = fingerprintCredentialId ? "🔒 Biometric captured" : "🔒 No biometric";
    bioFlag.className = fingerprintCredentialId ? "text-[#1F6F4A] font-semibold" : "text-[#B9B2A0]";
  }
}

async function suggestUsername() {
  const firstName = $("firstName").value.trim();
  const lastName = $("lastName").value.trim();
  if (!firstName || !lastName) return;
  const base = slugifyUsername(firstName, lastName);
  if (!base) return;
  const unique = await dedupeUsername(base);
  $("username").value = unique;
  updateCredentialPreview();
}

function generateTempPassword() {
  $("tempPassword").value = randomPassword();
  updateCredentialPreview();
}

function showError(field, msg) {
  const el = $(`err-${field}`);
  if (!el) return;
  if (msg) { el.textContent = msg; el.classList.remove("hidden"); }
  else { el.classList.add("hidden"); }
}

async function handleCreateUser(ev) {
  ev.preventDefault();

  if (editingUserId) return handleUpdateUser(ev);

  const lastName = $("lastName").value.trim();
  const firstName = $("firstName").value.trim();
  const middleInitial = $("middleInitial").value.trim();
  const collegeId = $("collegeSelect").value;
  const departmentId = $("departmentSelect").value;
  const designation = $("designationSelect").value;
  const username = $("username").value.trim();
  const password = $("tempPassword").value;

  let valid = true;
  showError("lastName", lastName ? "" : ((valid = false), "Last name is required."));
  showError("firstName", firstName ? "" : ((valid = false), "First name is required."));
  showError("middleInitial", middleInitial.length > 2 ? ((valid = false), "Use 1–2 letters only.") : "");
  showError("collegeSelect", collegeId ? "" : ((valid = false), "Select a college."));
  showError("departmentSelect", departmentId ? "" : ((valid = false), "Select a department."));
  showError("designationSelect", designation ? "" : ((valid = false), "Select a designation."));
  showError("username", username
    ? (users.some((u) => u.username === username) ? ((valid = false), "That username is taken.") : "")
    : ((valid = false), "Username is required."));
  showError("tempPassword", password.length >= 8 ? "" : ((valid = false), "Use at least 8 characters."));

  if (!valid) return;

  const submitBtn = ev.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "Creating account…";

  const { data, error } = await sb.rpc("create_app_user", {
    p_last_name: lastName,
    p_first_name: firstName,
    p_middle_initial: middleInitial,
    p_college_id: collegeId,
    p_department_id: departmentId,
    p_designation: designation,
    p_username: username,
    p_password: password,
    p_esignature: getSignatureDataUrl(),
    p_fingerprint_credential_id: fingerprintCredentialId,
  });

  submitBtn.disabled = false;
  submitBtn.textContent = originalLabel;

  if (error) {
    console.error("Failed to create user:", error);
    if (error.code === "23505" || /unique/i.test(error.message || "")) {
      showError("username", "That username is taken.");
    }
    showToast(error.message || "Couldn't create that account.", true);
    return;
  }

  users.unshift(data);
  $("userForm").reset();
  resetIdentityCapture();
  updateCredentialPreview();
  showToast(`Account created for ${formatName(data)}. Share the temporary credentials securely.`);
  renderHome();
}

// ── Edit / Delete existing accounts ─────────────────────────────────────

function startEditUser(id) {
  const u = users.find((x) => String(x.id) === String(id));
  if (!u) return;
  editingUserId = id;

  showView("create");
  $("userForm").reset();
  resetIdentityCapture();

  $("lastName").value = u.last_name;
  $("firstName").value = u.first_name;
  $("middleInitial").value = u.middle_initial || "";
  $("collegeSelect").value = u.college_id || "";
  $("departmentSelect").value = u.department_id || "";
  $("designationSelect").value = u.designation || "";
  $("username").value = u.username;

  $("username").readOnly = true;
  $("usernameHint").textContent = "Username can't be changed here.";
  $("createOnlySections").classList.add("hidden");
  $("userFormSubmitBtn").textContent = "Update account";
  $("cancelEditBtn").classList.remove("hidden");

  updateCredentialPreview();
  showToast(`Editing ${formatName(u)}.`);
}

function exitEditMode() {
  editingUserId = null;
  $("userForm").reset();
  resetIdentityCapture();
  $("username").readOnly = false;
  $("usernameHint").textContent = "Suggested automatically from the name — edit freely.";
  $("createOnlySections").classList.remove("hidden");
  $("userFormSubmitBtn").textContent = "Create account";
  $("cancelEditBtn").classList.add("hidden");
  updateCredentialPreview();
}

async function handleUpdateUser(ev) {
  const lastName = $("lastName").value.trim();
  const firstName = $("firstName").value.trim();
  const middleInitial = $("middleInitial").value.trim();
  const collegeId = $("collegeSelect").value;
  const departmentId = $("departmentSelect").value;
  const designation = $("designationSelect").value;

  let valid = true;
  showError("lastName", lastName ? "" : ((valid = false), "Last name is required."));
  showError("firstName", firstName ? "" : ((valid = false), "First name is required."));
  showError("middleInitial", middleInitial.length > 2 ? ((valid = false), "Use 1–2 letters only.") : "");
  showError("collegeSelect", collegeId ? "" : ((valid = false), "Select a college."));
  showError("departmentSelect", departmentId ? "" : ((valid = false), "Select a department."));
  showError("designationSelect", designation ? "" : ((valid = false), "Select a designation."));
  if (!valid) return;

  const submitBtn = $("userFormSubmitBtn");
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "Updating…";

  try {
    const { data, error } = await sb.from("app_users").update({
      last_name: lastName,
      first_name: firstName,
      middle_initial: middleInitial || null,
      college_id: collegeId,
      department_id: departmentId,
      designation,
    }).eq("id", editingUserId).select("id, last_name, first_name, middle_initial, college_id, department_id, designation").single();
    if (error) throw error;

    // The update() above returns the raw app_users row (names only, no
    // joined college/department text) — refresh from the report view so
    // the Reports table shows the new college/department names correctly.
    await loadUsers();
    exitEditMode();
    showView("reports");
    showToast(`${formatName(data)} updated.`);
  } catch (err) {
    console.error("Failed to update user:", err);
    showToast(`Couldn't update that account: ${err.message || err}`, true);
  }
  submitBtn.disabled = false;
  submitBtn.textContent = "Update account";
}

async function handleDeleteUser(id) {
  const u = users.find((x) => String(x.id) === String(id));
  if (!u) return;
  if (!confirm(`Delete ${formatName(u)}'s account? This can't be undone.`)) return;

  try {
    const { data, error } = await sb.from("app_users").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("No account was actually removed — it may already be gone, or a permissions rule silently blocked it.");
    }
    users = users.filter((x) => String(x.id) !== String(id));
    if (editingUserId === id) exitEditMode();
    renderReports();
    renderHome();
    showToast(`${formatName(u)}'s account was deleted.`);
  } catch (err) {
    console.error("Failed to delete user:", err);
    showToast(`Couldn't delete that account: ${err.message || err}`, true);
  }
}

// ── Reports ─────────────────────────────────────────────────────────────

function renderReports() {
  const search = $("searchInput").value.trim().toLowerCase();
  const filterDesignation = $("filterDesignation").value;
  const filterCollege = $("filterCollege").value;

  const filtered = users
    .filter((u) => filterDesignation === "All" || u.designation === filterDesignation)
    .filter((u) => filterCollege === "All" || u.college === filterCollege)
    .filter((u) =>
      !search ||
      u.last_name.toLowerCase().includes(search) ||
      u.first_name.toLowerCase().includes(search) ||
      u.username.toLowerCase().includes(search)
    )
    .sort((a, b) => a.last_name.localeCompare(b.last_name));

  $("reportsCount").textContent = `${filtered.length} of ${users.length} account${users.length !== 1 ? "s" : ""}`;

  const body = $("reportsBody");
  const empty = $("reportsEmpty");
  const table = body.closest("table");

  if (filtered.length === 0) {
    body.innerHTML = "";
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  table.classList.remove("hidden");
  empty.classList.add("hidden");

  body.innerHTML = filtered.map((u) => `
    <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]">
      <td class="px-4 py-3 font-mono text-[#6B7060]">${u.id}</td>
      <td class="px-4 py-3 flex items-center gap-2.5">
        <div class="w-7 h-7 rounded-full text-white text-[10px] font-bold font-display flex items-center justify-center shrink-0 bg-[#1F6F4A]">${initials(u.first_name, u.last_name)}</div>
        ${formatName(u)}
        ${u.esignature ? '<span title="Signature on file" class="text-xs">✎</span>' : ""}
        ${u.fingerprint_credential_id ? '<span title="Biometric on file" class="text-xs">🔒</span>' : ""}
      </td>
      <td class="px-4 py-3">${u.college || "—"}</td>
      <td class="px-4 py-3">${u.department || "—"}</td>
      <td class="px-4 py-3"><span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#FBF3D9] text-[#8A6A0C]">${u.designation}</span></td>
      <td class="px-4 py-3 font-mono text-[#6B7060]">@${u.username}</td>
      <td class="px-4 py-3">${u.must_change_password
        ? `<span class="text-xs font-semibold text-[#B3432B]">First-login pending</span>`
        : `<span class="text-xs font-semibold text-[#1F6F4A]">Active</span>`}</td>
      <td class="px-4 py-3 text-[#6B7060]">${fmtDate(u.created_at)}</td>
      <td class="px-4 py-3">
        <div class="flex items-center gap-2">
          <button data-id="${u.id}" class="user-edit-btn text-xs font-semibold text-[#8A6A0C] hover:underline">Edit</button>
          <button data-id="${u.id}" class="user-delete-btn text-[#B3432B] hover:opacity-70" title="Delete account">🗑</button>
        </div>
      </td>
    </tr>
  `).join("");

  body.querySelectorAll(".user-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => startEditUser(btn.dataset.id));
  });
  body.querySelectorAll(".user-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteUser(btn.dataset.id));
  });
}

function populateReportFilters() {
  const collegeFilter = $("filterCollege");
  if (collegeFilter) {
    collegeFilter.innerHTML = `<option value="All">All colleges</option>` +
      colleges.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");
  }
}

// ── Wire up events ──────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  const session = requirePortalRole("Super Admin"); // redirects to index.html if not signed in as Super Admin
  if (!session) return;
  $("sidebarName").textContent = `${session.first_name} ${session.last_name}`;

  const dbConnected = typeof sb !== "undefined";
  if (!dbConnected) {
    // supabaseClient.js either 404'd (most common: it isn't sitting next to
    // this HTML file, or the <script src="..."> path is wrong) or the
    // Supabase CDN script above it failed to load. Fail loudly here instead
    // of only surfacing this on the first button click.
    console.error(
      "`sb` is undefined — supabaseClient.js did not run. Open DevTools → Network, " +
      "reload, and look for a red/404 row for supabaseClient.js or the supabase-js CDN script."
    );
    const banner = $("dbConnectionError");
    const detail = $("dbConnectionErrorDetail");
    if (banner && detail) {
      detail.textContent =
        " supabaseClient.js did not load — check that it sits in the same folder as this HTML file, " +
        "and check the browser console (F12 → Console/Network) for a 404.";
      banner.classList.remove("hidden");
    }
  }

  ["lastName", "firstName", "middleInitial", "designationSelect", "username", "tempPassword"].forEach((id) => {
    $(id)?.addEventListener("input", updateCredentialPreview);
    $(id)?.addEventListener("change", updateCredentialPreview);
  });
  $("firstName")?.addEventListener("blur", suggestUsername);
  $("lastName")?.addEventListener("blur", suggestUsername);
  $("generatePasswordBtn")?.addEventListener("click", generateTempPassword);
  $("fingerprintBtn")?.addEventListener("click", registerFingerprint);
  $("userForm")?.addEventListener("submit", handleCreateUser);
  $("cancelEditBtn")?.addEventListener("click", () => { exitEditMode(); showView("reports"); });
  initSignaturePad();

  $("addCollegeBtn")?.addEventListener("click", () => addMaintenanceItem("colleges", $("newCollegeInput").value, $("newCollegeInput")));
  $("addDepartmentBtn")?.addEventListener("click", async () => {
    const collegeId = $("newDepartmentCollegeSelect")?.value || null;
    const ok = await addMaintenanceItem("departments", $("newDepartmentInput").value, $("newDepartmentInput"), null, { college_id: collegeId });
    if (ok && $("newDepartmentCollegeSelect")) $("newDepartmentCollegeSelect").value = "";
  });
  $("collegeChips")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-delete");
    if (btn) deleteMaintenanceItem(btn.dataset.table, btn.dataset.id);
  });
  $("departmentChips")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-delete");
    if (btn) deleteMaintenanceItem(btn.dataset.table, btn.dataset.id);
  });

  // Inline "add new" controls right inside the Create User form, so the
  // admin never has to leave the form to add a missing College/Department.
  wireInlineQuickAdd({
    toggleBtn: "collegeQuickAddBtn",
    row: "collegeQuickAddRow",
    input: "newCollegeQuickInput",
    addBtn: "addCollegeQuickBtn",
    table: "colleges",
    select: "collegeSelect",
  });
  wireInlineQuickAdd({
    toggleBtn: "departmentQuickAddBtn",
    row: "departmentQuickAddRow",
    input: "newDepartmentQuickInput",
    addBtn: "addDepartmentQuickBtn",
    table: "departments",
    select: "departmentSelect",
  });

  $("searchInput")?.addEventListener("input", renderReports);
  $("filterDesignation")?.addEventListener("change", renderReports);
  $("filterCollege")?.addEventListener("change", renderReports);

  generateTempPassword();
  if (dbConnected) {
    await refreshAll();
    populateReportFilters();
  }
});