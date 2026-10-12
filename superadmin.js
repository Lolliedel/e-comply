// ============================================================================
//  Super Admin Panel — application logic
//  Talks to Supabase via the `sb` client created in supabaseClient.js
// ============================================================================

const DESIGNATIONS = ["Campus Administrator", "Dean", "Department Head", "Faculty", "Student", "Quality Assurance"];

const DEFAULT_CAMPUSES = [
  { id: "main", name: "Main Campus", code: "MAIN", location: "Borongan City" },
  { id: "guiuan", name: "Guiuan Campus", code: "GUIUAN", location: "Guiuan" },
  { id: "salcedo", name: "Salcedo Campus", code: "SALCEDO", location: "Salcedo" },
  { id: "canavid", name: "Can-avid Campus", code: "CAN-AVID", location: "Can-avid" },
  { id: "maydolong", name: "Maydolong Campus", code: "MAYDOLONG", location: "Maydolong" },
  { id: "arteche", name: "Arteche Campus", code: "ARTECHE", location: "Arteche" },
];

let campuses = [];       // [{id, name, code, location}]
let colleges = [];      // [{id, name}]
let departments = [];   // [{id, name, college_id}]
let academicCourses = []; // [{id, name, code, department_id}]
let sections = [];      // [{id, name, department_id, course_id}]
let users = [];         // rows from app_users_report
let students = [];      // rows from students_report
let activeRole = "Dean"; // active role tab
let editingUserId = null; // set while the form is in edit mode
let editingUserType = "user"; // "user" or "student"

const DEFAULT_ACADEMIC_COURSES = [
  { id: "bsit", name: "Bachelor of Science in Information Technology", code: "BSIT", department_name: "BSIT" },
  { id: "bscs", name: "Bachelor of Science in Computer Science", code: "BSCS", department_name: "BSIT" },
  { id: "blis", name: "Bachelor of Library and Information Science", code: "BLIS", department_name: "BSIT" },
  { id: "bsed", name: "Bachelor of Secondary Education", code: "BSED", department_name: "Teacher Education" },
  { id: "beed", name: "Bachelor of Elementary Education", code: "BEED", department_name: "Teacher Education" },
  { id: "bshm", name: "Bachelor of Science in Hospitality Management", code: "BSHM", department_name: "Hospitality Management" },
  { id: "bstm", name: "Bachelor of Science in Tourism Management", code: "BSTM", department_name: "Hospitality Management" },
  { id: "bsba", name: "Bachelor of Science in Business Administration", code: "BSBA", department_name: "Business Administration" },
  { id: "bsa", name: "Bachelor of Science in Accountancy", code: "BSA", department_name: "Business Administration" },
  { id: "bsce", name: "Bachelor of Science in Civil Engineering", code: "BSCE", department_name: "Engineering" },
  { id: "bscpe", name: "Bachelor of Science in Computer Engineering", code: "BSCpE", department_name: "Engineering" }
];

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
  const takenStaff = new Set(users.map((u) => u.username));
  const takenStudents = new Set(students.map((s) => s.username));
  while (takenStaff.has(candidate) || takenStudents.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix++;
  }
  return candidate;
}

// ── Role Tab Switcher ───────────────────────────────────────────────────

function setActiveRole(role) {
  activeRole = role;

  document.querySelectorAll(".create-role-tab-btn").forEach((btn) => {
    const isActive = btn.dataset.roleTab === role;
    btn.classList.toggle("active", isActive);
    btn.classList.toggle("border-[#14432A]", isActive);
    btn.classList.toggle("text-[#14432A]", isActive);
    btn.classList.toggle("bg-[#14432A]/10", isActive);
    btn.classList.toggle("border-transparent", !isActive);
    btn.classList.toggle("text-[#6B7060]", !isActive);
  });

  const subtitle = $("createUserSubtitle");
  const deptLabel = $("departmentLabel");
  const courseContainer = $("courseSelectContainer");
  const secContainer = $("sectionSelectContainer");
  const affiliateContainer = $("affiliateCheckboxContainer");
  const tempPasswordHint = $("tempPasswordHint");

  if (subtitle) {
    if (role === "Campus Administrator") subtitle.textContent = "Register a Campus Administrator with administrative oversight scoped to a specific Campus.";
    else if (role === "Quality Assurance") subtitle.textContent = "Register a Quality Assurance officer to audit completed compliance documents across Campuses.";
    else if (role === "Dean") subtitle.textContent = "Register a Dean and dynamically assign College & Departments.";
    else if (role === "Department Head") subtitle.textContent = "Register a Department Head assigned to a College and Department.";
    else if (role === "Faculty") subtitle.textContent = "Register a Faculty account assigned to a College and Department.";
    else if (role === "Student") subtitle.textContent = "Register a Student account assigned to a College, Department, Course, and Section.";
  }

  if (deptLabel) {
    deptLabel.textContent = role === "Dean" ? "Primary Department (Optional)" : "Department";
  }

  if (courseContainer) {
    courseContainer.classList.toggle("hidden", role !== "Student");
  }

  if (secContainer) {
    secContainer.classList.toggle("hidden", role !== "Student");
  }

  if (affiliateContainer) {
    affiliateContainer.classList.toggle("hidden", role !== "Faculty");
  }

  const colContainer = $("collegeSelectContainer");
  const deptContainer = $("departmentSelectContainer");
  const isGlobalRole = ["Campus Administrator", "Quality Assurance"].includes(role);
  if (colContainer) colContainer.classList.toggle("hidden", isGlobalRole);
  if (deptContainer) deptContainer.classList.toggle("hidden", isGlobalRole);

  const empIdLabel = $("employeeIdLabel");
  if (empIdLabel) {
    empIdLabel.textContent = role === "Student" ? "Student ID Number" : "Employee ID Number";
  }

  const affCollegeContainer = $("affiliatedCollegeContainer");
  if (affCollegeContainer) {
    affCollegeContainer.classList.toggle("hidden", !["Faculty", "Department Head"].includes(role));
  }

  if (tempPasswordHint) {
    tempPasswordHint.textContent = role === "Student" 
      ? "Optional — fill in username & password if issuing student portal login access."
      : "The user must set their own password on first login.";
  }

  onCollegeChange();
  updateCredentialPreview();
}

// ── Cascading Dropdowns (College -> Department -> Course -> Section) ──

function onCollegeChange() {
  const selectedCollegeId = $("collegeSelect")?.value || "";
  const deptSelect = $("departmentSelect");
  if (!deptSelect) return;

  const currentDeptVal = deptSelect.value;
  // If a college is selected, include departments belonging to that college OR departments with no college set yet
  // If no college is selected, show ALL departments so dropdown is never empty/blocked
  const filteredDepts = selectedCollegeId
    ? departments.filter((d) => !d.college_id || String(d.college_id) === String(selectedCollegeId))
    : departments;

  deptSelect.innerHTML = filteredDepts.length > 0
    ? `<option value="">${selectedCollegeId ? "Select department…" : "Select department (or choose college above)…"}</option>` +
      filteredDepts.map((d) => `<option value="${d.id}">${d.name}${!d.college_id ? " (Unassigned)" : ""}</option>`).join("")
    : `<option value="">No departments found (+ add new)</option>`;

  if (filteredDepts.some((d) => String(d.id) === String(currentDeptVal))) {
    deptSelect.value = currentDeptVal;
  } else {
    deptSelect.value = "";
  }

  onDepartmentChange();
  renderAffiliatedCollegesList();
  updateCredentialPreview();
}

function onDepartmentChange() {
  const selectedDeptId = $("departmentSelect")?.value || "";
  const collegeSelect = $("collegeSelect");

  // Reverse auto-selection: if selected department is linked to a college, select that college automatically if not set
  if (selectedDeptId && collegeSelect) {
    const deptObj = departments.find((d) => String(d.id) === String(selectedDeptId));
    if (deptObj && deptObj.college_id && String(collegeSelect.value) !== String(deptObj.college_id)) {
      collegeSelect.value = deptObj.college_id;
    }
  }

  const courseSelect = $("courseSelect");
  if (courseSelect) {
    const currentCourseVal = courseSelect.value;
    const filteredCourses = selectedDeptId
      ? academicCourses.filter((c) => !c.department_id || String(c.department_id) === String(selectedDeptId))
      : academicCourses;

    courseSelect.innerHTML = filteredCourses.length > 0
      ? `<option value="">${selectedDeptId ? "Select course (degree program)…" : "Select course (or choose department above)…"}</option>` +
        filteredCourses.map((c) => `<option value="${c.id}">${c.code ? `[${c.code}] ` : ""}${c.name}</option>`).join("")
      : `<option value="">No courses found (+ add new)</option>`;

    if (filteredCourses.some((c) => String(c.id) === String(currentCourseVal))) {
      courseSelect.value = currentCourseVal;
    } else {
      courseSelect.value = "";
    }
  }

  onCourseChange();
}

function onCourseChange() {
  const selectedCourseId = $("courseSelect")?.value || "";
  const selectedDeptId = $("departmentSelect")?.value || "";

  // If selected course is linked to a department, auto-select that department if not set
  if (selectedCourseId) {
    const cObj = academicCourses.find((c) => String(c.id) === String(selectedCourseId));
    if (cObj && cObj.department_id && String($("departmentSelect")?.value) !== String(cObj.department_id)) {
      if ($("departmentSelect")) {
        $("departmentSelect").value = cObj.department_id;
      }
    }
  }

  const secSelect = $("sectionSelect");
  if (!secSelect) return;

  const currentSecVal = secSelect.value;
  let filteredSections = sections;
  if (selectedCourseId) {
    const courseSecs = sections.filter((s) => String(s.course_id) === String(selectedCourseId));
    if (courseSecs.length > 0) {
      filteredSections = courseSecs;
    } else if (selectedDeptId) {
      filteredSections = sections.filter((s) => !s.department_id || String(s.department_id) === String(selectedDeptId));
    }
  } else if (selectedDeptId) {
    filteredSections = sections.filter((s) => !s.department_id || String(s.department_id) === String(selectedDeptId));
  }

  secSelect.innerHTML = filteredSections.length > 0
    ? `<option value="">${selectedCourseId ? "Select section…" : "Select section (or choose course above)…"}</option>` +
      filteredSections.map((s) => `<option value="${s.id}">${s.name}</option>`).join("")
    : `<option value="">No sections found (+ add new)</option>`;

  if (filteredSections.some((s) => String(s.id) === String(currentSecVal))) {
    secSelect.value = currentSecVal;
  } else {
    secSelect.value = "";
  }

  updateCredentialPreview();
}

function onSectionChange() {
  const selectedSecId = $("sectionSelect")?.value || "";
  const deptSelect = $("departmentSelect");
  const courseSelect = $("courseSelect");

  // Reverse auto-selection: if selected section is linked to a department or course, select them
  if (selectedSecId) {
    const secObj = sections.find((s) => String(s.id) === String(selectedSecId));
    if (secObj) {
      if (secObj.course_id && courseSelect && String(courseSelect.value) !== String(secObj.course_id)) {
        courseSelect.value = secObj.course_id;
      }
      if (secObj.department_id && deptSelect && String(deptSelect.value) !== String(secObj.department_id)) {
        deptSelect.value = secObj.department_id;
        onDepartmentChange();
      }
    }
  }

  updateCredentialPreview();
}

// ── View switching ──────────────────────────────────────────────────────

function showView(view) {
  ["home", "maintenance", "forms", "create", "reports", "subjects"].forEach((v) => {
    $(`view-${v}`)?.classList.toggle("hidden", v !== view);
  });
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  if (view === "home") renderHome();
  if (view === "maintenance") renderMaintenance();
  if (view === "forms") renderFormsOverview();
  if (view === "reports") renderReports();
  if (view === "subjects") renderSuperSubjects();
}

async function loadCampuses() {
  try {
    const { data, error } = await sb.from("campuses").select("*").order("name");
    if (!error && data && data.length > 0) {
      campuses = data;
      populateSelect($("campusSelect"), campuses, "Select campus…");
      return;
    }
  } catch (err) {
    console.warn("Using local fallback campuses list:", err);
  }
  const local = localStorage.getItem("ecomply_campuses");
  if (local) {
    try {
      campuses = JSON.parse(local);
      populateSelect($("campusSelect"), campuses, "Select campus…");
      return;
    } catch {}
  }
  campuses = [...DEFAULT_CAMPUSES];
  localStorage.setItem("ecomply_campuses", JSON.stringify(campuses));
  populateSelect($("campusSelect"), campuses, "Select campus…");
}

function renderCampusChips() {
  renderChipList("campusChips", campuses, "campuses");
}

function saveLocalCampusMapping(id, type, campusId, campusName) {
  if (!id) return;
  try {
    const key = `ecomply_user_campus_map`;
    const map = JSON.parse(localStorage.getItem(key) || "{}");
    map[`${type}_${id}`] = { campus_id: campusId, campus_name: campusName };
    localStorage.setItem(key, JSON.stringify(map));
  } catch (err) {}
}

function getUserCampusMapping(id, type) {
  if (!id) return null;
  try {
    const key = `ecomply_user_campus_map`;
    const map = JSON.parse(localStorage.getItem(key) || "{}");
    return map[`${type}_${id}`] || null;
  } catch (err) {
    return null;
  }
}

function saveLocalRoleMapping(id, role) {
  if (!id || !role) return;
  try {
    const key = `ecomply_user_role_map`;
    const map = JSON.parse(localStorage.getItem(key) || "{}");
    map[String(id)] = role;
    localStorage.setItem(key, JSON.stringify(map));
  } catch (err) {}
}

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

function saveLocalEmployeeIdMapping(id, empId) {
  if (!id) return;
  try {
    const key = `ecomply_user_empid_map`;
    const map = JSON.parse(localStorage.getItem(key) || "{}");
    map[String(id)] = empId || "";
    localStorage.setItem(key, JSON.stringify(map));
  } catch (err) {}
}

function getUserEmployeeIdMapping(id) {
  if (!id) return "";
  try {
    const key = `ecomply_user_empid_map`;
    const map = JSON.parse(localStorage.getItem(key) || "{}");
    return map[String(id)] || "";
  } catch (err) {
    return "";
  }
}

