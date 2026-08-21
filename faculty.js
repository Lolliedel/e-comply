// ============================================================================
//  Faculty Portal — application logic
//  Talks to Supabase via the `sb` client (supabaseClient.js)
// ============================================================================

const FORM_TYPES = ["Return of Assessment", "Attendance", "Course Guide", "Syllabus and Course Guide", "Acceptance of Course Guide"];

let profile = null;       // set by session.js's requirePortalRole()
let courses = [];         // courses_report rows where faculty_id = profile.id
let formSubmissions = []; // form_submissions_report rows for those courses
let students = [];        // students_report rows in this faculty member's department
let sections = [];        // sections rows in this faculty member's department (read-only here)
let activeFormType = FORM_TYPES[0];

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

function fmtTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}
function scheduleLabel(c) {
  if (!c.days && !c.start_time) return "No schedule set";
  const time = c.start_time && c.end_time ? `${fmtTime(c.start_time)}–${fmtTime(c.end_time)}` : "";
  return [c.days, time].filter(Boolean).join(" · ");
}
function initials(first, last) { return ((first?.[0] || "") + (last?.[0] || "")).toUpperCase(); }
function formatName(u) { return `${u.last_name}, ${u.first_name}`.trim(); }
function fmtDate(iso) { return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
function randomPassword(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function enterApp() {
  $("appShell").classList.remove("hidden");
  $("sidebarName").textContent = `${profile.first_name} ${profile.last_name}`;
  buildFormsTabs();
  initStudentSignaturePad();
  await loadDepartmentName();
  await refreshAll();
  showView("home");
}

async function loadDepartmentName() {
  if (!profile.department_id) { $("sidebarDept").textContent = "No department assigned"; return; }
  const { data, error } = await sb.from("departments").select("name").eq("id", profile.department_id).single();
  if (!error && data) $("sidebarDept").textContent = data.name;
}

// ── View switching ──────────────────────────────────────────────────────

function showView(view) {
  ["home", "courses", "forms", "students"].forEach((v) => $(`view-${v}`)?.classList.toggle("hidden", v !== view));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "home") renderHome();
  if (view === "courses") renderCoursesTable();
  if (view === "forms") renderForms();
  if (view === "students") renderStudents();
}

// ── Data ────────────────────────────────────────────────────────────────

async function loadCourses() {
  const { data, error } = await sb.from("courses_report").select("*").eq("faculty_id", profile.id);
  if (error) { console.error(error); showToast("Couldn't load your courses.", true); return; }
  courses = data || [];
}

async function loadFormSubmissions() {
  if (courses.length === 0) { formSubmissions = []; return; }
  const courseIds = courses.map((c) => c.id);
  const { data, error } = await sb.from("form_submissions_report").select("*").in("course_id", courseIds);
  if (error) { console.error(error); showToast("Couldn't load form status.", true); return; }
  formSubmissions = data || [];
}

async function loadSections() {
  if (!profile.department_id) { sections = []; return; }
  try {
    const { data, error } = await sb.from("sections").select("*").eq("department_id", profile.department_id).order("name");
    if (error) throw error;
    sections = data || [];
  } catch (err) {
    console.error("Failed to load sections:", err);
    showToast(`Couldn't load sections: ${err.message || err}`, true);
    sections = [];
  }
}

async function loadStudents() {
  if (!profile.department_id) { students = []; return; }
  try {
    const { data, error } = await sb.from("students_report").select("*").eq("department_id", profile.department_id);
    if (error) throw error;
    students = data || [];
  } catch (err) {
    console.error("Failed to load students:", err);
    showToast(`Couldn't load students: ${err.message || err}`, true);
    students = [];
  }
}

function populateSectionSelect() {
  const select = $("studentSectionSelect");
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Select…</option>` +
    sections.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  if (sections.some((s) => s.id === current)) select.value = current;
}

async function refreshAll() {
  await loadCourses();
  await Promise.all([loadFormSubmissions(), loadSections(), loadStudents()]);
  populateSectionSelect();
}

// ── Home ────────────────────────────────────────────────────────────────

function renderHome() {
  $("statCourses").textContent = courses.length;
  $("statUnits").textContent = courses.reduce((sum, c) => sum + (Number(c.unit) || 0), 0);
  $("statPendingForms").textContent = formSubmissions.filter((f) => f.status === "Pending").length
    + (courses.length * FORM_TYPES.length - formSubmissions.length);

  $("recentCoursesList").innerHTML = courses.length === 0
    ? `<div class="text-center py-5 text-[#6B7060] text-sm">No courses assigned yet.</div>`
    : courses.map((c) => `
        <div class="flex items-center gap-3 py-2.5">
          <div class="w-8 h-8 rounded-full text-white text-xs font-bold font-display flex items-center justify-center shrink-0 bg-[#1F6F4A]">${c.course_number?.slice(0, 2).toUpperCase() || "—"}</div>
          <div class="flex-1">
            <div class="text-sm font-semibold">${c.course_number} — ${c.course_description}</div>
            <div class="font-mono text-xs text-[#6B7060]">${c.section_name || "—"} · ${scheduleLabel(c)}</div>
          </div>
        </div>
      `).join("");
}

// ── My Courses ──────────────────────────────────────────────────────────

function renderCoursesTable() {
  const body = $("coursesBody");
  const empty = $("coursesEmpty");
  const table = body.closest("table");

  if (courses.length === 0) {
    body.innerHTML = "";
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  table.classList.remove("hidden");
  empty.classList.add("hidden");

  body.innerHTML = courses.map((c) => `
    <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]">
      <td class="px-4 py-3">
        <div class="font-semibold">${c.course_number}</div>
        <div class="text-xs text-[#6B7060]">${c.course_description}</div>
      </td>
      <td class="px-4 py-3">${c.unit ?? "—"}</td>
      <td class="px-4 py-3">${c.section_name || "—"}</td>
      <td class="px-4 py-3">${scheduleLabel(c)}</td>
    </tr>
  `).join("");
}

// ── Forms ───────────────────────────────────────────────────────────────

function buildFormsTabs() {
  const el = $("formsTabs");
  el.innerHTML = FORM_TYPES.map((t) => `
    <button type="button" data-type="${t}" class="tab-btn ${t === activeFormType ? "active" : ""} border border-[#DEDACE] text-sm px-3.5 py-2 rounded-lg transition">${t}</button>
  `).join("");
  el.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeFormType = btn.dataset.type;
      el.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderForms();
    });
  });
}

function renderForms() {
  const body = $("formsBody");
  const empty = $("formsEmpty");
  const table = body.closest("table");

  if (courses.length === 0) {
    body.innerHTML = "";
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  table.classList.remove("hidden");
  empty.classList.add("hidden");

  body.innerHTML = courses.map((c) => {
    const existing = formSubmissions.find((f) => f.course_id === c.id && f.requirement_type === activeFormType);
    const status = existing?.status || "Pending";
    const remarks = existing?.remarks || "";
    const isApproved = status === "Approved";
    return `
      <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]" data-course-id="${c.id}">
        <td class="px-4 py-3">
          <div class="font-semibold">${c.course_number}</div>
          <div class="text-xs text-[#6B7060]">${c.course_description}</div>
        </td>
        <td class="px-4 py-3">${c.section_name || "—"}</td>
        <td class="px-4 py-3">
          ${isApproved
            ? `<span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#E1EEE6] text-[#1F6F4A]">Approved</span>`
            : `<select class="form-status-select border border-[#DEDACE] rounded-lg px-2 py-1.5 text-xs bg-white">
                <option value="Pending" ${status === "Pending" ? "selected" : ""}>Pending</option>
                <option value="Submitted" ${status === "Submitted" ? "selected" : ""}>Submitted</option>
              </select>`
          }
        </td>
        <td class="px-4 py-3">
          <input class="form-remarks-input border border-[#DEDACE] rounded-lg px-2 py-1.5 text-xs w-40" placeholder="Optional note" value="${remarks.replace(/"/g, "&quot;")}" ${isApproved ? "disabled" : ""}>
        </td>
        <td class="px-4 py-3">
          <div class="flex items-center gap-2">
            ${isApproved ? "" : `<button class="form-save-btn text-xs font-semibold text-white bg-[#14432A] hover:bg-[#1B5636] px-3 py-1.5 rounded-lg transition">Save</button>`}
            ${activeFormType === "Syllabus and Course Guide"
              ? `<a href="syllabus.html?course=${c.id}" class="text-xs font-semibold text-[#8A6A0C] hover:underline whitespace-nowrap">Open Syllabus →</a>`
              : ""}
            ${activeFormType === "Course Guide"
              ? `<a href="course-guide.html?course=${c.id}" class="text-xs font-semibold text-[#8A6A0C] hover:underline whitespace-nowrap">Open Course Guide →</a>`
              : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  body.querySelectorAll(".form-save-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const row = e.target.closest("tr");
      const courseId = row.dataset.courseId;
      const status = row.querySelector(".form-status-select").value;
      const remarks = row.querySelector(".form-remarks-input").value.trim();
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        const { data, error } = await sb.rpc("upsert_form_submission", {
          p_course_id: courseId, p_requirement_type: activeFormType, p_status: status, p_remarks: remarks || null,
        });
        if (error) throw error;
        formSubmissions = formSubmissions.filter((f) => !(f.course_id === courseId && f.requirement_type === activeFormType));
        formSubmissions.push(data);
        showToast(`${activeFormType} status saved.`);
        renderForms();
      } catch (err) {
        console.error("Failed to save form status:", err);
        showToast(`Couldn't save: ${err.message || err}`, true);
        btn.disabled = false;
        btn.textContent = "Save";
      }
    });
  });
}

