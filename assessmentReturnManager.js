// ============================================================================
//  Return of Assessment Manager (ESSU-ACAD-711 & Biometric Integration)
//  Syncs graded activities (Quizzes, Practicals, Exams) from the Class Record,
//  tracks student receipt, and attaches student Name, Student No., and
//  E-Signature upon Live20R biometric verification.
// ============================================================================

const ASSESSMENT_RETURNS_KEY = "ecomply_return_of_assessments";

const AssessmentReturnManager = {
  // ── Data Persistence ───────────────────────────────────────────────────

  getAllReturns() {
    try {
      const raw = localStorage.getItem(ASSESSMENT_RETURNS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("Error reading return of assessments:", e);
      return [];
    }
  },

  saveAllReturns(records) {
    try {
      localStorage.setItem(ASSESSMENT_RETURNS_KEY, JSON.stringify(records));
    } catch (e) {
      console.error("Error saving return of assessments:", e);
    }
  },

  // ── Sync from Class Record ─────────────────────────────────────────────
  // Triggered whenever a teacher/dean/depthead grades or saves the Class Record

  syncReturnsFromClassRecord(courseId, courseInfo, calcConfig, roster) {
    if (!courseId || !calcConfig || !roster) return;

    const allReturns = this.getAllReturns();
    let updatedOrCreatedCount = 0;

    const periods = ["midterm", "finals"];

    periods.forEach((period) => {
      const cfg = calcConfig[period] || {};
      const periodLabel = period === "midterm" ? "Midterm" : "Finals";

      // 1. Practicals (P1, P2, ...)
      (cfg.practicals || []).forEach((p, idx) => {
        const assessmentId = `${courseId}_${period}_${p.id}`;
        const assessmentLabel = `${periodLabel} Practical ${idx + 1} (${p.label || `P${idx+1}`})`;
        updatedOrCreatedCount += this._upsertAssessmentItem(allReturns, {
          assessmentId,
          courseId,
          courseInfo,
          period,
          assessmentType: "Practical",
          assessmentNumber: idx + 1,
          assessmentLabel,
          maxScore: Number(p.max) || 10,
          scoreKey: p.id,
          roster
        });
      });

      // 2. Quizzes (Q1, Q2, ...)
      (cfg.quizzes || []).forEach((q, idx) => {
        const assessmentId = `${courseId}_${period}_${q.id}`;
        const assessmentLabel = `${periodLabel} Quiz ${idx + 1} (${q.label || `Q${idx+1}`})`;
        updatedOrCreatedCount += this._upsertAssessmentItem(allReturns, {
          assessmentId,
          courseId,
          courseInfo,
          period,
          assessmentType: "Quiz",
          assessmentNumber: idx + 1,
          assessmentLabel,
          maxScore: Number(q.max) || 20,
          scoreKey: q.id,
          roster
        });
      });

      // 3. Major Exam
      if (cfg.maxExam) {
        const assessmentId = `${courseId}_${period}_exam`;
        const assessmentLabel = `${periodLabel} Examination`;
        updatedOrCreatedCount += this._upsertAssessmentItem(allReturns, {
          assessmentId,
          courseId,
          courseInfo,
          period,
          assessmentType: "Exam",
          assessmentNumber: period === "midterm" ? 1 : 2,
          assessmentLabel,
          maxScore: Number(cfg.maxExam) || 75,
          scoreKey: "exam",
          roster
        });
      }
    });

    this.saveAllReturns(allReturns);
    return updatedOrCreatedCount;
  },

  _upsertAssessmentItem(allReturns, { assessmentId, courseId, courseInfo, period, assessmentType, assessmentNumber, assessmentLabel, maxScore, scoreKey, roster }) {
    let item = allReturns.find((x) => x.id === assessmentId);
    let hasAnyScore = false;

    const studentScores = item ? { ...item.student_scores } : {};

    roster.forEach((s) => {
      const studentPeriodBreakdown = s.breakdown?.[period] || {};
      const rawScore = studentPeriodBreakdown[scoreKey];

      if (rawScore !== undefined && rawScore !== null && rawScore !== "") {
        hasAnyScore = true;
        const currentEntry = studentScores[s.id] || {
          student_id: s.id,
          student_number: s.student_number || "",
          student_name: `${s.last_name}, ${s.first_name}`,
          acknowledged_at: null,
          signature: null,
          biometric_verified: false,
          remarks: ""
        };

        currentEntry.score = Number(rawScore);
        currentEntry.max_score = maxScore;
        currentEntry.student_number = s.student_number || currentEntry.student_number;
        currentEntry.student_name = `${s.last_name}, ${s.first_name}`;

        studentScores[s.id] = currentEntry;
      }
    });

    // Only store if at least one student has received a score
    if (!hasAnyScore && !item) return 0;

    if (!item) {
      item = {
        id: assessmentId,
        course_id: courseId,
        course_number: courseInfo?.course_number || "",
        course_title: courseInfo?.course_description || "",
        section_name: courseInfo?.section_name || "",
        faculty_name: courseInfo?.faculty_first_name ? `${courseInfo.faculty_first_name} ${courseInfo.faculty_last_name}` : "Faculty",
        period,
        assessment_type: assessmentType,
        assessment_number: assessmentNumber,
        assessment_label: assessmentLabel,
        max_score: maxScore,
        date_graded: new Date().toISOString().split("T")[0],
        student_scores: studentScores,
        created_at: new Date().toISOString()
      };
      allReturns.push(item);
    } else {
      item.max_score = maxScore;
      item.student_scores = studentScores;
      item.updated_at = new Date().toISOString();
    }

    return 1;
  },

  // ── Queries ─────────────────────────────────────────────────────────────

  getAssessmentsForCourse(courseId) {
    const all = this.getAllReturns();
    return all.filter((x) => x.course_id === courseId);
  },

  getAllReturnsForStudent(studentId) {
    const all = this.getAllReturns();
    const studentAssessments = [];

    all.forEach((doc) => {
      const entry = doc.student_scores?.[studentId];
      if (entry && entry.score !== undefined) {
        studentAssessments.push({
          assessmentId: doc.id,
          courseId: doc.course_id,
          courseNumber: doc.course_number,
          courseTitle: doc.course_title,
          sectionName: doc.section_name,
          facultyName: doc.faculty_name,
          period: doc.period,
          assessmentType: doc.assessment_type,
          assessmentNumber: doc.assessment_number,
          assessmentLabel: doc.assessment_label,
          maxScore: doc.max_score,
          score: entry.score,
          acknowledgedAt: entry.acknowledged_at,
          signature: entry.signature,
          biometricVerified: entry.biometric_verified,
          remarks: entry.remarks,
          dateGraded: doc.date_graded
        });
      }
    });

    return studentAssessments;
  },

  getPendingReturnsForStudent(studentId) {
    const all = this.getAllReturnsForStudent(studentId);
    return all.filter((a) => !a.acknowledgedAt);
  },

  // ── Student Biometric Acknowledgment ───────────────────────────────────

  acknowledgeAssessmentReturn({ assessmentId, studentId, studentNumber, studentName, esignature }) {
    const all = this.getAllReturns();
    const doc = all.find((x) => x.id === assessmentId);
    if (!doc || !doc.student_scores?.[studentId]) {
      return { success: false, message: "Assessment record not found." };
    }

    const entry = doc.student_scores[studentId];
    entry.acknowledged_at = new Date().toISOString();
    entry.signature = esignature || null;
    entry.biometric_verified = true;
    if (studentNumber) entry.student_number = studentNumber;
    if (studentName) entry.student_name = studentName;

    this.saveAllReturns(all);
    return { success: true, entry };
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = AssessmentReturnManager;
}
if (typeof window !== "undefined") {
  window.AssessmentReturnManager = AssessmentReturnManager;
}

