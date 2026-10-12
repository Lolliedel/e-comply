// ============================================================================
//  Acceptance of Course Guide (ESSU-ACAD-502)
//  Department Head / Dean / Faculty can edit. Students can view (read-only)
//  once the course's "Acceptance of Course Guide" status is Approved.
// ============================================================================

function $(id) { return document.getElementById(id); }

let profile = null;
let courseId = null;
let readOnly = false;
let headerImageDataUrl = null;
let rosterRows = []; // [{ studentId, acknowledgedAt, comments }]
let sectionStudents = []; // students_report rows for this course's section

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

// ── Header logo upload ──────────────────────────────────────────────────

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
  if (!file.type.startsWith("image/")) { showToast("Please choose an image file.", true); e.target.value = ""; return; }
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
    title: "Acceptance of Course Guide",
    courseCodeName: course ? `${course.course_number} — ${course.course_description}` : "",
    semester: "",
    instructorName: course?.faculty_first_name ? `${course.faculty_first_name} ${course.faculty_last_name}` : "",
    department: course?.department || "",
    rows: [],
    instructorNotedName: "",
    programHeadNotedName: "",
    docCode: "ESSU-ACAD-502",
    docVersion: "5",
    pageInfo: "Page 1 of 1",
    effectivityDate: "",
  };
}

// Make sure every student currently in the course's section has a roster
// row — adds any missing, never removes existing ones (keeps acknowledgment
// history even if a student later changes section).
function syncRosterWithSection() {
  const existingIds = new Set(rosterRows.map((r) => r.studentId));
  sectionStudents.forEach((s) => {
    if (!existingIds.has(s.id)) rosterRows.push({ studentId: s.id, acknowledgedAt: null, comments: "" });
  });
}

// ── Rendering ────────────────────────────────────────────────────────────

function renderRoster() {
  const body = $("rosterBody");
  const empty = $("rosterEmpty");
  const table = body.closest("table");

  if (rosterRows.length === 0) {
    body.innerHTML = "";
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  table.classList.remove("hidden");
  empty.classList.add("hidden");

  body.innerHTML = rosterRows.map((row, i) => {
    const student = sectionStudents.find((s) => s.id === row.studentId);
    const name = student ? `${student.last_name}, ${student.first_name}` : "(student no longer in section)";
    const signed = !!row.acknowledgedAt;
    const sigCell = signed && student?.esignature
      ? `<img src="${student.esignature}" class="h-10 object-contain">`
      : signed
        ? `<span class="text-xs text-[#1F6F4A] font-semibold">Acknowledged</span>`
        : `<span class="text-xs text-[#B9B2A0]">Not yet signed</span>`;
    const actionCell = readOnly ? "" : (signed
      ? `<button type="button" data-index="${i}" class="unmark-btn text-xs text-[#B3432B] hover:underline mt-1 block">Undo</button>`
      : `<div class="flex items-center gap-2 mt-1">
           <button type="button" data-index="${i}" class="mark-btn text-xs text-[#8A6A0C] hover:underline">Mark received</button>
           <button type="button" data-index="${i}" class="scan-bio-btn text-xs text-[#14432A] font-semibold hover:underline flex items-center gap-0.5"><img src="ICON/scanner.svg" class="w-3.5 h-3.5 object-contain" alt=""> Scan</button>
         </div>`);

    return `
      <tr data-index="${i}">
        <td class="text-center">${i + 1}</td>
        <td>${name}</td>
        <td>${sigCell}${actionCell}</td>
        <td>${row.acknowledgedAt ? new Date(row.acknowledgedAt).toLocaleDateString() : "—"}</td>
        <td><textarea class="field-input comments-field" data-index="${i}" rows="1" ${readOnly ? "disabled" : ""}>${row.comments || ""}</textarea></td>
      </tr>
    `;
  }).join("");

  if (!readOnly) {
    body.querySelectorAll(".mark-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        rosterRows[Number(e.target.dataset.index)].acknowledgedAt = new Date().toISOString();
        renderRoster();
      });
    });
    body.querySelectorAll(".unmark-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        rosterRows[Number(e.target.dataset.index)].acknowledgedAt = null;
        renderRoster();
      });
    });
    body.querySelectorAll(".scan-bio-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const idx = Number(e.currentTarget.dataset.index);
        const row = rosterRows[idx];
        const student = sectionStudents.find((s) => s.id === row.studentId);
        if (!student) return;

        const auth = await BiometricSigner.requireBiometricSignature({
          user: student,
          actionTitle: "Acknowledge Course Guide",
          subtitle: `Biometric verification required for ${formatName(student)}.`
        });

        if (auth.success) {
          row.acknowledgedAt = new Date().toISOString();
          renderRoster();
          showToast(`✓ ${auth.signeeName} verified and signature attached!`);
        } else {
          showToast("Biometric verification cancelled.", true);
        }
      });
    });
    body.querySelectorAll(".comments-field").forEach((el) => {
      el.addEventListener("input", (e) => {
        rosterRows[Number(e.target.dataset.index)].comments = e.target.value;
      });
    });
  }
}

