// ============================================================================
//  Class Record & Reports of Grades Engine — ESSU-ACAD-712.b Format
//  Dual-mode: Official Reports of Grades + BSIT-3A Formula Breakdown Calculator
//  Dynamic Assessments: Unlimited Practicals (20%) & Quizzes (30%)
//  Biometric Attendance: Real-time Live20R subject attendance auto-retrieval
//  Student Privacy: Students can only view their own individual grade slip.
// ============================================================================

function $(id) { return document.getElementById(id); }

let profile = null;
let courseId = null;
let course = null;
let readOnly = false;
let isStudentUser = false;
let currentView = "report"; // "report" | "calc"
let currentCalcPeriod = "midterm"; // "midterm" | "finals"

let roster = [];      // [{ id, last_name, first_name, student_number, midterm, finals, breakdown: { midterm: {}, finals: {} } }]

// Dynamic Assessments Configuration
let calcConfig = {
  midterm: {
    practicals: [
      { id: "p1", label: "P1", max: 10 },
      { id: "p2", label: "P2", max: 10 },
      { id: "p3", label: "P3", max: 10 },
      { id: "p4", label: "P4", max: 30 }
    ],
    quizzes: [
      { id: "q1", label: "Q1", max: 20 },
      { id: "q2", label: "Q2", max: 20 },
      { id: "q3", label: "Q3", max: 20 }
    ],
    maxAtt: 17,
    maxExam: 75
  },
  finals: {
    practicals: [
      { id: "p1", label: "P1", max: 10 },
      { id: "p2", label: "P2", max: 10 },
      { id: "p3", label: "P3", max: 10 },
      { id: "p4", label: "P4", max: 30 }
    ],
    quizzes: [
      { id: "q1", label: "Q1", max: 20 },
      { id: "q2", label: "Q2", max: 20 },
      { id: "q3", label: "Q3", max: 20 }
    ],
    maxAtt: 17,
    maxExam: 75
  }
};

const GRADING_SYSTEM = [
  ["95-100%", "1.0", "Outstanding"],
  ["90-94%", "1.1 - 1.5", "Excellent"],
  ["85-89%", "1.6 - 2.0", "Very Good"],
  ["80-84%", "2.1 - 2.5", "Good"],
  ["75-79%", "2.6 - 3.0", "Fair"],
  ["70-74%", "3.1 - 3.5", "Conditional"],
  ["55-69%", "3.6 - 5.0", "Failed"],
  ["INC", "INC", "Incomplete"],
  ["Dr", "Dr", "Dropped"],
  ["WP", "WP", "Withdrawn w/ Permission"],
  ["IP", "IP", "In Progress"],
];

const GRADE_CODES = { dr: "Dr", wp: "Wp", inc: "INC", ip: "IP" };
const REMARKS_FOR_CODE = { Dr: "DROPPED", Wp: "WITHDRAWN WITH PERMISSION", INC: "INCOMPLETE", IP: "IN PROGRESS" };

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
  if (!c.days && !c.start_time) return "";
  const time = c.start_time && c.end_time ? `${fmtTime(c.start_time)}–${fmtTime(c.end_time)}` : "";
  return [c.days, time].filter(Boolean).join(" ");
}

// ── Dynamic BSIT-3A Grade Formula Engine ──────────────────────────────────
// Practical 20%, Quizzes 30%, Attendance 10%, Exam 40%
// Transmuted Base 55 Initial Grade % = ((Total_WS / 100) * 40) + 55
// Equivalent Rating (1.0 to 5.0) = (95 - InitialGrade) * 0.1 + 1.0

