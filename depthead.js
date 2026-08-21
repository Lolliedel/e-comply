// ============================================================================
//  Dean / Department Head Portal — application logic
//  Talks to Supabase via the `sb` client (supabaseClient.js)
//  Shared by dean.html and depthead.html (identical DOM shape, same script).
//
//  FIX NOTE: this file previously contained a verbatim copy of superadmin.js,
//  including a startup check of requirePortalRole("Super Admin"). Since Dean
//  and Department Head sessions are never "Super Admin", that check failed
//  on every load, which cleared the session and redirected back to
//  index.html — producing an endless bounce between login and this portal.
//  This version gates on the correct roles and implements the actual
//  Dean/Department Head views (Home, Forms, Faculty, Students, My Subjects,
//  Manage Accounts) that depthead.html / dean.html define.
// ============================================================================

const FORM_TYPES = ["Return of Assessment", "Attendance", "Course Guide", "Syllabus and Course Guide", "Acceptance of Course Guide"];
const DAY_OPTIONS = ["M", "T", "W", "TH", "F", "S"];

let profile = null;             // set by session.js's requirePortalRoleAny()
let workingDepartmentId = null; // department being managed (fixed for Dept Head, selectable for Dean)
let allDepartments = [];        // departments in the Dean's college (Dean only)
let sections = [];
let facultyOptions = [];        // app_users_report rows eligible for "Assign to"
let courses = [];
let students = [];
let formSubmissions = [];
let manageAccountsUsers = [];
let activeFormType = FORM_TYPES[0];
let selectedDays = [];          // day toggle state for the course/subject form

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
function formatName(u) { return `${u.last_name}, ${u.first_name}`.trim(); }
function fmtDate(iso) { return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }); }
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
function randomPassword(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// ── View switching ──────────────────────────────────────────────────────

function showView(view) {
  ["home", "forms", "faculty", "students", "mysubjects", "manageaccounts"].forEach((v) => {
    $(`view-${v}`)?.classList.toggle("hidden", v !== view);
  });
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "home") renderHome();
  if (view === "forms") renderForms();
  if (view === "faculty") { renderSections(); renderCoursesTable(); }
  if (view === "students") renderStudents();
  if (view === "mysubjects") renderMySubjects();
  if (view === "manageaccounts") renderManageAccounts();
}

// ── Startup / department scoping ─────────────────────────────────────────

async function initDepartmentScope() {
  if (profile.designation === "Dean") {
    $("deanDeptPicker")?.classList.remove("hidden");
    const { data, error } = await sb.from("departments").select("*").eq("college_id", profile.college_id).order("name");
    if (error) {
      console.error("Failed to load departments:", error);
      showStartupError(`Couldn't load departments for your college: ${error.message}`);
      return;
    }
    allDepartments = data || [];
    const select = $("deanDepartmentSelect");
    select.innerHTML = allDepartments.map((d) => `<option value="${d.id}">${d.name}</option>`).join("");
    workingDepartmentId = allDepartments[0]?.id || null;
    if (workingDepartmentId) select.value = workingDepartmentId;
    select.addEventListener("change", async () => {
      workingDepartmentId = select.value;
      await refreshDepartmentData();
      await loadSidebarDeptName();
      const activeView = document.querySelector(".nav-btn.active")?.dataset.view || "home";
      showView(activeView);
    });
  } else {
    workingDepartmentId = profile.department_id;
  }

  await loadSidebarDeptName();
}

async function loadSidebarDeptName() {
  if (!workingDepartmentId) { $("sidebarDept").textContent = "No department assigned"; return; }
  const { data, error } = await sb.from("departments").select("name").eq("id", workingDepartmentId).single();
  if (!error && data) $("sidebarDept").textContent = data.name;
}

function showStartupError(detail) {
  $("startupErrorDetail").textContent = ` ${detail}`;
  $("startupError")?.classList.remove("hidden");
}

// ── Data loading ────────────────────────────────────────────────────────

async function loadSections() {
  if (!workingDepartmentId) { sections = []; return; }
  const { data, error } = await sb.from("sections").select("*").eq("department_id", workingDepartmentId).order("name");
  if (error) { console.error(error); showToast("Couldn't load sections.", true); return; }
  sections = data || [];
}

