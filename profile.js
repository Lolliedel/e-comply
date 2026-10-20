// ============================================================================
//  My Profile — shared across every role (Super Admin, Dean, Department
//  Head, Faculty, Student). Reads the signed-in session, loads that
//  person's own record from the right table, and lets them edit their
//  name and upload a profile photo.
// ============================================================================

function $(id) { return document.getElementById(id); }

let profile = null;   // session profile (from session.js)
let record = null;    // full row from app_users_report / students_report
let profilePictureDataUrl = null;

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

function renderAvatarPreview() {
  const el = $("avatarPreview");
  if (profilePictureDataUrl) {
    el.innerHTML = `<img src="${profilePictureDataUrl}" class="w-full h-full object-cover">`;
  } else {
    el.textContent = initials($("firstName").value, $("lastName").value) || "—";
  }
  if (typeof renderEmbeddedIdCard === "function") {
    renderEmbeddedIdCard();
  }
}

// ── Photo upload (center-cropped to a square, downsized before storing) ──

function handlePhotoUpload(e) {
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
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      const minSide = Math.min(img.width, img.height);
      const sx = (img.width - minSide) / 2;
      const sy = (img.height - minSide) / 2;
      ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
      profilePictureDataUrl = canvas.toDataURL("image/jpeg", 0.85);
      renderAvatarPreview();
    };
    img.onerror = () => showToast("Couldn't read that image file.", true);
    img.src = reader.result;
  };
  reader.onerror = () => showToast("Couldn't read that file.", true);
  reader.readAsDataURL(file);
}

// ── Load / render ──────────────────────────────────────────────────────

async function loadOwnRecord() {
  const table = profile.role === "student" ? "students_report" : "app_users_report";
  let loaded = false;
  try {
    if (typeof sb !== "undefined" && sb && sb.from) {
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout loading profile")), 2500));
      const { data, error } = await Promise.race([
        sb.from(table).select("*").eq("id", profile.id).single(),
        timeoutPromise
      ]);
      if (!error && data) {
        record = data;
        loaded = true;
      }
    }
  } catch (err) {
    console.warn("Could not load from cloud, using local session fallback:", err);
  }

  if (!loaded || !record) {
    const vault = (typeof ZKTeco !== "undefined") ? ZKTeco.getBiometricVault() : {};
    const vaultUser = vault[String(profile.id)] || vault[String(profile.username)] || {};
    record = {
      id: profile.id,
      first_name: profile.first_name || "Super",
      last_name: profile.last_name || "Administrator",
      username: profile.username || "superadmin",
      designation: profile.designation || "Super Admin",
      role: profile.role || "staff",
      fingerprint_credential_id: vaultUser.fingerprint_credential_id || profile.fingerprint_credential_id || null,
      profile_picture: vaultUser.profile_picture || profile.profile_picture || null,
      campus_name: profile.campus_name || "Main Campus"
    };
  }

  renderForm();
  $("loadingState").classList.add("hidden");
  $("appShell").classList.remove("hidden");
}

let pendingFingerprintTemplate = null;
let pendingFingerprintImage = null;
let isFingerprintExplicitlyRemoved = false;

