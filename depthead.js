// ============================================================================
//  Department Head Portal — application logic
//  Talks to Supabase via the `sb` client created in supabaseClient.js
// ============================================================================

const FORM_TYPES = ["Class Record", "Return of Assessment", "Attendance", "Course Guide", "Syllabus and Course Guide", "Acceptance of Course Guide"];

let profile = null;      // { id, first_name, last_name, designation, college_id, department_id } — set by session.js
let activeDepartmentId = null; // Department Heads: fixed to profile.department_id. Deans: chosen from a picker (they oversee a whole college).
let faculty = [];        // app_users rows with designation = 'Faculty' in the active department
let sections = [];       // sections rows for the active department
let academicCourses = []; // academic_courses (degree programs) for the active department
let courses = [];        // courses_report rows for the active department
let students = [];       // students_report rows for the active department
let formSubmissions = []; // form_submissions_report rows for this department's courses
let activeFormType = FORM_TYPES[0];
let selectedDays = new Set(); // days currently toggled on in the course-assignment form
const DAY_OPTIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
function randomPassword(length = 10) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}
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
  if (!c.days && !c.start_time) return "—";
  const time = c.start_time && c.end_time ? `${fmtTime(c.start_time)}–${fmtTime(c.end_time)}` : "";
  return [c.days, time].filter(Boolean).join(" · ");
}

// ── Session ──────────────────────────────────────────────────────────────
// Authentication itself now happens on index.html (login.js). This page just
// checks for a valid Department Head or Dean session and bounces back to
// index.html if there isn't one — see session.js.

function logout() { portalLogout(); }

function showStartupError(err) {
  console.error("Department Head portal failed to load:", err);
  const banner = $("startupError");
  const detail = $("startupErrorDetail");
  if (banner && detail) {
    detail.textContent = ` ${err?.message || err}. Open the browser console (F12) for details — this often means schema.sql hasn't been fully re-run against your database yet.`;
    banner.classList.remove("hidden");
  }
  $("appShell").classList.remove("hidden"); // show whatever did load rather than staying blank
}

async function enterApp() {
  try {
    $("appShell").classList.remove("hidden");
    $("sidebarName").textContent = `${profile.first_name} ${profile.last_name} (${profile.designation})`;

    buildFormsTabs();
    buildDayToggles();
    initStudentSignaturePad();

    if (profile.designation === "Dean") {
      await setupDeanDepartmentPicker();
    } else {
      activeDepartmentId = profile.department_id;
      if (!activeDepartmentId) {
        const banner = $("startupError");
        const detail = $("startupErrorDetail");
        if (banner && detail) {
          detail.textContent = " Your account has no Department assigned yet, so Faculty, Sections, Subjects, and Students can't load. Ask your Super Admin to set one (Reports → Edit) for your account.";
          banner.classList.remove("hidden");
        }
      }
    }

    // Manage Accounts (delete) is available to both, scoped differently —
    // Dean to their own college, Department Head to only their department's
    // Faculty. See renderManageAccounts() for the actual scoping logic.
    $("manageAccountsNavBtn")?.classList.remove("hidden");
    $("manageAccountsNavBtn")?.classList.add("flex");

    await refreshAll();
    showView("home");
  } catch (err) {
    showStartupError(err);
  }
}

// Deans oversee a whole college, not one fixed department — let them pick
// which department's sections/faculty/subjects they're currently managing.
async function setupDeanDepartmentPicker() {
  $("deanDeptPicker").classList.remove("hidden");
  const { data, error } = await sb.from("departments").select("id, name").order("name");
  // Note: departments aren't scoped to a college in this schema (they're a
  // flat maintenance list shared institution-wide), so a Dean currently
  // picks from the full department list rather than only their college's.
  if (error) { console.error(error); showToast("Couldn't load departments.", true); return; }

  const select = $("deanDepartmentSelect");
  select.innerHTML = data.map((d) => `<option value="${d.id}">${d.name}</option>`).join("");
  activeDepartmentId = data[0]?.id || null;
  select.value = activeDepartmentId || "";

  select.addEventListener("change", async () => {
    activeDepartmentId = select.value;
    await refreshAll();
    renderHome(); renderFacultyView(); renderStudents(); renderForms();
  });
}

// ── View switching ──────────────────────────────────────────────────────

function showView(view) {
  ["home", "forms", "faculty", "students", "mysubjects", "manageaccounts"].forEach((v) => {
    $(`view-${v}`)?.classList.toggle("hidden", v !== view);
  });
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  if (view === "home") renderHome();
  if (view === "forms") renderForms();
  if (view === "faculty") renderFacultyView();
  if (view === "students") renderStudents();
  if (view === "mysubjects") renderMySubjects();
  if (view === "manageaccounts") renderManageAccounts();
}

// ── Data loading (scoped to the active department) ──────────────────────

async function loadDepartmentName() {
  if (!activeDepartmentId) { $("sidebarDept").textContent = "No department assigned"; return; }
  try {
    const { data, error } = await sb.from("departments").select("name").eq("id", activeDepartmentId).single();
    if (error) throw error;
    if (data) $("sidebarDept").textContent = data.name;
  } catch (err) {
    console.error("Failed to load department name:", err);
    $("sidebarDept").textContent = "Couldn't load department";
  }
}

async function loadFaculty() {
  try {
    const deptName = await currentDepartmentName();
    const { data: allStaff, error } = await sb.from("app_users_report").select("*");
    if (error) throw error;

    const seen = new Set();
    faculty = (allStaff || []).filter((u) => {
      if (!["Faculty", "Department Head", "Dean"].includes(u.designation)) return false;
      if (seen.has(u.id)) return false;

      const isSameCollege = profile && profile.college_id && String(u.college_id) === String(profile.college_id);
      const isSameDept = deptName && u.department === deptName;
      const isAffiliate = u.is_affiliate === true || u.is_affiliate === "true";
      const isAffiliatedCollege = u.affiliated_college_id && profile && String(u.affiliated_college_id) === String(profile.college_id);

      if (isSameCollege || isSameDept || isAffiliate || isAffiliatedCollege) {
        seen.add(u.id);
        return true;
      }
      return false;
    });
  } catch (err) {
    console.error("Failed to load faculty:", err);
    showToast(`Couldn't load faculty: ${err.message || err}`, true);
    faculty = [];
  }
}