async function loadFacultyOptions() {
  if (!workingDepartmentId) { facultyOptions = []; return; }
  const { data, error } = await sb.from("app_users_report").select("*")
    .eq("department_id", workingDepartmentId)
    .in("designation", ["Faculty", "Department Head", "Dean"]);
  if (error) { console.error(error); showToast("Couldn't load faculty.", true); return; }
  facultyOptions = data || [];
}

async function loadCourses() {
  if (!workingDepartmentId) { courses = []; return; }
  const { data, error } = await sb.from("courses_report").select("*").eq("department_id", workingDepartmentId);
  if (error) { console.error(error); showToast("Couldn't load subjects.", true); return; }
  courses = data || [];
}

async function loadStudents() {
  if (!workingDepartmentId) { students = []; return; }
  const { data, error } = await sb.from("students_report").select("*").eq("department_id", workingDepartmentId);
  if (error) { console.error(error); showToast("Couldn't load students.", true); return; }
  students = data || [];
}

async function loadFormSubmissions() {
  if (courses.length === 0) { formSubmissions = []; return; }
  const courseIds = courses.map((c) => c.id);
  const { data, error } = await sb.from("form_submissions_report").select("*").in("course_id", courseIds);
  if (error) { console.error(error); showToast("Couldn't load form status.", true); return; }
  formSubmissions = data || [];
}

async function loadManageAccounts() {
  if (profile.designation !== "Dean") { manageAccountsUsers = []; return; }
  const { data, error } = await sb.from("app_users_report").select("*")
    .eq("college_id", profile.college_id)
    .neq("designation", "Super Admin");
  if (error) { console.error(error); showToast("Couldn't load accounts.", true); return; }
  manageAccountsUsers = data || [];
}

function populateSectionSelects() {
  [$("courseSectionSelect"), $("studentSectionSelect")].forEach((select) => {
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">Select…</option>` + sections.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
    if (sections.some((s) => s.id === current)) select.value = current;
  });
}

