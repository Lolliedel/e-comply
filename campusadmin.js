// ============================================================================
//  Campus Administrator Panel — application logic
// ============================================================================

function $(id) { return document.getElementById(id); }

let sessionProfile = null;
let campusUsers = [];
let campusStudents = [];
let campusDepts = [];
let campusSubjects = [];
let complianceDocs = [];

function showToast(message, isError = false) {
  const toast = $("toast");
  const msg = $("toastMsg");
  if (!toast || !msg) return;
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

function showView(view) {
  ["home", "departments", "users", "compliance"].forEach((v) => {
    $(`view-${v}`)?.classList.toggle("hidden", v !== view);
  });
  document.querySelectorAll(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
}

function initials(first, last) {
  return ((first?.[0] || "") + (last?.[0] || "")).toUpperCase();
}

function formatName(u) {
  const mi = u.middle_initial ? u.middle_initial.toUpperCase() + "." : "";
  return `${u.last_name}, ${u.first_name} ${mi}`.trim();
}

async function loadCampusData() {
  const campusName = sessionProfile.campus_name || "Main Campus";
  const campusId = sessionProfile.campus_id;

  try {
    // 1. Load users for this campus
    let staffQuery = sb.from("app_users_report").select("*");
    if (campusId) {
      staffQuery = staffQuery.or(`campus_id.eq.${campusId},campus_name.eq.${campusName}`);
    } else {
      staffQuery = staffQuery.eq("campus_name", campusName);
    }
    const { data: staffData } = await staffQuery;
    campusUsers = staffData || [];

    // 2. Load students for this campus
    let studentQuery = sb.from("students_report").select("*");
    if (campusId) {
      studentQuery = studentQuery.or(`campus_id.eq.${campusId},campus_name.eq.${campusName}`);
    } else {
      studentQuery = studentQuery.eq("campus_name", campusName);
    }
    const { data: studentData } = await studentQuery;
    campusStudents = studentData || [];

    // 3. Load departments & subjects
    const { data: deptData } = await sb.from("departments").select("*").order("name");
    campusDepts = deptData || [];

    const { data: courseData } = await sb.from("courses").select("*").order("course_number");
    campusSubjects = courseData || [];

    // 4. Load compliance document submissions (Strictly scoped to this campus)
    let docQuery = sb.from("form_submissions").select("*").order("updated_at", { ascending: false });
    if (campusId) {
      docQuery = docQuery.or(`campus_id.eq.${campusId},campus_name.eq.${campusName}`);
    } else {
      docQuery = docQuery.eq("campus_name", campusName);
    }
    const { data: subData } = await docQuery;
    complianceDocs = (subData || []).filter(d => !d.campus_name || d.campus_name === campusName || (campusId && String(d.campus_id) === String(campusId)));

  } catch (err) {
    console.error("Error loading campus data:", err);
    showToast("Couldn't load complete campus records.", true);
  }

  renderOverview();
  renderDepartments();
  renderPersonnel();
  renderCompliance();
}

function renderOverview() {
  const deans = campusUsers.filter((u) => u.designation === "Dean").length;
  const heads = campusUsers.filter((u) => u.designation === "Department Head").length;
  const faculty = campusUsers.filter((u) => u.designation === "Faculty").length;
  const students = campusStudents.length;

  $("statCampusDeans").textContent = deans;
  $("statCampusHeads").textContent = heads;
  $("statCampusFaculty").textContent = faculty;
  $("statCampusStudents").textContent = students;

  const combined = [
    ...campusUsers.map((u) => ({ ...u, account_type: "user" })),
    ...campusStudents.map((s) => ({ ...s, designation: "Student", account_type: "student" }))
  ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const recent = combined.slice(0, 6);
  $("campusRecentList").innerHTML = recent.length === 0
    ? `<div class="text-center py-5 text-[#6B7060] text-sm">No campus personnel registered yet.</div>`
    : recent.map((u) => `
        <div class="flex items-center gap-3 py-2.5">
          <div class="w-8 h-8 rounded-full text-white text-xs font-bold font-display flex items-center justify-center shrink-0 bg-[#1F6F4A]">${initials(u.first_name, u.last_name)}</div>
          <div class="flex-1">
            <div class="text-sm font-semibold">${formatName(u)}</div>
            <div class="text-xs text-[#6B7060]">${u.college || u.department || "Campus Member"}</div>
          </div>
          <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#FBF3D9] text-[#8A6A0C]">${u.designation}</span>
        </div>
      `).join("");
}

function renderDepartments() {
  const deptEl = $("campusDeptList");
  if (deptEl) {
    deptEl.innerHTML = campusDepts.length === 0
      ? `<div class="text-xs text-[#6B7060]">No departments listed.</div>`
      : campusDepts.map((d) => `
          <div class="p-3 bg-[#FCFBF6] border border-[#EFEBDB] rounded-lg flex items-center justify-between">
            <span class="font-semibold text-sm text-[#14432A]">${d.name}</span>
            <span class="text-xs text-[#6B7060] font-mono">ID: ${d.id}</span>
          </div>
        `).join("");
  }

  const subjEl = $("campusSubjectList");
  if (subjEl) {
    subjEl.innerHTML = campusSubjects.length === 0
      ? `<div class="text-xs text-[#6B7060]">No subjects listed.</div>`
      : campusSubjects.slice(0, 10).map((s) => `
          <div class="p-3 bg-[#FCFBF6] border border-[#EFEBDB] rounded-lg flex items-center justify-between">
            <div>
              <div class="font-mono text-xs font-bold text-[#8A6A0C]">${s.course_number}</div>
              <div class="text-sm text-[#1B2116]">${s.course_description}</div>
            </div>
            <span class="text-xs font-semibold text-[#14432A] px-2 py-1 bg-[#14432A]/10 rounded">${s.unit || 3} units</span>
          </div>
        `).join("");
  }
}

function renderPersonnel() {
  const search = $("campusSearchInput")?.value.trim().toLowerCase() || "";
  const roleFilter = $("campusRoleFilter")?.value || "All";

  const staff = campusUsers.map((u) => ({ ...u, type: "staff" }));
  const stus = campusStudents.map((s) => ({ ...s, designation: "Student", type: "student" }));
  const all = [...staff, ...stus];

  const filtered = all
    .filter((u) => roleFilter === "All" || u.designation === roleFilter)
    .filter((u) =>
      !search ||
      (u.last_name && u.last_name.toLowerCase().includes(search)) ||
      (u.first_name && u.first_name.toLowerCase().includes(search)) ||
      (u.username && u.username.toLowerCase().includes(search))
    );

  const body = $("campusUsersBody");
  if (!body) return;

  body.innerHTML = filtered.length === 0
    ? `<tr><td colspan="7" class="text-center py-6 text-sm text-[#6B7060]">No campus personnel found.</td></tr>`
    : filtered.map((u) => `
        <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0] transition">
          <td class="px-3.5 py-3 font-mono text-xs font-semibold text-[#6B7060] whitespace-nowrap">${u.id}</td>
          <td class="px-3.5 py-3">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-7 h-7 rounded-full text-white text-[10px] font-bold font-display flex items-center justify-center shrink-0 bg-[#1F6F4A]">${initials(u.first_name, u.last_name)}</div>
              <span class="font-semibold text-sm whitespace-nowrap">${formatName(u)}</span>
            </div>
          </td>
          <td class="px-3.5 py-3 whitespace-nowrap">
            <span class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#FBF3D9] text-[#8A6A0C] inline-block">${u.designation}</span>
          </td>
          <td class="px-3.5 py-3 text-xs text-[#52555C] whitespace-nowrap">${u.college || u.department || "—"}</td>
          <td class="px-3.5 py-3 font-mono text-xs text-[#6B7060] whitespace-nowrap">${u.username ? "@" + u.username : "—"}</td>
          <td class="px-3.5 py-3 whitespace-nowrap">
            <span class="text-xs font-semibold text-[#1F6F4A]">Active</span>
          </td>
          <td class="px-3.5 py-3 text-right whitespace-nowrap">
            <button onclick="viewCampusUserQr('${u.id}', '${u.type}')" class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md border border-[#DEDACE] bg-white hover:bg-[#FAF7EF] text-[#14432A] transition whitespace-nowrap shrink-0">
              <img src="ICON/qr.svg" class="w-3.5 h-3.5" alt="">
              <span>ID &amp; QR</span>
            </button>
          </td>
        </tr>
      `).join("");
}

window.viewCampusUserQr = function(userId, type) {
  const user = type === "student"
    ? campusStudents.find(s => String(s.id) === String(userId))
    : campusUsers.find(u => String(u.id) === String(userId));
  if (!user) {
    showToast("User record not found", true);
    return;
  }
  const normalized = {
    ...user,
    role: type === "student" ? "student" : "staff",
    designation: user.designation || (type === "student" ? "Student" : "Staff"),
    campus_name: sessionProfile?.campus_name || "Main Campus"
  };
  if (typeof QRClient !== "undefined") {
    QRClient.openIdCardModal(normalized);
  } else {
    showToast("QR Client library not loaded", true);
  }
};

function renderCompliance() {
  const body = $("campusComplianceBody");
  if (!body) return;

  body.innerHTML = complianceDocs.length === 0
    ? `<tr><td colspan="5" class="text-center py-6 text-sm text-[#6B7060]">No compliance document submissions recorded for this campus.</td></tr>`
    : complianceDocs.slice(0, 10).map((d) => `
        <tr class="border-b border-[#EFEBDB] hover:bg-[#FBF9F0]">
          <td class="px-4 py-3 font-semibold text-xs text-[#14432A] uppercase">${d.form_type || "Syllabus"}</td>
          <td class="px-4 py-3 font-mono text-xs">${d.course_number || "—"}</td>
          <td class="px-4 py-3 text-xs">${d.submitted_by_name || "Faculty Member"}</td>
          <td class="px-4 py-3">
            <span class="text-xs font-semibold px-2 py-0.5 rounded bg-[#E5EDF9] text-[#1E40AF]">${d.status || "Submitted"}</span>
          </td>
          <td class="px-4 py-3 text-xs text-[#6B7060]">${d.updated_at ? new Date(d.updated_at).toLocaleDateString() : "—"}</td>
        </tr>
      `).join("");
}

document.addEventListener("DOMContentLoaded", async () => {
  sessionProfile = requirePortalRole("Campus Administrator");
  if (!sessionProfile) return;

  const campusName = sessionProfile.campus_name || "Main Campus";
  $("sidebarName").textContent = `${sessionProfile.first_name} ${sessionProfile.last_name}`;
  if ($("sidebarCampusName")) $("sidebarCampusName").textContent = campusName;
  if ($("activeCampusTag")) $("activeCampusTag").textContent = campusName;

  $("campusSearchInput")?.addEventListener("input", renderPersonnel);
  $("campusRoleFilter")?.addEventListener("change", renderPersonnel);

  await loadCampusData();
});
