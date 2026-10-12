// ============================================================================
//  Student Portal — application logic
//  Talks to Supabase via the `sb` client (supabaseClient.js)
// ============================================================================

let profile = null; // set by session.js's requirePortalRole()

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

const RELEVANT_TYPES = ["Class Record", "Course Guide", "Attendance", "Return of Assessment", "Acceptance of Course Guide"];
const DOC_LINKS = {
  "Class Record": "class-record.html",
  "Course Guide": "course-guide.html",
  "Return of Assessment": "return-of-assessment.html",
  "Acceptance of Course Guide": "acceptance-of-course-guide.html",
};

let currentStudentData = null;
let currentEnrolledCourses = [];

async function loadOwnRecord() {
  const { data, error } = await sb.from("students_report").select("*").eq("id", profile.id).single();
  if (error) {
    console.error("Couldn't load student record:", error);
    showToast(`Couldn't load your record: ${error.message}`, true);
    return;
  }
  currentStudentData = data;
  renderProfile(data);
  await loadCoursesAndStatus(data.section_id);
}

// A student's courses are whichever subjects share their section — there's
// no separate enrollment table, so section is what links the two.
async function loadCoursesAndStatus(sectionId) {
  if (!sectionId) {
    renderCourses([], []);
    renderStudentGrades([], []);
    renderStudentAttendance([], []);
    return;
  }
  try {
    const { data: courses, error: courseErr } = await sb.from("courses_report").select("*").eq("section_id", sectionId);
    if (courseErr) throw courseErr;
    const courseList = courses || [];
    currentEnrolledCourses = courseList;

    let submissions = [];
    let classRecords = [];
    if (courseList.length > 0) {
      const ids = courseList.map((c) => c.id);
      const [{ data: subs }, { data: records }] = await Promise.all([
        sb.from("form_submissions_report").select("*").in("course_id", ids),
        sb.from("class_records").select("course_id, content").in("course_id", ids).catch?.(() => ({ data: [] })) || { data: [] }
      ]);
      submissions = subs || [];
      classRecords = records || [];
    }

    renderStudentAttendance(courseList);
    renderStudentAssessments();
    renderStudentGrades(courseList, classRecords);
    renderCourses(courseList, submissions);
  } catch (err) {
    console.error("Failed to load courses:", err);
    showToast(`Couldn't load courses: ${err.message || err}`, true);
    renderStudentAttendance([]);
    renderStudentAssessments();
    renderStudentGrades([], []);
    renderCourses([], []);
  }
}

// ── Time-Gated Biometric Class Attendance ────────────────────────────────