function populateFacultySelect() {
  const select = $("courseFacultySelect");
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Select…</option>` +
    facultyOptions.map((f) => `<option value="${f.id}">${formatName(f)} (${f.designation})</option>`).join("");
  if (facultyOptions.some((f) => String(f.id) === current)) select.value = current;
}

async function refreshDepartmentData() {
  await loadSections();
  await Promise.all([loadFacultyOptions(), loadCourses(), loadStudents()]);
  await loadFormSubmissions();
  if (profile.designation === "Dean") await loadManageAccounts();
  populateSectionSelects();
  populateFacultySelect();
}

// ── Home ────────────────────────────────────────────────────────────────

function renderHome() {
  $("statFaculty").textContent = facultyOptions.filter((f) => f.designation === "Faculty").length;
  $("statCourses").textContent = courses.length;
  $("statStudents").textContent = students.length;
  $("statPendingForms").textContent = formSubmissions.filter((f) => f.status === "Pending").length
    + Math.max(0, courses.length * FORM_TYPES.length - formSubmissions.length);

  const recent = courses.slice(0, 5);
  $("recentCoursesList").innerHTML = recent.length === 0
    ? `<div class="text-center py-5 text-[#6B7060] text-sm">No courses assigned yet.</div>`
    : recent.map((c) => `
        <div class="flex items-center gap-3 py-2.5">
          <div class="w-8 h-8 rounded-full text-white text-xs font-bold font-display flex items-center justify-center shrink-0 bg-[#1F6F4A]">${(c.course_number || "—").slice(0, 2).toUpperCase()}</div>
          <div class="flex-1">
            <div class="text-sm font-semibold">${c.course_number} — ${c.course_description}</div>
            <div class="font-mono text-xs text-[#6B7060]">${c.section_name || "—"} · ${scheduleLabel(c)} · ${c.faculty_first_name ? `${c.faculty_first_name} ${c.faculty_last_name}` : "Unassigned"}</div>
          </div>
        </div>
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
  buildFormsTabs();
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
    return `
      <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]" data-course-id="${c.id}">
        <td class="px-4 py-3">
          <div class="font-semibold">${c.course_number}</div>
          <div class="text-xs text-[#6B7060]">${c.course_description}</div>
        </td>
        <td class="px-4 py-3">${c.section_name || "—"}</td>
        <td class="px-4 py-3">${c.faculty_first_name ? `${c.faculty_first_name} ${c.faculty_last_name}` : "Unassigned"}</td>
        <td class="px-4 py-3">
          <select class="form-status-select border border-[#DEDACE] rounded-lg px-2 py-1.5 text-xs bg-white">
            <option value="Pending" ${status === "Pending" ? "selected" : ""}>Pending</option>
            <option value="Submitted" ${status === "Submitted" ? "selected" : ""}>Submitted</option>
            <option value="Approved" ${status === "Approved" ? "selected" : ""}>Approved</option>
          </select>
        </td>
        <td class="px-4 py-3">
          <input class="form-remarks-input border border-[#DEDACE] rounded-lg px-2 py-1.5 text-xs w-40" placeholder="Optional note" value="${remarks.replace(/"/g, "&quot;")}">
        </td>
        <td class="px-4 py-3">
          <div class="flex items-center gap-2">
            <button class="form-save-btn text-xs font-semibold text-white bg-[#14432A] hover:bg-[#1B5636] px-3 py-1.5 rounded-lg transition">Save</button>
            ${activeFormType === "Syllabus and Course Guide" ? `<a href="syllabus.html?course=${c.id}" class="text-xs font-semibold text-[#8A6A0C] hover:underline whitespace-nowrap">Open Syllabus →</a>` : ""}
            ${activeFormType === "Course Guide" ? `<a href="course-guide.html?course=${c.id}" class="text-xs font-semibold text-[#8A6A0C] hover:underline whitespace-nowrap">Open Course Guide →</a>` : ""}
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

// ── Faculty tab: Sections maintenance ───────────────────────────────────

function renderSections() {
  const el = $("sectionChips");
  el.innerHTML = sections.length
    ? sections.map((s) => `
        <span class="inline-flex items-center gap-2 bg-white border border-[#E3DFC8] rounded-full pl-3 pr-2 py-1.5 text-sm mr-2 mb-2">
          ${s.name}
          <button data-id="${s.id}" class="section-delete-btn text-[#B3432B] hover:opacity-70 text-xs leading-none">✕</button>
        </span>
      `).join("")
    : `<div class="text-sm text-[#6B7060]">No sections yet — add the first one below.</div>`;

  el.querySelectorAll(".section-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { error } = await sb.from("sections").delete().eq("id", btn.dataset.id);
      if (error) { showToast(`Couldn't remove that section: ${error.message}`, true); return; }
      await loadSections();
      populateSectionSelects();
      renderSections();
      showToast("Section removed.");
    });
  });
}

async function addSection(name, inputEl) {
  const clean = name.trim();
  if (!clean) return;
  if (!workingDepartmentId) { showToast("Select a department first.", true); return; }
  const { error } = await sb.from("sections").insert({ name: clean, department_id: workingDepartmentId });
  if (error) {
    showToast(error.code === "23505" ? "That section already exists." : `Couldn't add that section: ${error.message}`, true);
    return;
  }
  inputEl.value = "";
  await loadSections();
  populateSectionSelects();
  renderSections();
  showToast(`"${clean}" added.`);
}

function wireInlineSectionQuickAdd({ toggleBtn, row, input, addBtn }) {
  const toggleEl = $(toggleBtn), rowEl = $(row), inputEl = $(input), addBtnEl = $(addBtn);
  if (!toggleEl || !rowEl || !inputEl || !addBtnEl) return;
  toggleEl.addEventListener("click", () => {
    const hidden = rowEl.classList.toggle("hidden");
    if (!hidden) inputEl.focus();
  });
  const submit = async () => {
    if (!inputEl.value.trim()) { inputEl.focus(); return; }
    await addSection(inputEl.value, inputEl);
    rowEl.classList.add("hidden");
  };
  addBtnEl.addEventListener("click", submit);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    if (e.key === "Escape") { inputEl.value = ""; rowEl.classList.add("hidden"); }
  });
}

