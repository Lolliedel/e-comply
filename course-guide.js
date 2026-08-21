// ============================================================================
//  Course Guide editor (ESSU-ACAD-501 format)
//  Accessible to Department Head, Dean, and Faculty. Reads ?course=<uuid>
//  from the URL, loads/creates the course guide for that course, and saves
//  the whole document as one JSON blob via upsert_course_guide().
// ============================================================================

function $(id) { return document.getElementById(id); }

let profile = null;
let courseId = null;
let headerImageDataUrl = null; // base64 logo shown in the letterhead
let scheduleRows = [];  // [{ date, topic }]
let outcomeRows = [];   // [{ outcome, output }]
let appendices = [];    // [{ id, text }]
let idCounter = 0;
function newId() { return `id_${Date.now()}_${idCounter++}`; }

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

// ── Header logo upload (same pattern as the Syllabus editor) ───────────

function renderHeaderLogoPreview() {
  const el = $("headerLogoPreview");
  if (!el) return;
  el.innerHTML = headerImageDataUrl
    ? `<img src="${headerImageDataUrl}" class="w-full h-full object-contain">`
    : "No logo";
}

function handleHeaderLogoUpload(e) {
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
      const maxSize = 240;
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      headerImageDataUrl = canvas.toDataURL("image/png");
      renderHeaderLogoPreview();
    };
    img.onerror = () => showToast("Couldn't read that image file.", true);
    img.src = reader.result;
  };
  reader.onerror = () => showToast("Couldn't read that file.", true);
  reader.readAsDataURL(file);
}

// ── Data model ───────────────────────────────────────────────────────────

function defaultContent(course) {
  return {
    headerImage: null,
    institutionName: "Eastern Samar State University",
    institutionTagline: "",
    title: "Course Guide",
    courseName: course ? `${course.course_number} — ${course.course_description}` : "",
    semester: "",
    schoolYear: "",
    classSchedule: course?.days && course?.start_time ? `${course.days} ${course.start_time}–${course.end_time}` : "",
    instructor: course?.faculty_first_name ? `${course.faculty_first_name} ${course.faculty_last_name}` : "",
    courseDescription: "",
    courseOutline: "",
    scheduleRows: [{ date: "", topic: "" }, { date: "", topic: "" }],
    outcomeRows: [{ outcome: "", output: "" }],
    coursePolicies: "",
    gradingSystem: "",
    fullReferences: "",
    consultationSchedule: "",
    preparedByName: "",
    approvedByName: "",
    appendices: [{ id: newId(), text: "Rubrics for Output 1" }],
    docCode: "ESSU-ACAD-501",
    docVersion: "5",
    pageInfo: "Page 1 of 1",
    effectivityDate: "",
  };
}

// ── Rendering: Schedule table ────────────────────────────────────────────

function renderScheduleTable() {
  const body = $("scheduleBody");
  body.innerHTML = scheduleRows.map((row, i) => `
    <tr data-index="${i}">
      <td><input class="field-input schedule-field" data-key="date" placeholder="Month, Day" value="${row.date || ""}"></td>
      <td><textarea class="field-input schedule-field" data-key="topic" rows="1">${row.topic || ""}</textarea></td>
      <td class="text-center"><button type="button" class="schedule-delete-btn text-[#B3432B] hover:opacity-70" title="Remove row">✕</button></td>
    </tr>
  `).join("");

  body.querySelectorAll(".schedule-field").forEach((el) => {
    el.addEventListener("input", (e) => {
      const idx = Number(e.target.closest("tr").dataset.index);
      scheduleRows[idx][e.target.dataset.key] = e.target.value;
    });
  });
  body.querySelectorAll(".schedule-delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.closest("tr").dataset.index);
      scheduleRows.splice(idx, 1);
      renderScheduleTable();
    });
  });
}

// ── Rendering: Course Learning Outcome / Required Output table ─────────