// ── Students (registration + signature/biometric capture) ──────────────

let studentSignatureCtx = null;
let studentSignatureHasInk = false;
let studentSignatureDrawing = false;
let studentFingerprintCredentialId = null;

function initStudentSignaturePad() {
  const canvas = $("studentSignaturePad");
  if (!canvas) return;
  studentSignatureCtx = canvas.getContext("2d");
  studentSignatureCtx.lineWidth = 2.25;
  studentSignatureCtx.lineCap = "round";
  studentSignatureCtx.lineJoin = "round";
  studentSignatureCtx.strokeStyle = "#1B2116";

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    return { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY };
  };

  canvas.addEventListener("pointerdown", (e) => {
    studentSignatureDrawing = true;
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = pos(e);
    studentSignatureCtx.beginPath();
    studentSignatureCtx.moveTo(x, y);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!studentSignatureDrawing) return;
    const { x, y } = pos(e);
    studentSignatureCtx.lineTo(x, y);
    studentSignatureCtx.stroke();
    if (!studentSignatureHasInk) { studentSignatureHasInk = true; $("studentSignatureStatus").textContent = "Signature captured."; }
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((evt) =>
    canvas.addEventListener(evt, () => { studentSignatureDrawing = false; })
  );

  $("studentClearSignatureBtn")?.addEventListener("click", clearStudentSignaturePad);
  $("studentUploadSignatureBtn")?.addEventListener("click", () => $("studentSignatureFileInput")?.click());
  $("studentSignatureFileInput")?.addEventListener("change", handleStudentSignatureUpload);
  $("studentFingerprintBtn")?.addEventListener("click", registerStudentFingerprint);
}