// ── Faculty tab: day toggles ────────────────────────────────────────────

function renderDayToggles() {
  const el = $("dayTogglesContainer");
  if (!el) return;
  el.innerHTML = DAY_OPTIONS.map((d) => `
    <button type="button" data-day="${d}" class="day-toggle-btn ${selectedDays.includes(d) ? "bg-[#14432A] text-white" : "bg-white text-[#1B2116]"} border border-[#DEDACE] text-xs font-semibold px-3 py-1.5 rounded-lg transition">${d}</button>
  `).join("");
  el.querySelectorAll(".day-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const day = btn.dataset.day;
      selectedDays = selectedDays.includes(day) ? selectedDays.filter((d) => d !== day) : [...selectedDays, day];
      renderDayToggles();
      checkConflict();
    });
  });
}

// ── Faculty tab: Course/subject assignment ──────────────────────────────

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
    <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]" data-id="${c.id}">
      <td class="px-4 py-3">
        <div class="font-semibold">${c.course_number}</div>
        <div class="text-xs text-[#6B7060]">${c.course_description}</div>
      </td>
      <td class="px-4 py-3">${c.unit ?? "—"}</td>
      <td class="px-4 py-3">${c.section_name || "—"}</td>
      <td class="px-4 py-3">${scheduleLabel(c)}</td>
      <td class="px-4 py-3">${c.faculty_first_name ? `${c.faculty_first_name} ${c.faculty_last_name}` : "Unassigned"}</td>
      <td class="px-4 py-3"><button data-id="${c.id}" class="course-delete-btn text-[#B3432B] hover:opacity-70" title="Remove subject">🗑</button></td>
    </tr>
  `).join("");

  body.querySelectorAll(".course-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Remove this subject assignment? This can't be undone.")) return;
      const { data, error } = await sb.from("courses").delete().eq("id", btn.dataset.id).select();
      if (error) { showToast(`Couldn't remove that subject: ${error.message}`, true); return; }
      if (!data || data.length === 0) { showToast("No subject was actually removed — it may already be gone.", true); return; }
      await loadCourses();
      renderCoursesTable();
      renderHome();
      showToast("Subject removed.");
    });
  });
}

function showCourseError(field, msg) {
  const el = $(`err-${field}`);
  if (!el) return;
  if (msg) { el.textContent = msg; el.classList.remove("hidden"); } else { el.classList.add("hidden"); }
}

function checkConflict() {
  const warningEl = $("conflictWarning");
  if (!warningEl) return;
  const facultyId = $("courseFacultySelect")?.value;
  const start = $("courseStartTime")?.value;
  const end = $("courseEndTime")?.value;
  if (!facultyId || !start || !end || selectedDays.length === 0) {
    warningEl.classList.add("hidden");
    return;
  }
  const overlapsTime = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;
  const conflict = courses.find((c) => {
    if (String(c.faculty_id) !== String(facultyId)) return false;
    if (!c.days || !c.start_time || !c.end_time) return false;
    const sharesDay = selectedDays.some((d) => c.days.includes(d));
    if (!sharesDay) return false;
    return overlapsTime(start, end, c.start_time, c.end_time);
  });
  if (conflict) {
    warningEl.textContent = `Schedule conflict: this person is already assigned to ${conflict.course_number} (${scheduleLabel(conflict)}).`;
    warningEl.classList.remove("hidden");
  } else {
    warningEl.classList.add("hidden");
  }
}