function saveLocalAffiliatedCollegesMapping(id, collegeIdsArray) {
  if (!id) return;
  try {
    const key = `ecomply_user_aff_colleges_map`;
    const map = JSON.parse(localStorage.getItem(key) || "{}");
    map[String(id)] = collegeIdsArray || [];
    localStorage.setItem(key, JSON.stringify(map));
  } catch (err) {}
}

function getUserAffiliatedCollegesMapping(id) {
  if (!id) return [];
  try {
    const key = `ecomply_user_aff_colleges_map`;
    const map = JSON.parse(localStorage.getItem(key) || "{}");
    return map[String(id)] || [];
  } catch (err) {
    return [];
  }
}

function saveLocalCourseMapping(id, courseId, courseName, courseCode) {
  if (!id) return;
  try {
    const key = `ecomply_user_course_map`;
    const map = JSON.parse(localStorage.getItem(key) || "{}");
    map[String(id)] = { course_id: courseId, course_name: courseName || "", course_code: courseCode || "" };
    localStorage.setItem(key, JSON.stringify(map));
  } catch (err) {}
}

function getUserCourseMapping(id) {
  if (!id) return null;
  try {
    const key = `ecomply_user_course_map`;
    const map = JSON.parse(localStorage.getItem(key) || "{}");
    return map[String(id)] || null;
  } catch (err) {
    return null;
  }
}

function renderAffiliatedCollegesList(selectedCollegeIds = null) {
  const container = $("affiliatedCollegesList");
  if (!container) return;
  const primaryColId = $("collegeSelect")?.value;
  const availableColleges = colleges.filter((c) => String(c.id) !== String(primaryColId));

  let checkedIds = selectedCollegeIds;
  if (!checkedIds) {
    checkedIds = getSelectedAffiliatedColleges();
  }

  if (availableColleges.length === 0) {
    container.innerHTML = `<span class="text-xs text-[#6B7060]">No other colleges available for affiliation.</span>`;
    return;
  }

  container.innerHTML = availableColleges.map((c) => {
    const isChecked = checkedIds.map(String).includes(String(c.id));
    return `
      <label class="flex items-center gap-2 text-xs text-[#14432A] cursor-pointer hover:bg-[#FAF7EF] p-1.5 rounded transition">
        <input type="checkbox" name="affiliated_colleges" value="${c.id}" ${isChecked ? "checked" : ""} class="rounded border-[#DEDACE] text-[#14432A] focus:ring-[#D9A62C]">
        <span class="font-medium">${c.name}</span>
      </label>
    `;
  }).join("");
}

function getSelectedAffiliatedColleges() {
  const checkboxes = document.querySelectorAll('input[name="affiliated_colleges"]:checked');
  return Array.from(checkboxes).map((cb) => cb.value);
}

async function loadColleges() {
  const { data, error } = await sb.from("colleges").select("*").order("name");
  if (error) { console.error(error); showToast("Couldn't load colleges.", true); return; }
  colleges = data || [];
}

async function loadDepartments() {
  const { data, error } = await sb.from("departments").select("*").order("name");
  if (error) { console.error(error); showToast("Couldn't load departments.", true); return; }
  departments = data || [];
}

async function loadAcademicCourses() {
  try {
    const { data, error } = await sb.from("academic_courses").select("*").order("name");
    if (!error && data && data.length > 0) {
      academicCourses = data;
      return;
    }
  } catch (err) {
    console.warn("Using local fallback academic courses list:", err);
  }

  const local = localStorage.getItem("ecomply_academic_courses");
  if (local) {
    try {
      academicCourses = JSON.parse(local);
      return;
    } catch {}
  }

  // Seed defaults linked to existing departments where possible
  academicCourses = DEFAULT_ACADEMIC_COURSES.map((def, idx) => {
    const matchedDept = departments.find((d) => d.name.toLowerCase().includes(def.department_name.toLowerCase()));
    return {
      id: def.id || (1000 + idx),
      name: def.name,
      code: def.code,
      department_id: matchedDept ? matchedDept.id : null
    };
  });
  localStorage.setItem("ecomply_academic_courses", JSON.stringify(academicCourses));
}

async function loadSections() {
  const { data, error } = await sb.from("sections").select("*").order("name");
  if (error) { console.error(error); showToast("Couldn't load sections.", true); return; }
  sections = data || [];
}

async function loadUsers() {
  const { data, error } = await sb.from("app_users_report").select("*").order("created_at", { ascending: false });
  if (error) { console.error(error); showToast("Couldn't load users.", true); return; }
  users = (data || []).map((u) => {
    const campusMapped = getUserCampusMapping(u.id, "user");
    const roleMapped = getUserRoleMapping(u.id);
    const empIdMapped = getUserEmployeeIdMapping(u.id);
    return {
      ...u,
      employee_id: u.employee_id || u.employee_no || empIdMapped || `EMP-${String(u.id).padStart(4, '0')}`,
      designation: roleMapped || u.designation,
      campus_id: u.campus_id || campusMapped?.campus_id || null,
      campus_name: u.campus_name || campusMapped?.campus_name || "Main Campus"
    };
  });
}

async function loadStudents() {
  const { data, error } = await sb.from("students_report").select("*").order("created_at", { ascending: false });
  if (error) { console.error(error); return; }
  students = (data || []).map((s) => {
    const mapped = getUserCampusMapping(s.id, "student");
    const empIdMapped = getUserEmployeeIdMapping(s.id);
    const courseMapped = getUserCourseMapping(s.id);
    const courseObj = academicCourses.find((c) => String(c.id) === String(s.course_id || courseMapped?.course_id));
    return {
      ...s,
      employee_id: s.employee_id || s.student_no || empIdMapped || `STD-${String(s.id).padStart(4, '0')}`,
      campus_id: s.campus_id || mapped?.campus_id || null,
      campus_name: s.campus_name || mapped?.campus_name || "Main Campus",
      course_id: s.course_id || courseMapped?.course_id || null,
      course_name: s.course_name || courseObj?.name || courseMapped?.course_name || "",
      course_code: s.course_code || courseObj?.code || courseMapped?.course_code || ""
    };
  });
}

async function refreshAll() {
  await Promise.all([loadCampuses(), loadColleges(), loadDepartments(), loadAcademicCourses(), loadSections(), loadUsers(), loadStudents(), loadMasterSubjects()]);
  populateSelect($("campusSelect"), campuses, "Select campus…");
  populateSelect($("collegeSelect"), colleges);
  populateSelect($("affiliatedCollegeSelect"), colleges, "None (Primary college only)");
  populateSelect($("superCollegeAddSelect"), colleges, "Select college…");
  if ($("superCollegeFilter")) {
    $("superCollegeFilter").innerHTML = `<option value="All">All Colleges</option>` +
      colleges.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");
  }
  if ($("superCourseDeptFilter")) {
    $("superCourseDeptFilter").innerHTML = `<option value="All">All Departments</option>` +
      departments.map((d) => `<option value="${d.id}">${d.name}</option>`).join("");
  }
  if ($("superSectionDeptFilter")) {
    $("superSectionDeptFilter").innerHTML = `<option value="All">All Departments</option>` +
      departments.map((d) => `<option value="${d.id}">${d.name}</option>`).join("");
  }
  if ($("superSectionCourseFilter")) {
    $("superSectionCourseFilter").innerHTML = `<option value="All">All Courses</option>` +
      academicCourses.map((c) => `<option value="${c.id}">${c.code ? `[${c.code}] ` : ""}${c.name}</option>`).join("");
  }
  if ($("filterCampus")) {
    $("filterCampus").innerHTML = `<option value="All">All campuses</option>` +
      campuses.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");
  }
  onCollegeChange();
  const activeView = document.querySelector(".nav-btn.active")?.dataset.view || "home";
  showView(activeView);
}

function populateSelect(select, items, defaultLabel = "Select…") {
  if (!select) return;
  const current = select.value;
  select.innerHTML =
    `<option value="">${defaultLabel}</option>` +
    items.map((i) => `<option value="${i.id}">${i.name}</option>`).join("");
  if (items.some((i) => String(i.id) === String(current))) select.value = current;
}

// ── Home ────────────────────────────────────────────────────────────────