// app_users_report exposes department NAME, not id — resolve it once per
// active department and cache.
let _deptNameCache = {};
async function currentDepartmentName() {
  if (!activeDepartmentId) return null;
  if (_deptNameCache[activeDepartmentId]) return _deptNameCache[activeDepartmentId];
  const { data, error } = await sb.from("departments").select("name").eq("id", activeDepartmentId).single();
  if (error) {
    console.error("Failed to resolve department name:", error);
    return null; // loadFaculty() will just come back empty rather than throwing
  }
  _deptNameCache[activeDepartmentId] = data?.name || null;
  return _deptNameCache[activeDepartmentId];
}

async function loadAcademicCourses() {
  if (!activeDepartmentId) { academicCourses = []; return; }
  try {
    const { data, error } = await sb.from("academic_courses").select("*").eq("department_id", activeDepartmentId).order("name");
    if (!error && data && data.length > 0) {
      academicCourses = data;
      return;
    }
  } catch (err) {}
  try {
    const stored = JSON.parse(localStorage.getItem("ecomply_academic_courses") || "[]");
    academicCourses = stored.filter((c) => String(c.department_id) === String(activeDepartmentId));
  } catch (e) {
    academicCourses = [];
  }
}

async function loadSections() {
  if (!activeDepartmentId) { sections = []; return; }
  try {
    const { data, error } = await sb.from("sections").select("*").eq("department_id", activeDepartmentId).order("name");
    if (error) throw error;
    sections = data || [];
  } catch (err) {
    console.error("Failed to load sections:", err);
    showToast(`Couldn't load sections: ${err.message || err}`, true);
    sections = [];
  }
}

async function loadCourses() {
  if (!activeDepartmentId) { courses = []; return; }
  try {
    const { data, error } = await sb.from("courses_report").select("*").eq("department_id", activeDepartmentId);
    if (error) throw error;
    courses = data || [];
  } catch (err) {
    console.error("Failed to load courses:", err);
    showToast(`Couldn't load courses: ${err.message || err}`, true);
    courses = [];
  }
}

async function loadStudents() {
  if (!activeDepartmentId) { students = []; return; }
  try {
    const { data, error } = await sb.from("students_report").select("*").eq("department_id", activeDepartmentId);
    if (error) throw error;
    students = data || [];
  } catch (err) {
    console.error("Failed to load students:", err);
    showToast(`Couldn't load students: ${err.message || err}`, true);
    students = [];
  }
}

async function loadFormSubmissions() {
  if (courses.length === 0) { formSubmissions = []; return; }
  try {
    const courseIds = courses.map((c) => c.id);
    const { data, error } = await sb.from("form_submissions_report").select("*").in("course_id", courseIds);
    if (error) throw error;
    formSubmissions = data || [];
  } catch (err) {
    console.error("Failed to load form status:", err);
    showToast(`Couldn't load form status: ${err.message || err}`, true);
    formSubmissions = [];
  }
}

let subjectPool = [];

async function loadSubjectPool() {
  try {
    const { data: allCourses, error } = await sb.from("courses").select("*");
    if (error) throw error;

    const collegeId = profile?.college_id;
    const poolMap = new Map();

    (allCourses || []).forEach((c) => {
      if (!c.course_number) return;
      const isGeneral = c.is_general === true || c.is_general === "true";
      const isMyCollege = collegeId && String(c.college_id) === String(collegeId);

      if (isGeneral || isMyCollege || !c.college_id) {
        if (!poolMap.has(c.course_number)) {
          poolMap.set(c.course_number, {
            course_number: c.course_number,
            course_description: c.course_description || "",
            unit: c.unit || 0,
            is_general: isGeneral,
            college_id: c.college_id,
          });
        }
      }
    });

    subjectPool = Array.from(poolMap.values()).sort((a, b) => a.course_number.localeCompare(b.course_number));
    populateSubjectPoolSelect();
    renderDeptSubjectPoolTable();
  } catch (err) {
    console.error("Failed to load subject pool:", err);
    subjectPool = [];
  }
}