async function handleCourseSubmit(ev) {
  ev.preventDefault();
  const courseNumber = $("courseNumber").value.trim();
  const courseDescription = $("courseDescription").value.trim();
  const unit = $("courseUnit").value;
  const sectionId = $("courseSectionSelect").value;
  const facultyId = $("courseFacultySelect").value;
  const startTime = $("courseStartTime").value;
  const endTime = $("courseEndTime").value;

  let valid = true;
  showCourseError("courseNumber", courseNumber ? "" : ((valid = false), "Subject/course number is required."));
  showCourseError("courseDescription", courseDescription ? "" : ((valid = false), "Course description is required."));
  showCourseError("courseSectionSelect", sectionId ? "" : ((valid = false), "Select a section."));
  showCourseError("courseFacultySelect", facultyId ? "" : ((valid = false), "Select who this is assigned to."));
  if (!valid) return;

  const btn = ev.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Assigning…";

  try {
    const { error } = await sb.from("courses").insert({
      course_number: courseNumber,
      course_description: courseDescription,
      unit: unit ? Number(unit) : 0,
      section_id: sectionId,
      days: selectedDays.join("") || null,
      start_time: startTime || null,
      end_time: endTime || null,
      faculty_id: facultyId,
      department_id: workingDepartmentId,
    });
    if (error) throw error;
    ev.target.reset();
    selectedDays = [];
    renderDayToggles();
    $("conflictWarning")?.classList.add("hidden");
    await loadCourses();
    renderCoursesTable();
    renderHome();
    showToast(`${courseNumber} assigned.`);
  } catch (err) {
    console.error("Failed to assign subject:", err);
    showToast(`Couldn't assign that subject: ${err.message || err}`, true);
  }
  btn.disabled = false;
  btn.textContent = original;
}

// ── Students tab ─────────────────────────────────────────────────────────

let signatureCtx = null;
let signatureHasInk = false;
let signatureDrawing = false;
let studentFingerprintCredentialId = null;

function initStudentSignaturePad() {
  const canvas = $("studentSignaturePad");
  if (!canvas) return;
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
    if (!signatureHasInk) { signatureHasInk = true; $("studentSignatureStatus").textContent = "Signature captured."; }
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((evt) => canvas.addEventListener(evt, () => { signatureDrawing = false; }));

  $("studentClearSignatureBtn")?.addEventListener("click", clearStudentSignaturePad);
  $("studentUploadSignatureBtn")?.addEventListener("click", () => $("studentSignatureFileInput")?.click());
  $("studentSignatureFileInput")?.addEventListener("change", handleStudentSignatureUpload);
  $("studentFingerprintBtn")?.addEventListener("click", registerStudentFingerprint);
}

function clearStudentSignaturePad() {
  const canvas = $("studentSignaturePad");
  if (!canvas || !signatureCtx) return;
  signatureCtx.clearRect(0, 0, canvas.width, canvas.height);
  signatureHasInk = false;
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
      signatureCtx.clearRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const w = img.width * scale, h = img.height * scale;
      signatureCtx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      signatureHasInk = true;
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
  if (!canvas || !signatureHasInk) return null;
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
        rp: { name: "Department Portal" },
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
        p_department_id: workingDepartmentId,
        p_college_id: profile.college_id,
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
        department_id: workingDepartmentId,
        college_id: profile.college_id,
        esignature: getStudentSignatureDataUrl(),
        fingerprint_credential_id: studentFingerprintCredentialId,
      });
      if (error) throw error;
    }
    await loadStudents();
    ev.target.reset();
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
      renderHome();
      showToast("Student removed.");
    });
  });
}

// ── My Subjects tab (subjects assigned to me — Dean/Dept Head who also teach) ─