function computePeriodRating(scores = {}, cfg = {}) {
  const practicals = cfg.practicals || [];
  const quizzes = cfg.quizzes || [];

  // 1. Dynamic Practicals (20%)
  const pSum = practicals.reduce((sum, p) => sum + (Number(scores[p.id]) || 0), 0);
  const maxPSum = practicals.reduce((sum, p) => sum + (Number(p.max) || 0), 0);
  const wsPractical = maxPSum > 0 ? (pSum / maxPSum) * 20 : 0;

  // 2. Dynamic Quizzes (30%)
  const qSum = quizzes.reduce((sum, q) => sum + (Number(scores[q.id]) || 0), 0);
  const maxQSum = quizzes.reduce((sum, q) => sum + (Number(q.max) || 0), 0);
  const wsQuiz = maxQSum > 0 ? (qSum / maxQSum) * 30 : 0;

  // 3. Attendance (10%)
  const att = Number(scores.att) || 0;
  const maxAtt = Number(cfg.maxAtt) || 17;
  const wsAtt = maxAtt > 0 ? (att / maxAtt) * 10 : 0;

  // 4. Major Exam (40%)
  const exam = Number(scores.exam) || 0;
  const maxExam = Number(cfg.maxExam) || 75;
  const wsExam = maxExam > 0 ? (exam / maxExam) * 40 : 0;

  const totalWS = wsPractical + wsQuiz + wsAtt + wsExam;
  const initialGrade = Math.min(100, Math.max(0, ((totalWS / 100) * 40) + 55));
  
  let equivRating = ((95 - initialGrade) * 0.1) + 1.0;
  equivRating = Math.max(1.0, Math.min(5.0, Math.round(equivRating * 10) / 10));

  return {
    pSum,
    maxPSum,
    wsPractical: wsPractical.toFixed(2),
    qSum,
    maxQSum,
    wsQuiz: wsQuiz.toFixed(2),
    wsAtt: wsAtt.toFixed(2),
    wsExam: wsExam.toFixed(2),
    initialGrade: initialGrade.toFixed(1),
    rating: equivRating.toFixed(1)
  };
}

function computeGenGrade(midterm, finals) {
  const mRaw = (midterm || "").trim();
  const fRaw = (finals || "").trim();
  const mCode = GRADE_CODES[mRaw.toLowerCase()];
  const fCode = GRADE_CODES[fRaw.toLowerCase()];

  if (mCode || fCode) {
    const code = fCode || mCode;
    return { gen: code, remarks: REMARKS_FOR_CODE[code] || "" };
  }

  const mNum = parseFloat(mRaw);
  const fNum = parseFloat(fRaw);
  if (!mRaw || !fRaw || isNaN(mNum) || isNaN(fNum)) return { gen: "", remarks: "" };

  const avg = Math.round(((mNum + fNum) / 2) * 10) / 10;
  let remarks = "PASSED";
  if (avg > 3.5) remarks = "FAILED";
  else if (avg > 3.0) remarks = "CONDITIONAL";
  
  return { gen: avg.toFixed(1), remarks };
}

function remarksClass(remarks) {
  if (remarks === "PASSED") return "remarks-passed";
  if (remarks === "FAILED") return "remarks-failed";
  if (remarks) return "remarks-other";
  return "";
}

// ── Dynamic Practical & Quiz Column Modifiers ────────────────────────────

function addPracticalColumn() {
  const cfg = calcConfig[currentCalcPeriod];
  const nextNum = cfg.practicals.length + 1;
  const newId = "p" + Date.now().toString(36);
  cfg.practicals.push({ id: newId, label: `P${nextNum}`, max: 10 });
  
  renderConfigLists();
  renderCalculatorHead();
  renderCalculatorGrid();
  showToast(`Added Practical P${nextNum}`);
}

function removePracticalColumn(pId) {
  const cfg = calcConfig[currentCalcPeriod];
  if (cfg.practicals.length <= 1) {
    showToast("Must have at least one Practical activity.", true);
    return;
  }
  cfg.practicals = cfg.practicals.filter((p) => p.id !== pId);
  renderConfigLists();
  renderCalculatorHead();
  renderCalculatorGrid();
}