function populateSubjectPoolSelect() {
  const select = $("coursePoolSelect");
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Choose a subject or enter details below…</option>` +
    subjectPool.map((s) => {
      const typeLabel = s.is_general ? "(General Ed)" : "(College Subject)";
      return `<option value="${s.course_number}">[${s.course_number}] ${s.course_description} ${typeLabel}</option>`;
    }).join("");
  if (subjectPool.some((s) => s.course_number === current)) select.value = current;
}

function onCoursePoolSelectChange() {
  const code = $("coursePoolSelect")?.value;
  if (!code) return;
  const match = subjectPool.find((s) => s.course_number === code);
  if (match) {
    if ($("courseNumber")) $("courseNumber").value = match.course_number;
    if ($("courseDescription")) $("courseDescription").value = match.course_description;
    if ($("courseUnit")) $("courseUnit").value = match.unit;
  }
}

function renderDeptSubjectPoolTable() {
  const body = $("deptSubjectPoolBody");
  if (!body) return;
  body.innerHTML = subjectPool.length === 0
    ? `<tr><td colspan="5" class="px-4 py-6 text-center text-[#8A8D93]">No subjects in pool. Add one above.</td></tr>`
    : subjectPool.map((s) => `
      <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]">
        <td class="px-4 py-3 font-mono font-bold text-[#14432A]">${s.course_number}</td>
        <td class="px-4 py-3">${s.course_description || "—"}</td>
        <td class="px-4 py-3">${s.unit || 0}</td>
        <td class="px-4 py-3">
          ${s.is_general
            ? '<span class="px-2.5 py-0.5 rounded-full text-xs bg-[#1F6F4A]/10 text-[#1F6F4A] font-semibold">General Education (Universal)</span>'
            : '<span class="px-2.5 py-0.5 rounded-full text-xs bg-[#FBF3D9] text-[#8A6A0C] font-semibold">College Subject</span>'
          }
        </td>
        <td class="px-4 py-3 text-right">
          ${s.is_general
            ? '<span class="text-xs text-[#8A8D93] italic">Managed by Superadmin</span>'
            : `<div class="flex items-center justify-end gap-2">
                <button data-id="${s.id || ''}" data-code="${s.course_number}" class="dept-edit-pool-btn inline-flex items-center gap-1 text-xs font-semibold text-[#8A6A0C] hover:underline bg-[#FBF3D9] px-2.5 py-1 rounded-md">
                  <img src="ICON/edit.svg" class="w-3.5 h-3.5"> Edit
                </button>
                <button data-id="${s.id || ''}" data-code="${s.course_number}" class="dept-delete-pool-btn inline-flex items-center gap-1 text-[#B3432B] hover:opacity-70 text-xs font-semibold bg-[#FBEAE4] px-2.5 py-1 rounded-md" title="Delete subject">
                  <img src="ICON/delete.svg" class="w-3.5 h-3.5"> Delete
                </button>
               </div>`
          }
        </td>
      </tr>
    `).join("");

  document.querySelectorAll(".dept-edit-pool-btn").forEach((btn) => {
    btn.onclick = () => handleEditDeptPoolSubject(btn.dataset.id, btn.dataset.code);
  });
  document.querySelectorAll(".dept-delete-pool-btn").forEach((btn) => {
    btn.onclick = () => handleDeleteDeptPoolSubject(btn.dataset.id, btn.dataset.code);
  });
}

function handleEditDeptPoolSubject(id, code) {
  openEditSubjectModal(id, code);
}

function openEditSubjectModal(id, code) {
  const s = subjectPool.find((x) => x.course_number === code || String(x.id) === String(id));
  if (!s) return;

  if ($("editSubjectId")) $("editSubjectId").value = s.id || id || "";
  if ($("editSubjectOriginalCode")) $("editSubjectOriginalCode").value = s.course_number || code || "";
  if ($("editCourseNumber")) $("editCourseNumber").value = s.course_number || "";
  if ($("editCourseDescription")) $("editCourseDescription").value = s.course_description || "";
  if ($("editCourseUnit")) $("editCourseUnit").value = s.unit || 0;

  $("editSubjectModal")?.classList.remove("hidden");
}

function closeEditSubjectModal() {
  $("editSubjectModal")?.classList.add("hidden");
}

async function handleSaveEditSubjectModal(ev) {
  ev.preventDefault();
  const id = $("editSubjectId")?.value;
  const originalCode = $("editSubjectOriginalCode")?.value;
  const num = $("editCourseNumber")?.value.trim();
  const desc = $("editCourseDescription")?.value.trim();
  const units = $("editCourseUnit")?.value.trim();

  if (!num || !desc) {
    showToast("Course number and description are required.", true);
    return;
  }

  const btn = $("saveEditSubjectBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  try {
    let query = sb.from("courses").update({
      course_number: num,
      course_description: desc,
      unit: Number(units) || 0,
    });
    if (id) query = query.eq("id", id);
    else query = query.eq("course_number", originalCode);

    const { error } = await query;
    if (error) throw error;
    closeEditSubjectModal();
    showToast(`Subject ${num} updated.`);
    await loadSubjectPool();
  } catch (err) {
    console.error("Failed to edit subject:", err);
    showToast(`Couldn't update subject: ${err.message || err}`, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save changes"; }
  }
}

async function handleDeleteDeptPoolSubject(id, code) {
  if (!confirm(`Delete subject "${code}" from College Pool? This action cannot be undone.`)) return;

  try {
    let query = sb.from("courses").delete();
    if (id) query = query.eq("id", id);
    else query = query.eq("course_number", code);

    const { error } = await query;
    if (error) throw error;
    showToast(`Subject ${code} deleted from pool.`);
    await loadSubjectPool();
  } catch (err) {
    console.error("Failed to delete subject:", err);
    showToast(`Couldn't delete subject: ${err.message || err}`, true);
  }
}

function setDeptSubjectTab(tab) {
  document.querySelectorAll(".dept-subject-tab-btn").forEach((btn) => {
    const isThis = btn.dataset.subjectTab === tab;
    btn.classList.toggle("active", isThis);
    if (isThis) {
      btn.classList.add("border-[#14432A]", "text-[#14432A]", "bg-[#14432A]/10");
      btn.classList.remove("border-transparent", "text-[#6B7060]");
    } else {
      btn.classList.remove("border-[#14432A]", "text-[#14432A]", "bg-[#14432A]/10");
      btn.classList.add("border-transparent", "text-[#6B7060]");
    }
  });
  $("deptSubjectTab-offer")?.classList.toggle("hidden", tab !== "offer");
  $("deptSubjectTab-pool")?.classList.toggle("hidden", tab !== "pool");
}