function renderBiometricSection() {
  const bioStatus = $("biometricProfileStatus");
  const bioDetail = $("biometricProfileDetail");
  const enrollLabel = $("enrollFingerprintLabel");
  const testBtn = $("testMyFingerprintBtn");
  const removeBtn = $("removeMyFingerprintBtn");
  const icon = $("profileFpIcon");
  const previewImg = $("profileFpPreviewImg");

  if (!bioStatus) return;

  if (pendingFingerprintTemplate) {
    bioStatus.textContent = "✓ Enrolled on Live20R";
    bioStatus.className = "text-xs font-semibold text-[#1F6F4A]";
    if (bioDetail) bioDetail.textContent = "Live20R biometric template ready for 1-touch login";
    if (enrollLabel) enrollLabel.textContent = "Re-enroll Fingerprint";
    if (testBtn) testBtn.classList.remove("hidden");
    if (removeBtn) removeBtn.classList.remove("hidden");

    if (previewImg && pendingFingerprintImage) {
      previewImg.src = pendingFingerprintImage;
      previewImg.classList.remove("hidden");
      if (icon) icon.classList.add("hidden");
    } else {
      if (icon) {
        if (icon.tagName === "IMG") icon.src = "ICON/biometric.svg";
        else icon.textContent = "";
        icon.classList.remove("hidden");
      }
      if (previewImg) previewImg.classList.add("hidden");
    }
  } else {
    bioStatus.textContent = "No biometric on file";
    bioStatus.className = "text-xs font-semibold text-[#6B7060]";
    if (bioDetail) bioDetail.textContent = "Enroll with Live20R scanner for quick 1-touch login";
    if (enrollLabel) enrollLabel.textContent = "Enroll Fingerprint";
    if (testBtn) testBtn.classList.add("hidden");
    if (removeBtn) removeBtn.classList.add("hidden");
    if (icon) {
      if (icon.tagName === "IMG") icon.src = "ICON/biometric.svg";
      else icon.textContent = "";
      icon.classList.remove("hidden");
    }
    if (previewImg) previewImg.classList.add("hidden");
  }
}

function handleEnrollFingerprint() {
  if (typeof ZKTeco === "undefined") {
    showToast("ZKTeco client library not found.", true);
    return;
  }

  const username = record?.username || profile?.username || `${$("firstName").value.trim()}.${$("lastName").value.trim()}` || "user";

  ZKTeco.openEnrollmentModal({
    username: username,
    onComplete: (res) => {
      isFingerprintExplicitlyRemoved = false;
      pendingFingerprintTemplate = res.template;
      pendingFingerprintImage = res.image;
      renderBiometricSection();

      // Immediately save to local biometric vault so Live20R 1-touch login works instantly
      if (typeof ZKTeco !== "undefined") {
        ZKTeco.saveBiometricVaultUser({
          id: profile.id,
          first_name: $("firstName").value.trim() || profile.first_name,
          last_name: $("lastName").value.trim() || profile.last_name,
          username: record?.username || profile.username || "user",
          designation: profile.designation,
          role: profile.role,
          college_id: profile.college_id,
          department_id: profile.department_id,
          campus_name: profile.campus_name || "Main Campus",
          fingerprint_credential_id: res.template
        });
      }

      // Keep portal_session updated
      profile.fingerprint_credential_id = res.template;
      if (typeof setPortalSession === "function") {
        setPortalSession(profile);
      }

      // Proactively persist to Supabase if reachable
      const table = profile.role === "student" ? "students" : "app_users";
      if (typeof sb !== "undefined" && sb && sb.from) {
        sb.from(table).update({ fingerprint_credential_id: res.template }).eq("id", profile.id)
          .then(() => console.log("Live20R biometric cloud auto-synced."))
          .catch((e) => console.warn("Biometric cloud auto-sync deferred:", e));
      }

      showToast(`Live20R fingerprint enrolled (${res.quality}% quality) and saved!`);
    },
    onError: (err) => {
      console.warn("Biometric enrollment error:", err);
      showToast(err.message || "Failed to enroll fingerprint.", true);
    }
  });
}

function handleTestFingerprint() {
  const candidate = { ...record, ...profile, fingerprint_credential_id: pendingFingerprintTemplate };

  const openQrAlternative = () => {
    if (typeof QRClient !== "undefined") {
      QRClient.openScannerModal({
        title: "Verify Identity: QR Code",
        subtitle: "Scan your ESSU Digital ID QR code to verify your identity.",
        candidates: [{ ...record, ...profile }],
        onMatch: () => { showToast("\u2713 Identity verified via QR Code!"); }
      });
    } else {
      showToast("Neither ZKTeco nor QR scanner is available.", true);
    }
  };

  if (typeof ZKTeco === "undefined") {
    openQrAlternative();
    return;
  }
  if (!pendingFingerprintTemplate) {
    showToast("No fingerprint template on file. Using QR code instead.", true);
    openQrAlternative();
    return;
  }

  ZKTeco.openVerifyModal({
    title: "Test Live20R Scan",
    subtitle: "Scan your fingerprint to test match against your profile.",
    candidates: [candidate],
    onMatch: () => {
      showToast("Live20R biometric match verified 100%!");
    },
    onError: (err) => {
      showToast(err.message || "Fingerprint does not match. Try QR code instead.", true);
      openQrAlternative();
    }
  });
}

