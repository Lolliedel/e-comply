// ============================================================================
//  Attendance & Class Scheduling Manager (Biometric Live20R Integration)
//  Handles instructor class scheduling, time-window verification, biometric
//  attendance logging, and automated retrieval into the Class Record.
// ============================================================================

const ATTENDANCE_SESSIONS_KEY = "ecomply_attendance_sessions";
const ATTENDANCE_LOGS_KEY = "ecomply_attendance_logs";

const AttendanceManager = {
  // ── Session Management ──────────────────────────────────────────────────

  getSessions(courseId = null) {
    try {
      const raw = localStorage.getItem(ATTENDANCE_SESSIONS_KEY);
      const all = raw ? JSON.parse(raw) : [];
      if (courseId) {
        return all.filter((s) => s.course_id === courseId);
      }
      return all;
    } catch (e) {
      console.error("Error reading attendance sessions:", e);
      return [];
    }
  },

  saveSessions(sessions) {
    try {
      localStorage.setItem(ATTENDANCE_SESSIONS_KEY, JSON.stringify(sessions));
    } catch (e) {
      console.error("Error saving attendance sessions:", e);
    }
  },

  createSession({ courseId, courseNumber, courseTitle, facultyId, date, startTime, endTime, topic }) {
    const sessions = this.getSessions();
    const newSession = {
      id: "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      course_id: courseId,
      course_number: courseNumber || "",
      course_title: courseTitle || "",
      faculty_id: facultyId,
      date: date || new Date().toISOString().split("T")[0],
      start_time: startTime || "08:00", // HH:MM (24h)
      end_time: endTime || "09:30",     // HH:MM (24h)
      topic: topic || "Regular Class Session",
      status: "Open",
      created_at: new Date().toISOString()
    };
    sessions.unshift(newSession);
    this.saveSessions(sessions);
    return newSession;
  },

  closeSession(sessionId) {
    const sessions = this.getSessions();
    const s = sessions.find((x) => x.id === sessionId);
    if (s) {
      s.status = "Closed";
      this.saveSessions(sessions);
    }
    return s;
  },

  deleteSession(sessionId) {
    let sessions = this.getSessions();
    sessions = sessions.filter((x) => x.id !== sessionId);
    this.saveSessions(sessions);
  },

  // ── Time Gating Validation ──────────────────────────────────────────────

  isSessionActiveNow(session) {
    if (!session || session.status === "Closed") return false;
    
    const todayStr = new Date().toISOString().split("T")[0];
    if (session.date !== todayStr) return false;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [sh, sm] = session.start_time.split(":").map(Number);
    const [eh, em] = session.end_time.split(":").map(Number);

    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  },

  getSessionTimeStatus(session) {
    if (!session) return { status: "invalid", label: "Invalid Session" };
    if (session.status === "Closed") {
      return { status: "closed", label: "Closed by Instructor", color: "bg-[#FBEBE8] text-[#B3432B]" };
    }

    const todayStr = new Date().toISOString().split("T")[0];
    if (session.date < todayStr) {
      return { status: "ended", label: "Past Date (Closed)", color: "bg-[#F0EDDE] text-[#6B7060]" };
    }
    if (session.date > todayStr) {
      return { status: "upcoming", label: `Scheduled for ${session.date}`, color: "bg-[#FBF3D9] text-[#8A6A0C]" };
    }

    // Same date -> check hours
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const [sh, sm] = session.start_time.split(":").map(Number);
    const [eh, em] = session.end_time.split(":").map(Number);

    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;

    if (currentMinutes < startMinutes) {
      return { status: "upcoming_today", label: `Opens at ${session.start_time}`, color: "bg-[#FBF3D9] text-[#8A6A0C]" };
    }
    if (currentMinutes > endMinutes) {
      return { status: "ended", label: `Ended at ${session.end_time} (Locked)`, color: "bg-[#FBEBE8] text-[#B3432B]" };
    }

    return { status: "open", label: `OPEN now until ${session.end_time}`, color: "bg-[#E1EEE6] text-[#1F6F4A]" };
  },

  // ── Attendance Logs ─────────────────────────────────────────────────────

  getLogs(sessionId = null, courseId = null) {
    try {
      const raw = localStorage.getItem(ATTENDANCE_LOGS_KEY);
      let all = raw ? JSON.parse(raw) : [];
      if (sessionId) {
        all = all.filter((l) => l.session_id === sessionId);
      }
      if (courseId) {
        all = all.filter((l) => l.course_id === courseId);
      }
      return all;
    } catch (e) {
      console.error("Error reading attendance logs:", e);
      return [];
    }
  },

  saveLogs(logs) {
    try {
      localStorage.setItem(ATTENDANCE_LOGS_KEY, JSON.stringify(logs));
    } catch (e) {
      console.error("Error saving attendance logs:", e);
    }
  },

  logAttendance({ sessionId, courseId, studentId, studentNumber, studentName }) {
    const logs = this.getLogs();
    
    // Prevent duplicate logs for the same session
    const existing = logs.find((l) => l.session_id === sessionId && l.student_id === studentId);
    if (existing) {
      return { success: true, log: existing, duplicate: true };
    }

    const newLog = {
      id: "att_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
      session_id: sessionId,
      course_id: courseId,
      student_id: studentId,
      student_number: studentNumber || "",
      student_name: studentName || "",
      timestamp: new Date().toISOString(),
      time_label: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      verified: true
    };

    logs.push(newLog);
    this.saveLogs(logs);
    return { success: true, log: newLog, duplicate: false };
  },

  hasStudentAttended(sessionId, studentId) {
    const logs = this.getLogs(sessionId);
    return logs.find((l) => l.student_id === studentId) || null;
  },

  // ── Class Record Retrieval ──────────────────────────────────────────────

  getCourseAttendanceSummary(courseId) {
    const sessions = this.getSessions(courseId);
    const totalSessions = sessions.length;
    const logs = this.getLogs(null, courseId);

    const countByStudent = {};
    logs.forEach((l) => {
      countByStudent[l.student_id] = (countByStudent[l.student_id] || 0) + 1;
    });

    return {
      totalSessions,
      sessions,
      countByStudent
    };
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = AttendanceManager;
}
if (typeof window !== "undefined") {
  window.AttendanceManager = AttendanceManager;
}