async function handleCreateDeptPoolSubject(ev) {
  ev.preventDefault();
  const num = $("deptPoolCourseNumber")?.value.trim();
  const desc = $("deptPoolCourseDescription")?.value.trim();
  const units = $("deptPoolCourseUnit")?.value.trim();

  if (!num || !desc) {
    showToast("Course number and description are required.", true);
    return;
  }

  const btn = $("addDeptPoolSubjectBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }

  try {
    const { error } = await sb.from("courses").insert({
      course_number: num,
      course_description: desc,
      unit: units ? Number(units) : 0,
      is_general: false,
      college_id: profile?.college_id || null,
      department_id: activeDepartmentId || null,
    });
    if (error) throw error;
    $("deptPoolSubjectForm")?.reset();
    showToast(`Subject ${num} added to College Subject Pool.`);
    await loadSubjectPool();
  } catch (err) {
    console.error("Failed to add pool subject:", err);
    showToast(`Couldn't add subject to pool: ${err.message || err}`, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "+ Add to Pool"; }
  }
}

async function refreshAll() {
  await loadFaculty();
  await loadAcademicCourses();
  await loadSections();
  await loadCourses();
  await loadSubjectPool();
  await Promise.all([loadStudents(), loadFormSubmissions()]);
  populateFacultySelect();
  populateSectionSelect();
}

function populateFacultySelect() {
  const select = $("courseFacultySelect");
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Select…</option>` +
    faculty.map((f) => `<option value="${f.id}">${formatName(f)} (${f.designation})</option>`).join("");
  if (faculty.some((f) => String(f.id) === current)) select.value = current;
}

function populateSectionSelect() {
  fillSectionSelect($("courseSectionSelect"));
  fillSectionSelect($("studentSectionSelect"));
  fillAcademicCourseSelect($("studentCourseSelect"));
  renderSectionChips();
}

function fillAcademicCourseSelect(select) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">— Select Degree Program (Optional) —</option>` +
    academicCourses.map((c) => `<option value="${c.id}">${c.code ? `[${c.code}] ` : ""}${c.name}</option>`).join("");
  if (academicCourses.some((c) => String(c.id) === String(current))) select.value = current;
}

function fillSectionSelect(select) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Select…</option>` +
    sections.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  if (sections.some((s) => s.id === current)) select.value = current;
}

function renderSectionChips() {
  const el = $("sectionChips");
  if (!el) return;
  el.innerHTML = sections.length
    ? sections.map((s) => `
        <span class="inline-flex items-center gap-2 bg-white border border-[#E3DFC8] rounded-full pl-3 pr-2 py-1.5 text-sm mr-2 mb-2">
          ${s.name}
          <button data-id="${s.id}" class="section-delete-btn text-[#B3432B] hover:opacity-70 text-xs leading-none flex items-center justify-center p-0.5" title="Remove section"><img src="ICON/delete.svg" class="w-3 h-3" alt="Delete"></button>
        </span>
      `).join("")
    : `<div class="text-sm text-[#6B7060]">No sections yet — add the first one below.</div>`;

  el.querySelectorAll(".section-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { error } = await sb.from("sections").delete().eq("id", btn.dataset.id);
      if (error) { showToast(`Couldn't remove that section: ${error.message}`, true); return; }
      await loadSections();
      populateSectionSelect();
      showToast("Section removed.");
    });
  });
}

async function addSection(name, inputEl, selectEl) {
  const clean = name.trim();
  if (!clean) return false;

  const existing = sections.find((s) => s.name.trim().toLowerCase() === clean.toLowerCase());
  if (existing) {
    inputEl.value = "";
    if (selectEl) selectEl.value = existing.id;
    showToast(`"${existing.name}" selected.`);
    return true;
  }

  try {
    const { data, error } = await sb.from("sections").insert({ name: clean, department_id: activeDepartmentId }).select().single();
    if (error) {
      if (error.code === "23505" || /already exists/i.test(error.message || "")) {
        await loadSections();
        populateSectionSelect();
        const found = sections.find((s) => s.name.trim().toLowerCase() === clean.toLowerCase());
        inputEl.value = "";
        if (selectEl && found) selectEl.value = found.id;
        showToast(`"${clean}" selected.`);
        return true;
      }
      showToast(`Couldn't add that section: ${error.message}`, true);
      return false;
    }
    inputEl.value = "";
    await loadSections();
    populateSectionSelect();
    if (selectEl) selectEl.value = data.id;
    showToast(`"${clean}" added.`);
    return true;
  } catch (err) {
    console.error("Failed to add section:", err);
    showToast(`Couldn't reach the database: ${err.message || err}`, true);
    return false;
  }
}

// Wires up a toggleable "+ add new" row for a section dropdown. Used by both
// the course-assignment form and the student-registration form so a missing
// section never means leaving the form to go add it elsewhere.
function wireSectionQuickAdd(toggleId, rowId, inputId, addBtnId, targetSelectId) {
  const toggle = $(toggleId);
  const row = $(rowId);
  const input = $(inputId);
  const addBtn = $(addBtnId);
  if (!toggle || !row || !input || !addBtn) return;

  toggle.addEventListener("click", () => {
    const hidden = row.classList.toggle("hidden");
    if (!hidden) input.focus();
  });
  const submit = async () => {
    if (!input.value.trim()) { input.focus(); return; }
    addBtn.disabled = true;
    const original = addBtn.textContent;
    addBtn.textContent = "Adding…";
    const ok = await addSection(input.value, input, $(targetSelectId));
    addBtn.disabled = false;
    addBtn.textContent = original;
    if (ok) row.classList.add("hidden");
  };
  addBtn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    if (e.key === "Escape") { input.value = ""; row.classList.add("hidden"); }
  });
}

function buildDayToggles() {
  const el = $("dayTogglesContainer");
  if (!el) return;
  el.innerHTML = DAY_OPTIONS.map((d) => `
    <button type="button" data-day="${d}" class="day-toggle-btn border border-[#DEDACE] text-xs px-2.5 py-1.5 rounded-lg transition">${d}</button>
  `).join("");
  el.querySelectorAll(".day-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const day = btn.dataset.day;
      if (selectedDays.has(day)) { selectedDays.delete(day); btn.classList.remove("bg-[#14432A]", "text-white"); }
      else { selectedDays.add(day); btn.classList.add("bg-[#14432A]", "text-white"); }
    });
  });
}

// ── Home ────────────────────────────────────────────────────────────────

function renderHome() {
  $("statFaculty").textContent = faculty.length;
  $("statCourses").textContent = courses.length;
  $("statStudents").textContent = students.length;
  $("statPendingForms").textContent = formSubmissions.filter((f) => f.status === "Pending").length
    + (courses.length * FORM_TYPES.length - formSubmissions.length); // untouched pairs count as pending too

  const recent = [...courses].slice(0, 5);
  $("recentCoursesList").innerHTML = recent.length === 0
    ? `<div class="text-center py-5 text-[#6B7060] text-sm">No courses assigned yet.</div>`
    : recent.map((c) => `
        <div class="flex items-center gap-3 py-2.5">
          <div class="w-8 h-8 rounded-full text-white text-xs font-bold font-display flex items-center justify-center shrink-0 bg-[#1F6F4A]">${c.course_number?.slice(0, 2).toUpperCase() || "—"}</div>
          <div class="flex-1">
            <div class="text-sm font-semibold">${c.course_number} — ${c.course_description}</div>
            <div class="font-mono text-xs text-[#6B7060]">${c.section_name || "—"} · ${c.faculty_first_name ? `${c.faculty_first_name} ${c.faculty_last_name}` : "Unassigned"}</div>
          </div>
        </div>
      `).join("");
}