function renderHome() {
  const totalAccounts = users.length + students.length;
  $("statTotal").textContent = totalAccounts;
  $("statColleges").textContent = colleges.length;
  $("statDepartments").textContent = departments.length;
  $("statPending").textContent = users.filter((u) => u.must_change_password).length + students.filter((s) => s.must_change_password).length;

  const deans = users.filter((u) => u.designation === "Dean").length;
  const deptHeads = users.filter((u) => u.designation === "Department Head").length;
  const faculty = users.filter((u) => u.designation === "Faculty").length;

  if ($("statDesig0")) $("statDesig0").textContent = deans;
  if ($("statDesig1")) $("statDesig1").textContent = deptHeads;
  if ($("statDesig2")) $("statDesig2").textContent = faculty;

  const combined = [
    ...users.map((u) => ({ ...u, account_type: "user" })),
    ...students.map((s) => ({ ...s, designation: "Student", account_type: "student" })),
  ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const recent = combined.slice(0, 5);
  $("recentList").innerHTML =
    recent.length === 0
      ? `<div class="text-center py-5 text-[#6B7060] text-sm">No accounts yet. Create the first one from Create User.</div>`
      : recent.map((u) => `
        <div class="flex items-center gap-3 py-2.5">
          <div class="w-8 h-8 rounded-full text-white text-xs font-bold font-display flex items-center justify-center shrink-0 bg-[#1F6F4A]">${initials(u.first_name, u.last_name)}</div>
          <div class="flex-1">
            <div class="text-sm font-semibold">${formatName(u)}</div>
            <div class="font-mono text-xs text-[#6B7060]">${u.username ? "@" + u.username : "No portal account"}</div>
          </div>
          <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#FBF3D9] text-[#8A6A0C]">${u.designation}</span>
        </div>
      `).join("");
}

// ── Maintenance Tabbed Views & Modal Controllers ────────────────────────

let activeMaintenanceTab = "campuses";

function setMaintenanceTab(tab) {
  activeMaintenanceTab = tab;
  document.querySelectorAll(".maint-tab-btn").forEach((btn) => {
    const isActive = btn.dataset.maintTab === tab;
    btn.classList.toggle("active", isActive);
    btn.classList.toggle("border-[#14432A]", isActive);
    btn.classList.toggle("text-[#14432A]", isActive);
    btn.classList.toggle("bg-[#14432A]/10", isActive);
    btn.classList.toggle("border-transparent", !isActive);
    btn.classList.toggle("text-[#6B7060]", !isActive);
  });

  ["campuses", "colleges", "departments", "academic-courses", "sections"].forEach((t) => {
    $(`maintTab-${t}`)?.classList.toggle("hidden", t !== tab);
  });
}

async function addCampus() {
  const nameInput = $("newCampusInput");
  const codeInput = $("newCampusCodeInput");
  const locInput = $("newCampusLocationInput");

  const name = nameInput?.value.trim();
  const code = codeInput?.value.trim().toUpperCase() || (name ? name.toUpperCase().replace(/\s+/g, "_") : "");
  const location = locInput?.value.trim() || "";

  if (!name) { showToast("Enter a campus name.", true); return; }

  const newObj = { id: Date.now(), name: name, code: code, location: location };

  try {
    const { data, error } = await sb.from("campuses").insert([{ name: name, code: code, location: location }]).select();
    if (!error && data && data.length > 0) {
      campuses.push(data[0]);
    } else {
      campuses.push(newObj);
      localStorage.setItem("ecomply_campuses", JSON.stringify(campuses));
    }
  } catch (err) {
    campuses.push(newObj);
    localStorage.setItem("ecomply_campuses", JSON.stringify(campuses));
  }

  if (nameInput) nameInput.value = "";
  if (codeInput) codeInput.value = "";
  if (locInput) locInput.value = "";

  showToast(`Added campus "${name}".`);
  await refreshAll();
}

async function deleteCampusItem(id) {
  const target = campuses.find((c) => String(c.id) === String(id));
  if (!target) return;
  if (!confirm(`Delete campus "${target.name}"?`)) return;
  try {
    await sb.from("campuses").delete().eq("id", id);
  } catch (err) { console.warn("Supabase campus delete fallback:", err); }
  campuses = campuses.filter((c) => String(c.id) !== String(id));
  localStorage.setItem("ecomply_campuses", JSON.stringify(campuses));
  showToast(`Deleted campus "${target.name}".`);
  await refreshAll();
}

// Campus Edit Modal Controllers
function openEditCampusModal(id) {
  const c = campuses.find((x) => String(x.id) === String(id));
  if (!c) return;

  if ($("editCampusId")) $("editCampusId").value = c.id;
  if ($("editCampusNameInput")) $("editCampusNameInput").value = c.name || "";
  if ($("editCampusCodeInput")) $("editCampusCodeInput").value = c.code || "";
  if ($("editCampusLocationInput")) $("editCampusLocationInput").value = c.location || "";

  $("editCampusModal")?.classList.remove("hidden");
}

function closeEditCampusModal() {
  $("editCampusModal")?.classList.add("hidden");
}

async function handleSaveEditCampusModal(ev) {
  ev.preventDefault();
  const id = $("editCampusId")?.value;
  const newName = $("editCampusNameInput")?.value.trim();
  const newCode = $("editCampusCodeInput")?.value.trim().toUpperCase() || null;
  const newLocation = $("editCampusLocationInput")?.value.trim() || null;

  if (!newName) {
    showToast("Campus name is required.", true);
    return;
  }

  const btn = $("saveEditCampusBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  try {
    const { error } = await sb.from("campuses").update({
      name: newName,
      code: newCode,
      location: newLocation
    }).eq("id", id);

    if (error) console.warn("Supabase campus update warning:", error);

    const c = campuses.find((x) => String(x.id) === String(id));
    if (c) {
      c.name = newName;
      if (newCode) c.code = newCode;
      if (newLocation) c.location = newLocation;
    }
    localStorage.setItem("ecomply_campuses", JSON.stringify(campuses));

    closeEditCampusModal();
    populateSelect($("campusSelect"), campuses, "Select campus…");
    renderMaintenance();
    showToast(`Campus "${newName}" updated successfully.`);
  } catch (err) {
    console.error("Failed to edit campus:", err);
    showToast(`Couldn't update campus: ${err.message || err}`, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save changes"; }
  }
}

// College Edit Modal Controllers
function openEditCollegeModal(id) {
  const col = colleges.find((x) => String(x.id) === String(id));
  if (!col) return;

  if ($("editCollegeId")) $("editCollegeId").value = col.id;
  if ($("editCollegeNameInput")) $("editCollegeNameInput").value = col.name || "";

  $("editCollegeModal")?.classList.remove("hidden");
}

function closeEditCollegeModal() {
  $("editCollegeModal")?.classList.add("hidden");
}

async function handleSaveEditCollegeModal(ev) {
  ev.preventDefault();
  const id = $("editCollegeId")?.value;
  const newName = $("editCollegeNameInput")?.value.trim();

  if (!newName) {
    showToast("College name is required.", true);
    return;
  }

  const btn = $("saveEditCollegeBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  try {
    const { error } = await sb.from("colleges").update({ name: newName }).eq("id", id);
    if (error) throw error;

    await loadColleges();
    populateSelect($("collegeSelect"), colleges);
    onCollegeChange();
    closeEditCollegeModal();
    renderMaintenance();
    showToast(`College "${newName}" updated successfully.`);
  } catch (err) {
    console.error("Failed to edit college:", err);
    showToast(`Couldn't update college: ${err.message || err}`, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save changes"; }
  }
}

// Department Edit Modal Controllers
function openEditDepartmentModal(id) {
  const d = departments.find((x) => String(x.id) === String(id));
  if (!d) return;

  if ($("editDepartmentId")) $("editDepartmentId").value = d.id;
  if ($("editDepartmentNameInput")) $("editDepartmentNameInput").value = d.name || "";

  const colSelect = $("editDepartmentCollegeSelect");
  if (colSelect) {
    colSelect.innerHTML = `<option value="">No college assigned</option>` +
      colleges.map((c) => `<option value="${c.id}" ${String(c.id) === String(d.college_id) ? "selected" : ""}>${c.name}</option>`).join("");
  }

  $("editDepartmentModal")?.classList.remove("hidden");
}

function closeEditDepartmentModal() {
  $("editDepartmentModal")?.classList.add("hidden");
}

async function handleSaveEditDepartmentModal(ev) {
  ev.preventDefault();
  const id = $("editDepartmentId")?.value;
  const newName = $("editDepartmentNameInput")?.value.trim();
  const newCollegeId = $("editDepartmentCollegeSelect")?.value || null;

  if (!newName) {
    showToast("Department name is required.", true);
    return;
  }

  const btn = $("saveEditDepartmentBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  try {
    const { error } = await sb.from("departments").update({
      name: newName,
      college_id: newCollegeId
    }).eq("id", id);

    if (error) throw error;

    await loadDepartments();
    onDepartmentChange();
    closeEditDepartmentModal();
    renderMaintenance();
    showToast(`Department "${newName}" updated successfully.`);
  } catch (err) {
    console.error("Failed to edit department:", err);
    showToast(`Couldn't update department: ${err.message || err}`, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save changes"; }
  }
}

// Academic Course (Degree Program) Edit Modal Controllers
function openEditAcademicCourseModal(id) {
  const c = academicCourses.find((x) => String(x.id) === String(id));
  if (!c) return;

  if ($("editAcademicCourseId")) $("editAcademicCourseId").value = c.id;
  if ($("editAcademicCourseNameInput")) $("editAcademicCourseNameInput").value = c.name || "";
  if ($("editAcademicCourseCodeInput")) $("editAcademicCourseCodeInput").value = c.code || "";

  const deptSelect = $("editAcademicCourseDeptSelect");
  if (deptSelect) {
    deptSelect.innerHTML = `<option value="">No department assigned</option>` +
      departments.map((d) => `<option value="${d.id}" ${String(d.id) === String(c.department_id) ? "selected" : ""}>${d.name}</option>`).join("");
  }

  $("editAcademicCourseModal")?.classList.remove("hidden");
}

function closeEditAcademicCourseModal() {
  $("editAcademicCourseModal")?.classList.add("hidden");
}

async function handleSaveEditAcademicCourseModal(ev) {
  ev.preventDefault();
  const id = $("editAcademicCourseId")?.value;
  const newName = $("editAcademicCourseNameInput")?.value.trim();
  const newCode = $("editAcademicCourseCodeInput")?.value.trim().toUpperCase() || "";
  const newDeptId = $("editAcademicCourseDeptSelect")?.value || null;

  if (!newName) {
    showToast("Course name is required.", true);
    return;
  }

  const btn = $("saveEditAcademicCourseBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  try {
    try {
      await sb.from("academic_courses").update({
        name: newName,
        code: newCode,
        department_id: newDeptId
      }).eq("id", id);
    } catch (sbErr) {
      console.warn("Supabase academic_courses update fallback:", sbErr);
    }

    const c = academicCourses.find((x) => String(x.id) === String(id));
    if (c) {
      c.name = newName;
      c.code = newCode;
      c.department_id = newDeptId;
    }
    localStorage.setItem("ecomply_academic_courses", JSON.stringify(academicCourses));

    closeEditAcademicCourseModal();
    onDepartmentChange();
    renderMaintenance();
    showToast(`Course "${newName}" updated successfully.`);
  } catch (err) {
    console.error("Failed to edit course:", err);
    showToast(`Couldn't update course: ${err.message || err}`, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save changes"; }
  }
}

async function addAcademicCourse() {
  const deptSelect = $("newCourseDepartmentSelect");
  const nameInput = $("newCourseNameInput");
  const codeInput = $("newCourseCodeInput");

  const deptId = deptSelect?.value || null;
  const name = nameInput?.value.trim();
  const code = codeInput?.value.trim().toUpperCase() || (name ? name.substring(0, 5).toUpperCase() : "");

  if (!deptId) { showToast("Please select a target department.", true); return; }
  if (!name) { showToast("Enter a course name.", true); return; }

  const newObj = { id: Date.now(), name: name, code: code, department_id: deptId };

  try {
    const { data, error } = await sb.from("academic_courses").insert([{ name: name, code: code, department_id: deptId }]).select();
    if (!error && data && data.length > 0) {
      academicCourses.push(data[0]);
    } else {
      academicCourses.push(newObj);
      localStorage.setItem("ecomply_academic_courses", JSON.stringify(academicCourses));
    }
  } catch (err) {
    academicCourses.push(newObj);
    localStorage.setItem("ecomply_academic_courses", JSON.stringify(academicCourses));
  }

  if (nameInput) nameInput.value = "";
  if (codeInput) codeInput.value = "";
  if (deptSelect) deptSelect.value = "";

  showToast(`Added course "${name}" (${code}).`);
  onDepartmentChange();
  renderMaintenance();
}

async function deleteAcademicCourseItem(id) {
  const target = academicCourses.find((c) => String(c.id) === String(id));
  if (!target) return;
  if (!confirm(`Delete degree course "${target.name}"?`)) return;

  try {
    await sb.from("academic_courses").delete().eq("id", id);
  } catch (err) { console.warn("Supabase course delete fallback:", err); }

  academicCourses = academicCourses.filter((c) => String(c.id) !== String(id));
  localStorage.setItem("ecomply_academic_courses", JSON.stringify(academicCourses));
  showToast(`Deleted course "${target.name}".`);
  onDepartmentChange();
  renderMaintenance();
}

// Section Edit Modal Controllers
function openEditSectionModal(id) {
  const s = sections.find((x) => String(x.id) === String(id));
  if (!s) return;

  if ($("editSectionId")) $("editSectionId").value = s.id || "";
  if ($("editSectionNameInput")) $("editSectionNameInput").value = s.name || "";

  const deptSelect = $("editSectionDeptSelect");
  if (deptSelect) {
    deptSelect.innerHTML = `<option value="">No department assigned</option>` +
      departments.map((d) => `<option value="${d.id}" ${String(d.id) === String(s.department_id) ? "selected" : ""}>${d.name}</option>`).join("");
  }

  const courseSelect = $("editSectionCourseSelect");
  if (courseSelect) {
    const candidateCourses = s.department_id
      ? academicCourses.filter((c) => !c.department_id || String(c.department_id) === String(s.department_id))
      : academicCourses;
    courseSelect.innerHTML = `<option value="">No degree course assigned</option>` +
      candidateCourses.map((c) => `<option value="${c.id}" ${String(c.id) === String(s.course_id) ? "selected" : ""}>${c.code ? `[${c.code}] ` : ""}${c.name}</option>`).join("");
  }

  $("editSectionModal")?.classList.remove("hidden");
}

function closeEditSectionModal() {
  $("editSectionModal")?.classList.add("hidden");
}

async function handleSaveEditSectionModal(ev) {
  ev.preventDefault();
  const id = $("editSectionId")?.value;
  const newName = $("editSectionNameInput")?.value.trim();
  const newDeptId = $("editSectionDeptSelect")?.value || null;
  const newCourseId = $("editSectionCourseSelect")?.value || null;

  if (!newName) {
    showToast("Section name is required.", true);
    return;
  }

  const btn = $("saveEditSectionBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  try {
    try {
      const { error } = await sb.from("sections").update({
        name: newName,
        department_id: newDeptId,
        course_id: newCourseId
      }).eq("id", id);
      if (error) throw error;
    } catch (sbErr) {
      await sb.from("sections").update({
        name: newName,
        department_id: newDeptId
      }).eq("id", id);
    }

    const targetSec = sections.find((x) => String(x.id) === String(id));
    if (targetSec) {
      targetSec.name = newName;
      targetSec.department_id = newDeptId;
      targetSec.course_id = newCourseId;
    }

    closeEditSectionModal();
    await loadSections();
    renderMaintenance();
    showToast(`Section "${newName}" updated successfully.`);
  } catch (err) {
    console.error("Failed to edit section:", err);
    showToast(`Couldn't update section: ${err.message || err}`, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save changes"; }
  }
}

function renderMaintenance() {
  if ($("countCampuses")) $("countCampuses").textContent = campuses.length;
  if ($("countColleges")) $("countColleges").textContent = colleges.length;
  if ($("countDepartments")) $("countDepartments").textContent = departments.length;
  if ($("countAcademicCourses")) $("countAcademicCourses").textContent = academicCourses.length;
  if ($("countSections")) $("countSections").textContent = sections.length;

  renderCampusList();
  renderCollegeList();
  renderDepartmentChips();
  renderAcademicCourseList();
  renderSuperadminSectionChips();

  const newDeptCollege = $("newDepartmentCollegeSelect");
  if (newDeptCollege) {
    const current = newDeptCollege.value;
    newDeptCollege.innerHTML = `<option value="">Select College…</option>` +
      colleges.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
    if (colleges.some((c) => String(c.id) === String(current))) newDeptCollege.value = current;
  }

  const newCourseDept = $("newCourseDepartmentSelect");
  if (newCourseDept) {
    const current = newCourseDept.value;
    newCourseDept.innerHTML = `<option value="">Select Department…</option>` +
      departments.map((d) => `<option value="${d.id}">${d.name}</option>`).join("");
    if (departments.some((d) => String(d.id) === String(current))) newCourseDept.value = current;
  }

  const newSecDept = $("newSectionDepartmentSelect");
  if (newSecDept) {
    const current = newSecDept.value;
    newSecDept.innerHTML = `<option value="">Select Department…</option>` +
      departments.map((d) => `<option value="${d.id}">${d.name}</option>`).join("");
    if (departments.some((d) => String(d.id) === String(current))) newSecDept.value = current;
  }

  updateNewSectionCourseDropdown();
}

function updateNewSectionCourseDropdown() {
  const deptId = $("newSectionDepartmentSelect")?.value;
  const courseSelect = $("newSectionCourseSelect");
  if (!courseSelect) return;

  const currentVal = courseSelect.value;
  const filtered = deptId
    ? academicCourses.filter((c) => !c.department_id || String(c.department_id) === String(deptId))
    : academicCourses;

  courseSelect.innerHTML = `<option value="">Select Course (optional)…</option>` +
    filtered.map((c) => `<option value="${c.id}">${c.code ? `[${c.code}] ` : ""}${c.name}</option>`).join("");

  if (filtered.some((c) => String(c.id) === String(currentVal))) {
    courseSelect.value = currentVal;
  } else {
    courseSelect.value = "";
  }
}

function renderCampusChips() {
  renderCampusList();
}

function renderCampusList() {
  const el = $("campusChips");
  if (!el) return;

  const search = $("superCampusSearchInput")?.value.trim().toLowerCase() || "";
  const filtered = campuses.filter((c) => {
    if (!search) return true;
    return (c.name || "").toLowerCase().includes(search) ||
           (c.code || "").toLowerCase().includes(search) ||
           (c.location || "").toLowerCase().includes(search);
  });

  if ($("campusFoundCount")) {
    $("campusFoundCount").textContent = `${filtered.length} of ${campuses.length} campuses`;
  }

  el.innerHTML = filtered.length
    ? filtered.map((c) => `
        <div class="flex items-center justify-between gap-3 p-3 bg-[#FCFBF6] border border-[#EFEBDB] rounded-xl hover:border-[#D9A62C]/40 transition shadow-2xs">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-8 h-8 rounded-lg bg-[#14432A]/10 text-[#14432A] flex items-center justify-center shrink-0">
              <img src="ICON/home.svg" class="w-4 h-4 object-contain">
            </div>
            <div class="min-w-0">
              <div class="font-bold text-sm text-[#14432A] truncate">${c.name}</div>
              <div class="text-[11px] text-[#6B7060] font-mono">${c.code || "CAMPUS"} ${c.location ? `· ${c.location}` : ""}</div>
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button data-id="${c.id}" class="campus-edit-btn inline-flex items-center gap-1 text-xs font-semibold text-[#8A6A0C] hover:underline bg-[#FBF3D9] px-2.5 py-1.5 rounded-lg transition">
              <img src="ICON/edit.svg" class="w-3 h-3"> Edit
            </button>
            <button data-id="${c.id}" class="chip-delete text-[#B3432B] hover:bg-[#FBEAE4] text-xs p-1.5 rounded-lg font-bold transition flex items-center justify-center" title="Delete campus"><img src="ICON/delete.svg" class="w-3.5 h-3.5" alt="Delete"></button>
          </div>
        </div>
      `).join("")
    : `<div class="text-sm text-[#6B7060] py-6 text-center">No campuses found matching "${search}".</div>`;

  el.querySelectorAll(".campus-edit-btn").forEach((btn) => {
    btn.onclick = () => openEditCampusModal(btn.dataset.id);
  });
}

function renderCollegeList() {
  const el = $("collegeChips");
  if (!el) return;

  const search = $("superCollegeSearchInput")?.value.trim().toLowerCase() || "";
  const filtered = colleges.filter((c) => {
    if (!search) return true;
    return (c.name || "").toLowerCase().includes(search);
  });

  if ($("collegeFoundCount")) {
    $("collegeFoundCount").textContent = `${filtered.length} of ${colleges.length} colleges`;
  }

  el.innerHTML = filtered.length
    ? filtered.map((col) => {
        const deptCount = departments.filter((d) => String(d.college_id) === String(col.id)).length;
        return `
          <div class="flex items-center justify-between gap-3 p-3 bg-[#FCFBF6] border border-[#EFEBDB] rounded-xl hover:border-[#D9A62C]/40 transition shadow-2xs">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-8 h-8 rounded-lg bg-[#8A6A0C]/10 text-[#8A6A0C] flex items-center justify-center shrink-0">
                <img src="ICON/subject.svg" class="w-4 h-4 object-contain">
              </div>
              <div class="min-w-0">
                <div class="font-bold text-sm text-[#14432A] truncate">${col.name}</div>
                <div class="text-[11px] text-[#6B7060]">${deptCount} Departments assigned</div>
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button data-id="${col.id}" class="college-edit-btn inline-flex items-center gap-1 text-xs font-semibold text-[#8A6A0C] hover:underline bg-[#FBF3D9] px-2.5 py-1.5 rounded-lg transition">
                <img src="ICON/edit.svg" class="w-3 h-3"> Edit
              </button>
              <button data-table="colleges" data-id="${col.id}" class="chip-delete text-[#B3432B] hover:bg-[#FBEAE4] text-xs p-1.5 rounded-lg font-bold transition flex items-center justify-center" title="Delete college"><img src="ICON/delete.svg" class="w-3.5 h-3.5" alt="Delete"></button>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="text-sm text-[#6B7060] py-6 text-center">No colleges found matching "${search}".</div>`;

  el.querySelectorAll(".college-edit-btn").forEach((btn) => {
    btn.onclick = () => openEditCollegeModal(btn.dataset.id);
  });
}

function renderDepartmentChips() {
  const el = $("departmentChips");
  if (!el) return;

  const search = $("superDepartmentSearchInput")?.value.trim().toLowerCase() || "";
  const collegeFilter = $("superDeptCollegeFilter")?.value || "All";

  // Populate college filter dropdown if not populated
  const filterSelect = $("superDeptCollegeFilter");
  if (filterSelect && filterSelect.options.length <= 1) {
    filterSelect.innerHTML = `<option value="All">All Colleges</option>` +
      colleges.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  }

  let filtered = departments;
  if (collegeFilter !== "All") {
    filtered = filtered.filter((d) => String(d.college_id) === String(collegeFilter));
  }
  if (search) {
    filtered = filtered.filter((d) => {
      const colObj = colleges.find((c) => String(c.id) === String(d.college_id));
      const colName = colObj ? colObj.name.toLowerCase() : "";
      return (d.name || "").toLowerCase().includes(search) || colName.includes(search);
    });
  }

  if ($("deptFoundCount")) {
    $("deptFoundCount").textContent = `${filtered.length} of ${departments.length} departments`;
  }

  el.innerHTML = filtered.length
    ? filtered.map((d) => {
        const colObj = colleges.find((c) => String(c.id) === String(d.college_id));
        return `
          <div class="flex items-center justify-between gap-3 p-3 bg-[#FCFBF6] border border-[#EFEBDB] rounded-xl hover:border-[#D9A62C]/40 transition shadow-2xs">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-8 h-8 rounded-lg bg-[#1F6F4A]/10 text-[#1F6F4A] flex items-center justify-center shrink-0">
                <img src="ICON/departmentHead.svg" class="w-4 h-4 object-contain">
              </div>
              <div class="min-w-0">
                <div class="font-bold text-sm text-[#14432A] truncate">${d.name}</div>
                <div class="text-[11px] text-[#6B7060] truncate">${colObj ? colObj.name : "No college assigned"}</div>
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button data-id="${d.id}" class="dept-edit-btn inline-flex items-center gap-1 text-xs font-semibold text-[#8A6A0C] hover:underline bg-[#FBF3D9] px-2.5 py-1.5 rounded-lg transition">
                <img src="ICON/edit.svg" class="w-3 h-3"> Edit
              </button>
              <button data-table="departments" data-id="${d.id}" class="chip-delete text-[#B3432B] hover:bg-[#FBEAE4] text-xs p-1.5 rounded-lg font-bold transition flex items-center justify-center" title="Delete department"><img src="ICON/delete.svg" class="w-3.5 h-3.5" alt="Delete"></button>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="text-sm text-[#6B7060] py-6 text-center">No departments found matching your criteria.</div>`;

  el.querySelectorAll(".dept-edit-btn").forEach((btn) => {
    btn.onclick = () => openEditDepartmentModal(btn.dataset.id);
  });
}

function renderAcademicCourseList() {
  const el = $("academicCourseChips");
  if (!el) return;

  const search = $("superAcademicCourseSearchInput")?.value.trim().toLowerCase() || "";
  const deptFilter = $("superCourseDeptFilter")?.value || "All";

  // Populate dept filter dropdown if not populated
  const filterSelect = $("superCourseDeptFilter");
  if (filterSelect && filterSelect.options.length <= 1) {
    filterSelect.innerHTML = `<option value="All">All Departments</option>` +
      departments.map((d) => `<option value="${d.id}">${d.name}</option>`).join("");
  }

  let filtered = academicCourses;
  if (deptFilter !== "All") {
    filtered = filtered.filter((c) => String(c.department_id) === String(deptFilter));
  }
  if (search) {
    filtered = filtered.filter((c) => {
      const deptObj = departments.find((d) => String(d.id) === String(c.department_id));
      const deptName = deptObj ? deptObj.name.toLowerCase() : "";
      return (c.name || "").toLowerCase().includes(search) ||
             (c.code || "").toLowerCase().includes(search) ||
             deptName.includes(search);
    });
  }

  if ($("academicCourseFoundCount")) {
    $("academicCourseFoundCount").textContent = `${filtered.length} of ${academicCourses.length} courses`;
  }

  el.innerHTML = filtered.length
    ? filtered.map((c) => {
        const deptObj = departments.find((d) => String(d.id) === String(c.department_id));
        const secCount = sections.filter((s) => String(s.course_id) === String(c.id)).length;
        return `
          <div class="flex items-center justify-between gap-3 p-3 bg-[#FCFBF6] border border-[#EFEBDB] rounded-xl hover:border-[#D9A62C]/40 transition shadow-2xs">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-8 h-8 rounded-lg bg-[#D9A62C]/15 text-[#8A6A0C] flex items-center justify-center shrink-0 font-mono font-bold text-xs">
                ${c.code || "CRS"}
              </div>
              <div class="min-w-0">
                <div class="font-bold text-sm text-[#14432A] truncate">${c.name}</div>
                <div class="text-[11px] text-[#6B7060] truncate">${deptObj ? deptObj.name : "Unassigned Department"} ${secCount > 0 ? `· ${secCount} Sections` : ""}</div>
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button data-id="${c.id}" class="academic-course-edit-btn inline-flex items-center gap-1 text-xs font-semibold text-[#8A6A0C] hover:underline bg-[#FBF3D9] px-2.5 py-1.5 rounded-lg transition">
                <img src="ICON/edit.svg" class="w-3 h-3"> Edit
              </button>
              <button data-id="${c.id}" class="academic-course-delete-btn text-[#B3432B] hover:bg-[#FBEAE4] text-xs p-1.5 rounded-lg font-bold transition flex items-center justify-center" title="Delete course"><img src="ICON/delete.svg" class="w-3.5 h-3.5" alt="Delete"></button>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="text-sm text-[#6B7060] py-6 text-center">No academic degree courses found.</div>`;

  el.querySelectorAll(".academic-course-edit-btn").forEach((btn) => {
    btn.onclick = () => openEditAcademicCourseModal(btn.dataset.id);
  });
  el.querySelectorAll(".academic-course-delete-btn").forEach((btn) => {
    btn.onclick = () => deleteAcademicCourseItem(btn.dataset.id);
  });
}

function renderSuperadminSectionChips() {
  const el = $("sectionChips");
  if (!el) return;

  const search = $("superSectionSearchInput")?.value.trim().toLowerCase() || "";
  const deptFilter = $("superSectionDeptFilter")?.value || "All";
  const courseFilter = $("superSectionCourseFilter")?.value || "All";

  // Populate dept filter dropdown if not populated
  const filterSelect = $("superSectionDeptFilter");
  if (filterSelect && filterSelect.options.length <= 1) {
    filterSelect.innerHTML = `<option value="All">All Departments</option>` +
      departments.map((d) => `<option value="${d.id}">${d.name}</option>`).join("");
  }

  // Populate course filter dropdown if not populated
  const courseFilterSelect = $("superSectionCourseFilter");
  if (courseFilterSelect && courseFilterSelect.options.length <= 1) {
    courseFilterSelect.innerHTML = `<option value="All">All Courses</option>` +
      academicCourses.map((c) => `<option value="${c.id}">${c.code ? `[${c.code}] ` : ""}${c.name}</option>`).join("");
  }

  let filtered = sections;
  if (deptFilter !== "All") {
    filtered = filtered.filter((s) => String(s.department_id) === String(deptFilter));
  }
  if (courseFilter !== "All") {
    filtered = filtered.filter((s) => String(s.course_id) === String(courseFilter));
  }
  if (search) {
    filtered = filtered.filter((s) => {
      const deptObj = departments.find((d) => String(d.id) === String(s.department_id));
      const deptName = deptObj ? deptObj.name.toLowerCase() : "";
      const courseObj = academicCourses.find((c) => String(c.id) === String(s.course_id));
      const courseName = courseObj ? (courseObj.name + " " + courseObj.code).toLowerCase() : "";
      return (s.name || "").toLowerCase().includes(search) || deptName.includes(search) || courseName.includes(search);
    });
  }

  if ($("sectionFoundCount")) {
    $("sectionFoundCount").textContent = `${filtered.length} of ${sections.length} sections`;
  }

  el.innerHTML = filtered.length
    ? filtered.map((s) => {
        const deptObj = departments.find((d) => String(d.id) === String(s.department_id));
        const courseObj = academicCourses.find((c) => String(c.id) === String(s.course_id));
        return `
          <div class="flex items-center justify-between gap-3 p-3 bg-[#FCFBF6] border border-[#EFEBDB] rounded-xl hover:border-[#D9A62C]/40 transition shadow-2xs">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-8 h-8 rounded-lg bg-[#14432A]/10 text-[#14432A] flex items-center justify-center shrink-0">
                <img src="ICON/class_record.svg" class="w-4 h-4 object-contain">
              </div>
              <div class="min-w-0">
                <div class="font-bold text-sm text-[#14432A] truncate flex items-center gap-2">
                  <span>${s.name}</span>
                  ${courseObj?.code ? `<span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#14432A]/10 text-[#14432A] font-semibold">${courseObj.code}</span>` : ""}
                </div>
                <div class="text-[11px] text-[#6B7060] truncate">${courseObj ? `${courseObj.name} · ` : ""}${deptObj ? deptObj.name : "Unassigned Department"}</div>
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0">
              <button data-id="${s.id}" class="section-edit-btn inline-flex items-center gap-1 text-xs font-semibold text-[#8A6A0C] hover:underline bg-[#FBF3D9] px-2.5 py-1.5 rounded-lg transition">
                <img src="ICON/edit.svg" class="w-3 h-3"> Edit
              </button>
              <button data-table="sections" data-id="${s.id}" class="chip-delete text-[#B3432B] hover:bg-[#FBEAE4] text-xs p-1.5 rounded-lg font-bold transition flex items-center justify-center" title="Delete section"><img src="ICON/delete.svg" class="w-3.5 h-3.5" alt="Delete"></button>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="text-sm text-[#6B7060] py-6 text-center">No matching sections found.</div>`;

  el.querySelectorAll(".section-edit-btn").forEach((btn) => {
    btn.onclick = () => openEditSectionModal(btn.dataset.id);
  });
}

// ── Forms Overview (Read-only) ──────────────────────────────────────────

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

  let itemsList = table === "colleges" ? colleges : table === "departments" ? departments : sections;
  let existing = itemsList.find((i) => i.name.trim().toLowerCase() === clean.toLowerCase());

  try {
    // If the item already exists in memory / DB
    if (existing) {
      // If adding a department and a college was selected, assign/update its college_id
      if (table === "departments" && extraFields.college_id && String(existing.college_id) !== String(extraFields.college_id)) {
        await sb.from("departments").update({ college_id: extraFields.college_id }).eq("id", existing.id);
        existing.college_id = extraFields.college_id;
      }
      // If adding a section and a department was selected, assign/update its department_id
      if (table === "sections" && extraFields.department_id && String(existing.department_id) !== String(extraFields.department_id)) {
        await sb.from("sections").update({ department_id: extraFields.department_id }).eq("id", existing.id);
        existing.department_id = extraFields.department_id;
      }

      inputEl.value = "";
      if (table === "colleges") await loadColleges();
      else if (table === "departments") await loadDepartments();
      else if (table === "sections") await loadSections();

      if (table === "colleges") populateSelect($("collegeSelect"), colleges);
      onCollegeChange();

      if (selectEl) {
        selectEl.value = existing.id;
        if (table === "departments") onDepartmentChange();
      }

      renderMaintenance();
      updateCredentialPreview();
      showToast(`"${existing.name}" selected.`);
      return true;
    }

    // Insert new item
    const { data, error } = await sb.from(table).insert({ name: clean, ...extraFields }).select().single();
    if (error) {
      // If duplicate key error from DB, load again & select existing
      if (error.code === "23505" || /already exists/i.test(error.message || "")) {
        if (table === "colleges") await loadColleges();
        else if (table === "departments") await loadDepartments();
        else if (table === "sections") await loadSections();

        itemsList = table === "colleges" ? colleges : table === "departments" ? departments : sections;
        const found = itemsList.find((i) => i.name.trim().toLowerCase() === clean.toLowerCase());

        inputEl.value = "";
        onCollegeChange();
        if (selectEl && found) {
          selectEl.value = found.id;
          if (table === "departments") onDepartmentChange();
        }
        renderMaintenance();
        updateCredentialPreview();
        showToast(`"${clean}" selected.`);
        return true;
      }
      console.error(`Failed to add ${table} item:`, error);
      showToast(`Couldn't add that item: ${error.message}`, true);
      return false;
    }

    inputEl.value = "";
    if (table === "colleges") await loadColleges();
    else if (table === "departments") await loadDepartments();
    else if (table === "sections") await loadSections();

    if (table === "colleges") populateSelect($("collegeSelect"), colleges);
    onCollegeChange();
    renderMaintenance();
    if (selectEl && data) {
      selectEl.value = data.id;
      if (table === "departments") onDepartmentChange();
      updateCredentialPreview();
    }
    showToast(`"${clean}" added.`);
    return true;
  } catch (err) {
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
    if (table === "colleges") await loadColleges();
    else if (table === "departments") await loadDepartments();
    else if (table === "sections") await loadSections();

    populateSelect($("collegeSelect"), colleges);
    onCollegeChange();
    renderMaintenance();
    showToast("Item removed.");
  } catch (err) {
    console.error(`Unexpected error deleting ${table} item:`, err);
    showToast(`Couldn't reach the database: ${err.message || err}`, true);
  }
}

function wireInlineQuickAdd({ toggleBtn, row, input, addBtn, table, select, getExtraFields }) {
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

    const extraFields = getExtraFields ? getExtraFields() : {};
    const ok = await addMaintenanceItem(table, inputEl.value, inputEl, selectEl, extraFields);

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

// ── E-signature pad ─────────────────────────────────────────────────────

let signatureCtx = null;
let signatureHasInk = false;
let signatureDrawing = false;

function initSignaturePad() {
  const canvas = $("signaturePad");
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

// ── Biometric (ZKTeco Live20R) ──────────────────────────────────────────

let fingerprintCredentialId = null;
let fingerprintImagePreview = null;

async function registerFingerprint() {
  const btn = $("fingerprintBtn");
  const icon = $("fingerprintIcon");
  const label = $("fingerprintLabel");
  const status = $("fingerprintStatus");
  if (!btn) return;

  status.classList.remove("text-[#B3432B]");

  if (typeof ZKTeco === "undefined") {
    status.textContent = "ZKTeco client library not found.";
    status.classList.add("text-[#B3432B]");
    return;
  }

  const username = $("username")?.value.trim() || `${$("firstName")?.value.trim()}.${$("lastName")?.value.trim()}` || "user";

  ZKTeco.openEnrollmentModal({
    username: username,
    onComplete: (result) => {
      fingerprintCredentialId = result.template;
      fingerprintImagePreview = result.image;

      if (icon) {
        if (icon.tagName === "IMG") icon.src = "ICON/biometric.svg";
        else icon.textContent = "";
      }
      if (label) label.textContent = "Fingerprint Enrolled";
      if (status) {
        status.textContent = `Live20R biometric template captured (${result.quality}% quality).`;
        status.classList.remove("text-[#B3432B]");
      }

      const previewRow = $("fingerprintPreviewRow");
      const previewImg = $("fingerprintPreviewImg");
      if (previewRow && previewImg && result.image) {
        previewImg.src = result.image;
        previewRow.classList.remove("hidden");
      }

      if (btn) {
        btn.classList.add("bg-[#FAF7EF]");
      }

      updateCredentialPreview();
      showToast("ZKTeco Live20R biometric enrolled successfully.");
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

function clearFingerprint() {
  fingerprintCredentialId = null;
  fingerprintImagePreview = null;
  const btn = $("fingerprintBtn");
  const icon = $("fingerprintIcon");
  const label = $("fingerprintLabel");
  const status = $("fingerprintStatus");
  const previewRow = $("fingerprintPreviewRow");

  if (btn) { btn.classList.remove("bg-[#FAF7EF]"); }
  if (icon) icon.textContent = "";
  if (label) label.textContent = "Register Fingerprint";
  if (status) { status.textContent = "Not yet registered"; status.classList.remove("text-[#B3432B]"); }
  if (previewRow) previewRow.classList.add("hidden");
  updateCredentialPreview();
}

function resetIdentityCapture() {
  clearSignaturePad();
  clearFingerprint();
}

function updateCredentialPreview() {
  const lastName = $("lastName")?.value.trim() || "";
  const firstName = $("firstName")?.value.trim() || "";
  const mi = $("middleInitial")?.value.trim() || "";
  const username = $("username")?.value.trim() || "";
  const password = $("tempPassword")?.value || "";

  const colId = $("collegeSelect")?.value;
  const deptId = $("departmentSelect")?.value;
  const secId = $("sectionSelect")?.value;

  const colObj = colleges.find((c) => String(c.id) === String(colId));
  const deptObj = departments.find((d) => String(d.id) === String(deptId));
  const secObj = sections.find((s) => String(s.id) === String(secId));

  let orgText = colObj ? colObj.name : "—";
  if (deptObj) orgText += ` • ${deptObj.name}`;
  if (activeRole === "Student" && secObj) orgText += ` (${secObj.name})`;

  const isAffiliate = $("isAffiliateCheckbox")?.checked || false;
  const empId = $("employeeId")?.value.trim() || "";

  if ($("credAvatar")) $("credAvatar").textContent = initials(firstName, lastName) || "—";
  if ($("credName")) $("credName").textContent = (lastName || firstName) ? `${lastName || "—"}, ${firstName || "—"} ${mi ? mi.toUpperCase() + "." : ""}`.trim() : "Full name";
  if ($("credDesignation")) $("credDesignation").textContent = activeRole + (activeRole === "Faculty" && isAffiliate ? " (Affiliate)" : "");
  if ($("credOrg")) $("credOrg").textContent = orgText;
  if ($("credEmployeeId")) $("credEmployeeId").textContent = empId || "—";
  if ($("credUsername")) $("credUsername").textContent = username || "username";
  if ($("credPassword")) $("credPassword").textContent = password || (activeRole === "Student" && !username ? "N/A" : "••••••••");

  const sigFlag = $("credSignatureFlag");
  if (sigFlag) {
    sigFlag.textContent = signatureHasInk ? "Signature captured" : "No signature";
    sigFlag.className = signatureHasInk ? "text-[#1F6F4A] font-semibold" : "text-[#B9B2A0]";
  }
  const bioFlag = $("credBiometricFlag");
  if (bioFlag) {
    bioFlag.textContent = fingerprintCredentialId ? "Biometric captured" : "No biometric";
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

  const employeeIdVal = $("employeeId")?.value.trim() || null;
  const lastName = $("lastName").value.trim();
  const firstName = $("firstName").value.trim();
  const middleInitial = $("middleInitial").value.trim();
  const campusId = $("campusSelect")?.value || null;
  const campusObj = campuses.find((c) => String(c.id) === String(campusId));
  const campusName = campusObj ? campusObj.name : "Main Campus";
  const collegeId = $("collegeSelect").value;
  const departmentId = $("departmentSelect").value;
  const courseId = $("courseSelect")?.value || null;
  const courseObj = academicCourses.find((c) => String(c.id) === String(courseId));
  const sectionId = $("sectionSelect")?.value;
  const username = $("username").value.trim();
  const password = $("tempPassword").value;

  let valid = true;
  showError("lastName", lastName ? "" : ((valid = false), "Last name is required."));
  showError("firstName", firstName ? "" : ((valid = false), "First name is required."));
  showError("middleInitial", middleInitial.length > 2 ? ((valid = false), "Use 1–2 letters only.") : "");
  showError("campusSelect", campusId ? "" : ((valid = false), "Select a campus."));
  if (!["Quality Assurance", "Campus Administrator"].includes(activeRole)) {
    showError("collegeSelect", collegeId ? "" : ((valid = false), "Select a college."));
  } else {
    showError("collegeSelect", "");
  }

  if (activeRole === "Student") {
    showError("departmentSelect", departmentId ? "" : ((valid = false), "Select a department."));
    showError("courseSelect", courseId ? "" : ((valid = false), "Select an academic course / program."));
    showError("sectionSelect", sectionId ? "" : ((valid = false), "Select a section."));
    showError("username", (!username && password && password.length > 0) ? ((valid = false), "Add a username, or clear the password.") : "");
    showError("tempPassword", (username && (!password || password.length < 8)) ? ((valid = false), "Use at least 8 characters.") : "");
  } else {
    if (!["Dean", "Campus Administrator", "Quality Assurance"].includes(activeRole)) {
      showError("departmentSelect", departmentId ? "" : ((valid = false), "Select a department."));
    }
    showError("username", username
      ? (users.some((u) => u.username === username) || students.some((s) => s.username === username) ? ((valid = false), "That username is taken.") : "")
      : ((valid = false), "Username is required."));
    showError("tempPassword", password.length >= 8 ? "" : ((valid = false), "Use at least 8 characters."));
  }

  if (!valid) return;

  const submitBtn = ev.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "Creating account…";

  try {
    if (activeRole === "Student") {
      let createdId = null;
      if (username) {
        const { data, error } = await sb.rpc("create_student", {
          p_last_name: lastName,
          p_first_name: firstName,
          p_section_id: sectionId,
          p_department_id: departmentId,
          p_college_id: collegeId,
          p_esignature: getSignatureDataUrl(),
          p_fingerprint_credential_id: fingerprintCredentialId,
          p_username: username,
          p_password: password,
        });
        if (error) throw error;
        createdId = Array.isArray(data) ? data[0]?.id : data?.id;
      } else {
        const { data, error } = await sb.from("students").insert({
          last_name: lastName,
          first_name: firstName,
          middle_initial: middleInitial || null,
          section_id: sectionId,
          department_id: departmentId,
          college_id: collegeId,
          esignature: getSignatureDataUrl(),
          fingerprint_credential_id: fingerprintCredentialId,
        }).select().single();
        if (error) throw error;
        createdId = data?.id;
      }
      if (createdId) {
        saveLocalEmployeeIdMapping(createdId, employeeIdVal);
        saveLocalCampusMapping(createdId, "student", campusId, campusName);
        saveLocalCourseMapping(createdId, courseId, courseObj?.name, courseObj?.code);
        if (fingerprintCredentialId && typeof ZKTeco !== "undefined") {
          ZKTeco.saveBiometricVaultUser({
            id: createdId,
            first_name: firstName,
            last_name: lastName,
            username: username,
            designation: "Student",
            role: "student",
            college_id: collegeId,
            department_id: departmentId,
            campus_id: campusId,
            campus_name: campusName,
            fingerprint_credential_id: fingerprintCredentialId
          });
        }
        try { await sb.from("students").update({ campus_id: campusId, campus_name: campusName, course_id: courseId }).eq("id", createdId); } catch (e) {}
      }
      await loadStudents();
      showToast(`Student account created for ${formatName({ first_name: firstName, last_name: lastName })}.`);
    } else {
      const isAffiliate = activeRole === "Faculty" ? ($("isAffiliateCheckbox")?.checked || false) : false;
      const dbDesignation = ["Quality Assurance", "Campus Administrator"].includes(activeRole) ? "Faculty" : activeRole;
      const { data, error } = await sb.rpc("create_app_user", {
        p_last_name: lastName,
        p_first_name: firstName,
        p_middle_initial: middleInitial,
        p_college_id: collegeId || null,
        p_department_id: departmentId || null,
        p_designation: dbDesignation,
        p_username: username,
        p_password: password,
        p_esignature: getSignatureDataUrl(),
        p_fingerprint_credential_id: fingerprintCredentialId,
      });
      if (error) throw error;
      const createdId = Array.isArray(data) ? data[0]?.id : (data?.id || data);
      if (createdId) {
        saveLocalEmployeeIdMapping(createdId, employeeIdVal);
        saveLocalRoleMapping(createdId, activeRole);
        saveLocalCampusMapping(createdId, "user", campusId, campusName);
        const selectedAffCols = getSelectedAffiliatedColleges();
        saveLocalAffiliatedCollegesMapping(createdId, selectedAffCols);
        if (fingerprintCredentialId && typeof ZKTeco !== "undefined") {
          ZKTeco.saveBiometricVaultUser({
            id: createdId,
            first_name: firstName,
            last_name: lastName,
            username: username,
            designation: activeRole,
            role: "staff",
            college_id: collegeId,
            department_id: departmentId,
            campus_id: campusId,
            campus_name: campusName,
            fingerprint_credential_id: fingerprintCredentialId
          });
        }
        try { await sb.from("app_users").update({ campus_id: campusId, campus_name: campusName }).eq("id", createdId); } catch (e) {}
      }
      if (data && data.id && isAffiliate) {
        try { await sb.from("app_users").update({ is_affiliate: true }).eq("id", data.id); } catch (e) {}
      }
      await loadUsers();
      showToast(`Account created for ${formatName(data)}. Share the temporary credentials securely.`);
    }

    $("userForm").reset();
    resetIdentityCapture();
    generateTempPassword();
    onCollegeChange();
    renderHome();
  } catch (err) {
    console.error("Failed to create user:", err);
    if (err.code === "23505" || /taken|unique/i.test(err.message || "")) {
      showError("username", "That username is taken.");
    }
    showToast(err.message || "Couldn't create that account.", true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
}

// ── Edit / Delete existing accounts ─────────────────────────────────────

function handleUserQuickSearch() {
  const query = $("userQuickSearchInput")?.value.trim().toLowerCase();
  const resultsContainer = $("userQuickSearchResults");
  if (!resultsContainer) return;

  if (!query) {
    resultsContainer.innerHTML = "";
    resultsContainer.classList.add("hidden");
    return;
  }

  const staffList = users.map((u) => ({ ...u, account_type: "user" }));
  const studentList = students.map((s) => ({ ...s, designation: "Student", account_type: "student" }));
  const all = [...staffList, ...studentList];

  const matches = all.filter((u) => {
    const fullName = `${u.first_name || ""} ${u.last_name || ""}`.toLowerCase();
    const reverseName = `${u.last_name || ""} ${u.first_name || ""}`.toLowerCase();
    const idStr = String(u.id).toLowerCase();
    const empIdStr = String(u.employee_id || u.employee_no || "").toLowerCase();
    const usernameStr = String(u.username || "").toLowerCase();
    return fullName.includes(query) || reverseName.includes(query) || idStr.includes(query) || empIdStr.includes(query) || usernameStr.includes(query);
  }).slice(0, 8);

  if (matches.length === 0) {
    resultsContainer.innerHTML = `<div class="p-3 text-xs text-[#6B7060] text-center">No matching accounts found for "${query}".</div>`;
    resultsContainer.classList.remove("hidden");
    return;
  }

  resultsContainer.innerHTML = matches.map((u) => `
    <div data-id="${u.id}" data-type="${u.account_type}" class="quick-search-item p-3 hover:bg-[#FBF9F0] cursor-pointer flex items-center justify-between transition">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-full text-white text-xs font-bold font-display flex items-center justify-center shrink-0 bg-[#1F6F4A]">${initials(u.first_name, u.last_name)}</div>
        <div>
          <div class="text-sm font-semibold text-[#1B2116]">${formatName(u)} <span class="font-mono text-xs text-[#6B7060]">(#${u.id})</span></div>
          <div class="text-xs text-[#6B7060] font-mono">${u.username ? "@" + u.username : "No username"} • <span class="text-[#14432A] font-semibold">${u.campus_name || "Main Campus"}</span></div>
        </div>
      </div>
      <span class="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#FBF3D9] text-[#8A6A0C]">${u.designation}</span>
    </div>
  `).join("");

  resultsContainer.classList.remove("hidden");

  resultsContainer.querySelectorAll(".quick-search-item").forEach((item) => {
    item.addEventListener("click", () => {
      startEditUser(item.dataset.id, item.dataset.type);
      resultsContainer.classList.add("hidden");
      if ($("userQuickSearchInput")) $("userQuickSearchInput").value = "";
    });
  });
}

function startEditUser(id, type = "user") {
  let u = null;
  if (type === "student") {
    u = students.find((x) => String(x.id) === String(id));
    if (!u) return;
    editingUserId = id;
    editingUserType = "student";
    setActiveRole("Student");
  } else {
    u = users.find((x) => String(x.id) === String(id));
    if (!u) return;
    editingUserId = id;
    editingUserType = "user";
    setActiveRole(u.designation || "Dean");
    if ($("isAffiliateCheckbox")) {
      $("isAffiliateCheckbox").checked = !!(u.is_affiliate === true || u.is_affiliate === "true");
    }
  }

  showView("create");
  $("userForm").reset();
  resetIdentityCapture();

  if ($("editUserBanner")) {
    $("editUserBannerName").textContent = `${formatName(u)} (#${u.id}${u.username ? " @" + u.username : ""})`;
    $("editUserBanner").classList.remove("hidden");
  }
  if ($("createViewHeading")) $("createViewHeading").textContent = `Editing Account Attributes — ${formatName(u)}`;

  if ($("employeeId")) {
    $("employeeId").value = u.employee_id || u.employee_no || getUserEmployeeIdMapping(u.id) || "";
  }
  $("lastName").value = u.last_name || "";
  $("firstName").value = u.first_name || "";
  $("middleInitial").value = u.middle_initial || "";
  if ($("campusSelect")) {
    const matchedCampus = campuses.find((c) => String(c.id) === String(u.campus_id) || c.name === u.campus_name);
    $("campusSelect").value = matchedCampus ? matchedCampus.id : (u.campus_id || "");
  }
  $("collegeSelect").value = u.college_id || "";
  onCollegeChange();

  $("departmentSelect").value = u.department_id || "";
  if (type === "student") {
    onDepartmentChange();
    if ($("courseSelect")) {
      const mappedCourse = getUserCourseMapping(id);
      const cId = u.course_id || (mappedCourse ? mappedCourse.course_id : "");
      $("courseSelect").value = cId || "";
      onCourseChange();
    }
    if ($("sectionSelect")) $("sectionSelect").value = u.section_id || "";
  }

  $("username").value = u.username || "";
  if (u.username) {
    $("username").readOnly = false; // Allow superadmin to update username if needed
    $("usernameHint").textContent = "Username registered — edit freely if required.";
  }

  const alreadyLoggedIn = u.must_change_password === false || u.has_logged_in === true || u.first_login_done === true || u.logged_in_once === true;
  if (alreadyLoggedIn) {
    $("firstTimePasswordSection")?.classList.add("hidden");
  } else {
    $("firstTimePasswordSection")?.classList.remove("hidden");
  }

  const affCols = getUserAffiliatedCollegesMapping(id);
  renderAffiliatedCollegesList(affCols);

  $("userFormSubmitBtn").textContent = "Save changes";
  $("deleteUserInFormBtn")?.classList.remove("hidden");
  $("cancelEditBtn").classList.remove("hidden");

  fingerprintCredentialId = u.fingerprint_credential_id || null;
  if (u.fingerprint_credential_id) {
    const icon = $("fingerprintIcon");
    const label = $("fingerprintLabel");
    const status = $("fingerprintStatus");
    const previewRow = $("fingerprintPreviewRow");
    if (icon) {
      if (icon.tagName === "IMG") icon.src = "ICON/biometric.svg";
      else icon.textContent = "";
    }
    if (label) label.textContent = "Re-enroll Fingerprint";
    if (status) {
      status.textContent = "Live20R biometric template on file.";
      status.classList.remove("text-[#B3432B]");
    }
    if (previewRow) previewRow.classList.remove("hidden");
  }

  updateCredentialPreview();
  showToast(`Loaded ${formatName(u)} into form for attribute editing.`);
}

function exitEditMode() {
  editingUserId = null;
  editingUserType = "user";
  $("userForm").reset();
  resetIdentityCapture();
  if ($("employeeId")) $("employeeId").value = "";
  if ($("editUserBanner")) $("editUserBanner").classList.add("hidden");
  if ($("createViewHeading")) $("createViewHeading").textContent = "Create or Edit User";
  if ($("userQuickSearchInput")) $("userQuickSearchInput").value = "";
  if ($("userQuickSearchResults")) $("userQuickSearchResults").classList.add("hidden");
  if ($("isAffiliateCheckbox")) $("isAffiliateCheckbox").checked = false;
  if ($("courseSelect")) $("courseSelect").value = "";
  if ($("courseQuickAddRow")) $("courseQuickAddRow").classList.add("hidden");
  if ($("sectionQuickAddRow")) $("sectionQuickAddRow").classList.add("hidden");
  $("username").readOnly = false;
  $("usernameHint").textContent = "Suggested automatically from the name — edit freely.";
  $("firstTimePasswordSection").classList.remove("hidden");
  $("userFormSubmitBtn").textContent = "Create account";
  $("deleteUserInFormBtn")?.classList.add("hidden");
  $("cancelEditBtn").classList.add("hidden");
  generateTempPassword();
  onCollegeChange();
  renderAffiliatedCollegesList([]);
}

async function handleUpdateUser(ev) {
  const employeeIdVal = $("employeeId")?.value.trim() || null;
  const lastName = $("lastName").value.trim();
  const firstName = $("firstName").value.trim();
  const middleInitial = $("middleInitial").value.trim();
  const campusId = $("campusSelect")?.value || null;
  const campusObj = campuses.find((c) => String(c.id) === String(campusId));
  const campusName = campusObj ? campusObj.name : "Main Campus";
  const collegeId = $("collegeSelect").value;
  const departmentId = $("departmentSelect").value;
  const courseId = $("courseSelect")?.value || null;
  const courseObj = academicCourses.find((c) => String(c.id) === String(courseId));
  const sectionId = $("sectionSelect")?.value;
  const username = $("username")?.value.trim() || null;
  const newPassword = $("tempPassword")?.value || null;

  let valid = true;
  showError("lastName", lastName ? "" : ((valid = false), "Last name is required."));
  showError("firstName", firstName ? "" : ((valid = false), "First name is required."));
  showError("middleInitial", middleInitial.length > 2 ? ((valid = false), "Use 1–2 letters only.") : "");
  showError("campusSelect", campusId ? "" : ((valid = false), "Select a campus."));
  if (!["Quality Assurance", "Campus Administrator"].includes(activeRole)) {
    showError("collegeSelect", collegeId ? "" : ((valid = false), "Select a college."));
  } else {
    showError("collegeSelect", "");
  }

  if (editingUserType === "student") {
    showError("departmentSelect", departmentId ? "" : ((valid = false), "Select a department."));
    showError("courseSelect", courseId ? "" : ((valid = false), "Select an academic course / program."));
    showError("sectionSelect", sectionId ? "" : ((valid = false), "Select a section."));
  } else if (!["Dean", "Campus Administrator", "Quality Assurance"].includes(activeRole)) {
    showError("departmentSelect", departmentId ? "" : ((valid = false), "Select a department."));
  }

  if (!valid) return;

  const submitBtn = $("userFormSubmitBtn");
  submitBtn.disabled = true;
  const originalLabel = submitBtn.textContent;
  submitBtn.textContent = "Saving changes…";

  try {
    const sig = getSignatureDataUrl();

    if (editingUserType === "student") {
      const payload = {
        last_name: lastName,
        first_name: firstName,
        middle_initial: middleInitial || null,
        college_id: collegeId || null,
        department_id: departmentId,
        section_id: sectionId,
        username: username,
        fingerprint_credential_id: fingerprintCredentialId,
      };
      if (courseId) payload.course_id = courseId;
      if (sig) payload.esignature = sig;
      const { error } = await sb.from("students").update(payload).eq("id", editingUserId);
      if (error) {
        if (payload.course_id) {
          delete payload.course_id;
          const { error: err2 } = await sb.from("students").update(payload).eq("id", editingUserId);
          if (err2) throw err2;
        } else {
          throw error;
        }
      }

      saveLocalCourseMapping(editingUserId, courseId, courseObj?.name, courseObj?.code);
      saveLocalEmployeeIdMapping(editingUserId, employeeIdVal);
      saveLocalCampusMapping(editingUserId, "student", campusId, campusName);
      if (fingerprintCredentialId && typeof ZKTeco !== "undefined") {
        ZKTeco.saveBiometricVaultUser({
          id: editingUserId,
          first_name: firstName,
          last_name: lastName,
          username: username,
          designation: "Student",
          role: "student",
          college_id: collegeId,
          department_id: departmentId,
          campus_id: campusId,
          campus_name: campusName,
          fingerprint_credential_id: fingerprintCredentialId
        });
      }
      try { await sb.from("students").update({ campus_id: campusId, campus_name: campusName }).eq("id", editingUserId); } catch (e) {}

      if (newPassword && newPassword.length >= 8) {
        try { await sb.rpc("set_student_password", { p_id: editingUserId, p_new_password: newPassword }); } catch (pwErr) { console.warn("Password change:", pwErr); }
      }
      await loadStudents();
    } else {
      const isAffiliate = activeRole === "Faculty" ? ($("isAffiliateCheckbox")?.checked || false) : false;
      const dbDesignation = ["Quality Assurance", "Campus Administrator"].includes(activeRole) ? "Faculty" : activeRole;
      const payload = {
        last_name: lastName,
        first_name: firstName,
        middle_initial: middleInitial || null,
        college_id: collegeId || null,
        department_id: departmentId || null,
        designation: dbDesignation,
        username: username,
        fingerprint_credential_id: fingerprintCredentialId,
      };
      if (sig) payload.esignature = sig;
      const { error } = await sb.from("app_users").update(payload).eq("id", editingUserId);
      if (error) throw error;

      saveLocalEmployeeIdMapping(editingUserId, employeeIdVal);
      saveLocalRoleMapping(editingUserId, activeRole);
      saveLocalCampusMapping(editingUserId, "user", campusId, campusName);
      const selectedAffCols = getSelectedAffiliatedColleges();
      saveLocalAffiliatedCollegesMapping(editingUserId, selectedAffCols);
      if (fingerprintCredentialId && typeof ZKTeco !== "undefined") {
        ZKTeco.saveBiometricVaultUser({
          id: editingUserId,
          first_name: firstName,
          last_name: lastName,
          username: username,
          designation: activeRole,
          role: "staff",
          college_id: collegeId,
          department_id: departmentId,
          campus_id: campusId,
          campus_name: campusName,
          fingerprint_credential_id: fingerprintCredentialId
        });
      }
      try { await sb.from("app_users").update({ campus_id: campusId, campus_name: campusName }).eq("id", editingUserId); } catch (e) {}
      if (isAffiliate) {
        try { await sb.from("app_users").update({ is_affiliate: true }).eq("id", editingUserId); } catch (e) {}
      }

      if (newPassword && newPassword.length >= 8) {
        try { await sb.rpc("set_user_password", { p_id: editingUserId, p_new_password: newPassword }); } catch (pwErr) { console.warn("Password change:", pwErr); }
      }
      await loadUsers();
    }

    exitEditMode();
    showView("reports");
    showToast("User attributes saved successfully.");
  } catch (err) {
    console.error("Failed to update user:", err);
    showToast(`Couldn't save changes: ${err.message || err}`, true);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
}

async function handleDeleteUser(id, type = "user") {
  const list = type === "student" ? students : users;
  const u = list.find((x) => String(x.id) === String(id));
  if (!u) return;
  if (!confirm(`Delete ${formatName(u)}'s account? This can't be undone.`)) return;

  try {
    const table = type === "student" ? "students" : "app_users";
    const { data, error } = await sb.from(table).delete().eq("id", id).select("id");
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("No account was actually removed — it may already be gone or blocked.");
    }
    if (type === "student") await loadStudents();
    else await loadUsers();

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
  const filterCampus = $("filterCampus")?.value || "All";
  const filterDesignation = $("filterDesignation").value;
  const filterCollege = $("filterCollege").value;

  const staffList = users.map((u) => ({ ...u, account_type: "user" }));
  const studentList = students.map((s) => ({ ...s, designation: "Student", account_type: "student" }));

  const allAccounts = [...staffList, ...studentList];

  const filtered = allAccounts
    .filter((u) => filterCampus === "All" || (u.campus_name || "Main Campus") === filterCampus)
    .filter((u) => filterDesignation === "All" || u.designation === filterDesignation)
    .filter((u) => filterCollege === "All" || u.college === filterCollege)
    .filter((u) =>
      !search ||
      (u.last_name && u.last_name.toLowerCase().includes(search)) ||
      (u.first_name && u.first_name.toLowerCase().includes(search)) ||
      (u.username && u.username.toLowerCase().includes(search))
    )
    .sort((a, b) => (a.last_name || "").localeCompare(b.last_name || ""));

  $("reportsCount").textContent = `${filtered.length} of ${allAccounts.length} account${allAccounts.length !== 1 ? "s" : ""}`;

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
        ${u.esignature ? '<img src="ICON/signature.svg" class="w-4 h-4 inline-block text-[#14432A]" title="Signature on file">' : ""}
        ${u.fingerprint_credential_id ? '<img src="ICON/biometric.svg" class="w-4 h-4 inline-block text-[#14432A]" title="Biometric on file">' : ""}
      </td>
      <td class="px-4 py-3 font-semibold text-[#14432A]">${u.campus_name || u.campus || "Main Campus"}</td>
      <td class="px-4 py-3">${u.college || "—"}</td>
      <td class="px-4 py-3">${u.department || "—"}${u.section_name ? ` (${u.section_name})` : ""}</td>
      <td class="px-4 py-3">
        <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#FBF3D9] text-[#8A6A0C]">${u.designation}</span>
        ${u.is_affiliate ? '<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#E5EDF9] text-[#1E40AF] ml-1">Affiliate</span>' : ''}
      </td>
      <td class="px-4 py-3 font-mono text-[#6B7060]">${u.username ? "@" + u.username : "—"}</td>
      <td class="px-4 py-3">${!u.username ? `<span class="text-xs font-semibold text-[#8A8D93]">Record only</span>` : u.must_change_password
        ? `<span class="text-xs font-semibold text-[#B3432B]">First-login pending</span>`
        : `<span class="text-xs font-semibold text-[#1F6F4A]">Active</span>`}</td>
      <td class="px-4 py-3 text-[#6B7060]">${u.created_at ? fmtDate(u.created_at) : "—"}</td>
      <td class="px-4 py-3">
        <div class="flex items-center gap-1.5">
          <button data-id="${u.id}" data-type="${u.account_type}" class="user-id-card-btn inline-flex items-center gap-1 text-xs font-semibold text-[#14432A] hover:bg-[#FAF7EF] bg-white border border-[#DEDACE] px-2 py-1 rounded-md transition shadow-2xs" title="View Digital ID & QR Code">
            <img src="ICON/qr.svg" class="w-3.5 h-3.5"> ID & QR
          </button>
          <button data-id="${u.id}" data-type="${u.account_type}" class="user-edit-btn inline-flex items-center gap-1 text-xs font-semibold text-[#8A6A0C] hover:underline bg-[#FBF3D9] px-2.5 py-1 rounded-md">
            <img src="ICON/edit.svg" class="w-3.5 h-3.5"> Edit
          </button>
          <button data-id="${u.id}" data-type="${u.account_type}" class="user-delete-btn inline-flex items-center gap-1 text-[#B3432B] hover:opacity-70 text-xs font-semibold bg-[#FBEAE4] px-2.5 py-1 rounded-md" title="Delete account">
            <img src="ICON/delete.svg" class="w-3.5 h-3.5"> Delete
          </button>
        </div>
      </td>
    </tr>
  `).join("");

  body.querySelectorAll(".user-id-card-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const list = btn.dataset.type === "student" ? students : users;
      const targetUser = list.find((x) => String(x.id) === String(btn.dataset.id));
      if (targetUser && typeof QRClient !== "undefined") {
        QRClient.openIdCardModal({ user: targetUser });
      }
    });
  });

  body.querySelectorAll(".user-edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => startEditUser(btn.dataset.id, btn.dataset.type));
  });
  body.querySelectorAll(".user-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteUser(btn.dataset.id, btn.dataset.type));
  });
}

function populateReportFilters() {
  const collegeFilter = $("filterCollege");
  if (collegeFilter) {
    collegeFilter.innerHTML = `<option value="All">All colleges</option>` +
      colleges.map((c) => `<option value="${c.name}">${c.name}</option>`).join("");
  }
}

// ── Master Subject Pool Management (Superadmin) ───────────────────────────

let masterSubjects = [];
let activeSuperSubjectTab = "general";

function setSuperSubjectTab(tab) {
  activeSuperSubjectTab = tab;
  document.querySelectorAll(".super-subject-tab-btn").forEach((btn) => {
    const isThis = btn.dataset.superSubjectTab === tab;
    btn.classList.toggle("active", isThis);
    if (isThis) {
      btn.classList.add("border-[#14432A]", "text-[#14432A]", "bg-[#14432A]/10");
      btn.classList.remove("border-transparent", "text-[#6B7060]");
    } else {
      btn.classList.remove("border-[#14432A]", "text-[#14432A]", "bg-[#14432A]/10");
      btn.classList.add("border-transparent", "text-[#6B7060]");
    }
  });
  $("superSubjectTab-general")?.classList.toggle("hidden", tab !== "general");
  $("superSubjectTab-college")?.classList.toggle("hidden", tab !== "college");
}

async function loadMasterSubjects() {
  try {
    const { data, error } = await sb.from("courses").select("*");
    if (error) throw error;
    masterSubjects = data || [];
    renderSuperSubjects();
  } catch (err) {
    console.error("Failed to load master subjects:", err);
    masterSubjects = [];
  }
}

function renderSuperSubjects() {
  const genBody = $("generalSubjectsBody");
  const colBody = $("collegeSubjectsBody");
  const colFilter = $("superCollegeFilter")?.value || "All";
  const search = $("superSubjectSearchInput")?.value.trim().toLowerCase() || "";

  if (genBody) {
    let genList = masterSubjects.filter((s) => s.is_general === true || s.is_general === "true" || !s.college_id);
    if (search) {
      genList = genList.filter((s) =>
        (s.course_number || "").toLowerCase().includes(search) ||
        (s.course_description || "").toLowerCase().includes(search) ||
        String(s.unit || "").toLowerCase().includes(search)
      );
    }

    genBody.innerHTML = genList.length === 0
      ? `<tr><td colspan="5" class="px-4 py-6 text-center text-[#8A8D93]">No General Education subjects match search.</td></tr>`
      : genList.map((s) => `
        <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]">
          <td class="px-4 py-3 font-mono font-bold text-[#14432A]">${s.course_number}</td>
          <td class="px-4 py-3">${s.course_description || "—"}</td>
          <td class="px-4 py-3">${s.unit || 0}</td>
          <td class="px-4 py-3"><span class="px-2.5 py-0.5 rounded-full text-xs bg-[#1F6F4A]/10 text-[#1F6F4A] font-semibold">Universal (All Colleges)</span></td>
          <td class="px-4 py-3 text-right">
            <div class="flex items-center justify-end gap-2">
              <button data-id="${s.id}" class="super-edit-subject-btn inline-flex items-center gap-1 text-xs font-semibold text-[#8A6A0C] hover:underline bg-[#FBF3D9] px-2.5 py-1 rounded-md">
                <img src="ICON/edit.svg" class="w-3.5 h-3.5"> Edit
              </button>
              <button data-id="${s.id}" class="super-delete-subject-btn inline-flex items-center gap-1 text-xs font-semibold text-[#B3432B] hover:opacity-70 bg-[#FBEAE4] px-2.5 py-1 rounded-md" title="Delete subject">
                <img src="ICON/delete.svg" class="w-3.5 h-3.5"> Delete
              </button>
            </div>
          </td>
        </tr>
      `).join("");
  }

  if (colBody) {
    let colList = masterSubjects.filter((s) => {
      if (s.is_general === true || s.is_general === "true" || !s.college_id) return false;
      if (colFilter !== "All") {
        const colObj = colleges.find((c) => String(c.id) === String(s.college_id));
        if (!colObj || colObj.name !== colFilter) return false;
      }
      if (search) {
        const colObj = colleges.find((c) => String(c.id) === String(s.college_id));
        const colName = colObj ? colObj.name.toLowerCase() : "";
        return (s.course_number || "").toLowerCase().includes(search) ||
          (s.course_description || "").toLowerCase().includes(search) ||
          String(s.unit || "").toLowerCase().includes(search) ||
          colName.includes(search);
      }
      return true;
    });

    colBody.innerHTML = colList.length === 0
      ? `<tr><td colspan="5" class="px-4 py-6 text-center text-[#8A8D93]">No college-specific subjects match search.</td></tr>`
      : colList.map((s) => {
        const colObj = colleges.find((c) => String(c.id) === String(s.college_id));
        return `
          <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]">
            <td class="px-4 py-3 font-mono font-bold text-[#14432A]">${s.course_number}</td>
            <td class="px-4 py-3">${s.course_description || "—"}</td>
            <td class="px-4 py-3">${s.unit || 0}</td>
            <td class="px-4 py-3"><span class="px-2.5 py-0.5 rounded-full text-xs bg-[#FBF3D9] text-[#8A6A0C] font-semibold">${colObj ? colObj.name : "College Subject"}</span></td>
            <td class="px-4 py-3 text-right">
              <div class="flex items-center justify-end gap-2">
                <button data-id="${s.id}" class="super-edit-subject-btn inline-flex items-center gap-1 text-xs font-semibold text-[#8A6A0C] hover:underline bg-[#FBF3D9] px-2.5 py-1 rounded-md">
                  <img src="ICON/edit.svg" class="w-3.5 h-3.5"> Edit
                </button>
                <button data-id="${s.id}" class="super-delete-subject-btn inline-flex items-center gap-1 text-xs font-semibold text-[#B3432B] hover:opacity-70 bg-[#FBEAE4] px-2.5 py-1 rounded-md" title="Delete subject">
                  <img src="ICON/delete.svg" class="w-3.5 h-3.5"> Delete
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join("");
  }

  document.querySelectorAll(".super-edit-subject-btn").forEach((btn) => {
    btn.onclick = () => handleEditMasterSubject(btn.dataset.id);
  });
  document.querySelectorAll(".super-delete-subject-btn").forEach((btn) => {
    btn.onclick = () => handleDeleteMasterSubject(btn.dataset.id);
  });
}

async function handleCreateGeneralSubject(ev) {
  ev.preventDefault();
  const num = $("genCourseNumber").value.trim();
  const desc = $("genCourseDescription").value.trim();
  const units = $("genCourseUnit").value.trim();

  if (!num || !desc) {
    showToast("Course number and description are required.", true);
    return;
  }

  const btn = $("createGenSubjectBtn");
  btn.disabled = true;
  btn.textContent = "Creating…";

  try {
    const { error } = await sb.from("courses").insert({
      course_number: num,
      course_description: desc,
      unit: units ? Number(units) : 0,
      is_general: true,
      college_id: null,
    });
    if (error) throw error;
    $("generalSubjectForm").reset();
    showToast(`General Subject ${num} created successfully.`);
    await loadMasterSubjects();
  } catch (err) {
    console.error("Failed to create General Subject:", err);
    showToast(`Couldn't create General Subject: ${err.message || err}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "+ Add General Subject";
  }
}

async function handleCreateCollegeSubject(ev) {
  ev.preventDefault();
  const collegeId = $("superCollegeAddSelect")?.value;
  const num = $("colCourseNumber")?.value.trim();
  const desc = $("colCourseDescription")?.value.trim();
  const units = $("colCourseUnit")?.value.trim();

  if (!collegeId || !num || !desc) {
    showToast("Target college, course number, and description are required.", true);
    return;
  }

  const btn = $("createColSubjectBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Creating…"; }

  try {
    const { error } = await sb.from("courses").insert({
      course_number: num,
      course_description: desc,
      unit: units ? Number(units) : 0,
      is_general: false,
      college_id: collegeId,
    });
    if (error) throw error;
    $("collegeSubjectForm")?.reset();
    showToast(`College Subject ${num} added successfully.`);
    await loadMasterSubjects();
  } catch (err) {
    console.error("Failed to create College Subject:", err);
    showToast(`Couldn't create subject: ${err.message || err}`, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "+ Add College Subject"; }
  }
}

function handleEditMasterSubject(id) {
  openEditSubjectModal(id);
}

function openEditSubjectModal(id) {
  const s = masterSubjects.find((x) => String(x.id) === String(id));
  if (!s) return;

  if ($("editSubjectId")) $("editSubjectId").value = s.id || "";
  if ($("editSubjectOriginalCode")) $("editSubjectOriginalCode").value = s.course_number || "";
  if ($("editCourseNumber")) $("editCourseNumber").value = s.course_number || "";
  if ($("editCourseDescription")) $("editCourseDescription").value = s.course_description || "";
  if ($("editCourseUnit")) $("editCourseUnit").value = s.unit || 0;

  const scopeSelect = $("editSubjectScope");
  const colContainer = $("editSubjectCollegeContainer");
  const colSelect = $("editSubjectCollegeSelect");

  const isGen = s.is_general === true || s.is_general === "true" || !s.college_id;
  if (scopeSelect) scopeSelect.value = isGen ? "general" : "college";

  if (colSelect) {
    colSelect.innerHTML = `<option value="">Select college…</option>` +
      colleges.map((c) => `<option value="${c.id}" ${String(c.id) === String(s.college_id) ? "selected" : ""}>${c.name}</option>`).join("");
  }
  if (colContainer) colContainer.classList.toggle("hidden", isGen);

  $("editSubjectModal")?.classList.remove("hidden");
}

function closeEditSubjectModal() {
  $("editSubjectModal")?.classList.add("hidden");
}

async function handleSaveEditSubjectModal(ev) {
  ev.preventDefault();
  const id = $("editSubjectId")?.value;
  const num = $("editCourseNumber")?.value.trim();
  const desc = $("editCourseDescription")?.value.trim();
  const units = $("editCourseUnit")?.value.trim();
  const scope = $("editSubjectScope")?.value || "general";
  const colId = $("editSubjectCollegeSelect")?.value || null;

  if (!num || !desc) {
    showToast("Course number and description are required.", true);
    return;
  }

  if (scope === "college" && !colId) {
    showToast("Target college is required for college-specific subjects.", true);
    return;
  }

  const btn = $("saveEditSubjectBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  try {
    const isGen = scope === "general";
    const { error } = await sb.from("courses").update({
      course_number: num,
      course_description: desc,
      unit: Number(units) || 0,
      is_general: isGen,
      college_id: isGen ? null : colId,
    }).eq("id", id);

    if (error) throw error;
    closeEditSubjectModal();
    showToast(`Subject ${num} updated successfully.`);
    await loadMasterSubjects();
  } catch (err) {
    console.error("Failed to edit subject:", err);
    showToast(`Couldn't update subject: ${err.message || err}`, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save changes"; }
  }
}

async function handleDeleteMasterSubject(id) {
  const s = masterSubjects.find((x) => String(x.id) === String(id));
  if (!s) return;
  if (!confirm(`Delete subject "${s.course_number} - ${s.course_description}"? This action cannot be undone.`)) return;

  try {
    const { error } = await sb.from("courses").delete().eq("id", id);
    if (error) throw error;
    showToast(`Subject ${s.course_number} deleted.`);
    await loadMasterSubjects();
  } catch (err) {
    console.error("Failed to delete subject:", err);
    showToast(`Couldn't delete subject: ${err.message || err}`, true);
  }
}

// ── Wire up events ──────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  const session = requirePortalRole("Super Admin");
  if (!session) return;
  $("sidebarName").textContent = `${session.first_name} ${session.last_name}`;

  const dbConnected = typeof sb !== "undefined";
  if (!dbConnected) {
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

  // Tab Listeners
  document.querySelectorAll(".create-role-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (editingUserId) exitEditMode();
      setActiveRole(btn.dataset.roleTab);
    });
  });

  document.querySelectorAll(".super-subject-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setSuperSubjectTab(btn.dataset.superSubjectTab);
    });
  });

  $("generalSubjectForm")?.addEventListener("submit", handleCreateGeneralSubject);
  $("collegeSubjectForm")?.addEventListener("submit", handleCreateCollegeSubject);
  $("superCollegeFilter")?.addEventListener("change", renderSuperSubjects);
  $("superSubjectSearchInput")?.addEventListener("input", renderSuperSubjects);
  $("editSubjectScope")?.addEventListener("change", (e) => {
    $("editSubjectCollegeContainer")?.classList.toggle("hidden", e.target.value === "general");
  });

  $("editSubjectModalForm")?.addEventListener("submit", handleSaveEditSubjectModal);
  $("closeEditSubjectModalBtn")?.addEventListener("click", closeEditSubjectModal);
  $("cancelEditSubjectModalBtn")?.addEventListener("click", closeEditSubjectModal);
  $("editSubjectModal")?.addEventListener("click", (e) => {
    if (e.target === $("editSubjectModal")) closeEditSubjectModal();
  });

  // Maintenance Search Bars & Filter Listeners
  $("superCampusSearchInput")?.addEventListener("input", renderCampusList);
  $("superCollegeSearchInput")?.addEventListener("input", renderCollegeList);
  $("superDepartmentSearchInput")?.addEventListener("input", renderDepartmentChips);
  $("superDeptCollegeFilter")?.addEventListener("change", renderDepartmentChips);
  $("superSectionSearchInput")?.addEventListener("input", renderSuperadminSectionChips);
  $("superSectionDeptFilter")?.addEventListener("change", renderSuperadminSectionChips);

  // Maintenance Edit Modals Listeners
  $("editCampusModalForm")?.addEventListener("submit", handleSaveEditCampusModal);
  $("closeEditCampusModalBtn")?.addEventListener("click", closeEditCampusModal);
  $("cancelEditCampusModalBtn")?.addEventListener("click", closeEditCampusModal);
  $("editCampusModal")?.addEventListener("click", (e) => {
    if (e.target === $("editCampusModal")) closeEditCampusModal();
  });

  $("editCollegeModalForm")?.addEventListener("submit", handleSaveEditCollegeModal);
  $("closeEditCollegeModalBtn")?.addEventListener("click", closeEditCollegeModal);
  $("cancelEditCollegeModalBtn")?.addEventListener("click", closeEditCollegeModal);
  $("editCollegeModal")?.addEventListener("click", (e) => {
    if (e.target === $("editCollegeModal")) closeEditCollegeModal();
  });

  $("editDepartmentModalForm")?.addEventListener("submit", handleSaveEditDepartmentModal);
  $("closeEditDepartmentModalBtn")?.addEventListener("click", closeEditDepartmentModal);
  $("cancelEditDepartmentModalBtn")?.addEventListener("click", closeEditDepartmentModal);
  $("editDepartmentModal")?.addEventListener("click", (e) => {
    if (e.target === $("editDepartmentModal")) closeEditDepartmentModal();
  });

  $("editSectionModalForm")?.addEventListener("submit", handleSaveEditSectionModal);
  $("closeEditSectionModalBtn")?.addEventListener("click", closeEditSectionModal);
  $("cancelEditSectionModalBtn")?.addEventListener("click", closeEditSectionModal);
  $("editSectionModal")?.addEventListener("click", (e) => {
    if (e.target === $("editSectionModal")) closeEditSectionModal();
  });

  $("editAcademicCourseModalForm")?.addEventListener("submit", handleSaveEditAcademicCourseModal);
  $("closeEditAcademicCourseModalBtn")?.addEventListener("click", closeEditAcademicCourseModal);
  $("cancelEditAcademicCourseModalBtn")?.addEventListener("click", closeEditAcademicCourseModal);
  $("editAcademicCourseModal")?.addEventListener("click", (e) => {
    if (e.target === $("editAcademicCourseModal")) closeEditAcademicCourseModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeEditSubjectModal();
      closeEditCampusModal();
      closeEditCollegeModal();
      closeEditDepartmentModal();
      closeEditAcademicCourseModal();
      closeEditSectionModal();
    }
  });

  $("campusSelect")?.addEventListener("change", updateCredentialPreview);
  $("collegeSelect")?.addEventListener("change", onCollegeChange);
  $("departmentSelect")?.addEventListener("change", onDepartmentChange);
  $("courseSelect")?.addEventListener("change", () => {
    onCourseChange();
    updateCredentialPreview();
  });
  $("sectionSelect")?.addEventListener("change", updateCredentialPreview);
  $("isAffiliateCheckbox")?.addEventListener("change", updateCredentialPreview);
  $("affiliatedCollegeSelect")?.addEventListener("change", updateCredentialPreview);

  ["lastName", "firstName", "middleInitial", "employeeId", "username", "tempPassword"].forEach((id) => {
    $(id)?.addEventListener("input", updateCredentialPreview);
    $(id)?.addEventListener("change", updateCredentialPreview);
  });
  $("firstName")?.addEventListener("blur", suggestUsername);
  $("lastName")?.addEventListener("blur", suggestUsername);
  $("generatePasswordBtn")?.addEventListener("click", generateTempPassword);
  $("fingerprintBtn")?.addEventListener("click", registerFingerprint);
  $("clearFingerprintBtn")?.addEventListener("clearFingerprint", clearFingerprint);
  $("clearFingerprintBtn")?.addEventListener("click", clearFingerprint);

  // Dual option switching for User Registration Credential
  $("saTabBioBtn")?.addEventListener("click", () => {
    $("saBioPanel")?.classList.remove("hidden");
    $("saQrPanel")?.classList.add("hidden");
    $("saTabBioBtn")?.classList.add("bg-[#14432A]", "text-white");
    $("saTabBioBtn")?.classList.remove("text-[#14432A]");
    $("saTabQrBtn")?.classList.remove("bg-[#14432A]", "text-white");
    $("saTabQrBtn")?.classList.add("text-[#14432A]");
  });

  $("saTabQrBtn")?.addEventListener("click", () => {
    $("saQrPanel")?.classList.remove("hidden");
    $("saBioPanel")?.classList.add("hidden");
    $("saTabQrBtn")?.classList.add("bg-[#14432A]", "text-white");
    $("saTabQrBtn")?.classList.remove("text-[#14432A]");
    $("saTabBioBtn")?.classList.remove("bg-[#14432A]", "text-white");
    $("saTabBioBtn")?.classList.add("text-[#14432A]");

    // Render live QR Code in user registration panel
    const fName = $("firstName")?.value.trim() || "User";
    const lName = $("lastName")?.value.trim() || "Sample";
    const uName = $("username")?.value.trim() || "user.sample";
    const desig = $("designationSelect")?.value || "Faculty";
    const empId = $("employeeId")?.value.trim() || "EMP-" + Math.floor(1000 + Math.random() * 9000);
    const dummyUser = {
      id: "preview-" + Date.now(),
      first_name: fName,
      last_name: lName,
      username: uName,
      designation: desig,
      role: desig.toLowerCase().replace(/\s+/g, ""),
      employee_id: empId,
      campus_name: "Main Campus"
    };
    if (typeof QRClient !== "undefined") {
      const container = $("saRegQrContainer");
      if (container) {
        const payload = QRClient.getUserQrPayload(dummyUser);
        container.innerHTML = QRClient.generateSvg(payload, { size: 84, margin: 1 });
      }
    }
  });

  $("saPreviewIdCardBtn")?.addEventListener("click", () => {
    const fName = $("firstName")?.value.trim() || "User";
    const lName = $("lastName")?.value.trim() || "Sample";
    const uName = $("username")?.value.trim() || "user.sample";
    const desig = $("designationSelect")?.value || "Faculty";
    const empId = $("employeeId")?.value.trim() || "EMP-" + Math.floor(1000 + Math.random() * 9000);
    const dummyUser = {
      id: "preview-" + Date.now(),
      first_name: fName,
      last_name: lName,
      username: uName,
      employee_id: empId,
      designation: desig,
      role: desig.toLowerCase().replace(/\s+/g, ""),
      campus_name: "Main Campus"
    };
    if (typeof QRClient !== "undefined") {
      QRClient.openIdCardModal({ user: dummyUser });
    }
  });

  $("saSampleIdsBtn")?.addEventListener("click", () => {
    if (typeof QRClient !== "undefined") {
      const desig = $("designationSelect")?.value || "superadmin";
      let key = "superadmin";
      if (/dean/i.test(desig)) key = "dean";
      else if (/head/i.test(desig)) key = "depthead";
      else if (/faculty/i.test(desig)) key = "faculty";
      else if (/qa|quality/i.test(desig)) key = "qa";
      else if (/campus/i.test(desig)) key = "campusadmin";
      QRClient.openSampleSchoolIdModal(key);
    }
  });

  $("userForm")?.addEventListener("submit", handleCreateUser);
  $("cancelEditBtn")?.addEventListener("click", () => { exitEditMode(); showView("reports"); });
  initSignaturePad();

  $("addCampusBtn")?.addEventListener("click", addCampus);
  $("campusChips")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-delete");
    if (btn) deleteCampusItem(btn.dataset.id);
  });
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

  $("superAcademicCourseSearchInput")?.addEventListener("input", renderAcademicCourseList);
  $("superCourseDeptFilter")?.addEventListener("change", renderAcademicCourseList);
  $("superSectionCourseFilter")?.addEventListener("change", renderSuperadminSectionChips);
  $("addAcademicCourseBtn")?.addEventListener("click", addAcademicCourse);

  $("newSectionDepartmentSelect")?.addEventListener("change", (e) => {
    const deptId = e.target.value;
    const sc = $("newSectionCourseSelect");
    if (!sc) return;
    sc.innerHTML = '<option value="">— Select Academic Course / Degree Program (Optional) —</option>';
    const filteredCourses = deptId ? academicCourses.filter((c) => String(c.department_id) === String(deptId)) : academicCourses;
    filteredCourses.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.code ? `[${c.code}] ` : ""}${c.name}`;
      sc.appendChild(opt);
    });
  });

  $("addSectionBtn")?.addEventListener("click", async () => {
    const departmentId = $("newSectionDepartmentSelect")?.value || null;
    const courseId = $("newSectionCourseSelect")?.value || null;
    const extra = { department_id: departmentId };
    if (courseId) extra.course_id = courseId;
    const ok = await addMaintenanceItem("sections", $("newSectionInput").value, $("newSectionInput"), null, extra);
    if (ok) {
      if ($("newSectionDepartmentSelect")) $("newSectionDepartmentSelect").value = "";
      if ($("newSectionCourseSelect")) $("newSectionCourseSelect").value = "";
    }
  });
  $("sectionChips")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-delete");
    if (btn) deleteMaintenanceItem(btn.dataset.table, btn.dataset.id);
  });

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
    getExtraFields: () => {
      const colId = $("collegeSelect")?.value;
      return colId ? { college_id: colId } : {};
    }
  });
  wireInlineQuickAdd({
    toggleBtn: "courseQuickAddBtn",
    row: "courseQuickAddRow",
    input: "newCourseQuickInput",
    addBtn: "addCourseQuickBtn",
    table: "academic_courses",
    select: "courseSelect",
    getExtraFields: () => {
      const deptId = $("departmentSelect")?.value;
      return deptId ? { department_id: deptId } : {};
    }
  });
  wireInlineQuickAdd({
    toggleBtn: "sectionQuickAddBtn",
    row: "sectionQuickAddRow",
    input: "newSectionQuickInput",
    addBtn: "addSectionQuickBtn",
    table: "sections",
    select: "sectionSelect",
    getExtraFields: () => {
      const deptId = $("departmentSelect")?.value;
      const courseId = $("courseSelect")?.value;
      const extra = {};
      if (deptId) extra.department_id = deptId;
      if (courseId) extra.course_id = courseId;
      return extra;
    }
  });

  $("userQuickSearchInput")?.addEventListener("input", handleUserQuickSearch);
  $("userQuickSearchInput")?.addEventListener("focus", handleUserQuickSearch);
  $("cancelEditBannerBtn")?.addEventListener("click", exitEditMode);
  $("editUserBannerQrBtn")?.addEventListener("click", () => {
    if (!editingUserId) return;
    const list = editingUserType === "student" ? students : users;
    const targetUser = list.find((x) => String(x.id) === String(editingUserId));
    if (targetUser && typeof QRClient !== "undefined") {
      QRClient.openIdCardModal({ user: targetUser });
    }
  });
  $("deleteUserInFormBtn")?.addEventListener("click", () => {
    if (editingUserId) handleDeleteUser(editingUserId, editingUserType);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#userQuickSearchInput") && !e.target.closest("#userQuickSearchResults")) {
      $("userQuickSearchResults")?.classList.add("hidden");
    }
  });

  $("searchInput")?.addEventListener("input", renderReports);
  $("filterCampus")?.addEventListener("change", renderReports);
  $("filterDesignation")?.addEventListener("change", renderReports);
  $("filterCollege")?.addEventListener("change", renderReports);

  generateTempPassword();
  if (dbConnected) {
    await refreshAll();
    populateReportFilters();
  }
});