function handleRemoveFingerprint() {
  isFingerprintExplicitlyRemoved = true;
  pendingFingerprintTemplate = null;
  pendingFingerprintImage = null;
  renderBiometricSection();
  showToast("Biometric removed. Click Save Changes to apply.");
}

let isProfileIdBack = false;

function renderEmbeddedIdCard() {
  const stage = $("profileEmbeddedIdCardStage");
  if (!stage || typeof QRClient === "undefined") return;
  const userData = {
    ...record,
    ...profile,
    first_name: $("firstName")?.value?.trim() || record?.first_name || profile?.first_name,
    last_name: $("lastName")?.value?.trim() || record?.last_name || profile?.last_name,
    middle_initial: $("middleInitial")?.value?.trim() || record?.middle_initial || profile?.middle_initial,
    profile_picture: profilePictureDataUrl || record?.profile_picture || profile?.profile_picture || null
  };
  stage.innerHTML = QRClient.renderIdCardHtml(userData, { isBack: isProfileIdBack });
  if ($("profileFlipLabel")) {
    $("profileFlipLabel").textContent = isProfileIdBack ? "Flip to Front View" : "Flip to Back (QR Code)";
  }
}

function renderForm() {
  const isStudent = profile.role === "student";

  $("lastName").value = record.last_name || "";
  $("firstName").value = record.first_name || "";
  $("usernameDisplay").textContent = record.username || "—";
  if ($("campusDisplay")) $("campusDisplay").textContent = record.campus_name || record.campus || profile.campus_name || "Main Campus";
  $("designationDisplay").textContent = profile.designation;

  // Entity ID computation & visibility
  const rawId = record.id || profile.id;
  const studentNum = record.student_number || record.student_no || null;
  const employeeNum = record.employee_id || record.employee_no || null;
  const primaryIdDisplay = isStudent
    ? (studentNum ? studentNum : `ESSU-STU-${rawId}`)
    : (employeeNum ? employeeNum : `#${rawId}`);

  if ($("profileEntityIdPill")) {
    $("profileEntityIdPill").textContent = isStudent
      ? `Student ID: ${primaryIdDisplay}`
      : `ID #${rawId}`;
  }
  if ($("accountInfoIdLabel")) {
    $("accountInfoIdLabel").textContent = isStudent ? "Student ID" : "Entity / User ID";
  }
  if ($("accountInfoIdDisplay")) {
    $("accountInfoIdDisplay").textContent = isStudent
      ? (studentNum ? `${studentNum} (DB #${rawId})` : `ESSU-STU-${rawId}`)
      : `#${rawId}${employeeNum ? ` (${employeeNum})` : ""}`;
  }
  if ($("profileQrIdBadge")) {
    $("profileQrIdBadge").textContent = isStudent
      ? `Student ID: ${primaryIdDisplay}`
      : `User ID: #${rawId}`;
  }

  let studentCoursePart = "";
  if (isStudent) {
    try {
      const courseMap = JSON.parse(localStorage.getItem("ecomply_user_course_map") || "{}");
      const mapped = courseMap[profile.id];
      if (mapped?.course_code || mapped?.course_name) {
        studentCoursePart = mapped.course_code ? ` · ${mapped.course_code}` : ` · ${mapped.course_name}`;
      } else if (record.course_code || record.course_name) {
        studentCoursePart = record.course_code ? ` · ${record.course_code}` : ` · ${record.course_name}`;
      }
    } catch (e) {}
  }
  $("roleLine").textContent = isStudent ? `Student${studentCoursePart}${(record.section_name || record.section) ? " · " + (record.section_name || record.section) : ""}` : profile.designation;
  $("departmentDisplay").textContent = record.department || "—";

  $("middleInitialRow").classList.toggle("hidden", isStudent);
  if (!isStudent) {
    $("middleInitial").value = record.middle_initial || "";
  }

  pendingFingerprintTemplate = record.fingerprint_credential_id || null;
  if (!pendingFingerprintTemplate && typeof ZKTeco !== "undefined") {
    const vault = ZKTeco.getBiometricVault();
    const vaultUser = vault[String(profile.id)] || vault[String(profile.username)];
    if (vaultUser && (vaultUser.fingerprint_credential_id || vaultUser.template)) {
      pendingFingerprintTemplate = vaultUser.fingerprint_credential_id || vaultUser.template;
    }
  }
  renderBiometricSection();

  profilePictureDataUrl = record.profile_picture || null;
  renderAvatarPreview();

  // Render Official Embedded ID Card
  renderEmbeddedIdCard();
}