// ── Forms (per-course requirement tracking) ─────────────────────────────

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

      if (status === "Approved" && typeof BiometricSigner !== "undefined") {
        const roleLabel = profile.designation || "Department Head";
        const auth = await BiometricSigner.requireBiometricSignature({
          user: profile,
          actionTitle: `Approve ${activeFormType} (${roleLabel})`,
          subtitle: `Biometric authentication required to approve and affix official ${roleLabel} signature.`
        });
        if (!auth.success) {
          showToast("Approval cancelled: Biometric signature required.", true);
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
        showToast(`${activeFormType} approved with biometric signature.`);
      } catch (err) {
        console.error("Failed to save form status:", err);
        showToast(`Couldn't save: ${err.message || err}`, true);
      }
      btn.disabled = false;
      btn.textContent = "Save";
    });
  });
}

// ── Faculty (course assignment) ─────────────────────────────────────────

function renderFacultyView() {
  populateFacultySelect();
  populateSectionSelect();
  renderCoursesTable();
}

function showCourseError(field, msg) {
  const el = $(`err-${field}`);
  if (!el) return;
  if (msg) { el.textContent = msg; el.classList.remove("hidden"); } else { el.classList.add("hidden"); }
}

function showConflictWarning(message) {
  const el = $("conflictWarning");
  if (!el) return;
  if (message) { el.textContent = message; el.classList.remove("hidden"); } else { el.classList.add("hidden"); }
}

// Two time ranges overlap if one starts before the other ends, on both sides.
function timesOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false;
  return startA < endB && startB < endA;
}

// A subject conflicts with an existing one if they share at least one day
// AND their time ranges overlap, and either the same faculty member or the
// same section is involved (a person/section can't be in two places at once).
function findScheduleConflicts({ days, startTime, endTime, facultyId, sectionId, excludeCourseId }) {
  if (!days || !startTime || !endTime) return [];
  const dayList = days.split(",").map((d) => d.trim());

  return courses.filter((c) => {
    if (c.id === excludeCourseId) return false;
    if (!c.days || !c.start_time || !c.end_time) return false;
    const sameFaculty = facultyId && String(c.faculty_id) === String(facultyId);
    const sameSection = sectionId && c.section_id === sectionId;
    if (!sameFaculty && !sameSection) return false;

    const existingDays = c.days.split(",").map((d) => d.trim());
    const shareDay = dayList.some((d) => existingDays.includes(d));
    if (!shareDay) return false;

    return timesOverlap(startTime, endTime, c.start_time, c.end_time);
  });
}

function describeConflicts(conflicts, facultyId) {
  return conflicts.map((c) => {
    const who = String(c.faculty_id) === String(facultyId)
      ? `${c.faculty_first_name || "This faculty member"} ${c.faculty_last_name || ""}`.trim()
      : `Section ${c.section_name || "—"}`;
    return `${who} already has ${c.course_number} (${scheduleLabel(c)})`;
  }).join("; ");
}

async function handleAssignCourse(ev) {
  ev.preventDefault();
  const courseNumber = $("courseNumber").value.trim();
  const courseDescription = $("courseDescription").value.trim();
  const unit = $("courseUnit").value;
  const sectionId = $("courseSectionSelect").value;
  const startTime = $("courseStartTime").value;
  const endTime = $("courseEndTime").value;
  const days = [...selectedDays].sort((a, b) => DAY_OPTIONS.indexOf(a) - DAY_OPTIONS.indexOf(b)).join(",");
  const facultyId = $("courseFacultySelect").value;

  let valid = true;
  showCourseError("courseNumber", courseNumber ? "" : ((valid = false), "Course number is required."));
  showCourseError("courseDescription", courseDescription ? "" : ((valid = false), "Course description is required."));
  showCourseError("courseSectionSelect", sectionId ? "" : ((valid = false), "Select a section."));
  showCourseError("courseFacultySelect", facultyId ? "" : ((valid = false), "Select a faculty member."));
  showConflictWarning("");
  if (!valid) return;

  if (days && startTime && endTime) {
    const conflicts = findScheduleConflicts({ days, startTime, endTime, facultyId, sectionId });
    if (conflicts.length > 0) {
      showConflictWarning(`Schedule conflict — ${describeConflicts(conflicts, facultyId)}. Change the time, day, section, or faculty to resolve it.`);
      return;
    }
  }

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
      days: days || null,
      start_time: startTime || null,
      end_time: endTime || null,
      faculty_id: facultyId,
      department_id: activeDepartmentId,
    }).select().single();

    if (error) throw error;
    await loadCourses();
    $("courseForm").reset();
    selectedDays.clear();
    document.querySelectorAll(".day-toggle-btn").forEach((b) => b.classList.remove("bg-[#14432A]", "text-white"));
    renderCoursesTable();
    renderHome();
    showToast(`${courseNumber} assigned.`);
  } catch (err) {
    console.error("Failed to assign course:", err);
    showToast(`Couldn't assign that subject: ${err.message || err}`, true);
  }
  btn.disabled = false;
  btn.textContent = original;
}

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
      <td class="px-4 py-3">${c.faculty_first_name ? `${c.faculty_first_name} ${c.faculty_last_name}` : "Unassigned"}</td>
      <td class="px-4 py-3">
        <button data-id="${c.id}" class="course-delete-btn inline-flex items-center gap-1 text-[#B3432B] hover:opacity-70 text-xs font-semibold bg-[#FBEAE4] px-2.5 py-1 rounded-md" title="Delete course">
          <img src="ICON/delete.svg" class="w-3.5 h-3.5"> Delete
        </button>
      </td>
    </tr>
  `).join("");

  body.querySelectorAll(".course-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { error } = await sb.from("courses").delete().eq("id", btn.dataset.id);
      if (error) { showToast(`Couldn't remove that subject: ${error.message}`, true); return; }
      await loadCourses();
      await loadFormSubmissions();
      renderCoursesTable();
      renderHome();
      showToast("Subject removed.");
    });
  });
}