function renderStudentAttendance(courses = currentEnrolledCourses) {
  const el = $("todayAttendanceList");
  const empty = $("todayAttendanceEmpty");
  if (!el || !empty) return;

  if (courses.length === 0) {
    el.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  const todayStr = new Date().toISOString().split("T")[0];
  const allSessions = typeof AttendanceManager !== "undefined" ? AttendanceManager.getSessions() : [];
  
  // Find sessions for enrolled courses scheduled for today or active
  const todaySessions = [];
  courses.forEach((c) => {
    const cSessions = allSessions.filter((s) => s.course_id === c.id && (s.date === todayStr || s.status === "Open"));
    cSessions.forEach((s) => todaySessions.push({ ...s, course_obj: c }));
  });

  if (todaySessions.length === 0) {
    el.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  el.innerHTML = todaySessions.map((sess) => {
    const timeStatus = AttendanceManager.getSessionTimeStatus(sess);
    const hasAttended = AttendanceManager.hasStudentAttended(sess.id, profile.id);

    let actionButtonHtml = "";
    if (hasAttended) {
      actionButtonHtml = `
        <div class="flex items-center gap-1.5 bg-[#E1EEE6] text-[#1F6F4A] px-3 py-1.5 rounded-lg text-xs font-bold">
          <img src="ICON/biometric.svg" class="w-3.5 h-3.5" alt=""> Attended at ${hasAttended.time_label || "Class"} · Live20R Verified
        </div>
      `;
    } else if (timeStatus.status === "open") {
      actionButtonHtml = `
        <div class="flex items-center gap-2">
          <button type="button" onclick="logStudentBiometricAttendance('${sess.id}')"
            class="bg-[#14432A] hover:bg-[#1B5636] text-white text-xs font-bold px-3 py-2 rounded-lg transition shadow-xs flex items-center gap-1.5">
            <img src="ICON/biometric.svg" class="w-3.5 h-3.5 invert" alt=""> Live20R
          </button>
          <button type="button" onclick="logStudentQrAttendance('${sess.id}')"
            class="bg-[#FAF7EF] hover:bg-[#F2EEDD] border border-[#DEDACE] text-[#14432A] text-xs font-bold px-3 py-2 rounded-lg transition shadow-2xs flex items-center gap-1.5">
            <img src="ICON/qr.svg" class="w-3.5 h-3.5" alt=""> QR ID
          </button>
        </div>
      `;
    } else {
      actionButtonHtml = `
        <div class="text-xs text-[#8A8D93] bg-[#FAF7EF] border border-[#E3DFC8] px-3 py-1.5 rounded-lg italic flex items-center gap-1">
          <img src="ICON/clock.svg" class="w-3.5 h-3.5" alt=""> Attendance Locked (${timeStatus.label})
        </div>
      `;
    }

    return `
      <div class="border border-[#E3DFC8] bg-[#FAF7EF]/60 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <span class="font-bold text-sm text-[#14432A]">${sess.course_number} — ${sess.course_title}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${timeStatus.color}">${timeStatus.label}</span>
          </div>
          <div class="text-xs text-[#6B7060] mt-1 flex items-center gap-3">
            <span class="flex items-center gap-1"><img src="ICON/faculty.svg" class="w-3.5 h-3.5" alt=""> ${sess.course_obj?.faculty_first_name ? `${sess.course_obj.faculty_first_name} ${sess.course_obj.faculty_last_name}` : "Faculty"}</span>
            <span class="flex items-center gap-1"><img src="ICON/clock.svg" class="w-3.5 h-3.5" alt=""> ${fmtTime(sess.start_time)} – ${fmtTime(sess.end_time)}</span>
          </div>
        </div>
        <div>
          ${actionButtonHtml}
        </div>
      </div>
    `;
  }).join("");
}

function logStudentQrAttendance(sessionId) {
  const session = AttendanceManager.getSessions().find((s) => s.id === sessionId);
  if (!session) {
    showToast("Session not found.", true);
    return;
  }
  const timeStatus = AttendanceManager.getSessionTimeStatus(session);
  if (timeStatus.status !== "open") {
    showToast(`Attendance window is not currently open (${timeStatus.label}).`, true);
    renderStudentAttendance();
    return;
  }

  if (typeof QRClient === "undefined") {
    showToast("QR Client library is not loaded.", true);
    return;
  }

  const stud = currentStudentData || profile;
  QRClient.openScannerModal({
    title: `QR Attendance: ${session.course_number}`,
    subtitle: "Scan your official ESSU Student Digital ID or mobile QR code.",
    candidates: stud ? [stud] : [],
    onMatch: (matched) => {
      const res = AttendanceManager.logAttendance({
        sessionId: session.id,
        courseId: session.course_id,
        studentId: stud.id,
        studentNumber: stud.student_number || "",
        studentName: `${stud.last_name}, ${stud.first_name}`,
        method: "QR Code"
      });

      if (res.duplicate) {
        showToast("You have already logged attendance for this session.");
      } else {
        showToast(`✓ Attendance recorded successfully via QR for ${session.course_number}!`);
      }
      renderStudentAttendance();
    },
    onError: (err) => {
      showToast(err.message || "QR verification failed.", true);
    }
  });
}

async function logStudentBiometricAttendance(sessionId) {
  const session = AttendanceManager.getSessions().find((s) => s.id === sessionId);
  if (!session) {
    showToast("Session not found.", true);
    return;
  }

  // Strictly enforce time window
  const timeStatus = AttendanceManager.getSessionTimeStatus(session);
  if (timeStatus.status !== "open") {
    showToast(`Attendance window is not currently open (${timeStatus.label}).`, true);
    renderStudentAttendance();
    return;
  }

  if (!currentStudentData?.fingerprint_credential_id && !currentStudentData?.fingerprint_template) {
    // Offer QR code attendance directly
    logStudentQrAttendance(sessionId);
    return;
  }

  if (typeof ZKTeco === "undefined") {
    logStudentQrAttendance(sessionId);
    return;
  }

  ZKTeco.openVerifyModal({
    title: `Biometric Attendance: ${session.course_number}`,
    subtitle: "Place your finger on the Live20R scanner or switch to QR reader.",
    candidates: [{
      id: currentStudentData.id,
      label: `${currentStudentData.last_name}, ${currentStudentData.first_name}`,
      first_name: currentStudentData.first_name,
      last_name: currentStudentData.last_name,
      student_number: currentStudentData.student_number,
      template: currentStudentData.fingerprint_template || currentStudentData.fingerprint_credential_id
    }],
    onMatch: (matched) => {
      const res = AttendanceManager.logAttendance({
        sessionId: session.id,
        courseId: session.course_id,
        studentId: currentStudentData.id,
        studentNumber: currentStudentData.student_number,
        studentName: `${currentStudentData.last_name}, ${currentStudentData.first_name}`
      });

      if (res.duplicate) {
        showToast("You have already logged attendance for this session.");
      } else {
        showToast(`✓ Attendance recorded successfully for ${session.course_number}!`);
      }
      renderStudentAttendance();
    },
    onError: (err) => {
      showToast(err.message || "Fingerprint does not match.", true);
    }
  });
}

// ── Return of Assessments & Score Acknowledgment (Biometric E-Signature) ─

function renderStudentAssessments() {
  const listEl = $("assessmentReturnsList");
  const emptyEl = $("assessmentReturnsEmpty");
  const badgeEl = $("pendingAssessmentNotificationBadge");
  if (!listEl || !emptyEl) return;

  if (typeof AssessmentReturnManager === "undefined") {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }

  const allStudentAssessments = AssessmentReturnManager.getAllReturnsForStudent(profile.id);
  const pendingAssessments = allStudentAssessments.filter((a) => !a.acknowledgedAt);

  // Update notification badge
  if (badgeEl) {
    if (pendingAssessments.length > 0) {
      badgeEl.textContent = `${pendingAssessments.length} Pending Acknowledgment`;
      badgeEl.classList.remove("hidden");
    } else {
      badgeEl.classList.add("hidden");
    }
  }

  if (allStudentAssessments.length === 0) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  listEl.innerHTML = allStudentAssessments.map((a) => {
    const isAcknowledged = !!a.acknowledgedAt;
    const percent = Math.round((a.score / a.maxScore) * 100);

    let statusHtml = "";
    if (isAcknowledged) {
      statusHtml = `
        <div class="flex items-center gap-3">
          <div class="text-right">
            <span class="bg-[#E1EEE6] text-[#1F6F4A] text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 justify-end">
              <img src="ICON/biometric.svg" class="w-3 h-3" alt=""> Acknowledged (Live20R)
            </span>
            <div class="text-[10px] text-[#6B7060] mt-1 font-mono">${new Date(a.acknowledgedAt).toLocaleString()}</div>
          </div>
          ${a.signature ? `<div class="bg-white border border-[#E3DFC8] rounded-md p-1 h-11 w-24 flex items-center justify-center overflow-hidden"><img src="${a.signature}" class="max-h-full max-w-full object-contain" alt="E-Signature"></div>` : ""}
        </div>
      `;
    } else {
      statusHtml = `
        <div class="flex flex-col sm:flex-row items-end sm:items-center gap-2">
          <span class="text-xs bg-[#FBEBE8] text-[#B3432B] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
            <img src="ICON/clock.svg" class="w-3 h-3" alt=""> Awaiting Acknowledgment
          </span>
          <div class="flex items-center gap-1.5">
            <button type="button" onclick="acknowledgeAssessmentWithBiometrics('${a.assessmentId}')"
              class="bg-[#14432A] hover:bg-[#1B5636] text-white text-xs font-bold px-3 py-1.5 rounded-lg transition shadow-sm flex items-center gap-1.5 whitespace-nowrap">
              <img src="ICON/biometric.svg" class="w-3.5 h-3.5 invert" alt=""> Live20R
            </button>
            <button type="button" onclick="acknowledgeAssessmentWithQr('${a.assessmentId}')"
              class="bg-[#FAF7EF] hover:bg-[#F2EEDD] text-[#14432A] border border-[#DEDACE] text-xs font-bold px-3 py-1.5 rounded-lg transition shadow-sm flex items-center gap-1.5 whitespace-nowrap">
              <img src="ICON/qr.svg" class="w-3.5 h-3.5" alt=""> Scan QR
            </button>
          </div>
        </div>
      `;
    }

    return `
      <div class="border ${isAcknowledged ? "border-[#E3DFC8] bg-[#FAF7EF]/40" : "border-[#B3432B]/30 bg-[#FFFDF9]"} rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 transition">
        <div>
          <div class="flex items-center gap-2">
            <span class="font-bold text-sm text-[#14432A]">${a.courseNumber} — ${a.courseTitle}</span>
            <span class="text-[11px] font-semibold bg-[#FAF7EF] border border-[#DEDACE] px-2 py-0.5 rounded text-[#52555C]">${a.assessmentLabel}</span>
          </div>
          <div class="flex items-center gap-3 text-xs text-[#6B7060] mt-1">
            <span class="flex items-center gap-1"><img src="ICON/faculty.svg" class="w-3.5 h-3.5" alt=""> ${a.facultyName}</span>
            <span class="flex items-center gap-1"><img src="ICON/calendar.svg" class="w-3.5 h-3.5" alt=""> Graded: ${a.dateGraded || "Recent"}</span>
          </div>
        </div>

        <div class="flex items-center gap-4">
          <!-- Score Pill -->
          <div class="text-center px-3 py-1 bg-white border border-[#E3DFC8] rounded-lg">
            <div class="text-[10px] text-[#8A8D93] uppercase font-semibold">Your Score</div>
            <div class="text-sm font-extrabold text-[#14432A]">${a.score} <span class="text-xs font-normal text-[#6B7060]">/ ${a.maxScore} (${percent}%)</span></div>
          </div>

          <!-- Status / Action -->
          <div>
            ${statusHtml}
          </div>
        </div>
      </div>
    `;
  }).join("");
}

async function acknowledgeAssessmentWithBiometrics(assessmentId) {
  const all = AssessmentReturnManager.getAllReturnsForStudent(profile.id);
  const targetAssessment = all.find((a) => a.assessmentId === assessmentId);
  const label = targetAssessment?.assessmentLabel || "Assessment";

  const auth = await BiometricSigner.requireBiometricSignature({
    user: currentStudentData || profile,
    actionTitle: `Acknowledge: ${label}`,
    subtitle: `Biometric authentication or QR Digital ID required to acknowledge receipt.`
  });

  if (!auth.success) {
    showToast("Acknowledgment cancelled: Biometric signature required.", true);
    return;
  }

  const studentFullName = typeof getFormattedFullName === "function" ? getFormattedFullName(currentStudentData || profile) : `${currentStudentData.last_name}, ${currentStudentData.first_name}`;

  const res = AssessmentReturnManager.acknowledgeAssessmentReturn({
    assessmentId,
    studentId: currentStudentData.id,
    studentNumber: currentStudentData.student_number,
    studentName: studentFullName,
    esignature: auth.esignature || currentStudentData.esignature || null
  });

  if (res.success) {
    showToast(`✓ ${label} acknowledged! Verified signature for ${studentFullName} attached.`);
    renderStudentAssessments();
  } else {
    showToast(`Couldn't acknowledge: ${res.message}`, true);
  }
}

async function acknowledgeAssessmentWithQr(assessmentId) {
  const all = AssessmentReturnManager.getAllReturnsForStudent(profile.id);
  const targetAssessment = all.find((a) => a.assessmentId === assessmentId);
  const label = targetAssessment?.assessmentLabel || "Assessment";

  if (typeof QRClient === "undefined") {
    showToast("QR Code scanner library not available.", true);
    return;
  }

  const studentObj = currentStudentData || profile;

  QRClient.openScannerModal({
    title: `Scan QR ID — ${label}`,
    subtitle: "Present your official ESSU Student QR Code Digital ID to the camera.",
    candidates: [studentObj],
    onMatch: (matched) => {
      const studentFullName = typeof getFormattedFullName === "function" ? getFormattedFullName(studentObj) : `${studentObj.last_name}, ${studentObj.first_name}`;

      const res = AssessmentReturnManager.acknowledgeAssessmentReturn({
        assessmentId,
        studentId: studentObj.id,
        studentNumber: studentObj.student_number,
        studentName: studentFullName,
        esignature: studentObj.esignature || null
      });

      if (res.success) {
        showToast(`✓ ${label} acknowledged with QR Digital ID for ${studentFullName}!`);
        renderStudentAssessments();
      } else {
        showToast(`Couldn't acknowledge: ${res.message}`, true);
      }
    },
    onError: (err) => {
      showToast(err?.message || "QR Code verification failed.", true);
    }
  });
}

window.acknowledgeAssessmentWithBiometrics = acknowledgeAssessmentWithBiometrics;
window.acknowledgeAssessmentWithQr = acknowledgeAssessmentWithQr;

function renderStudentGrades(courses, classRecords) {
  const el = $("gradesList");
  const empty = $("gradesEmpty");
  if (!el || !empty) return;

  if (courses.length === 0) {
    el.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  let gradeCardsHtml = "";
  let countWithGrades = 0;

  courses.forEach((c) => {
    let savedContent = classRecords.find((r) => r.course_id === c.id)?.content;
    if (!savedContent) {
      try {
        const local = localStorage.getItem(`ecomply_class_record_${c.id}`);
        if (local) savedContent = JSON.parse(local);
      } catch (e) {}
    }

    const studentGrade = savedContent?.roster?.find((s) => s.id === profile.id);
    const midterm = studentGrade?.midterm || "—";
    const finals = studentGrade?.finals || "—";

    let genGrade = "—";
    let remarks = "Pending";
    let badgeColor = "bg-[#F0EDDE] text-[#6B7060]";

    if (midterm !== "—" || finals !== "—") {
      countWithGrades++;
      const mNum = parseFloat(midterm);
      const fNum = parseFloat(finals);
      if (!isNaN(mNum) && !isNaN(fNum)) {
        const avg = Math.round(((mNum + fNum) / 2) * 10) / 10;
        genGrade = avg.toFixed(1);
        if (avg <= 3.0) {
          remarks = "PASSED";
          badgeColor = "bg-[#E1EEE6] text-[#1F6F4A]";
        } else if (avg <= 3.5) {
          remarks = "CONDITIONAL";
          badgeColor = "bg-[#FBF3D9] text-[#8A6A0C]";
        } else {
          remarks = "FAILED";
          badgeColor = "bg-[#FBEBE8] text-[#B3432B]";
        }
      } else if (midterm.toLowerCase() === "dr" || finals.toLowerCase() === "dr") {
        genGrade = "Dr";
        remarks = "DROPPED";
        badgeColor = "bg-[#FBEBE8] text-[#B3432B]";
      } else {
        genGrade = midterm !== "—" ? midterm : finals;
        remarks = "In Progress";
        badgeColor = "bg-[#FBF3D9] text-[#8A6A0C]";
      }
    }

    gradeCardsHtml += `
      <div class="border border-[#E3DFC8] bg-[#FAF7EF]/60 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div class="font-semibold text-sm text-[#14432A]">${c.course_number} — ${c.course_description}</div>
          <div class="text-xs text-[#6B7060] mt-0.5">${c.faculty_first_name ? `${c.faculty_first_name} ${c.faculty_last_name}` : "Faculty"} · ${c.section_name || ""}</div>
        </div>
        <div class="flex items-center gap-3">
          <div class="text-center px-2 py-1 bg-white border border-[#E3DFC8] rounded-lg min-w-[54px]">
            <div class="text-[10px] text-[#8A8D93] uppercase">Midterm</div>
            <div class="text-xs font-bold text-[#14432A]">${midterm}</div>
          </div>
          <div class="text-center px-2 py-1 bg-white border border-[#E3DFC8] rounded-lg min-w-[54px]">
            <div class="text-[10px] text-[#8A8D93] uppercase">Finals</div>
            <div class="text-xs font-bold text-[#14432A]">${finals}</div>
          </div>
          <div class="text-center px-2.5 py-1 bg-[#14432A]/5 border border-[#14432A]/20 rounded-lg min-w-[60px]">
            <div class="text-[10px] text-[#14432A] font-semibold uppercase">General</div>
            <div class="text-sm font-extrabold text-[#14432A]">${genGrade}</div>
          </div>
          <div class="flex flex-col items-end gap-1">
            <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full ${badgeColor}">${remarks}</span>
            <a href="class-record.html?course=${c.id}" class="text-[11px] text-[#8A6A0C] font-semibold hover:underline">Official Slip →</a>
          </div>
        </div>
      </div>
    `;
  });

  el.innerHTML = gradeCardsHtml;
  empty.classList.add("hidden");
}

function renderCourses(courses, submissions) {
  const el = $("coursesList");
  const empty = $("coursesEmpty");

  if (courses.length === 0) {
    el.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  el.innerHTML = courses.map((c) => {
    const rows = RELEVANT_TYPES.map((type) => {
      const sub = submissions.find((s) => s.course_id === c.id && s.requirement_type === type);
      const status = sub?.status || "Pending";
      const color = status === "Approved" ? "bg-[#E1EEE6] text-[#1F6F4A]"
        : status === "Submitted" ? "bg-[#FBF3D9] text-[#8A6A0C]"
        : "bg-[#F0EDDE] text-[#6B7060]";
      const link = DOC_LINKS[type];
      const viewLink = (status === "Approved" || type === "Class Record") && link
        ? `<a href="${link}?course=${c.id}" class="ml-2 text-[#8A6A0C] font-semibold hover:underline">View →</a>`
        : "";
      return `
        <div class="flex items-center justify-between text-xs py-1.5">
          <span>${type}</span>
          <span class="flex items-center"><span class="font-semibold px-2 py-0.5 rounded-full ${color}">${status}</span>${viewLink}</span>
        </div>`;
    }).join("");

    return `
      <div class="border border-[#E3DFC8] rounded-lg p-4">
        <div class="font-semibold text-sm mb-0.5">${c.course_number} — ${c.course_description}</div>
        <div class="text-xs text-[#6B7060] mb-2">${c.faculty_first_name ? `${c.faculty_first_name} ${c.faculty_last_name}` : "Unassigned"}${c.section_name ? ` · ${c.section_name}` : ""}</div>
        <div class="divide-y divide-[#F0EDDE]">${rows}</div>
      </div>`;
  }).join("");
}

function renderProfile(s) {
  $("avatar").innerHTML = s.profile_picture
    ? `<img src="${s.profile_picture}" class="w-full h-full object-cover rounded-full">`
    : (initials(s.first_name, s.last_name) || "—");
  $("fullName").textContent = `${s.last_name}, ${s.first_name}`;
  $("section").textContent = s.section_name || s.section || "No section on file";
  $("headerDept").textContent = s.department || "No department assigned";

  // Academic Course / Degree Program
  let courseInfo = "";
  try {
    const courseMap = JSON.parse(localStorage.getItem("ecomply_user_course_map") || "{}");
    const mapped = courseMap[s.id];
    if (mapped && (mapped.course_code || mapped.course_name)) {
      courseInfo = mapped.course_code ? `${mapped.course_code} — ${mapped.course_name}` : mapped.course_name;
    }
  } catch (e) {}
  if (!courseInfo && s.section_id) {
    try {
      const storedSecs = JSON.parse(localStorage.getItem("ecomply_sections_cache") || "[]");
      const sec = storedSecs.find((x) => String(x.id) === String(s.section_id));
      if (sec && sec.course_id) {
        const storedCourses = JSON.parse(localStorage.getItem("ecomply_academic_courses") || "[]");
        const crs = storedCourses.find((x) => String(x.id) === String(sec.course_id));
        if (crs) courseInfo = crs.code ? `${crs.code} — ${crs.name}` : crs.name;
      }
    } catch (e) {}
  }
  const badgeEl = $("studentCourseBadge");
  if (badgeEl) {
    if (courseInfo) {
      badgeEl.textContent = courseInfo;
      badgeEl.classList.remove("hidden");
    } else {
      badgeEl.classList.add("hidden");
    }
  }

  if (s.esignature) {
    if ($("signatureIcon").tagName === "IMG") $("signatureIcon").src = "ICON/signature.svg";
    $("signatureStatus").textContent = "On file";
    $("signatureStatus").className = "text-xs text-[#1F6F4A] font-semibold";
  }
  if (s.fingerprint_credential_id) {
    if ($("biometricIcon").tagName === "IMG") $("biometricIcon").src = "ICON/biometric.svg";
    $("biometricStatus").textContent = "Live20R on file";
    $("biometricStatus").className = "text-xs text-[#1F6F4A] font-semibold";
    const testBtn = $("testBiometricBtn");
    if (testBtn) {
      testBtn.classList.remove("hidden");
      testBtn.onclick = () => {
        if (typeof ZKTeco === "undefined") {
          showToast("ZKTeco library not available", true);
          return;
        }
        ZKTeco.openVerifyModal({
          title: "Test Live20R Biometric",
          subtitle: "Place your finger on the Live20R scanner to verify against your profile.",
          candidates: [s],
          onMatch: () => {
            showToast("Fingerprint verified successfully!");
          },
          onError: (err) => {
            showToast(err.message || "Fingerprint does not match.", true);
          }
        });
      };
    }
  }

  const viewIdBtn = $("viewMyQrIdBtn");
  if (viewIdBtn) {
    viewIdBtn.onclick = () => {
      if (typeof QRClient !== "undefined") {
        QRClient.openIdCardModal({ user: s });
      } else {
        showToast("QR Client library not loaded.", true);
      }
    };
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  profile = requirePortalRole("Student");
  if (!profile) return;

  if (typeof sb === "undefined") {
    console.error("`sb` is undefined — supabaseClient.js did not load. Check that it sits next to this HTML file.");
    showToast("Database connection not found — supabaseClient.js did not load. Check the browser console.", true);
    return;
  }

  $("scanMyQrAttendanceBtn")?.addEventListener("click", () => {
    const sessions = AttendanceManager.getSessions();
    const openSess = sessions.find((s) => AttendanceManager.getSessionTimeStatus(s).status === "open");
    if (openSess) {
      logStudentQrAttendance(openSess.id);
    } else {
      showToast("No active scheduled attendance session open right now.", true);
    }
  });

  $("appShell").classList.remove("hidden");
  await loadOwnRecord();
});