function renderOutcomeTable() {
  const body = $("outcomeBody");
  body.innerHTML = outcomeRows.map((row, i) => `
    <tr data-index="${i}">
      <td><textarea class="field-input outcome-field" data-key="outcome" rows="2">${row.outcome || ""}</textarea></td>
      <td><textarea class="field-input outcome-field" data-key="output" rows="2">${row.output || ""}</textarea></td>
      <td class="text-center"><button type="button" class="outcome-delete-btn text-[#B3432B] hover:opacity-70" title="Remove row">✕</button></td>
    </tr>
  `).join("");

  body.querySelectorAll(".outcome-field").forEach((el) => {
    el.addEventListener("input", (e) => {
      const idx = Number(e.target.closest("tr").dataset.index);
      outcomeRows[idx][e.target.dataset.key] = e.target.value;
    });
  });
  body.querySelectorAll(".outcome-delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.closest("tr").dataset.index);
      outcomeRows.splice(idx, 1);
      renderOutcomeTable();
    });
  });
}

// ── Rendering: Appendices list ──────────────────────────────────────────

function renderAppendixList() {
  const el = $("appendixList");
  el.innerHTML = appendices.length
    ? appendices.map((a, i) => `
        <div class="flex items-center gap-2">
          <div class="font-mono text-xs font-semibold text-[#6B7060] w-8 shrink-0">[${i + 1}]</div>
          <input class="field-input appendix-field border border-[#DEDACE] rounded px-2 py-1.5 flex-1" value="${(a.text || "").replace(/"/g, "&quot;")}" placeholder="e.g. Rubrics for Output 1">
          <button type="button" data-id="${a.id}" class="appendix-delete-btn text-[#B3432B] hover:opacity-70" title="Remove appendix">✕</button>
        </div>
      `).join("")
    : `<div class="text-xs text-[#6B7060]">No appendices yet.</div>`;

  el.querySelectorAll(".appendix-field").forEach((input, i) => {
    input.addEventListener("input", (e) => { appendices[i].text = e.target.value; });
  });
  el.querySelectorAll(".appendix-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      appendices = appendices.filter((a) => a.id !== btn.dataset.id);
      renderAppendixList();
    });
  });
}

// ── Whole-form render / collect ─────────────────────────────────────────

function renderForm(content) {
  headerImageDataUrl = content.headerImage || null;
  renderHeaderLogoPreview();
  $("institutionName").value = content.institutionName || "Eastern Samar State University";
  $("institutionTagline").value = content.institutionTagline || "";
  $("docTitle").value = content.title || "Course Guide";
  $("courseName").value = content.courseName || "";
  $("semester").value = content.semester || "";
  $("schoolYear").value = content.schoolYear || "";
  $("classSchedule").value = content.classSchedule || "";
  $("instructor").value = content.instructor || "";
  $("courseDescription").value = content.courseDescription || "";
  $("courseOutline").value = content.courseOutline || "";
  $("coursePolicies").value = content.coursePolicies || "";
  $("gradingSystem").value = content.gradingSystem || "";
  $("fullReferences").value = content.fullReferences || "";
  $("consultationSchedule").value = content.consultationSchedule || "";
  $("preparedByName").value = content.preparedByName || "";
  $("approvedByName").value = content.approvedByName || "";
  $("docCode").value = content.docCode || "ESSU-ACAD-501";
  $("docVersion").value = content.docVersion || "5";
  $("pageInfo").value = content.pageInfo || "Page 1 of 1";
  $("effectivityDate").value = content.effectivityDate || "";

  scheduleRows = content.scheduleRows && content.scheduleRows.length ? content.scheduleRows : [{ date: "", topic: "" }, { date: "", topic: "" }];
  outcomeRows = content.outcomeRows && content.outcomeRows.length ? content.outcomeRows : [{ outcome: "", output: "" }];
  appendices = (content.appendices && content.appendices.length ? content.appendices : [{ id: newId(), text: "Rubrics for Output 1" }])
    .map((a) => ({ id: a.id || newId(), text: a.text || "" }));

  renderScheduleTable();
  renderOutcomeTable();
  renderAppendixList();
}