function addQuizColumn() {
  const cfg = calcConfig[currentCalcPeriod];
  const nextNum = cfg.quizzes.length + 1;
  const newId = "q" + Date.now().toString(36);
  cfg.quizzes.push({ id: newId, label: `Q${nextNum}`, max: 20 });
  
  renderConfigLists();
  renderCalculatorHead();
  renderCalculatorGrid();
  showToast(`Added Quiz Q${nextNum}`);
}

function removeQuizColumn(qId) {
  const cfg = calcConfig[currentCalcPeriod];
  if (cfg.quizzes.length <= 1) {
    showToast("Must have at least one Quiz.", true);
    return;
  }
  cfg.quizzes = cfg.quizzes.filter((q) => q.id !== qId);
  renderConfigLists();
  renderCalculatorHead();
  renderCalculatorGrid();
}

// ── Biometric Attendance Auto-Sync ───────────────────────────────────────

function syncBiometricAttendance() {
  if (typeof AttendanceManager === "undefined") {
    showToast("Attendance manager is loading...", true);
    return;
  }

  const summary = AttendanceManager.getCourseAttendanceSummary(courseId);
  const cfg = calcConfig[currentCalcPeriod];

  // Update total sessions denominator if recorded
  if (summary.totalSessions > 0) {
    cfg.maxAtt = summary.totalSessions;
    $("maxAtt").value = summary.totalSessions;
  }

  // Update attendance count for each student
  let updatedCount = 0;
  roster.forEach((s) => {
    if (!s.breakdown) s.breakdown = { midterm: {}, finals: {} };
    if (!s.breakdown[currentCalcPeriod]) s.breakdown[currentCalcPeriod] = {};
    
    const count = summary.countByStudent[s.id] || 0;
    s.breakdown[currentCalcPeriod].att = count;
    updatedCount++;
  });

  // Update badge
  const badge = $("biometricSessionsBadge");
  if (badge) {
    badge.textContent = `${summary.totalSessions} Session${summary.totalSessions === 1 ? "" : "s"} Held`;
  }

  renderCalculatorGrid();
  showToast(`✓ Retrieved live biometric attendance logs for ${updatedCount} students!`);
}

// ── View Switching ───────────────────────────────────────────────────────

function switchView(view) {
  if (isStudentUser) return;
  currentView = view;
  $("tabReportBtn").classList.toggle("active", view === "report");
  $("tabCalcBtn").classList.toggle("active", view === "calc");
  $("reportOfGradesView").classList.toggle("hidden", view !== "report");
  $("calculatorView").classList.toggle("hidden", view !== "calc");

  if (view === "calc") {
    renderConfigLists();
    renderCalculatorHead();
    renderCalculatorGrid();
  } else {
    renderGradesTable();
  }
}

function switchCalcPeriod(period) {
  currentCalcPeriod = period;
  $("calcPeriodMidtermBtn").className = period === "midterm" ? "px-3 py-1 text-xs font-semibold rounded-md bg-[#14432A] text-white" : "px-3 py-1 text-xs font-semibold rounded-md text-[#52555C]";
  $("calcPeriodFinalsBtn").className = period === "finals" ? "px-3 py-1 text-xs font-semibold rounded-md bg-[#14432A] text-white" : "px-3 py-1 text-xs font-semibold rounded-md text-[#52555C]";
  
  const cfg = calcConfig[period];
  $("maxAtt").value = cfg.maxAtt;
  $("maxExam").value = cfg.maxExam;

  renderConfigLists();
  renderCalculatorHead();
  renderCalculatorGrid();
}

function readConfigInputs() {
  const cfg = calcConfig[currentCalcPeriod];
  cfg.maxAtt = Number($("maxAtt").value) || 17;
  cfg.maxExam = Number($("maxExam").value) || 75;
}

function recalculateAll() {
  readConfigInputs();
  renderCalculatorGrid();
}