// ── Save ────────────────────────────────────────────────────────────────

async function handleSave(ev) {
  ev.preventDefault();
  const lastName = $("lastName").value.trim();
  const firstName = $("firstName").value.trim();
  if (!lastName || !firstName) {
    showToast("Last name and first name can't be empty.", true);
    return;
  }

  const isStudent = profile.role === "student";
  const table = isStudent ? "students" : "app_users";

  // Preserve existing template if not re-enrolled and not explicitly removed
  const finalFpTemplate = isFingerprintExplicitlyRemoved 
    ? null 
    : (pendingFingerprintTemplate !== null ? pendingFingerprintTemplate : (record?.fingerprint_credential_id || profile?.fingerprint_credential_id || null));

  const payload = {
    last_name: lastName,
    first_name: firstName,
    profile_picture: profilePictureDataUrl,
    fingerprint_credential_id: finalFpTemplate,
  };
  if (!isStudent) payload.middle_initial = $("middleInitial").value.trim() || null;

  const btn = $("saveBtn");
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Saving…";

  // Always save to local biometric vault so Live20R biometric login works offline
  if (typeof ZKTeco !== "undefined") {
    ZKTeco.saveBiometricVaultUser({
      id: profile.id,
      first_name: firstName,
      last_name: lastName,
      username: record?.username || profile.username || "user",
      designation: profile.designation,
      role: profile.role,
      college_id: profile.college_id,
      department_id: profile.department_id,
      campus_name: profile.campus_name || "Main Campus",
      fingerprint_credential_id: finalFpTemplate
    });
  }

  try {
    let cloudSaved = false;
    if (typeof sb !== "undefined" && sb && sb.from) {
      try {
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Database timeout")), 2500));
        const res = await Promise.race([
          sb.from(table).update(payload).eq("id", profile.id),
          timeoutPromise
        ]);
        if (res && res.error) throw res.error;
        cloudSaved = true;
      } catch (cloudErr) {
        console.warn("Cloud save notice (local biometric vault preserved):", cloudErr);
      }
    }

    // Keep the session's cached name and template in sync so sidebars and login pick it up
    profile.first_name = firstName;
    profile.last_name = lastName;
    profile.fingerprint_credential_id = finalFpTemplate;
    setPortalSession(profile);

    if (record) {
      record.last_name = lastName;
      record.first_name = firstName;
      record.fingerprint_credential_id = finalFpTemplate;
    }

    if (cloudSaved) {
      showToast("Profile & biometric updated successfully.");
    } else {
      showToast("Profile & biometric saved locally to Live20R vault.");
    }
  } catch (err) {
    console.error("Failed to save profile:", err);
    showToast(`Saved locally to Live20R biometric vault.`, false);
  }
  btn.disabled = false;
  btn.textContent = original;
}