function collectContent() {
  return {
    headerImage: headerImageDataUrl,
    institutionName: $("institutionName").value,
    institutionTagline: $("institutionTagline").value,
    title: $("docTitle").value,
    courseName: $("courseName").value,
    semester: $("semester").value,
    schoolYear: $("schoolYear").value,
    classSchedule: $("classSchedule").value,
    instructor: $("instructor").value,
    courseDescription: $("courseDescription").value,
    courseOutline: $("courseOutline").value,
    scheduleRows,
    outcomeRows,
    coursePolicies: $("coursePolicies").value,
    gradingSystem: $("gradingSystem").value,
    fullReferences: $("fullReferences").value,
    consultationSchedule: $("consultationSchedule").value,
    preparedByName: $("preparedByName").value,
    approvedByName: $("approvedByName").value,
    appendices,
    docCode: $("docCode").value,
    docVersion: $("docVersion").value,
    pageInfo: $("pageInfo").value,
    effectivityDate: $("effectivityDate").value,
  };
}

// ── Load / Save ──────────────────────────────────────────────────────────

async function loadCourseGuide() {
  const { data: course, error: courseErr } = await sb.from("courses_report").select("*").eq("id", courseId).single();
  if (courseErr || !course) {
    console.error("Couldn't load course:", courseErr);
    $("loadingState").textContent = "Couldn't find that course. Go back and open the course guide from the Forms tab.";
    return;
  }

  const { data: existing, error: cgErr } = await sb.from("course_guides").select("content").eq("course_id", courseId).maybeSingle();
  if (cgErr) console.error("Couldn't load existing course guide:", cgErr);

  renderForm(existing?.content || defaultContent(course));

  $("loadingState").classList.add("hidden");
  $("appShell").classList.remove("hidden");
}

async function handleSave() {
  const btn = $("saveBtn");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Saving…";
  try {
    const { error } = await sb.rpc("upsert_course_guide", { p_course_id: courseId, p_content: collectContent() });
    if (error) throw error;
    $("saveStatus").textContent = `Saved ${new Date().toLocaleTimeString()}`;
    showToast("Course guide saved.");
  } catch (err) {
    console.error("Failed to save course guide:", err);
    showToast(`Couldn't save: ${err.message || err}`, true);
  }
  btn.disabled = false;
  btn.textContent = original;
}

// ── Startup ─────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  profile = requirePortalRoleAny(["Department Head", "Dean", "Faculty"]); // redirects to index.html if none of these roles
  if (!profile) return;

  const params = new URLSearchParams(window.location.search);
  courseId = params.get("course");
  $("backLink").href = PORTAL_ROUTES[profile.designation] || "index.html";

  if (!courseId) {
    $("loadingState").textContent = "No course selected. Go back and open the course guide from the Forms tab.";
    return;
  }
  if (typeof sb === "undefined") {
    console.error("`sb` is undefined — supabaseClient.js did not load. Check that it sits next to this HTML file.");
    $("loadingState").textContent = "Database connection not found — supabaseClient.js did not load. Check the browser console.";
    return;
  }

  $("saveBtn")?.addEventListener("click", handleSave);
  $("addScheduleRowBtn")?.addEventListener("click", () => { scheduleRows.push({ date: "", topic: "" }); renderScheduleTable(); });
  $("addOutcomeRowBtn")?.addEventListener("click", () => { outcomeRows.push({ outcome: "", output: "" }); renderOutcomeTable(); });
  $("addAppendixBtn")?.addEventListener("click", () => { appendices.push({ id: newId(), text: "" }); renderAppendixList(); });
  $("uploadHeaderLogoBtn")?.addEventListener("click", () => $("headerLogoFileInput")?.click());
  $("headerLogoFileInput")?.addEventListener("change", handleHeaderLogoUpload);
  $("removeHeaderLogoBtn")?.addEventListener("click", () => {
    headerImageDataUrl = null;
    $("headerLogoFileInput").value = "";
    renderHeaderLogoPreview();
  });

  loadCourseGuide();
});