function clearStudentSignaturePad() {
  const canvas = $("studentSignaturePad");
  if (!canvas || !studentSignatureCtx) return;
  studentSignatureCtx.clearRect(0, 0, canvas.width, canvas.height);
  studentSignatureHasInk = false;
  const fileInput = $("studentSignatureFileInput");
  if (fileInput) fileInput.value = "";
  $("studentSignatureStatus").textContent = "Have the student sign above with a mouse, or upload a signature image.";
}

function handleStudentSignatureUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) { showToast("Please choose an image file.", true); e.target.value = ""; return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const canvas = $("studentSignaturePad");
      studentSignatureCtx.clearRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const w = img.width * scale, h = img.height * scale;
      studentSignatureCtx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      studentSignatureHasInk = true;
      $("studentSignatureStatus").textContent = `Loaded "${file.name}" as the signature.`;
    };
    img.onerror = () => showToast("Couldn't read that image file.", true);
    img.src = reader.result;
  };
  reader.onerror = () => showToast("Couldn't read that file.", true);
  reader.readAsDataURL(file);
}

function getStudentSignatureDataUrl() {
  const canvas = $("studentSignaturePad");
  if (!canvas || !studentSignatureHasInk) return null;
  return canvas.toDataURL("image/png");
}

async function registerStudentFingerprint() {
  const btn = $("studentFingerprintBtn");
  const icon = $("studentFingerprintIcon");
  const label = $("studentFingerprintLabel");
  const status = $("studentFingerprintStatus");
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
    icon.textContent = "⏳"; label.textContent = "Scanning…";
    status.textContent = "Follow your device prompt to scan the fingerprint.";

    const lastName = $("studentLastName")?.value.trim() || "";
    const firstName = $("studentFirstName")?.value.trim() || "";

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: "Faculty Portal" },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: `${firstName}.${lastName}`.toLowerCase() || "pending-student",
          displayName: `${firstName} ${lastName}`.trim() || "New student",
        },
        pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
        timeout: 60000,
        attestation: "none",
      },
    });

    studentFingerprintCredentialId = credential.id;
    icon.textContent = "✅"; label.textContent = "Fingerprint Registered";
    status.textContent = "Biometric credential captured for this student.";
    btn.disabled = true;
    btn.classList.add("opacity-70", "cursor-not-allowed");
  } catch (err) {
    icon.textContent = "🔒"; label.textContent = "Register Fingerprint";
    status.textContent = err.name === "NotAllowedError" ? "Fingerprint registration was cancelled." : "Could not register fingerprint. Please try again.";
    status.classList.add("text-[#B3432B]");
  }
}

