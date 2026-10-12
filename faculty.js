// ============================================================================
//  Faculty Portal — application logic
//  Talks to Supabase via the `sb` client (supabaseClient.js)
// ============================================================================

const FORM_TYPES = ["Class Record", "Return of Assessment", "Attendance", "Course Guide", "Syllabus and Course Guide", "Acceptance of Course Guide"];

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
  ["home", "courses", "forms", "attendance", "students"].forEach((v) => $(`view-${v}`)?.classList.toggle("hidden", v !== view));
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "home") renderHome();
  if (view === "courses") renderCoursesTable();
  if (view === "forms") renderForms();
  if (view === "attendance") {
    populateAttendanceCourses();
    renderAttendanceSessions();
  }
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
            ${activeFormType === "Class Record"
              ? `<a href="class-record.html?course=${c.id}" class="text-xs font-semibold text-[#8A6A0C] hover:underline whitespace-nowrap">Open Class Record →</a>`
              : ""}
            ${activeFormType === "Syllabus and Course Guide"
              ? `<a href="syllabus.html?course=${c.id}" class="text-xs font-semibold text-[#8A6A0C] hover:underline whitespace-nowrap">Open Syllabus →</a>`
              : ""}
            ${activeFormType === "Course Guide"
              ? `<a href="course-guide.html?course=${c.id}" class="text-xs font-semibold text-[#8A6A0C] hover:underline whitespace-nowrap">Open Course Guide →</a>`
              : ""}
            ${activeFormType === "Acceptance of Course Guide"
              ? `<a href="acceptance-of-course-guide.html?course=${c.id}" class="text-xs font-semibold text-[#8A6A0C] hover:underline whitespace-nowrap">Open Acceptance Roster →</a>`
              : ""}
            ${activeFormType === "Return of Assessment"
              ? `<a href="return-of-assessment.html?course=${c.id}" class="text-xs font-semibold text-[#8A6A0C] hover:underline whitespace-nowrap">Open Return of Assessment →</a>`
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

      if (status === "Submitted" && typeof BiometricSigner !== "undefined") {
        const auth = await BiometricSigner.requireBiometricSignature({
          user: profile,
          actionTitle: `Submit ${activeFormType}`,
          subtitle: `Biometric authentication required to submit ${activeFormType} for course evaluation.`
        });
        if (!auth.success) {
          showToast("Submission cancelled: Biometric signature required.", true);
          btn.disabled = false;
          btn.textContent = "Save";
          return;
        }
      }

      try {
        const { data, error } = await sb.rpc("upsert_form_submission", {
          p_course_id: courseId, p_requirement_type: activeFormType, p_status: status, p_remarks: remarks || null,
        });
        if (error) throw error;
        formSubmissions = formSubmissions.filter((f) => !(f.course_id === courseId && f.requirement_type === activeFormType));
        formSubmissions.push(data);
        showToast(`${activeFormType} status saved with biometric verification.`);
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
  $("studentClearFingerprintBtn")?.addEventListener("click", clearStudentFingerprint);
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
  if (!btn) return;

  status.classList.remove("text-[#B3432B]");

  if (typeof ZKTeco === "undefined") {
    status.textContent = "ZKTeco client library not found.";
    status.classList.add("text-[#B3432B]");
    return;
  }

  const lastName = $("studentLastName")?.value.trim() || "";
  const firstName = $("studentFirstName")?.value.trim() || "";
  const studentUsername = $("studentUsername")?.value.trim() || `${firstName}.${lastName}`.toLowerCase() || "student";

  ZKTeco.openEnrollmentModal({
    username: studentUsername,
    onComplete: (result) => {
      studentFingerprintCredentialId = result.template;

      if (icon) {
        if (icon.tagName === "IMG") icon.src = "ICON/biometric.svg";
        else icon.textContent = "";
      }
      if (label) label.textContent = "Fingerprint Enrolled";
      if (status) {
        status.textContent = `Live20R biometric template captured (${result.quality}% quality).`;
        status.classList.remove("text-[#B3432B]");
      }

      // Show preview thumbnail
      const previewRow = $("studentFingerprintPreviewRow");
      const previewImg = $("studentFingerprintPreviewImg");
      if (previewRow && previewImg && result.image) {
        previewImg.src = result.image;
        previewRow.classList.remove("hidden");
      }

      if (btn) btn.classList.add("bg-[#FAF7EF]");
      showToast("Student fingerprint enrolled on Live20R.");
    },
    onError: (err) => {
      console.warn("Biometric enrollment error:", err);
      if (status) {
        status.textContent = err.message || "Could not complete Live20R enrollment.";
        status.classList.add("text-[#B3432B]");
      }
    }
  });
}

function clearStudentFingerprint() {
  studentFingerprintCredentialId = null;
  const btn = $("studentFingerprintBtn");
  const icon = $("studentFingerprintIcon");
  const label = $("studentFingerprintLabel");
  const status = $("studentFingerprintStatus");
  const previewRow = $("studentFingerprintPreviewRow");

  if (btn) { btn.classList.remove("bg-[#FAF7EF]"); }
  if (icon) {
    if (icon.tagName === "IMG") icon.src = "ICON/biometric.svg";
    else icon.textContent = "";
  }
  if (label) label.textContent = "Register Fingerprint";
  if (status) { status.textContent = "Not yet registered"; status.classList.remove("text-[#B3432B]"); }
  if (previewRow) previewRow.classList.add("hidden");
}

function resetStudentIdentityCapture() {
  clearStudentSignaturePad();
  clearStudentFingerprint();
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
        ${s.esignature ? '<img src="ICON/signature.svg" class="w-4 h-4 inline-block text-[#14432A]" title="Signature on file">' : ""}
        ${s.fingerprint_credential_id ? '<img src="ICON/biometric.svg" class="w-4 h-4 inline-block text-[#14432A]" title="Biometric on file">' : ""}
      </td>
      <td class="px-4 py-3">${s.section_name || s.section || "—"}</td>
      <td class="px-4 py-3 text-[#6B7060]">${fmtDate(s.created_at)}</td>
      <td class="px-4 py-3">
        <div class="flex items-center gap-1.5">
          <button data-id="${s.id}" class="student-id-card-btn inline-flex items-center gap-1 text-[#14432A] hover:bg-[#FAF7EF] text-xs font-semibold bg-white border border-[#DEDACE] px-2.5 py-1 rounded-md transition shadow-2xs" title="View Student ID & QR Code">
            <img src="ICON/qr.svg" class="w-3.5 h-3.5"> ID & QR
          </button>
          <button data-id="${s.id}" class="student-delete-btn inline-flex items-center gap-1 text-[#B3432B] hover:opacity-70 text-xs font-semibold bg-[#FBEAE4] px-2.5 py-1 rounded-md" title="Delete student">
            <img src="ICON/delete.svg" class="w-3.5 h-3.5"> Delete
          </button>
        </div>
      </td>
    </tr>
  `).join("");

  body.querySelectorAll(".student-id-card-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const student = students.find((x) => String(x.id) === String(btn.dataset.id));
      if (student && typeof QRClient !== "undefined") {
        QRClient.openIdCardModal({ user: student });
      }
    });
  });

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

// ── Class Attendance & Live20R Biometrics ──────────────────────────────

function populateAttendanceCourses() {
  const sel = $("attCourseSelect");
  if (!sel) return;

  sel.innerHTML = courses.map((c) => `
    <option value="${c.id}" data-days="${c.days || ""}" data-start="${c.start_time || ""}" data-end="${c.end_time || ""}">
      ${c.course_number} — ${c.course_description} (${c.section_name || "Section"})
    </option>
  `).join("");

  const updateTimesForSelectedCourse = () => {
    const opt = sel.options[sel.selectedIndex];
    if (!opt) return;
    const start = opt.dataset.start ? opt.dataset.start.substring(0, 5) : "08:00";
    const end = opt.dataset.end ? opt.dataset.end.substring(0, 5) : "09:30";
    $("attStartTime").value = start;
    $("attEndTime").value = end;
  };

  sel.addEventListener("change", updateTimesForSelectedCourse);
  updateTimesForSelectedCourse();

  // Set default date to today
  $("attDate").value = new Date().toISOString().split("T")[0];
}

function handleScheduleSession(e) {
  e.preventDefault();
  const sel = $("attCourseSelect");
  const courseId = sel.value;
  const course = courses.find((c) => c.id === courseId);
  const date = $("attDate").value;
  const startTime = $("attStartTime").value;
  const endTime = $("attEndTime").value;

  if (startTime >= endTime) {
    showToast("End time must be after start time.", true);
    return;
  }

  const session = AttendanceManager.createSession({
    courseId,
    courseNumber: course?.course_number,
    courseTitle: course?.course_description,
    facultyId: profile.id,
    date,
    startTime,
    endTime,
    topic: `Class Session - ${course?.course_number || ""}`
  });

  showToast(`Attendance window opened for ${course?.course_number || "Class"} (${startTime} - ${endTime})!`);
  renderAttendanceSessions();
}

function renderAttendanceSessions() {
  const listEl = $("attendanceSessionsList");
  const emptyEl = $("attendanceSessionsEmpty");
  if (!listEl || !emptyEl) return;

  const courseIds = new Set(courses.map((c) => c.id));
  const sessions = AttendanceManager.getSessions().filter((s) => courseIds.has(s.course_id));

  if (sessions.length === 0) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  listEl.innerHTML = sessions.map((sess) => {
    const timeStatus = AttendanceManager.getSessionTimeStatus(sess);
    const logs = AttendanceManager.getLogs(sess.id);

    const attendeesHtml = logs.length === 0
      ? `<div class="text-xs text-[#8A8D93] italic py-2">No students have scanned in for this session yet.</div>`
      : `
        <div class="mt-3 overflow-x-auto">
          <table class="w-full text-xs text-left border-collapse bg-white rounded-lg border border-[#E3DFC8]">
            <thead>
              <tr class="bg-[#FAF7EF] text-[11px] text-[#52555C] border-b border-[#E3DFC8]">
                <th class="px-3 py-1.5">#</th>
                <th class="px-3 py-1.5">Student Name</th>
                <th class="px-3 py-1.5">Student No.</th>
                <th class="px-3 py-1.5">Time Logged</th>
                <th class="px-3 py-1.5 text-center">Verification</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map((l, i) => `
                <tr class="border-b border-[#F0EDDE]">
                  <td class="px-3 py-1.5 text-center">${i + 1}</td>
                  <td class="px-3 py-1.5 font-medium">${l.student_name}</td>
                  <td class="px-3 py-1.5 font-mono text-[#52555C]">${l.student_number || "—"}</td>
                  <td class="px-3 py-1.5 text-[#14432A] font-semibold">${l.time_label || fmtTime(l.timestamp?.split("T")[1]?.substring(0, 5))}</td>
                  <td class="px-3 py-1.5 text-center">
                    <span class="bg-[#E1EEE6] text-[#1F6F4A] text-[10px] font-bold px-2 py-0.5 rounded-full">✓ Live20R Match</span>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;

    return `
      <div class="border border-[#E3DFC8] bg-[#FAF7EF]/40 rounded-xl p-4">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div>
            <div class="font-bold text-sm text-[#14432A]">${sess.course_number} — ${sess.course_title}</div>
            <div class="text-xs text-[#6B7060] mt-0.5 flex items-center gap-2">
              <span class="inline-flex items-center gap-1"><img src="ICON/calendar.svg" class="w-3.5 h-3.5 opacity-70">${sess.date}</span>
              <span>·</span>
              <span class="inline-flex items-center gap-1"><img src="ICON/clock.svg" class="w-3.5 h-3.5 opacity-70">${fmtTime(sess.start_time)} – ${fmtTime(sess.end_time)}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold px-2.5 py-1 rounded-full ${timeStatus.color}">${timeStatus.label}</span>
            ${sess.status === "Open"
              ? `<button type="button" onclick="closeSessionById('${sess.id}')" class="text-xs bg-[#B3432B] hover:bg-red-700 text-white px-2.5 py-1 rounded-lg transition font-semibold">Close Window</button>`
              : `<span class="text-xs text-[#8A8D93]">Window Locked</span>`
            }
            <button type="button" onclick="deleteSessionById('${sess.id}')" class="inline-flex items-center gap-1 text-xs text-[#B3432B] hover:opacity-70 bg-[#FBEAE4] px-2 py-1 rounded-md font-semibold" title="Delete Session">
              <img src="ICON/delete.svg" class="w-3.5 h-3.5"> Delete
            </button>
          </div>
        </div>

        <div class="mt-3 pt-3 border-t border-[#EFEBDB]">
          <div class="flex items-center justify-between">
            <div class="text-xs font-semibold text-[#14432A]">Attended Students (${logs.length})</div>
            <div class="flex items-center gap-2">
              <button type="button" onclick="launchKioskForSession('${sess.id}')" class="inline-flex items-center gap-1 text-xs text-[#1F6F4A] hover:underline font-bold">
                <img src="ICON/biometric.svg" class="w-3.5 h-3.5"> Live20R
              </button>
              <span class="text-[#DEDACE]">·</span>
              <button type="button" onclick="launchQrScannerForSession('${sess.id}')" class="inline-flex items-center gap-1 text-xs text-[#14432A] hover:underline font-bold">
                <img src="ICON/qr.svg" class="w-3.5 h-3.5"> Scan QR ID
              </button>
            </div>
          </div>
          ${attendeesHtml}
        </div>
      </div>
    `;
  }).join("");
}

function closeSessionById(id) {
  AttendanceManager.closeSession(id);
  renderAttendanceSessions();
  showToast("Attendance session closed.");
}

function deleteSessionById(id) {
  if (!confirm("Delete this attendance session and its logs?")) return;
  AttendanceManager.deleteSession(id);
  renderAttendanceSessions();
  showToast("Session deleted.");
}

async function launchQrScannerForSession(sessionId) {
  const session = AttendanceManager.getSessions().find((s) => s.id === sessionId);
  if (!session) return;

  const course = courses.find((c) => c.id === session.course_id);
  if (!course) return;

  let candidates = [];
  try {
    const { data } = await sb.from("students_report").select("id, first_name, last_name, student_number").eq("section_id", course.section_id);
    candidates = data || [];
  } catch (e) {
    console.error("Error fetching students:", e);
  }

  if (typeof QRClient === "undefined") {
    showToast("QR Client library is not loaded.", true);
    return;
  }

  QRClient.openScannerModal({
    title: `QR Attendance: ${session.course_number}`,
    subtitle: `Point camera at student's ESSU Digital ID card or mobile QR code.`,
    candidates: candidates,
    onMatch: (matchedCandidate, payload) => {
      const studentId = matchedCandidate?.id || payload.id;
      const studentNum = matchedCandidate?.student_number || payload.id_num || "";
      const studentName = matchedCandidate?.first_name
        ? `${matchedCandidate.last_name}, ${matchedCandidate.first_name}`
        : (payload.name || `Student #${studentId}`);

      const res = AttendanceManager.logAttendance({
        sessionId: session.id,
        courseId: session.course_id,
        studentId: studentId,
        studentNumber: studentNum,
        studentName: studentName,
        method: "QR Code"
      });

      if (res.duplicate) {
        showToast(`${studentName} was already logged for this session.`);
      } else {
        showToast(`✓ Attendance logged via QR for ${studentName}!`);
      }
      renderAttendanceSessions();
    }
  });
}

