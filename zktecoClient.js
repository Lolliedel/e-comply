/**
 * ZKTeco Live20R Web Client SDK (zktecoClient.js)
 * 
 * Provides web applications with seamless communication to the local
 * ZKTeco Live20R Bridge Service (http://127.0.0.1:43711).
 * 
 * Includes:
 * - Device status checks & auto-discovery
 * - 3-Pass Fingerprint Enrollment Modal with Live Visual Feedback
 * - Quick Fingerprint Scan / Login Modal
 * - Biometric template matching (1:1 and 1:N)
 */

(function () {
  const BRIDGE_URL = "http://127.0.0.1:43711";

  const ZKTeco = {
    BRIDGE_URL: BRIDGE_URL,
    isAvailable: false,
    deviceInfo: null,

    _pollerTimer: null,
    _lastStatusKey: "",

    /**
     * Start automatic background status polling so UI updates the moment
     * the site loads or the scanner is plugged in/unplugged.
     */
    startAutoPoller(intervalMs = 2500) {
      if (this._pollerTimer) return;
      const poll = async () => {
        const res = await this.checkStatus();
        this.updateUiBadges(res);
      };
      poll();
      this._pollerTimer = setInterval(poll, intervalMs);
    },

    updateUiBadges(res) {
      const badge = document.getElementById("scannerStatusBadge");
      const indicator = document.getElementById("scannerIndicator");
      const text = document.getElementById("scannerStatusText");

      const key = res.ok ? `${res.ok}_${res.device?.connected}` : "offline";
      if (key !== this._lastStatusKey) {
        this._lastStatusKey = key;
        window.dispatchEvent(new CustomEvent("zkteco-status-change", { detail: res }));
      }

      if (!badge || !indicator || !text) return;

      if (res.ok && res.device?.connected) {
        indicator.className = "w-2 h-2 rounded-full bg-[#248A54] animate-pulse";
        text.textContent = "ZKTeco Live20R: Ready";
        badge.title = "Live20R optical biometric scanner is connected and ready.";
      } else if (res.ok && !res.device?.connected) {
        indicator.className = "w-2 h-2 rounded-full bg-[#D9A62C]";
        text.textContent = "ZKTeco Bridge: Ready (Plug in Live20R scanner)";
        badge.title = "Bridge service is running. Connect your Live20R optical scanner to a USB port.";
      } else {
        indicator.className = "w-2 h-2 rounded-full bg-[#8A8D93]";
        text.textContent = "ZKTeco Bridge: Offline (Click to start)";
        badge.title = "ZKTeco Bridge service is not running. Double-click start-zkteco-bridge-silent.bat to activate.";
      }
    },

    /**
     * Check if ZKTeco Live20R Bridge service is running
     */
    async checkStatus() {
      try {
        const res = await fetch(`${BRIDGE_URL}/api/status`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store"
        });
        if (!res.ok) throw new Error("Bridge HTTP " + res.status);
        const data = await res.json();
        this.isAvailable = true;
        this.deviceInfo = data.device;
        return { ok: true, device: data.device };
      } catch (err) {
        this.isAvailable = false;
        this.deviceInfo = null;
        return {
          ok: false,
          error: "ZKTeco Live20R Bridge is not running. Launch start-zkteco-bridge-silent.bat on your PC."
        };
      }
    },

    /**
     * Single Fingerprint Capture
     */
    async capture(seedOrUsername) {
      try {
        const res = await fetch(`${BRIDGE_URL}/api/capture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: seedOrUsername })
        });
        if (!res.ok) throw new Error("Capture failed");
        return await res.json();
      } catch (err) {
        throw new Error("Could not connect to ZKTeco scanner: " + err.message);
      }
    },

    /**
     * 1:1 Match
     */
    async match(template1, template2) {
      try {
        const res = await fetch(`${BRIDGE_URL}/api/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template1, template2 })
        });
        return await res.json();
      } catch (err) {
        return { success: false, match: false, error: err.message };
      }
    },

    /**
     * 1:N Identify against candidate templates
     */
    async identify(template, candidates) {
      try {
        const res = await fetch(`${BRIDGE_URL}/api/identify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ template, candidates })
        });
        return await res.json();
      } catch (err) {
        return { success: false, match: false, error: err.message };
      }
    },

    /**
     * Local Biometric Vault Helpers
     * Persists enrolled templates locally so biometric login functions flawlessly
     * whether Supabase is online, offline, or paused.
     */
    getBiometricVault() {
      try {
        const raw = localStorage.getItem("ecomply_biometric_vault");
        return raw ? JSON.parse(raw) : {};
      } catch (e) {
        return {};
      }
    },

    saveBiometricVaultUser(user) {
      if (!user || (!user.id && !user.username)) return null;
      const vault = this.getBiometricVault();
      const primaryKey = String(user.id || user.username);
      
      const record = {
        ...(vault[primaryKey] || {}),
        ...user,
        updated_at: new Date().toISOString()
      };
      vault[primaryKey] = record;

      if (user.username && String(user.username) !== primaryKey) {
        vault[String(user.username)] = record;
      }
      try {
        localStorage.setItem("ecomply_biometric_vault", JSON.stringify(vault));
      } catch (e) {
        console.warn("Could not save to biometric vault:", e);
      }
      return record;
    },

    async getAllCandidates() {
      const vault = this.getBiometricVault();
      const candidates = [];
      const seen = new Set();

      // 1. Gather all candidates from local biometric vault
      for (const val of Object.values(vault)) {
        if (!val || (!val.fingerprint_credential_id && !val.template)) continue;
        const key = val.id ? `id_${val.id}` : `u_${val.username}`;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(val);
        }
      }

      // Check additional local storage caches
      try {
        const sessRaw = localStorage.getItem("portal_session");
        if (sessRaw) {
          const s = JSON.parse(sessRaw);
          if (s && (s.fingerprint_credential_id || s.template)) {
            const key = s.id ? `id_${s.id}` : `u_${s.username}`;
            if (!seen.has(key)) {
              seen.add(key);
              candidates.push(s);
              this.saveBiometricVaultUser(s);
            }
          }
        }
      } catch (e) {}

      try {
        const usersRaw = localStorage.getItem("ecomply_users");
        if (usersRaw) {
          const uList = JSON.parse(usersRaw);
          if (Array.isArray(uList)) {
            for (const u of uList) {
              if (u && (u.fingerprint_credential_id || u.template)) {
                const key = u.id ? `id_${u.id}` : `u_${u.username}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  candidates.push(u);
                  this.saveBiometricVaultUser(u);
                }
              }
            }
          }
        }
      } catch (e) {}

      // 2. Query Supabase (resilient Promise.allSettled and only existing table columns)
      if (typeof sb !== "undefined" && sb && sb.from) {
        try {
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Supabase fetch timeout")), 3000)
          );

          const fetchStaff = sb.from("app_users")
            .select("id, first_name, last_name, designation, college_id, department_id, username, fingerprint_credential_id")
            .not("fingerprint_credential_id", "is", null);

          const fetchStudents = sb.from("students")
            .select("id, first_name, last_name, section_id, college_id, department_id, username, fingerprint_credential_id")
            .not("fingerprint_credential_id", "is", null);

          const [staffRes, studentRes] = await Promise.race([
            Promise.allSettled([fetchStaff, fetchStudents]),
            timeoutPromise
          ]);

          const staff = (staffRes?.status === "fulfilled" && staffRes.value?.data ? staffRes.value.data : []).map((u) => ({ ...u, role: "staff" }));
          const students = (studentRes?.status === "fulfilled" && studentRes.value?.data ? studentRes.value.data : []).map((s) => ({ ...s, role: "student", designation: "Student" }));
          const cloudCandidates = [...staff, ...students];

          for (const cand of cloudCandidates) {
            const key = `id_${cand.id}`;
            if (!seen.has(key)) {
              seen.add(key);
              candidates.push(cand);
            }
            // Automatically cache cloud candidates to local vault
            this.saveBiometricVaultUser(cand);
          }
        } catch (err) {
          console.warn("Cloud candidate fetch skipped or offline:", err?.message || err);
        }
      }

      return candidates;
    },

    // ── BIOMETRIC ENROLLMENT MODAL (3-PASS) ──────────────────────────────
    openEnrollmentModal({ username = "User", onComplete, onError, onClose } = {}) {
      this.closeModal();

      let currentStep = 1;
      let isBusy = false;
      let lastResult = null;

      const modalEl = document.createElement("div");
      modalEl.id = "zktecoModalOverlay";
      modalEl.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in";
      modalEl.innerHTML = `
        <div class="bg-white border border-[#E3DFC8] rounded-2xl max-w-md w-full p-6 shadow-2xl relative text-[#1B2116] overflow-hidden">
          
          <!-- Header -->
          <div class="flex items-center justify-between pb-4 border-b border-[#EFEBDB]">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-[#14432A] text-[#D9A62C] flex items-center justify-center text-base font-bold shadow-xs">
                <img src="ICON/biometric.svg" class="w-4 h-4 object-contain invert brightness-0 saturate-100" alt="">
              </div>
              <div>
                <h3 class="font-display font-bold text-base text-[#14432A]">ZKTeco Live20R Enrollment</h3>
                <p class="text-[11px] text-[#6B7060]">Optical Biometric Registration</p>
              </div>
            </div>
            <button id="zkModalCloseBtn" class="text-xs text-[#8A8D93] hover:text-[#1B2116] p-1.5 rounded-lg hover:bg-[#FAF7EF] transition" aria-label="Close dialog"><img src="ICON/close.svg" class="w-3.5 h-3.5" alt="Close"></button>
          </div>

          <!-- Body -->
          <div class="py-5 text-center">
            
            <!-- Scanner Visual Animation -->
            <div class="relative w-28 h-36 mx-auto mb-4 bg-[#FAF7EF] border-2 border-[#DEDACE] rounded-2xl flex flex-col items-center justify-center overflow-hidden shadow-inner group">
              <div id="zkSensorGlow" class="absolute inset-0 bg-[#1F6F4A]/10 transition duration-500"></div>
              
              <!-- Fingerprint SVG Icon / Live Preview -->
              <div id="zkScannerVisual" class="relative z-10 w-16 h-20 flex items-center justify-center">
                <svg id="zkFpIcon" class="w-14 h-14 text-[#14432A] transition-all duration-300 transform scale-100" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.026.99-4.184.99-6.42a8 8 0 10-16 0c0 1.594.304 3.118.86 4.515" />
                </svg>
                <img id="zkFpPreviewImg" class="hidden w-full h-full object-contain rounded-lg" alt="Fingerprint Preview" />
              </div>

              <!-- Optical Scanner Bezel Ring -->
              <div class="absolute bottom-2 text-[9px] font-mono text-[#8A8D93] uppercase tracking-wider">Live20R</div>
            </div>

            <!-- Steps Pill -->
            <div class="flex items-center justify-center gap-2 mb-3">
              <div id="stepDot1" class="w-2.5 h-2.5 rounded-full bg-[#14432A] transition"></div>
              <div id="stepDot2" class="w-2.5 h-2.5 rounded-full bg-[#DEDACE] transition"></div>
              <div id="stepDot3" class="w-2.5 h-2.5 rounded-full bg-[#DEDACE] transition"></div>
            </div>

            <!-- Status Text -->
            <h4 id="zkModalTitle" class="font-display font-semibold text-base mb-1">Place finger on Live20R scanner</h4>
            <p id="zkModalSubtitle" class="text-xs text-[#6B7060] max-w-xs mx-auto mb-4">Sample 1 of 3: Firmly press the user's finger on the glass sensor surface.</p>

            <!-- Quality Bar -->
            <div class="w-full bg-[#EFEBDB] h-1.5 rounded-full overflow-hidden mb-4 max-w-xs mx-auto">
              <div id="zkProgressBar" class="bg-[#14432A] h-full w-1/3 transition-all duration-300"></div>
            </div>

            <!-- Error / Warning Box -->
            <div id="zkModalAlert" class="hidden bg-[#FBEAE4] border border-[#E5B4A4] text-[#8A3420] text-xs rounded-lg px-3 py-2 mb-3"></div>

            <!-- Action Buttons -->
            <div class="flex gap-2.5 justify-center">
              <button id="zkScanActionBtn" class="bg-[#14432A] hover:bg-[#1B5636] text-white text-xs font-semibold px-5 py-2.5 rounded-xl transition shadow-xs flex items-center gap-1.5">
                <img src="ICON/biometric.svg" class="w-4 h-4 invert" alt=""> <span id="zkScanBtnLabel">Capture Sample 1</span>
              </button>
              <button id="zkCancelBtn" class="border border-[#DEDACE] hover:bg-[#FAF7EF] text-[#52555C] text-xs font-semibold px-4 py-2.5 rounded-xl transition">
                Cancel
              </button>
            </div>
          </div>

          <!-- Footer -->
          <div class="pt-3 border-t border-[#EFEBDB] flex items-center justify-between text-[11px] text-[#8A8D93]">
            <span class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-[#248A54] animate-pulse"></span> Live20R SilkID Ready
            </span>
            <span class="font-mono">500 DPI • ZKFinger 10.0</span>
          </div>

        </div>
      `;

      document.body.appendChild(modalEl);

      const titleEl = document.getElementById("zkModalTitle");
      const subEl = document.getElementById("zkModalSubtitle");
      const alertEl = document.getElementById("zkModalAlert");
      const pBar = document.getElementById("zkProgressBar");
      const btn = document.getElementById("zkScanActionBtn");
      const btnLabel = document.getElementById("zkScanBtnLabel");
      const fpIcon = document.getElementById("zkFpIcon");
      const previewImg = document.getElementById("zkFpPreviewImg");
      const sensorGlow = document.getElementById("zkSensorGlow");

      const updateStepUi = (step) => {
        currentStep = step;
        [1, 2, 3].forEach((s) => {
          const dot = document.getElementById(`stepDot${s}`);
          if (dot) {
            dot.className = s <= step ? "w-2.5 h-2.5 rounded-full bg-[#14432A] transition" : "w-2.5 h-2.5 rounded-full bg-[#DEDACE] transition";
          }
        });
        pBar.style.width = `${(step / 3) * 100}%`;
        btnLabel.textContent = `Capture Sample ${step}`;
        titleEl.textContent = `Sample ${step} of 3`;
        subEl.textContent = step === 1
          ? "Firmly press finger on the Live20R glass sensor."
          : `Lift finger and place it back on the scanner for step ${step}.`;
      };

      let abortController = null;
      let countdownTimer = null;

      const stopCountdown = () => {
        if (countdownTimer) {
          clearInterval(countdownTimer);
          countdownTimer = null;
        }
      };

      const doCaptureStep = async () => {
        if (isBusy) return;
        isBusy = true;
        stopCountdown();
        alertEl.classList.add("hidden");
        btn.disabled = true;

        let secondsLeft = 14;
        btnLabel.textContent = `Waiting for finger on sensor… (${secondsLeft}s)`;
        sensorGlow.className = "absolute inset-0 bg-[#D9A62C]/30 animate-pulse";
        fpIcon.classList.add("scale-110", "text-[#D9A62C]");

        countdownTimer = setInterval(() => {
          secondsLeft--;
          if (secondsLeft > 0) {
            btnLabel.textContent = `Waiting for finger on sensor… (${secondsLeft}s)`;
          } else {
            stopCountdown();
          }
        }, 1000);

        abortController = new AbortController();

        try {
          const res = await fetch(`${BRIDGE_URL}/api/enroll`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, step: currentStep, timeout: 15.0 }),
            signal: abortController.signal
          });
          stopCountdown();

          if (!res.ok) throw new Error(`Scanner communication error (HTTP ${res.status})`);
          const data = await res.json();
          if (!data.success) throw new Error(data.error || data.message || "Failed to acquire sample");

          // Show captured image preview if available
          if (data.image) {
            fpIcon.classList.add("hidden");
            previewImg.src = data.image;
            previewImg.classList.remove("hidden");
          }

          if (data.isComplete) {
            // Enrollment Finished!
            pBar.style.width = "100%";
            sensorGlow.className = "absolute inset-0 bg-[#248A54]/30";
            titleEl.textContent = "✓ Biometric Enrolled!";
            subEl.textContent = "Live20R high-resolution biometric template created.";
            btn.className = "bg-[#248A54] text-white text-xs font-semibold px-5 py-2.5 rounded-xl cursor-default";
            btnLabel.textContent = "Enrolled Successfully!";

            lastResult = {
              template: data.template,
              image: data.image,
              quality: data.quality || 98
            };

            setTimeout(() => {
              this.closeModal();
              if (typeof onComplete === "function") onComplete(lastResult);
            }, 1200);
            return;
          }

          // Sample captured — advance to next step
          sensorGlow.className = "absolute inset-0 bg-[#248A54]/30";
          titleEl.textContent = `✓ Sample ${currentStep} Captured!`;
          subEl.textContent = `Lift finger now. Preparing scanner for Sample ${currentStep + 1} of 3...`;
          btnLabel.textContent = `Sample ${currentStep} Done ✓`;

          const nextStep = currentStep + 1;
          setTimeout(() => {
            updateStepUi(nextStep);
            sensorGlow.className = "absolute inset-0 bg-[#1F6F4A]/10";
            fpIcon.classList.remove("text-[#D9A62C]");
            if (previewImg) previewImg.classList.add("hidden");
            if (fpIcon) fpIcon.classList.remove("hidden");
            isBusy = false;
            // Smoothly auto-listen for next sample
            doCaptureStep();
          }, 1400);

        } catch (err) {
          stopCountdown();
          isBusy = false;
          btn.disabled = false;
          btnLabel.textContent = `Retry Sample ${currentStep}`;
          sensorGlow.className = "absolute inset-0 bg-[#B3432B]/20";
          fpIcon.classList.remove("text-[#D9A62C]");
          
          if (err.name === "AbortError") return;
          const rawMsg = err.message || "";
          if (rawMsg.includes("Failed to fetch") || rawMsg.includes("NetworkError")) {
            alertEl.innerHTML = `
              <div class="font-medium mb-1">Cannot connect to ZKTeco Bridge.</div>
              <div class="text-[11px] text-[#6B7060]">Ensure <b>start-zkteco-bridge-silent.bat</b> is running.</div>
            `;
          } else {
            alertEl.textContent = rawMsg || "Failed to scan. Check sensor connection.";
          }
          alertEl.classList.remove("hidden");
          if (typeof onError === "function") onError(err);
        }
      };

      btn.addEventListener("click", () => {
        if (!isBusy) doCaptureStep();
      });

      const handleModalClose = () => {
        stopCountdown();
        if (abortController) {
          try { abortController.abort(); } catch (e) {}
        }
        this.closeModal();
        if (typeof onClose === "function") onClose();
      };

      document.getElementById("zkModalCloseBtn")?.addEventListener("click", handleModalClose);
      document.getElementById("zkCancelBtn")?.addEventListener("click", handleModalClose);

      // Auto-trigger step 1 after modal render
      setTimeout(doCaptureStep, 450);
    },

    // ── BIOMETRIC VERIFY / LOGIN MODAL (1-PASS) ──────────────────────────
    openVerifyModal({ title = "Fingerprint Sign-In", subtitle = "Touch the ZKTeco Live20R scanner to verify your identity.", candidates = [], onMatch, onError, onClose } = {}) {
      this.closeModal();

      let isBusy = false;

      const modalEl = document.createElement("div");
      modalEl.id = "zktecoModalOverlay";
      modalEl.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in";
      modalEl.innerHTML = `
        <div class="bg-white border border-[#E3DFC8] rounded-2xl max-w-sm w-full p-6 shadow-2xl relative text-[#1B2116]">
          
          <div class="flex items-center justify-between pb-3 border-b border-[#EFEBDB] mb-3">
            <div class="flex items-center gap-2">
              <img src="ICON/biometric.svg" class="w-4 h-4 object-contain" alt="">
              <h3 class="font-display font-bold text-sm text-[#14432A]">${title}</h3>
            </div>
            <button id="zkVerifyCloseBtn" class="text-xs text-[#8A8D93] hover:text-[#1B2116] p-1.5 rounded-lg hover:bg-[#FAF7EF] transition" aria-label="Close dialog"><img src="ICON/close.svg" class="w-3.5 h-3.5" alt="Close"></button>
          </div>

          <!-- Dual Verification Switcher Tabs (Fingerprint vs QR Code) -->
          <div class="flex rounded-xl bg-[#FAF7EF] p-1 border border-[#DEDACE] mb-4">
            <button type="button" class="flex-1 py-1.5 text-xs font-bold rounded-lg bg-[#14432A] text-white shadow-xs flex items-center justify-center gap-1.5">
              <img src="ICON/biometric.svg" class="w-3.5 h-3.5 invert" alt=""> Live20R Fingerprint
            </button>
            <button type="button" id="zkVerifyTopQrTabBtn" class="flex-1 py-1.5 text-xs font-semibold rounded-lg text-[#14432A] hover:bg-white/60 transition flex items-center justify-center gap-1.5">
              <img src="ICON/qr.svg" class="w-3.5 h-3.5" alt=""> QR Code Digital ID
            </button>
          </div>

          <div class="text-center py-2">
            <!-- Scanner Visual -->
            <div class="relative w-24 h-28 mx-auto mb-4 bg-[#FAF7EF] border-2 border-[#DEDACE] rounded-2xl flex items-center justify-center shadow-inner">
              <div id="zkVerifyGlow" class="absolute inset-0 bg-[#1F6F4A]/10 transition duration-300"></div>
              <svg id="zkVerifyIcon" class="w-12 h-12 text-[#14432A] transition duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.026.99-4.184.99-6.42a8 8 0 10-16 0c0 1.594.304 3.118.86 4.515" />
              </svg>
            </div>

            <p id="zkVerifySub" class="text-xs text-[#6B7060] mb-4">${subtitle}</p>
            <div id="zkVerifyAlert" class="hidden bg-[#FBEAE4] border border-[#E5B4A4] text-[#8A3420] text-xs rounded-lg px-3 py-2 mb-3"></div>

            <button id="zkVerifyScanBtn" class="w-full bg-[#14432A] hover:bg-[#1B5636] text-white text-xs font-semibold py-2.5 rounded-xl transition shadow-xs flex items-center justify-center gap-1.5">
              <img src="ICON/scanner.svg" class="w-4 h-4 invert" alt=""> <span id="zkVerifyBtnText">Scan Live20R</span>
            </button>

            <button type="button" id="zkVerifyQrBtn" class="w-full mt-2 bg-[#FAF7EF] hover:bg-[#F2EEDD] border border-[#DEDACE] text-[#14432A] text-xs font-semibold py-2 rounded-xl transition flex items-center justify-center gap-1.5">
              <img src="ICON/qr.svg" class="w-3.5 h-3.5" alt=""> <span>Switch to QR Code Scanner</span>
            </button>
          </div>

          <div class="pt-2 border-t border-[#EFEBDB] text-center text-[10px] text-[#8A8D93] font-mono">
            ZKTeco Live20R SilkID · QR ID Alternative Supported
          </div>
        </div>
      `;

      document.body.appendChild(modalEl);

      const glow = document.getElementById("zkVerifyGlow");
      const icon = document.getElementById("zkVerifyIcon");
      const alertEl = document.getElementById("zkVerifyAlert");
      const subEl = document.getElementById("zkVerifySub");
      const btn = document.getElementById("zkVerifyScanBtn");
      const btnText = document.getElementById("zkVerifyBtnText");

      const doVerifyScan = async () => {
        if (isBusy) return;
        isBusy = true;
        alertEl.classList.add("hidden");
        btn.disabled = true;
        btnText.textContent = "Waiting for finger on sensor…";
        subEl.textContent = "Sensor active — place your finger firmly on the Live20R scanner.";
        glow.className = "absolute inset-0 bg-[#D9A62C]/30 animate-pulse";
        icon.classList.add("text-[#D9A62C]", "scale-110");

        try {
          // 1. Capture current finger on Live20R (with 15s timeout)
          const capRes = await fetch(`${BRIDGE_URL}/api/capture`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ timeout: 15.0 })
          });
          const capData = await capRes.json();
          if (!capData.success) throw new Error(capData.error || capData.message || "Failed to capture fingerprint");

          // 2. Identify against candidates if provided
          if (candidates && candidates.length > 0) {
            const identRes = await fetch(`${BRIDGE_URL}/api/identify`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ template: capData.template, candidates, threshold: 55 })
            });
            const identData = await identRes.json();

            if (identData.match && identData.user) {
              // Match found!
              glow.className = "absolute inset-0 bg-[#248A54]/30";
              icon.className = "w-12 h-12 text-[#248A54]";
              subEl.textContent = `✓ Identity Verified: ${identData.user.first_name || ""} ${identData.user.last_name || ""}`;
              btnText.textContent = "Verified!";
              btn.className = "w-full bg-[#248A54] text-white text-xs font-semibold py-2.5 rounded-xl cursor-default";

              setTimeout(() => {
                this.closeModal();
                if (typeof onMatch === "function") onMatch(identData.user, capData);
              }, 900);
              return;
            } else {
              // No match
              throw new Error("Fingerprint not recognized. Please register your fingerprint first.");
            }
          } else {
            // Raw capture returned
            glow.className = "absolute inset-0 bg-[#248A54]/30";
            setTimeout(() => {
              this.closeModal();
              if (typeof onMatch === "function") onMatch(null, capData);
            }, 800);
          }
        } catch (err) {
          isBusy = false;
          btn.disabled = false;
          btnText.textContent = "Try Again";
          glow.className = "absolute inset-0 bg-[#B3432B]/20";
          icon.className = "w-12 h-12 text-[#B3432B]";
          const rawMsg = err.message || "";
          if (rawMsg.includes("Failed to fetch") || rawMsg.includes("NetworkError")) {
            alertEl.innerHTML = `
              <div class="mb-1.5 font-medium">Cannot connect to Live20R Bridge.<br><span class="font-normal text-[11px]">Sensor offline. Use QR scanner alternative instead:</span></div>
              <button type="button" id="zkAlertQrBtn" class="w-full bg-[#14432A] hover:bg-[#1B5636] text-white text-xs font-semibold py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 transition">
                <img src="ICON/qr.svg" class="w-3.5 h-3.5 invert" alt=""> Scan QR Code Alternative
              </button>
            `;
            document.getElementById("zkAlertQrBtn")?.addEventListener("click", () => {
              this.closeModal();
              if (typeof QRClient !== "undefined") {
                QRClient.openScannerModal({ title, subtitle, candidates, onMatch, onError, onClose });
              }
            });
          } else {
            alertEl.innerHTML = `
              <div class="mb-1">${rawMsg || "Verification failed."}</div>
              <div class="flex items-center justify-center gap-2 pt-1">
                <button type="button" id="zkQuickEnrollPromptBtn" class="text-[11px] text-[#14432A] underline font-semibold hover:text-[#1B5636]">Enroll as Super Admin</button>
              </div>
            `;
            document.getElementById("zkQuickEnrollPromptBtn")?.addEventListener("click", () => {
              this.closeModal();
              if (typeof window.quickEnrollSuperadminFingerprint === "function") {
                window.quickEnrollSuperadminFingerprint();
              }
            });
          }
          alertEl.classList.remove("hidden");
          if (typeof onError === "function") onError(err);
        }
      };

      btn.addEventListener("click", doVerifyScan);

      const triggerQrAlternative = () => {
        this.closeModal();
        if (typeof window.QRClient !== "undefined" && typeof window.QRClient.openScannerModal === "function") {
          window.QRClient.openScannerModal({ title, subtitle, candidates, onMatch, onError, onClose });
        } else {
          alert("QR scanner SDK is not available.");
        }
      };

      document.getElementById("zkVerifyTopQrTabBtn")?.addEventListener("click", triggerQrAlternative);
      document.getElementById("zkVerifyQrBtn")?.addEventListener("click", triggerQrAlternative);
      document.getElementById("zkVerifyCloseBtn")?.addEventListener("click", () => {
        this.closeModal();
        if (typeof onClose === "function") onClose();
      });

      // Auto-trigger scan after render
      setTimeout(doVerifyScan, 500);
    },

    closeModal() {
      const el = document.getElementById("zktecoModalOverlay");
      if (el) el.remove();
    }
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => ZKTeco.startAutoPoller());
    } else {
      ZKTeco.startAutoPoller();
    }
  }

  window.ZKTeco = ZKTeco;
})();