function resetStudentIdentityCapture() {
  clearStudentSignaturePad();
  studentFingerprintCredentialId = null;
  const btn = $("studentFingerprintBtn");
  const icon = $("studentFingerprintIcon");
  const label = $("studentFingerprintLabel");
  const status = $("studentFingerprintStatus");
  if (btn) { btn.disabled = false; btn.classList.remove("opacity-70", "cursor-not-allowed"); }
  if (icon) icon.textContent = "🔒";
  if (label) label.textContent = "Register Fingerprint";
  if (status) { status.textContent = "Not yet registered"; status.classList.remove("text-[#B3432B]"); }
}

function showStudentError(field, msg) {
  const el = $(`err-${field}`);
  if (!el) return;
  if (msg) { el.textContent = msg; el.classList.remove("hidden"); } else { el.classList.add("hidden"); }
}

async function handleAddStudent(ev) {
  ev.preventDefault();
  const lastName = $("studentLastName").value.trim();
  const firstName = $("studentFirstName").value.trim();
  const sectionId = $("studentSectionSelect").value;
  const username = $("studentUsername").value.trim();
  const tempPassword = $("studentTempPassword").value;

  let valid = true;
  showStudentError("studentLastName", lastName ? "" : ((valid = false), "Last name is required."));
  showStudentError("studentFirstName", firstName ? "" : ((valid = false), "First name is required."));
  showStudentError("studentSection", sectionId ? "" : ((valid = false), "Select a section."));
  showStudentError("studentUsername", (!username && tempPassword) ? ((valid = false), "Add a username, or clear the password.") : "");
  showStudentError("studentTempPassword",
    username && !tempPassword ? ((valid = false), "Add a temporary password, or clear the username.")
    : (tempPassword && tempPassword.length < 8) ? ((valid = false), "Use at least 8 characters.")
    : "");
  if (!valid) return;

  const btn = ev.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Adding…";

  try {
    if (username) {
      const { error } = await sb.rpc("create_student", {
        p_last_name: lastName,
        p_first_name: firstName,
        p_section_id: sectionId,
        p_department_id: profile.department_id,
        p_college_id: profile.college_id, // auto-derived from the faculty member creating this student
        p_esignature: getStudentSignatureDataUrl(),
        p_fingerprint_credential_id: studentFingerprintCredentialId,
        p_username: username,
        p_password: tempPassword,
      });
      if (error) throw error;
    } else {
      const { error } = await sb.from("students").insert({
        last_name: lastName,
        first_name: firstName,
        section_id: sectionId,
        department_id: profile.department_id,
        college_id: profile.college_id,
        esignature: getStudentSignatureDataUrl(),
        fingerprint_credential_id: studentFingerprintCredentialId,
      });
      if (error) throw error;
    }
    await loadStudents();
    $("studentForm").reset();
    resetStudentIdentityCapture();
    renderStudents();
    renderHome();
    showToast(`${formatName({ last_name: lastName, first_name: firstName })} added.`);
  } catch (err) {
    console.error("Failed to add student:", err);
    if (err.code === "23505" || /already taken/i.test(err.message || "")) {
      showStudentError("studentUsername", "That username is taken.");
    }
    showToast(`Couldn't add that student: ${err.message || err}`, true);
  }
  btn.disabled = false;
  btn.textContent = original;
}