// ── Startup ─────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  if (typeof getPortalSession !== "function") {
    $("loadingState").textContent = "session.js is missing or out of date. Re-download it and reload.";
    return;
  }
  profile = getPortalSession();
  if (!profile) { window.location.href = "index.html"; return; }

  if (typeof sb === "undefined") {
    $("loadingState").textContent = "Database connection not found — supabaseClient.js did not load. Check the browser console.";
    return;
  }

  $("backLink").href = PORTAL_ROUTES[profile.designation] || "index.html";
  $("profileForm")?.addEventListener("submit", handleSave);
  $("uploadPhotoBtn")?.addEventListener("click", () => $("photoFileInput")?.click());
  $("photoFileInput")?.addEventListener("change", handlePhotoUpload);
  $("removePhotoBtn")?.addEventListener("click", () => {
    profilePictureDataUrl = null;
    $("photoFileInput").value = "";
    renderAvatarPreview();
  });

  $("enrollFingerprintBtn")?.addEventListener("click", handleEnrollFingerprint);
  $("testMyFingerprintBtn")?.addEventListener("click", handleTestFingerprint);
  $("removeMyFingerprintBtn")?.addEventListener("click", handleRemoveFingerprint);

  $("profileDownloadQrBtn")?.addEventListener("click", () => {
    if (typeof QRClient === "undefined") return;
    const qrPayload = QRClient.getUserQrPayload({ ...record, ...profile });
    const dataUrl = QRClient.generateDataUrl(qrPayload, { size: 350 });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `ESSU_ID_${profile.username || profile.id}_QR.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  $("profileFlipIdCardBtn")?.addEventListener("click", () => {
    isProfileIdBack = !isProfileIdBack;
    renderEmbeddedIdCard();
  });

  $("profilePrintIdCardBtn")?.addEventListener("click", () => {
    if (typeof QRClient === "undefined") return;
    const userData = {
      ...record,
      ...profile,
      first_name: $("firstName")?.value?.trim() || record?.first_name || profile?.first_name,
      last_name: $("lastName")?.value?.trim() || record?.last_name || profile?.last_name,
      middle_initial: $("middleInitial")?.value?.trim() || record?.middle_initial || profile?.middle_initial,
      profile_picture: profilePictureDataUrl || record?.profile_picture || profile?.profile_picture || null
    };
    const frontHtml = QRClient.renderIdCardHtml(userData, { isBack: false });
    const backHtml = QRClient.renderIdCardHtml(userData, { isBack: true });
    const fullName = `${userData.last_name || ""}, ${userData.first_name || ""}`.trim();
    const printWin = window.open("", "_blank", "width=700,height=800");
    if (!printWin) {
      showToast("Please allow popups to print your ID card.", true);
      return;
    }
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>ESSU Official Digital ID - ${fullName}</title>
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        <style>
          body { font-family: system-ui, sans-serif; background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
          @media print {
            body { padding: 0; min-height: auto; }
            .no-print { display: none !important; }
            .page-break { page-break-after: always; }
          }
        </style>
      </head>
      <body>
        <div class="no-print mb-4 flex gap-3">
          <button onclick="window.print()" style="background:#14432A;color:#fff;padding:8px 18px;border-radius:8px;font-weight:bold;cursor:pointer;border:none;">Print Official ID Card</button>
          <button onclick="window.close()" style="background:#FAF7EF;color:#52555C;border:1px solid #DEDACE;padding:8px 16px;border-radius:8px;cursor:pointer;">Close</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:20px;justify-content:center;max-width:760px;">
          <div style="width:340px;">${frontHtml}</div>
          <div style="width:340px;">${backHtml}</div>
        </div>
      </body>
      </html>
    `);
    printWin.document.close();
  });

  $("profileTestQrScannerBtn")?.addEventListener("click", () => {
    if (typeof QRClient !== "undefined") {
      QRClient.openScannerModal({
        title: "Test QR ID Scanner",
        subtitle: "Scan your mobile QR code or ID badge to test camera detection.",
        candidates: [{ ...record, ...profile }],
        onMatch: () => {
          showToast("✓ QR Code verified successfully!");
        }
      });
    }
  });

  loadOwnRecord();
});