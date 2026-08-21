// ============================================================================
//  Course Syllabus editor (ESSU-ACAD-500 format)
//  Accessible to Department Head and Faculty. Reads ?course=<uuid> from the
//  URL, loads/creates the syllabus for that course, and saves the whole
//  document as one JSON blob via upsert_syllabus().
// ============================================================================

function $(id) { return document.getElementById(id); }

let profile = null;
let courseId = null;
let headerImageDataUrl = null; // base64 logo shown in the letterhead
let clos = [];      // [{ id, text }] — as many as the user adds; column count in the plan table follows this
let planRows = [];  // [{ topics, timeAllotment, cloChecks: { [cloId]: bool }, activities, assessments, references }]
let cloIdCounter = 0;
function newCloId() { return `clo_${Date.now()}_${cloIdCounter++}`; }

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

function blankRow() {
  return { topics: "", timeAllotment: "", cloChecks: {}, activities: "", assessments: "", references: "" };
}

// ── Header logo upload ──────────────────────────────────────────────────
// Resized to fit within a reasonable box (preserving aspect ratio) before
// being stored as base64, same pattern used for signatures/profile photos
// elsewhere in this app — keeps the saved document reasonably sized.

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

function defaultContent(course) {
  return {
    headerImage: null,
    institutionName: "Eastern Samar State University",
    institutionTagline: "",
    title: "Course Syllabus",
    courseCode: course?.course_number || "",
    courseTitle: course?.course_description || "",
    units: course?.unit ? `${course.unit} units` : "",
    prerequisite: "",
    totalHours: "",
    courseDescription: "",
    clos: [{ id: newCloId(), text: "" }, { id: newCloId(), text: "" }],
    learningPlan: [blankRow(), blankRow(), blankRow()],
    fullReferences: "",
    docCode: "ESSU-ACAD-500",
    docVersion: "4",
    pageInfo: "Page 1 of 1",
    effectivityDate: "",
  };
}

// ── Rendering ────────────────────────────────────────────────────────────

function renderCloList() {
  const el = $("cloList");
  el.innerHTML = clos.length
    ? clos.map((c, i) => `
        <div class="flex items-start gap-2">
          <div class="font-mono text-xs font-semibold text-[#6B7060] pt-2 w-12 shrink-0">CLO${i + 1}</div>
          <textarea class="field-input clo-text-field border border-[#DEDACE] rounded px-2 py-1.5 flex-1" rows="1" placeholder="Describe this learning outcome…">${c.text || ""}</textarea>
          <button type="button" data-id="${c.id}" class="clo-delete-btn text-[#B3432B] hover:opacity-70 pt-2" title="Remove CLO">✕</button>
        </div>
      `).join("")
    : `<div class="text-xs text-[#6B7060]">No CLOs yet — add the first one above.</div>`;

  el.querySelectorAll(".clo-text-field").forEach((ta, i) => {
    ta.addEventListener("input", (e) => { clos[i].text = e.target.value; });
  });
  el.querySelectorAll(".clo-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const removedId = btn.dataset.id;
      clos = clos.filter((c) => c.id !== removedId);
      planRows.forEach((r) => { delete r.cloChecks[removedId]; });
      renderCloList();
      renderPlanTable();
    });
  });
}