function renderMySubjects() {
  const mine = courses.filter((c) => String(c.faculty_id) === String(profile.id));
  const body = $("mySubjectsBody");
  const empty = $("mySubjectsEmpty");
  const table = body.closest("table");

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

// ── Manage Accounts (Dean only — delete staff accounts, never Super Admin) ──

async function renderManageAccounts() {
  // Defense in depth: even if this view were reached some other way (e.g.
  // stale UI state), never load or show account data outside these two roles.
  if (profile.designation !== "Dean" && profile.designation !== "Department Head") {
    showView("home");
    return;
  }

  const body = $("manageAccountsBody");
  const empty = $("manageAccountsEmpty");
  const table = body.closest("table");
  $("manageAccountsScopeNote").textContent = profile.designation === "Dean"
    ? "Scoped to your own college — Super Admin accounts never appear here."
    : "Scoped to Faculty in your own department only — Super Admin accounts never appear here.";

  // If this account has no college/department assigned, the scoping queries
  // below have nothing to scope to — show a clear message instead of
  // sending a broken query with a missing id.
  const missingScope = profile.designation === "Dean" ? !profile.college_id : !profile.department_id;
  if (missingScope) {
    body.innerHTML = "";
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    empty.textContent = profile.designation === "Dean"
      ? "Your account has no College assigned yet — ask your Super Admin to set one (Reports → Edit) before this can load."
      : "Your account has no Department assigned yet — ask your Super Admin to set one (Reports → Edit) before this can load.";
    return;
  }

  try {
    let accounts = [];

    if (profile.designation === "Dean") {
      // College-wide, not institution-wide: find every department under
      // this Dean's own college, then include Faculty/Department Head in
      // those departments, plus other Deans who share the same college.
      const { data: depts, error: deptErr } = await sb.from("departments").select("id").eq("college_id", profile.college_id);
      if (deptErr) throw deptErr;
      const deptIds = (depts || []).map((d) => d.id);

      const [scoped, deans] = await Promise.all([
        deptIds.length
          ? sb.from("app_users_report").select("*").in("designation", ["Faculty", "Department Head"]).in("department_id", deptIds)
          : Promise.resolve({ data: [], error: null }),
        sb.from("app_users_report").select("*").eq("designation", "Dean").eq("college_id", profile.college_id),
      ]);
      if (scoped.error) throw scoped.error;
      if (deans.error) throw deans.error;

      const merged = [...(scoped.data || []), ...(deans.data || [])];
      const seen = new Set();
      accounts = merged.filter((u) => {
        if (String(u.id) === String(profile.id)) return false; // don't list/delete yourself here
        if (seen.has(u.id)) return false;
        seen.add(u.id);
        return true;
      });
    } else {
      // Department Head: only Faculty within their own fixed department.
      const { data, error } = await sb
        .from("app_users_report")
        .select("*")
        .eq("designation", "Faculty")
        .eq("department_id", profile.department_id);
      if (error) throw error;
      accounts = data || [];
    }

    accounts.sort((a, b) => (a.last_name || "").localeCompare(b.last_name || ""));

    if (accounts.length === 0) {
      body.innerHTML = "";
      table.classList.add("hidden");
      empty.textContent = "No accounts on file yet.";
      empty.classList.remove("hidden");
      return;
    }
    table.classList.remove("hidden");
    empty.classList.add("hidden");

    body.innerHTML = accounts.map((u) => `
      <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]">
        <td class="px-4 py-3">${formatName(u)}</td>
        <td class="px-4 py-3"><span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#FBF3D9] text-[#8A6A0C]">${u.designation}</span></td>
        <td class="px-4 py-3">${u.department || "—"}</td>
        <td class="px-4 py-3 font-mono text-[#6B7060]">@${u.username}</td>
        <td class="px-4 py-3 text-right">
          <div class="inline-flex items-center gap-1.5">
            <button data-id="${u.id}" class="account-id-btn inline-flex items-center gap-1 text-[#14432A] hover:bg-[#FAF7EF] text-xs font-semibold bg-white border border-[#DEDACE] px-2.5 py-1 rounded-md transition shadow-2xs" title="View Digital ID & QR Code">
              <img src="ICON/qr.svg" class="w-3.5 h-3.5"> ID & QR
            </button>
            <button data-id="${u.id}" class="account-delete-btn inline-flex items-center gap-1 text-[#B3432B] hover:opacity-70 text-xs font-semibold bg-[#FBEAE4] px-2.5 py-1 rounded-md" title="Delete account">
              <img src="ICON/delete.svg" class="w-3.5 h-3.5"> Delete
            </button>
          </div>
        </td>
      </tr>
    `).join("");

    body.querySelectorAll(".account-id-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const u = accounts.find((x) => String(x.id) === String(btn.dataset.id));
        if (u && typeof QRClient !== "undefined") {
          QRClient.openIdCardModal({ user: u });
        }
      });
    });

    body.querySelectorAll(".account-delete-btn").forEach((btn) => {
      btn.addEventListener("click", () => handleDeleteAccount(btn.dataset.id, accounts));
    });
  } catch (err) {
    console.error("Failed to load accounts:", err);
    showToast(`Couldn't load accounts: ${err.message || err}`, true);
  }
}