function syncCalcToReport() {
  readConfigInputs();
  roster.forEach((s) => {
    const bMid = s.breakdown?.midterm || {};
    const bFin = s.breakdown?.finals || {};
    const midRes = computePeriodRating(bMid, calcConfig.midterm);
    const finRes = computePeriodRating(bFin, calcConfig.finals);

    if (Object.keys(bMid).length > 0) {
      s.midterm = midRes.rating;
    }
    if (Object.keys(bFin).length > 0) {
      s.finals = finRes.rating;
    }
  });

  if (typeof AssessmentReturnManager !== "undefined") {
    AssessmentReturnManager.syncReturnsFromClassRecord(courseId, course, calcConfig, roster);
  }

  showToast("Calculated BSIT-3A ratings synced & Return of Assessments generated!");
  switchView("report");
}

// ── Rendering ────────────────────────────────────────────────────────────

function renderConfigLists() {
  const cfg = calcConfig[currentCalcPeriod];

  // Practicals list
  const pList = $("practicalsConfigList");
  if (pList) {
    pList.innerHTML = cfg.practicals.map((p, idx) => `
      <div class="flex items-center gap-1 bg-[#FAF7EF] border border-[#DEDACE] px-1.5 py-1 rounded">
        <span class="font-bold text-[#14432A]">${p.label || `P${idx+1}`}:</span>
        <input type="number" class="w-9 border rounded text-center text-xs p-0.5" value="${p.max}" onchange="updatePracticalMax('${p.id}', this.value)">
        <button type="button" onclick="removePracticalColumn('${p.id}')" class="text-[#B3432B] font-bold text-xs hover:text-red-700 ml-0.5">×</button>
      </div>
    `).join("");
  }

  // Quizzes list
  const qList = $("quizzesConfigList");
  if (qList) {
    qList.innerHTML = cfg.quizzes.map((q, idx) => `
      <div class="flex items-center gap-1 bg-[#FAF7EF] border border-[#DEDACE] px-1.5 py-1 rounded">
        <span class="font-bold text-[#14432A]">${q.label || `Q${idx+1}`}:</span>
        <input type="number" class="w-9 border rounded text-center text-xs p-0.5" value="${q.max}" onchange="updateQuizMax('${q.id}', this.value)">
        <button type="button" onclick="removeQuizColumn('${q.id}')" class="text-[#B3432B] font-bold text-xs hover:text-red-700 ml-0.5">×</button>
      </div>
    `).join("");
  }
}

function updatePracticalMax(id, val) {
  const p = calcConfig[currentCalcPeriod].practicals.find((x) => x.id === id);
  if (p) p.max = Number(val) || 10;
  renderCalculatorGrid();
}

function updateQuizMax(id, val) {
  const q = calcConfig[currentCalcPeriod].quizzes.find((x) => x.id === id);
  if (q) q.max = Number(val) || 20;
  renderCalculatorGrid();
}

function renderGradingSystem() {
  $("gradingSystemBody").innerHTML = GRADING_SYSTEM.map(([actual, equiv, adj]) => `
    <tr>
      <td class="text-center">${actual}</td>
      <td class="text-center">${equiv}</td>
      <td>${adj}</td>
    </tr>
  `).join("");
}