function renderForm(content) {
  headerImageDataUrl = content.headerImage || null;
  renderHeaderLogoPreview();
  $("institutionName").value = content.institutionName || "Eastern Samar State University";
  $("institutionTagline").value = content.institutionTagline || "";
  $("docTitle").value = content.title || "Acceptance of Course Guide";
  $("courseCodeName").value = content.courseCodeName || "";
  $("semester").value = content.semester || "";
  $("instructorName").value = content.instructorName || "";
  $("department").value = content.department || "";
  $("instructorNotedName").value = content.instructorNotedName || "";
  $("programHeadNotedName").value = content.programHeadNotedName || "";
  $("docCode").value = content.docCode || "ESSU-ACAD-502";
  $("docVersion").value = content.docVersion || "5";
  $("pageInfo").value = content.pageInfo || "Page 1 of 1";
  $("effectivityDate").value = content.effectivityDate || "";

  rosterRows = content.rows || [];
  syncRosterWithSection();
  renderRoster();
}

function collectContent() {
  return {
    headerImage: headerImageDataUrl,
    institutionName: $("institutionName").value,
    institutionTagline: $("institutionTagline").value,
    title: $("docTitle").value,
    courseCodeName: $("courseCodeName").value,
    semester: $("semester").value,
    instructorName: $("instructorName").value,
    department: $("department").value,
    rows: rosterRows,
    instructorNotedName: $("instructorNotedName").value,
    programHeadNotedName: $("programHeadNotedName").value,
    docCode: $("docCode").value,
    docVersion: $("docVersion").value,
    pageInfo: $("pageInfo").value,
    effectivityDate: $("effectivityDate").value,
  };
}

// ── Load / Save ──────────────────────────────────────────────────────────

async function loadDocument() {
  const { data: course, error: courseErr } = await sb.from("courses_report").select("*").eq("id", courseId).single();
  if (courseErr || !course) {
    console.error("Couldn't load course:", courseErr);
    $("loadingState").textContent = "Couldn't find that course.";
    return;
  }

  if (course.section_id) {
    const { data: students, error: studErr } = await sb.from("students_report").select("*").eq("section_id", course.section_id);
    if (studErr) console.error("Couldn't load section roster:", studErr);
    sectionStudents = students || [];
  } else {
    sectionStudents = [];
  }

  const { data: existing, error: docErr } = await sb.from("acceptance_rosters").select("content").eq("course_id", courseId).maybeSingle();
  if (docErr) console.error("Couldn't load existing document:", docErr);

  renderForm(existing?.content || defaultContent(course));

  if (readOnly) {
    document.querySelectorAll(".field-input").forEach((el) => { el.disabled = true; });
    $("editControls").classList.add("hidden");
    $("logoControls").classList.add("hidden");
  }

  $("loadingState").classList.add("hidden");
  $("appShell").classList.remove("hidden");
}