async function handleDeleteAccount(id, accounts) {
  const u = accounts.find((x) => String(x.id) === String(id));
  if (!u) return;
  // Hard guards: these stand no matter what the list query above returned.
  if (u.designation === "Super Admin") {
    showToast("Super Admin accounts can't be removed from this portal.", true);
    return;
  }
  if (profile.designation === "Department Head" && u.designation !== "Faculty") {
    showToast("Department Head can only remove Faculty accounts.", true);
    return;
  }
  if (!confirm(`Delete ${formatName(u)}'s account (${u.designation})? This can't be undone.`)) return;

  try {
    const { data, error } = await sb.from("app_users").delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("No account was actually removed — it may already be gone, or a permissions rule silently blocked it.");
    }
    showToast(`${formatName(u)}'s account was deleted.`);
    renderManageAccounts();
    await loadFaculty(); // keep the Assign-subject dropdown in sync if this person was in it
    populateFacultySelect();
  } catch (err) {
    console.error("Failed to delete account:", err);
    showToast(`Couldn't delete that account: ${err.message || err}`, true);
  }
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
  const courseId = $("studentCourseSelect")?.value || null;
  const courseObj = academicCourses.find((c) => String(c.id) === String(courseId));
  const sectionId = $("studentSectionSelect").value;
  const username = $("studentUsername").value.trim();
  const tempPassword = $("studentTempPassword").value;

  let valid = true;
  showStudentError("studentLastName", lastName ? "" : ((valid = false), "Last name is required."));
  showStudentError("studentFirstName", firstName ? "" : ((valid = false), "First name is required."));
  showStudentError("studentSection", sectionId ? "" : ((valid = false), "Select a section."));
  // Username/password are optional — a student registered without them just
  // won't have portal access yet. But if either is filled in, both must be,
  // and the password must meet the same minimum as staff accounts.
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
      // Issuing login credentials — go through the RPC so the password is
      // hashed server-side and the username is checked against staff too.
      const { error } = await sb.rpc("create_student", {
        p_last_name: lastName,
        p_first_name: firstName,
        p_section_id: sectionId,
        p_department_id: activeDepartmentId,
        p_college_id: profile.college_id, // auto-derived from whoever is creating this student
        p_esignature: getStudentSignatureDataUrl(),
        p_fingerprint_credential_id: studentFingerprintCredentialId,
        p_username: username,
        p_password: tempPassword,
      });
      if (error) throw error;
    } else {
      // No portal access requested — a plain record is enough.
      const insertPayload = {
        last_name: lastName,
        first_name: firstName,
        section_id: sectionId,
        department_id: activeDepartmentId,
        college_id: profile.college_id,
        esignature: getStudentSignatureDataUrl(),
        fingerprint_credential_id: studentFingerprintCredentialId,
      };
      if (courseId) insertPayload.course_id = courseId;
      const { error } = await sb.from("students").insert(insertPayload);
      if (error) {
        if (insertPayload.course_id) {
          delete insertPayload.course_id;
          const { error: err2 } = await sb.from("students").insert(insertPayload);
          if (err2) throw err2;
        } else {
          throw error;
        }
      }
    }
    await loadStudents();
    const newStudent = students.find((s) => (username && s.username === username) || (s.last_name === lastName && s.first_name === firstName));
    if (newStudent && courseId) {
      try {
        const courseMap = JSON.parse(localStorage.getItem("ecomply_user_course_map") || "{}");
        courseMap[newStudent.id] = { course_id: courseId, course_name: courseObj?.name || "", course_code: courseObj?.code || "" };
        localStorage.setItem("ecomply_user_course_map", JSON.stringify(courseMap));
        await sb.from("students").update({ course_id: courseId }).eq("id", newStudent.id);
      } catch (e) {}
    }

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

  let courseMap = {};
  try { courseMap = JSON.parse(localStorage.getItem("ecomply_user_course_map") || "{}"); } catch (e) {}

  body.innerHTML = students.map((s) => {
    let prog = "—";
    if (s.course_code || s.course_name) {
      prog = s.course_code ? `[${s.course_code}] ${s.course_name}` : s.course_name;
    } else if (courseMap[s.id]?.course_code || courseMap[s.id]?.course_name) {
      const cm = courseMap[s.id];
      prog = cm.course_code ? `[${cm.course_code}] ${cm.course_name}` : cm.course_name;
    } else if (s.section_id) {
      const sec = sections.find((x) => String(x.id) === String(s.section_id));
      if (sec && sec.course_id) {
        const crs = academicCourses.find((x) => String(x.id) === String(sec.course_id));
        if (crs) prog = crs.code ? `[${crs.code}] ${crs.name}` : crs.name;
      }
    }
    return `
    <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]">
      <td class="px-4 py-3 flex items-center gap-2.5">
        <div class="w-7 h-7 rounded-full text-white text-[10px] font-bold font-display flex items-center justify-center shrink-0 bg-[#1F6F4A]">${initials(s.first_name, s.last_name)}</div>
        ${formatName(s)}
        ${s.esignature ? '<img src="ICON/signature.svg" class="w-4 h-4 inline-block text-[#14432A]" title="Signature on file">' : ""}
        ${s.fingerprint_credential_id ? '<img src="ICON/biometric.svg" class="w-4 h-4 inline-block text-[#14432A]" title="Biometric on file">' : ""}
      </td>
      <td class="px-4 py-3 text-xs font-semibold text-[#14432A]">${prog}</td>
      <td class="px-4 py-3">${s.section_name || s.section || "—"}</td>
      <td class="px-4 py-3 text-[#6B7060]">${fmtDate(s.created_at)}</td>
      <td class="px-4 py-3 text-right">
        <div class="inline-flex items-center gap-1.5">
          <button data-id="${s.id}" class="student-id-btn inline-flex items-center gap-1 text-[#14432A] hover:bg-[#FAF7EF] text-xs font-semibold bg-white border border-[#DEDACE] px-2.5 py-1 rounded-md transition shadow-2xs" title="View Digital ID & QR Code">
            <img src="ICON/qr.svg" class="w-3.5 h-3.5"> ID & QR
          </button>
          <button data-id="${s.id}" class="student-delete-btn inline-flex items-center gap-1 text-[#B3432B] hover:opacity-70 text-xs font-semibold bg-[#FBEAE4] px-2.5 py-1 rounded-md" title="Delete student">
            <img src="ICON/delete.svg" class="w-3.5 h-3.5"> Delete
          </button>
        </div>
      </td>
    </tr>
  `;
  }).join("");

  body.querySelectorAll(".student-id-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const student = students.find((x) => String(x.id) === String(btn.dataset.id));
      if (student && typeof QRClient !== "undefined") {
        QRClient.openIdCardModal({ user: student });
      }
    });
  });

  body.querySelectorAll(".student-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
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

// ── Wire up events ──────────────────────────────────────────────────────

// Writes directly to document.body, bypassing the (possibly still-hidden)
// appShell entirely — used when startup fails so early that we can't trust
// any other part of the page to be in a working state.
function fatalStartupError(message) {
  console.error("Department Head portal fatal error:", message);
  document.body.innerHTML = `
    <div style="max-width:480px;margin:80px auto;font-family:system-ui,sans-serif;background:#FBEAE4;border:1px solid #E5B4A4;color:#8A3420;padding:20px 24px;border-radius:10px;">
      <strong>This page couldn't start.</strong>
      <p style="margin-top:8px;font-size:14px;line-height:1.5;">${message}</p>
      <a href="index.html" style="display:inline-block;margin-top:14px;color:#8A6A0C;font-weight:600;text-decoration:underline;">← Back to sign-in</a>
    </div>`;
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    // These come from session.js — if that file is missing, 404'd, or is an
    // older copy from before this portal added multi-role support, these
    // won't exist and calling them would throw a silent ReferenceError that
    // aborts this whole handler, leaving a blank page with no explanation.
    if (typeof requirePortalRoleAny !== "function" || typeof getPortalSession !== "function") {
      fatalStartupError(
        "session.js is missing or out of date (requirePortalRoleAny is not defined). " +
        "Re-download the latest session.js from the assistant and make sure it's the one sitting next to this HTML file, then reload."
      );
      return;
    }

    if (typeof sb === "undefined") {
      fatalStartupError("Database connection not found — supabaseClient.js did not load. Check that it sits next to this HTML file, then reload.");
      return;
    }

    profile = requirePortalRoleAny(["Department Head", "Dean"]); // redirects to index.html otherwise
    if (!profile) return;

    $("courseForm")?.addEventListener("submit", handleAssignCourse);
    $("studentForm")?.addEventListener("submit", handleAddStudent);
    $("studentGeneratePasswordBtn")?.addEventListener("click", () => {
      $("studentTempPassword").value = randomPassword();
    });

    document.querySelectorAll(".dept-subject-tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        setDeptSubjectTab(btn.dataset.subjectTab);
      });
    });
    $("coursePoolSelect")?.addEventListener("change", onCoursePoolSelectChange);
    $("deptPoolSubjectForm")?.addEventListener("submit", handleCreateDeptPoolSubject);

    $("editSubjectModalForm")?.addEventListener("submit", handleSaveEditSubjectModal);
    $("closeEditSubjectModalBtn")?.addEventListener("click", closeEditSubjectModal);
    $("cancelEditSubjectModalBtn")?.addEventListener("click", closeEditSubjectModal);
    $("editSubjectModal")?.addEventListener("click", (e) => {
      if (e.target === $("editSubjectModal")) closeEditSubjectModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeEditSubjectModal();
    });

    // Sections maintenance panel (Faculty view)
    $("addSectionBtn")?.addEventListener("click", () => addSection($("newSectionInput").value, $("newSectionInput")));

    // Inline "+ add new" section shortcuts — one inside the course-assignment
    // form, one inside the student-registration form, both backed by the
    // same sections list.
    wireSectionQuickAdd("courseSectionQuickAddBtn", "courseSectionQuickAddRow", "newCourseSectionQuickInput", "addCourseSectionQuickBtn", "courseSectionSelect");
    wireSectionQuickAdd("studentSectionQuickAddBtn", "studentSectionQuickAddRow", "newStudentSectionQuickInput", "addStudentSectionQuickBtn", "studentSectionSelect");

    // Dual option switching for Student Registration Credential
    $("dhTabBioSelectBtn")?.addEventListener("click", () => {
      $("dhStudentBioPanel")?.classList.remove("hidden");
      $("dhStudentQrPanel")?.classList.add("hidden");
      $("dhTabBioSelectBtn")?.classList.add("bg-[#14432A]", "text-white");
      $("dhTabBioSelectBtn")?.classList.remove("text-[#14432A]");
      $("dhTabQrSelectBtn")?.classList.remove("bg-[#14432A]", "text-white");
      $("dhTabQrSelectBtn")?.classList.add("text-[#14432A]");
    });

    $("dhTabQrSelectBtn")?.addEventListener("click", () => {
      $("dhStudentQrPanel")?.classList.remove("hidden");
      $("dhStudentBioPanel")?.classList.add("hidden");
      $("dhTabQrSelectBtn")?.classList.add("bg-[#14432A]", "text-white");
      $("dhTabQrSelectBtn")?.classList.remove("text-[#14432A]");
      $("dhTabBioSelectBtn")?.classList.remove("bg-[#14432A]", "text-white");
      $("dhTabBioSelectBtn")?.classList.add("text-[#14432A]");

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
        campus_name: profile?.campus_name || "Main Campus"
      };
      if (typeof QRClient !== "undefined") {
        const container = $("dhStudentRegQrContainer");
        if (container) {
          const payload = QRClient.getUserQrPayload(dummyStudent);
          container.innerHTML = QRClient.generateSvg(payload, { size: 84, margin: 1 });
        }
      }
    });

    $("dhStudentPreviewIdCardBtn")?.addEventListener("click", () => {
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
        campus_name: profile?.campus_name || "Main Campus"
      };
      if (typeof QRClient !== "undefined") {
        QRClient.openIdCardModal({ user: dummyStudent });
      }
    });

    $("dhStudentSampleIdsBtn")?.addEventListener("click", () => {
      if (typeof QRClient !== "undefined") {
        QRClient.openSampleSchoolIdModal("student");
      }
    });

    $("studentSectionSelect")?.addEventListener("change", (e) => {
      const secId = e.target.value;
      if (!secId) return;
      const sec = sections.find((s) => String(s.id) === String(secId));
      if (sec && sec.course_id && $("studentCourseSelect")) {
        $("studentCourseSelect").value = sec.course_id;
      }
    });

    enterApp();
  } catch (err) {
    fatalStartupError(`Unexpected error while starting the page: ${err.message || err}. Open the browser console (F12) for details.`);
  }
});