async function launchKioskForSession(sessionId) {
  const session = AttendanceManager.getSessions().find((s) => s.id === sessionId);
  if (!session) return;

  const course = courses.find((c) => c.id === session.course_id);
  if (!course) return;

  // Load candidate students for this section
  let candidates = [];
  try {
    const { data } = await sb.from("students_report").select("id, first_name, last_name, student_number, fingerprint_credential_id, fingerprint_template").eq("section_id", course.section_id);
    candidates = (data || []).filter((s) => s.fingerprint_template || s.fingerprint_credential_id);
  } catch (e) {
    console.error("Error fetching students:", e);
  }

  if (candidates.length === 0) {
    // If no fingerprints registered, offer QR scanner immediately!
    launchQrScannerForSession(sessionId);
    return;
  }

  if (typeof ZKTeco === "undefined") {
    launchQrScannerForSession(sessionId);
    return;
  }

  ZKTeco.openVerifyModal({
    title: `Class Attendance: ${session.course_number}`,
    prompt: "Student: Place your finger on the Live20R scanner or switch to QR reader.",
    candidates: candidates.map((s) => ({
      id: s.id,
      label: `${s.last_name}, ${s.first_name} (${s.student_number || "No ID"})`,
      first_name: s.first_name,
      last_name: s.last_name,
      student_number: s.student_number,
      template: s.fingerprint_template || s.fingerprint_credential_id
    })),
    onMatch: (matchedCandidate) => {
      AttendanceManager.logAttendance({
        sessionId: session.id,
        courseId: session.course_id,
        studentId: matchedCandidate.id,
        studentNumber: matchedCandidate.student_number,
        studentName: `${matchedCandidate.last_name}, ${matchedCandidate.first_name}`
      });
      showToast(`✓ Attendance logged for ${matchedCandidate.first_name} ${matchedCandidate.last_name}!`);
      renderAttendanceSessions();
    }
  });
}