function renderMySubjects() {
  const body = $("mySubjectsBody");
  const empty = $("mySubjectsEmpty");
  const table = body.closest("table");

  const mine = courses.filter((c) => String(c.faculty_id) === String(profile.id));

  if (mine.length === 0) {
    body.innerHTML = "";
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  table.classList.remove("hidden");
  empty.classList.add("hidden");

  body.innerHTML = mine.map((c) => `
    <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]">
      <td class="px-4 py-3">
        <div class="font-semibold">${c.course_number}</div>
        <div class="text-xs text-[#6B7060]">${c.course_description}</div>
      </td>
      <td class="px-4 py-3">${c.unit ?? "—"}</td>
      <td class="px-4 py-3">${c.section_name || "—"}</td>
      <td class="px-4 py-3">${scheduleLabel(c)}</td>
      <td class="px-4 py-3">${c.department || "—"}</td>
    </tr>
  `).join("");
}

// ── Manage Accounts tab (Dean only) ──────────────────────────────────────

function renderManageAccounts() {
  $("manageAccountsScopeNote").textContent = "Department Head and Faculty accounts within your college. Super Admin accounts are never shown here.";
  const body = $("manageAccountsBody");
  const empty = $("manageAccountsEmpty");
  const table = body.closest("table");

  if (manageAccountsUsers.length === 0) {
    body.innerHTML = "";
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  table.classList.remove("hidden");
  empty.classList.add("hidden");

  body.innerHTML = manageAccountsUsers.map((u) => `
    <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]">
      <td class="px-4 py-3">${formatName(u)}</td>
      <td class="px-4 py-3"><span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#FBF3D9] text-[#8A6A0C]">${u.designation}</span></td>
      <td class="px-4 py-3">${u.department || "—"}</td>
      <td class="px-4 py-3 font-mono text-[#6B7060]">@${u.username}</td>
      <td class="px-4 py-3"><button data-id="${u.id}" class="account-delete-btn text-[#B3432B] hover:opacity-70" title="Delete account">🗑</button></td>
    </tr>
  `).join("");

  body.querySelectorAll(".account-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const u = manageAccountsUsers.find((x) => String(x.id) === btn.dataset.id);
      if (!u) return;
      if (!confirm(`Delete ${formatName(u)}'s account? This can't be undone.`)) return;
      try {
        const { data, error } = await sb.from("app_users").delete().eq("id", btn.dataset.id).select("id");
        if (error) throw error;
        if (!data || data.length === 0) throw new Error("No account was actually removed — it may already be gone, or a permissions rule silently blocked it.");
        manageAccountsUsers = manageAccountsUsers.filter((x) => String(x.id) !== btn.dataset.id);
        renderManageAccounts();
        showToast(`${formatName(u)}'s account was deleted.`);
      } catch (err) {
        console.error("Failed to delete account:", err);
        showToast(`Couldn't delete that account: ${err.message || err}`, true);
      }
    });
  });
}

// ── Startup ─────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  profile = requirePortalRoleAny(["Dean", "Department Head"]); // redirects to index.html if neither role
  if (!profile) return;

  // Reveal the shell right away, before anything that can fail — so if an
  // error happens below, showStartupError()'s message is actually visible
  // instead of being written into a still-hidden element (a blank page
  // with no visible error is much harder to diagnose than a visible one).
  $("appShell").classList.remove("hidden");

  $("sidebarName").textContent = `${profile.first_name} ${profile.last_name}`;
  $("manageAccountsNavBtn")?.classList.toggle("hidden", profile.designation !== "Dean");

  if (typeof sb === "undefined") {
    console.error("`sb` is undefined — supabaseClient.js did not load. Check that it sits next to this HTML file.");
    showStartupError("Database connection not found — supabaseClient.js did not load. Check the browser console.");
    return;
  }

  initStudentSignaturePad();
  renderDayToggles();

  $("courseForm")?.addEventListener("submit", handleCourseSubmit);
  $("courseFacultySelect")?.addEventListener("change", checkConflict);
  $("courseStartTime")?.addEventListener("change", checkConflict);
  $("courseEndTime")?.addEventListener("change", checkConflict);

  $("addSectionBtn")?.addEventListener("click", () => addSection($("newSectionInput").value, $("newSectionInput")));
  $("newSectionInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addSection($("newSectionInput").value, $("newSectionInput")); } });

  wireInlineSectionQuickAdd({
    toggleBtn: "courseSectionQuickAddBtn", row: "courseSectionQuickAddRow",
    input: "newCourseSectionQuickInput", addBtn: "addCourseSectionQuickBtn",
  });
  wireInlineSectionQuickAdd({
    toggleBtn: "studentSectionQuickAddBtn", row: "studentSectionQuickAddRow",
    input: "newStudentSectionQuickInput", addBtn: "addStudentSectionQuickBtn",
  });

  $("studentForm")?.addEventListener("submit", handleAddStudent);
  $("studentGeneratePasswordBtn")?.addEventListener("click", () => { $("studentTempPassword").value = randomPassword(); });

  try {
    await initDepartmentScope();
    await refreshDepartmentData();
  } catch (err) {
    console.error("Failed to initialize portal:", err);
    showStartupError(`${err.message || err}`);
  }

  showView("home");
});