function renderGradesTable() {
  const body = $("gradesBody");
  const empty = $("gradesEmpty");
  const table = body.closest("table");

  if (roster.length === 0) {
    body.innerHTML = "";
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  table.classList.remove("hidden");
  empty.classList.add("hidden");

  body.innerHTML = roster.map((s, i) => {
    const { gen, remarks } = computeGenGrade(s.midterm, s.finals);
    return `
      <tr data-index="${i}">
        <td class="text-center">${i + 1}</td>
        <td class="font-medium">${s.last_name}, ${s.first_name}</td>
        <td><input class="field-input student-number-field font-mono" value="${(s.student_number || "").replace(/"/g, "&quot;")}" placeholder="—" ${readOnly ? "disabled" : ""}></td>
        <td><input class="grade-input midterm-field font-semibold" value="${s.midterm || ""}" placeholder="—" ${readOnly ? "disabled" : ""}></td>
        <td><input class="grade-input finals-field font-semibold" value="${s.finals || ""}" placeholder="—" ${readOnly ? "disabled" : ""}></td>
        <td class="text-center font-bold gen-grade-cell text-[#14432A]">${gen || "—"}</td>
        <td class="text-center font-semibold remarks-cell ${remarksClass(remarks)}">${remarks || "—"}</td>
      </tr>
    `;
  }).join("");

  if (!readOnly) {
    body.querySelectorAll(".student-number-field").forEach((el) => {
      el.addEventListener("input", (e) => {
        const idx = Number(e.target.closest("tr").dataset.index);
        roster[idx].student_number = e.target.value;
      });
    });

    const wireGradeField = (selector, key) => {
      body.querySelectorAll(selector).forEach((el) => {
        el.addEventListener("input", (e) => {
          const row = e.target.closest("tr");
          const idx = Number(row.dataset.index);
          roster[idx][key] = e.target.value;
          const { gen, remarks } = computeGenGrade(roster[idx].midterm, roster[idx].finals);
          row.querySelector(".gen-grade-cell").textContent = gen || "—";
          const remarksCell = row.querySelector(".remarks-cell");
          remarksCell.textContent = remarks || "—";
          remarksCell.className = `text-center font-semibold remarks-cell ${remarksClass(remarks)}`;
        });
      });
    };
    wireGradeField(".midterm-field", "midterm");
    wireGradeField(".finals-field", "finals");
  }
}

function renderCalculatorHead() {
  const head = $("calcGridHead");
  const cfg = calcConfig[currentCalcPeriod];
  const pCount = cfg.practicals.length;
  const qCount = cfg.quizzes.length;

  head.innerHTML = `
    <tr class="bg-[#FAF7EF]">
      <th rowspan="2" class="w-8 text-center">#</th>
      <th rowspan="2" class="w-44 text-left">Student Name</th>
      <th colspan="${pCount + 1}" class="text-center bg-[#E1EEE6]/60">Practical (20%) [Max: ${cfg.practicals.reduce((a,b)=>a+b.max,0)}]</th>
      <th colspan="${qCount + 1}" class="text-center bg-[#FAF7EF]">Quizzes (30%) [Max: ${cfg.quizzes.reduce((a,b)=>a+b.max,0)}]</th>
      <th colspan="2" class="text-center bg-[#E1EEE6]/60">Attendance (10%)</th>
      <th colspan="2" class="text-center bg-[#FAF7EF]">Exam (40%)</th>
      <th rowspan="2" class="w-16 text-center bg-[#D9A62C]/20">Initial %</th>
      <th rowspan="2" class="w-20 text-center bg-[#14432A] text-white font-bold">Calculated Rating</th>
    </tr>
    <tr class="bg-[#FAF7EF]">
      ${cfg.practicals.map((p, idx) => `<th class="w-10">${p.label || `P${idx+1}`}</th>`).join("")}
      <th class="w-12 font-bold bg-[#E1EEE6]">WS</th>
      ${cfg.quizzes.map((q, idx) => `<th class="w-10">${q.label || `Q${idx+1}`}</th>`).join("")}
      <th class="w-12 font-bold bg-[#FAF7EF]">WS</th>
      <th class="w-12">Att</th><th class="w-12 font-bold bg-[#E1EEE6]">WS</th>
      <th class="w-12">Score</th><th class="w-12 font-bold bg-[#FAF7EF]">WS</th>
    </tr>
  `;
}

function renderCalculatorGrid() {
  const body = $("calcGridBody");
  const cfg = calcConfig[currentCalcPeriod];

  body.innerHTML = roster.map((s, i) => {
    if (!s.breakdown) s.breakdown = { midterm: {}, finals: {} };
    if (!s.breakdown[currentCalcPeriod]) s.breakdown[currentCalcPeriod] = {};
    const b = s.breakdown[currentCalcPeriod];
    const calc = computePeriodRating(b, cfg);

    const practicalInputs = cfg.practicals.map((p) => `
      <td><input type="number" class="score-cell-input calc-input" data-key="${p.id}" value="${b[p.id] ?? ""}"></td>
    `).join("");

    const quizInputs = cfg.quizzes.map((q) => `
      <td><input type="number" class="score-cell-input calc-input" data-key="${q.id}" value="${b[q.id] ?? ""}"></td>
    `).join("");

    return `
      <tr data-index="${i}">
        <td class="text-center font-semibold">${i + 1}</td>
        <td class="font-medium">${s.last_name}, ${s.first_name}</td>
        
        <!-- Dynamic Practicals -->
        ${practicalInputs}
        <td class="text-center font-bold bg-[#FAF7EF] cell-ws-p">${calc.wsPractical}</td>

        <!-- Dynamic Quizzes -->
        ${quizInputs}
        <td class="text-center font-bold bg-[#FAF7EF] cell-ws-q">${calc.wsQuiz}</td>

        <!-- Attendance -->
        <td><input type="number" class="score-cell-input calc-input" data-key="att" value="${b.att ?? ""}"></td>
        <td class="text-center font-bold bg-[#FAF7EF] cell-ws-att">${calc.wsAtt}</td>

        <!-- Exam -->
        <td><input type="number" class="score-cell-input calc-input" data-key="exam" value="${b.exam ?? ""}"></td>
        <td class="text-center font-bold bg-[#FAF7EF] cell-ws-exam">${calc.wsExam}</td>

        <!-- Initial & Calculated Rating -->
        <td class="text-center font-semibold bg-[#FAF7EF] cell-initial">${calc.initialGrade}%</td>
        <td class="text-center font-bold text-sm bg-[#14432A]/10 text-[#14432A] cell-rating">${calc.rating}</td>
      </tr>
    `;
  }).join("");

  body.querySelectorAll(".calc-input").forEach((el) => {
    el.addEventListener("input", (e) => {
      const row = e.target.closest("tr");
      const idx = Number(row.dataset.index);
      const key = e.target.dataset.key;
      roster[idx].breakdown[currentCalcPeriod][key] = e.target.value === "" ? "" : Number(e.target.value);
      
      const calc = computePeriodRating(roster[idx].breakdown[currentCalcPeriod], calcConfig[currentCalcPeriod]);
      row.querySelector(".cell-ws-p").textContent = calc.wsPractical;
      row.querySelector(".cell-ws-q").textContent = calc.wsQuiz;
      row.querySelector(".cell-ws-att").textContent = calc.wsAtt;
      row.querySelector(".cell-ws-exam").textContent = calc.wsExam;
      row.querySelector(".cell-initial").textContent = `${calc.initialGrade}%`;
      row.querySelector(".cell-rating").textContent = calc.rating;
    });
  });
}

function renderStudentGradeSlip(s) {
  $("studentGradeSlipView").classList.remove("hidden");
  $("reportOfGradesView").classList.add("hidden");
  $("calculatorView").classList.add("hidden");
  $("viewTabs").classList.add("hidden");
  $("saveBtn").classList.add("hidden");

  const { gen, remarks } = computeGenGrade(s.midterm, s.finals);
  $("slipStudentName").textContent = `${s.last_name}, ${s.first_name}`;
  $("slipStudentNo").textContent = s.student_number || "—";
  $("slipCourseInfo").textContent = `${course?.course_number || ""} — ${course?.course_description || ""} (${course?.section_name || ""})`;
  $("slipInstructor").textContent = course?.faculty_first_name ? `${course.faculty_first_name} ${course.faculty_last_name}` : "Faculty";
  
  $("slipCode").textContent = course?.course_number || "—";
  $("slipTitle").textContent = course?.course_description || "—";
  $("slipMidterm").textContent = s.midterm || "—";
  $("slipFinals").textContent = s.finals || "—";
  $("slipGenGrade").textContent = gen || "—";
  $("slipRemarks").textContent = remarks || "—";
  $("slipRemarks").className = `text-center font-semibold ${remarksClass(remarks)}`;
}

function renderForm(course, content) {
  $("institutionName").value = content.institutionName || "Eastern Samar State University";
  $("institutionTagline").value = content.institutionTagline || "";
  $("docTitle").value = content.title || "Reports of Grades";
  $("semesterTerm").value = content.semesterTerm || "First Semester";
  $("schoolYear").value = content.schoolYear || "2025-2026";

  $("courseNumber").value = content.courseNumber || course?.course_number || "";
  $("courseTitle").value = content.courseTitle || course?.course_description || "";
  $("courseSection").value = content.courseSection || course?.section_name || "";
  $("schedule").value = content.schedule || scheduleLabel(course || {});
  $("units").value = content.units || course?.unit || "";
  $("room").value = content.room || "";

  $("lecturerName").value = content.lecturerName || (course?.faculty_first_name ? `${course.faculty_first_name} ${course.faculty_last_name}` : "");
  $("programHeadName").value = content.programHeadName || "";
  $("collegeDeanName").value = content.collegeDeanName || "";
  $("registrarName").value = content.registrarName || "";

  $("docCode").value = content.docCode || "ESSU-ACAD-712.b";
  $("docVersion").value = content.docVersion || "5";
  $("pageInfo").value = content.pageInfo || "Page 1 of 1";
  $("effectivityDate").value = content.effectivityDate || "";

  if (content.calcConfig) {
    calcConfig = content.calcConfig;
  }
}

function collectContent() {
  return {
    institutionName: $("institutionName").value,
    institutionTagline: $("institutionTagline").value,
    title: $("docTitle").value,
    semesterTerm: $("semesterTerm").value,
    schoolYear: $("schoolYear").value,
    courseNumber: $("courseNumber").value,
    courseTitle: $("courseTitle").value,
    courseSection: $("courseSection").value,
    schedule: $("schedule").value,
    units: $("units").value,
    room: $("room").value,
    lecturerName: $("lecturerName").value,
    programHeadName: $("programHeadName").value,
    collegeDeanName: $("collegeDeanName").value,
    registrarName: $("registrarName").value,
    docCode: $("docCode").value,
    docVersion: $("docVersion").value,
    pageInfo: $("pageInfo").value,
    effectivityDate: $("effectivityDate").value,
    calcConfig,
    rosterBreakdown: roster.map((s) => ({ id: s.id, breakdown: s.breakdown }))
  };
}

// ── Load / Save ──────────────────────────────────────────────────────────

async function loadClassRecord() {
  const { data: courseData, error: courseErr } = await sb.from("courses_report").select("*").eq("id", courseId).single();
  if (courseErr || !courseData) {
    console.error("Couldn't load course:", courseErr);
    $("loadingState").textContent = "Couldn't find that course. Go back and open the class record from the Forms tab.";
    return;
  }
  course = courseData;

  if (!course.section_id) {
    $("loadingState").textContent = "This course has no section assigned yet, so there's no roster to pull grades for. Assign a section to it first.";
    return;
  }

  // Load students and existing record (with localStorage fallback)
  let students = [];
  try {
    const { data: sData } = await sb.from("students_report").select("*").eq("section_id", course.section_id).order("last_name");
    students = sData || [];
  } catch (err) {
    console.warn("Could not query students_report:", err);
  }

  let savedRecord = null;
  try {
    const { data: rData } = await sb.from("class_records").select("content").eq("course_id", courseId).maybeSingle();
    savedRecord = rData?.content;
  } catch (err) {
    console.warn("class_records query:", err);
  }

  if (!savedRecord) {
    try {
      const local = localStorage.getItem(`ecomply_class_record_${courseId}`);
      if (local) savedRecord = JSON.parse(local);
    } catch (e) {}
  }

  const existingBreakdowns = {};
  if (savedRecord?.rosterBreakdown) {
    savedRecord.rosterBreakdown.forEach((rb) => { existingBreakdowns[rb.id] = rb.breakdown; });
  }

  roster = (students || []).map((s) => {
    const cached = savedRecord?.roster?.find((r) => r.id === s.id);
    return {
      id: s.id,
      last_name: s.last_name,
      first_name: s.first_name,
      student_number: s.student_number || cached?.student_number || "",
      midterm: cached?.midterm || "",
      finals: cached?.finals || "",
      breakdown: existingBreakdowns[s.id] || cached?.breakdown || { midterm: {}, finals: {} }
    };
  });

  renderGradingSystem();
  renderForm(course, savedRecord || {});

  // Update biometric badge if AttendanceManager is present
  if (typeof AttendanceManager !== "undefined") {
    const summary = AttendanceManager.getCourseAttendanceSummary(courseId);
    const badge = $("biometricSessionsBadge");
    if (badge) {
      badge.textContent = `${summary.totalSessions} Session${summary.totalSessions === 1 ? "" : "s"} Held`;
    }
  }

  if (isStudentUser) {
    const ownStudent = roster.find((s) => s.id === profile.id) || {
      id: profile.id,
      last_name: profile.last_name,
      first_name: profile.first_name,
      student_number: profile.student_number || "",
      midterm: "",
      finals: ""
    };
    renderStudentGradeSlip(ownStudent);
  } else {
    renderGradesTable();
  }

  $("loadingState").classList.add("hidden");
  $("appShell").classList.remove("hidden");
}

async function handleSave() {
  if (readOnly) return;
  const btn = $("saveBtn");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Saving…";

  const content = collectContent();
  content.roster = roster.map((s) => ({
    id: s.id,
    student_number: s.student_number,
    midterm: s.midterm,
    finals: s.finals,
    breakdown: s.breakdown
  }));

  try {
    // 1. Save to localStorage for instant client persistence
    localStorage.setItem(`ecomply_class_record_${courseId}`, JSON.stringify(content));

    // 2. Try Supabase RPC / table if configured
    try {
      await sb.rpc("upsert_class_record", { p_course_id: courseId, p_content: content });
    } catch (e) {
      console.info("RPC upsert_class_record fallback to form submission tracking.");
    }

    // 3. Keep form_submissions updated
    try {
      await sb.rpc("upsert_form_submission", {
        p_course_id: courseId,
        p_requirement_type: "Class Record",
        p_status: "Submitted",
        p_remarks: "Grades updated"
      });
    } catch (e) {}

    // 4. Update student numbers on students table
    try {
      await Promise.all(
        roster.filter((s) => s.student_number).map((s) => sb.from("students").update({ student_number: s.student_number }).eq("id", s.id))
      );
    } catch (e) {}

    // 5. Automatically trigger Return of Assessment generation for students
    let returnCount = 0;
    if (typeof AssessmentReturnManager !== "undefined") {
      returnCount = AssessmentReturnManager.syncReturnsFromClassRecord(courseId, course, calcConfig, roster);
    }

    $("saveStatus").textContent = `Saved ${new Date().toLocaleTimeString()}`;
    showToast(`✓ Class record saved & ${returnCount} Return of Assessment items updated for students!`);
  } catch (err) {
    console.error("Failed to save class record:", err);
    showToast(`Saved locally (Error syncing: ${err.message || err})`, true);
  }

  btn.disabled = false;
  btn.textContent = original;
}

// ── Startup ─────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  profile = requirePortalRoleAny(["Department Head", "Dean", "Faculty", "Student"]);
  if (!profile) return;

  isStudentUser = profile.designation === "Student";
  readOnly = isStudentUser;

  const params = new URLSearchParams(window.location.search);
  courseId = params.get("course");
  $("backLink").href = PORTAL_ROUTES[profile.designation] || "index.html";

  if (!courseId) {
    $("loadingState").textContent = "No course selected. Go back and open the class record from your portal.";
    return;
  }

  if (typeof sb === "undefined") {
    console.error("`sb` is undefined — supabaseClient.js did not load.");
    $("loadingState").textContent = "Database connection not found — supabaseClient.js did not load. Check the browser console.";
    return;
  }

  if (!readOnly) {
    $("saveBtn")?.addEventListener("click", handleSave);
  }

  loadClassRecord();
});