// ── Startup ─────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  profile = requirePortalRole("Faculty");
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

  $("scheduleSessionForm")?.addEventListener("submit", handleScheduleSession);
  $("launchKioskBtn")?.addEventListener("click", () => {
    const sel = $("attCourseSelect");
    const activeSessions = AttendanceManager.getSessions(sel?.value).filter((s) => s.status === "Open");
    if (activeSessions.length > 0) {
      launchKioskForSession(activeSessions[0].id);
    } else {
      showToast("Please open a scheduled session first to launch scanner kiosk.", true);
    }
  });

  $("launchQrKioskBtn")?.addEventListener("click", () => {
    const sel = $("attCourseSelect");
    const activeSessions = AttendanceManager.getSessions(sel?.value).filter((s) => s.status === "Open");
    if (activeSessions.length > 0) {
      launchQrScannerForSession(activeSessions[0].id);
    } else {
      showToast("Please open a scheduled session first to launch QR scanner kiosk.", true);
    }
  });

  // Dual option switching for Student Registration Credential
  $("tabBioSelectBtn")?.addEventListener("click", () => {
    $("studentBioPanel")?.classList.remove("hidden");
    $("studentQrPanel")?.classList.add("hidden");
    $("tabBioSelectBtn")?.classList.add("bg-[#14432A]", "text-white");
    $("tabBioSelectBtn")?.classList.remove("text-[#14432A]");
    $("tabQrSelectBtn")?.classList.remove("bg-[#14432A]", "text-white");
    $("tabQrSelectBtn")?.classList.add("text-[#14432A]");
  });

  $("tabQrSelectBtn")?.addEventListener("click", () => {
    $("studentQrPanel")?.classList.remove("hidden");
    $("studentBioPanel")?.classList.add("hidden");
    $("tabQrSelectBtn")?.classList.add("bg-[#14432A]", "text-white");
    $("tabQrSelectBtn")?.classList.remove("text-[#14432A]");
    $("tabBioSelectBtn")?.classList.remove("bg-[#14432A]", "text-white");
    $("tabBioSelectBtn")?.classList.add("text-[#14432A]");

    // Render live QR Code in student registration panel
    const fName = $("studentFirstName")?.value.trim() || "Student";
    const lName = $("studentLastName")?.value.trim() || "Sample";
    const uName = $("studentUsername")?.value.trim() || "student.sample";
    const dummyStudent = {
      id: "preview-" + Date.now(),
      first_name: fName,
      last_name: lName,
      username: uName,
      designation: "Student",
      role: "student",
      campus_name: profile.campus_name || "Main Campus"
    };
    if (typeof QRClient !== "undefined") {
      const container = $("studentRegQrContainer");
      if (container) {
        const payload = QRClient.getUserQrPayload(dummyStudent);
        container.innerHTML = QRClient.generateSvg(payload, { size: 84, margin: 1 });
      }
    }
  });

  $("studentPreviewIdCardBtn")?.addEventListener("click", () => {
    const fName = $("studentFirstName")?.value.trim() || "Student";
    const lName = $("studentLastName")?.value.trim() || "Sample";
    const uName = $("studentUsername")?.value.trim() || "student.sample";
    const secSelect = $("studentSectionSelect");
    const secName = secSelect?.options[secSelect.selectedIndex]?.text || "Section";
    const dummyStudent = {
      id: "preview-" + Date.now(),
      first_name: fName,
      last_name: lName,
      username: uName,
      student_number: "2024-" + Math.floor(10000 + Math.random() * 90000),
      designation: "Student",
      role: "student",
      section_name: secName,
      campus_name: profile.campus_name || "Main Campus"
    };
    if (typeof QRClient !== "undefined") {
      QRClient.openIdCardModal({ user: dummyStudent });
    }
  });

  enterApp();
});