function renderPlanThead() {
  $("planThead").innerHTML = `
    <tr class="bg-[#FAF7EF]">
      <th style="min-width:160px">Topics</th>
      <th style="min-width:90px">Time Allotment</th>
      ${clos.map((c, i) => `<th style="width:36px" title="${(c.text || "").replace(/"/g, "&quot;")}">CLO${i + 1}</th>`).join("")}
      <th style="min-width:160px">Teaching and Learning Activities</th>
      <th style="min-width:160px">Outcomes-Based Assessments</th>
      <th style="min-width:140px">References</th>
      <th style="width:30px"></th>
    </tr>
  `;
}

function renderPlanTable() {
  renderPlanThead();
  const body = $("planBody");
  body.innerHTML = planRows.map((row, i) => `
    <tr data-index="${i}">
      <td><textarea class="field-input plan-field" data-key="topics" rows="2">${row.topics || ""}</textarea></td>
      <td><input class="field-input plan-field" data-key="timeAllotment" value="${row.timeAllotment || ""}"></td>
      ${clos.map((c) => `
        <td class="text-center"><input type="checkbox" class="clo-check plan-clo-check" data-clo-id="${c.id}" ${row.cloChecks[c.id] ? "checked" : ""}></td>
      `).join("")}
      <td><textarea class="field-input plan-field" data-key="activities" rows="2">${row.activities || ""}</textarea></td>
      <td><textarea class="field-input plan-field" data-key="assessments" rows="2">${row.assessments || ""}</textarea></td>
      <td><textarea class="field-input plan-field" data-key="references" rows="2">${row.references || ""}</textarea></td>
      <td class="text-center"><button type="button" class="row-delete-btn text-[#B3432B] hover:opacity-70" title="Remove row">✕</button></td>
    </tr>
  `).join("");

  body.querySelectorAll(".plan-field").forEach((el) => {
    el.addEventListener("input", (e) => {
      const idx = Number(e.target.closest("tr").dataset.index);
      planRows[idx][e.target.dataset.key] = e.target.value;
    });
  });
  body.querySelectorAll(".plan-clo-check").forEach((el) => {
    el.addEventListener("change", (e) => {
      const idx = Number(e.target.closest("tr").dataset.index);
      planRows[idx].cloChecks[e.target.dataset.cloId] = e.target.checked;
    });
  });
  body.querySelectorAll(".row-delete-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.closest("tr").dataset.index);
      planRows.splice(idx, 1);
      renderPlanTable();
    });
  });
}

function renderForm(content) {
  headerImageDataUrl = content.headerImage || null;
  renderHeaderLogoPreview();
  $("institutionName").value = content.institutionName || "Eastern Samar State University";
  $("institutionTagline").value = content.institutionTagline || "";
  $("docTitle").value = content.title || "Course Syllabus";
  $("courseCode").value = content.courseCode || "";
  $("courseTitle").value = content.courseTitle || "";
  $("units").value = content.units || "";
  $("prerequisite").value = content.prerequisite || "";
  $("totalHours").value = content.totalHours || "";
  $("courseDescription").value = content.courseDescription || "";
  $("fullReferences").value = content.fullReferences || "";
  $("docCode").value = content.docCode || "ESSU-ACAD-500";
  $("docVersion").value = content.docVersion || "4";
  $("pageInfo").value = content.pageInfo || "Page 1 of 1";
  $("effectivityDate").value = content.effectivityDate || "";

  clos = (content.clos && content.clos.length ? content.clos : [{ id: newCloId(), text: "" }, { id: newCloId(), text: "" }])
    .map((c) => ({ id: c.id || newCloId(), text: c.text || "" }));

  planRows = (content.learningPlan && content.learningPlan.length ? content.learningPlan : [blankRow(), blankRow(), blankRow()])
    .map((r) => ({ ...blankRow(), ...r, cloChecks: { ...(r.cloChecks || {}) } }));

  renderCloList();
  renderPlanTable();
}

function collectContent() {
  return {
    headerImage: headerImageDataUrl,
    institutionName: $("institutionName").value,
    institutionTagline: $("institutionTagline").value,
    title: $("docTitle").value,
    courseCode: $("courseCode").value,
    courseTitle: $("courseTitle").value,
    units: $("units").value,
    prerequisite: $("prerequisite").value,
    totalHours: $("totalHours").value,
    courseDescription: $("courseDescription").value,
    clos,
    learningPlan: planRows,
    fullReferences: $("fullReferences").value,
    docCode: $("docCode").value,
    docVersion: $("docVersion").value,
    pageInfo: $("pageInfo").value,
    effectivityDate: $("effectivityDate").value,
  };
}

// ── Load / Save ──────────────────────────────────────────────────────────

async function loadSyllabus() {
  const { data: course, error: courseErr } = await sb.from("courses_report").select("*").eq("id", courseId).single();
  if (courseErr || !course) {
    console.error("Couldn't load course:", courseErr);
    $("loadingState").textContent = "Couldn't find that course. Go back and open the syllabus from the Forms tab.";
    return;
  }

  const { data: existing, error: sylErr } = await sb.from("syllabi").select("content").eq("course_id", courseId).maybeSingle();
  if (sylErr) console.error("Couldn't load existing syllabus:", sylErr);

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
    const { error } = await sb.rpc("upsert_syllabus", { p_course_id: courseId, p_content: collectContent() });
    if (error) throw error;
    $("saveStatus").textContent = `Saved ${new Date().toLocaleTimeString()}`;
    showToast("Syllabus saved.");
  } catch (err) {
    console.error("Failed to save syllabus:", err);
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
    $("loadingState").textContent = "No course selected. Go back and open the syllabus from the Forms tab.";
    return;
  }
  if (typeof sb === "undefined") {
    console.error("`sb` is undefined — supabaseClient.js did not load. Check that it sits next to this HTML file.");
    $("loadingState").textContent = "Database connection not found — supabaseClient.js did not load. Check the browser console.";
    return;
  }

  $("saveBtn")?.addEventListener("click", handleSave);
  $("addRowBtn")?.addEventListener("click", () => { planRows.push(blankRow()); renderPlanTable(); });
  $("uploadHeaderLogoBtn")?.addEventListener("click", () => $("headerLogoFileInput")?.click());
  $("headerLogoFileInput")?.addEventListener("change", handleHeaderLogoUpload);
  $("removeHeaderLogoBtn")?.addEventListener("click", () => {
    headerImageDataUrl = null;
    $("headerLogoFileInput").value = "";
    renderHeaderLogoPreview();
  });
  $("addCloBtn")?.addEventListener("click", () => { clos.push({ id: newCloId(), text: "" }); renderCloList(); renderPlanTable(); });

  loadSyllabus();
});