async function handleSave() {
  const btn = $("saveBtn");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Saving…";
  try {
    const { error } = await sb.rpc("upsert_acceptance_roster", { p_course_id: courseId, p_content: collectContent() });
    if (error) throw error;
    $("saveStatus").textContent = `Saved ${new Date().toLocaleTimeString()}`;
    showToast("Saved.");
  } catch (err) {
    console.error("Failed to save:", err);
    showToast(`Couldn't save: ${err.message || err}`, true);
  }
  btn.disabled = false;
  btn.textContent = original;
}

// ── Startup ─────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  profile = requirePortalRoleAny(["Department Head", "Dean", "Faculty", "Student"]);
  if (!profile) return;
  readOnly = profile.designation === "Student";

  const params = new URLSearchParams(window.location.search);
  courseId = params.get("course");
  $("backLink").href = PORTAL_ROUTES[profile.designation] || "index.html";

  if (!courseId) {
    $("loadingState").textContent = "No course selected.";
    return;
  }
  if (typeof sb === "undefined") {
    console.error("`sb` is undefined — supabaseClient.js did not load.");
    $("loadingState").textContent = "Database connection not found — supabaseClient.js did not load. Check the browser console.";
    return;
  }

  if (!readOnly) {
    $("saveBtn")?.addEventListener("click", handleSave);
    $("uploadHeaderLogoBtn")?.addEventListener("click", () => $("headerLogoFileInput")?.click());
    $("headerLogoFileInput")?.addEventListener("change", handleHeaderLogoUpload);
    $("removeHeaderLogoBtn")?.addEventListener("click", () => {
      headerImageDataUrl = null;
      $("headerLogoFileInput").value = "";
      renderHeaderLogoPreview();
    });

    $("live20rScanBtn")?.addEventListener("click", () => {
      if (typeof ZKTeco === "undefined") {
        showToast("ZKTeco library not available", true);
        return;
      }
      ZKTeco.openVerifyModal({
        title: "Live20R Student Acknowledgment",
        subtitle: "Have student place their finger on the Live20R scanner.",
        candidates: sectionStudents,
        onMatch: (matchedStudent) => {
          if (!matchedStudent) return;
          const row = rosterRows.find((r) => r.studentId === matchedStudent.id);
          if (row) {
            row.acknowledgedAt = new Date().toISOString();
            renderRoster();
            showToast(`✓ ${matchedStudent.first_name} ${matchedStudent.last_name} acknowledged via Live20R!`);
          } else {
            showToast(`Student ${matchedStudent.first_name} is not in this section.`, true);
          }
        },
        onError: (err) => {
          showToast(err.message || "Fingerprint did not match any enrolled student.", true);
        }
      });
    });

    $("qrScanBtn")?.addEventListener("click", () => {
      if (typeof QRClient === "undefined") {
        showToast("QR scanner library not available", true);
        return;
      }
      QRClient.openScannerModal({
        title: "Student QR Acknowledgment",
        subtitle: "Have student scan their official ESSU QR ID card.",
        candidates: sectionStudents,
        onMatch: (matchedStudent) => {
          if (!matchedStudent) return;
          const row = rosterRows.find((r) => r.studentId === matchedStudent.id);
          if (row) {
            row.acknowledgedAt = new Date().toISOString();
            renderRoster();
            showToast(`✓ ${matchedStudent.first_name} ${matchedStudent.last_name} acknowledged via QR Code!`);
          } else {
            showToast(`Student ${matchedStudent.first_name} is not in this section.`, true);
          }
        },
        onError: (err) => {
          showToast(err.message || "QR Code did not match any enrolled student.", true);
        }
      });
    });
  }

  loadDocument();
});