function renderStudents() {
  const body = $("studentsBody");
  const empty = $("studentsEmpty");
  const table = body.closest("table");

  if (students.length === 0) {
    body.innerHTML = "";
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  table.classList.remove("hidden");
  empty.classList.add("hidden");

  body.innerHTML = students.map((s) => `
    <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]">
      <td class="px-4 py-3 flex items-center gap-2.5">
        <div class="w-7 h-7 rounded-full text-white text-[10px] font-bold font-display flex items-center justify-center shrink-0 bg-[#1F6F4A]">${initials(s.first_name, s.last_name)}</div>
        ${formatName(s)}
        ${s.esignature ? '<span title="Signature on file" class="text-xs">✎</span>' : ""}
        ${s.fingerprint_credential_id ? '<span title="Biometric on file" class="text-xs">🔒</span>' : ""}
      </td>
      <td class="px-4 py-3">${s.section_name || s.section || "—"}</td>
      <td class="px-4 py-3 text-[#6B7060]">${fmtDate(s.created_at)}</td>
      <td class="px-4 py-3"><button data-id="${s.id}" class="student-delete-btn text-[#B3432B] hover:opacity-70">🗑</button></td>
    </tr>
  `).join("");

  body.querySelectorAll(".student-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this student's record? This can't be undone.")) return;
      const { data, error } = await sb.from("students").delete().eq("id", btn.dataset.id).select();
      if (error) { showToast(`Couldn't remove that student: ${error.message}`, true); return; }
      if (!data || data.length === 0) { showToast("No student was actually removed — it may already be gone.", true); return; }
      await loadStudents();
      renderStudents();
      showToast("Student removed.");
    });
  });
}

// ── Startup ─────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  profile = requirePortalRole("Faculty"); // redirects to index.html if not signed in as Faculty
  if (!profile) return;

  if (typeof sb === "undefined") {
    console.error("`sb` is undefined — supabaseClient.js did not load. Check that it sits next to this HTML file.");
    showToast("Database connection not found — supabaseClient.js did not load. Check the browser console.", true);
    return;
  }

  $("studentForm")?.addEventListener("submit", handleAddStudent);
  $("studentGeneratePasswordBtn")?.addEventListener("click", () => {
    $("studentTempPassword").value = randomPassword();
  });

  enterApp();
});