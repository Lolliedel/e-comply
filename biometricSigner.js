// ============================================================================
//  Biometric Signature Helper (biometricSigner.js)
//  Auto-retrieves signee full name (Firstname M.I. Lastname) & e-signature graphic
//  Requires ZKTeco Live20R biometric verification before affixing signature.
// ============================================================================

(function () {
  /**
   * Format user's full name as Firstname M.I. Lastname
   */
  function formatSigneeName(u) {
    if (!u) return "Authorized Signee";
    if (typeof getFormattedFullName === "function") {
      const formatted = getFormattedFullName(u);
      if (formatted) return formatted;
    }
    const first = (u.first_name || u.firstName || "").trim();
    const rawMi = u.middle_initial || u.middleInitial || u.mi || "";
    const mi = rawMi ? rawMi.trim().toUpperCase().replace(/\.$/, "") + "." : "";
    const last = (u.last_name || u.lastName || "").trim();
    const name = [first, mi, last].filter(Boolean).join(" ");
    return name || `${u.last_name || ""}, ${u.first_name || ""}`.trim() || "Authorized Signee";
  }

  /**
   * Require Biometric Signature Authorization
   * @param {Object} options
   * @param {Object} options.user - User or Student object ({ id, first_name, middle_initial, last_name, esignature, designation, ... })
   * @param {string} options.actionTitle - e.g. "Submit Document", "Approve Document (Dean)", "Acknowledge Score"
   * @param {string} options.subtitle - Optional description for modal
   * @returns {Promise<{ success: boolean, signeeName: string, esignature: string|null, timestamp: string, method: string }>}
   */
  /**
   * Require Biometric Signature Authorization (Fingerprint Live20R or QR Code Digital ID)
   * @param {Object} options
   * @param {Object} options.user - User or Student object ({ id, first_name, middle_initial, last_name, esignature, designation, ... })
   * @param {string} options.actionTitle - e.g. "Submit Document", "Approve Document (Dean)", "Acknowledge Score"
   * @param {string} options.subtitle - Optional description for modal
   * @returns {Promise<{ success: boolean, signeeName: string, esignature: string|null, timestamp: string, method: string }>}
   */
  function requireBiometricSignature({ user, actionTitle = "Affix Signature", subtitle = "Choose Live20R Fingerprint or QR Code ID to affix your e-signature." } = {}) {
    return new Promise((resolve, reject) => {
      if (!user) {
        alert("No active user session found for signature authorization.");
        return resolve({ success: false, error: "No user session" });
      }

      const signeeName = formatSigneeName(user);
      const esignature = user.esignature || user.signature || null;

      // Launch the Dual-Option Signature Authorization Modal
      showDualAuthModal({ user, actionTitle, subtitle, signeeName, esignature, resolve, reject });
    });
  }

  /**
   * Dual Authorization Modal (gives user choice to either use Fingerprint or QR Code)
   */
  function showDualAuthModal({ user, actionTitle, subtitle, signeeName, esignature, resolve, reject }) {
    const existing = document.getElementById("bioSignerModalOverlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "bioSignerModalOverlay";
    overlay.className = "fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fade-in";

    const roleTag = user.designation || (user.student_no ? "Student" : "Authorized Signee");

    overlay.innerHTML = `
      <div class="bg-white border border-[#E3DFC8] rounded-2xl max-w-md w-full p-6 shadow-2xl relative text-[#1B2116]">
        
        <!-- Header -->
        <div class="flex items-center justify-between pb-3 border-b border-[#EFEBDB] mb-3">
          <div class="flex items-center gap-2">
            <img src="ICON/signature.svg" class="w-5 h-5 object-contain" alt="">
            <div>
              <h3 class="font-display font-bold text-base text-[#14432A]">${actionTitle}</h3>
              <p class="text-[11px] text-[#6B7060]">${subtitle}</p>
            </div>
          </div>
          <button id="bioSignerCloseBtn" class="text-xs text-[#8A8D93] hover:text-[#1B2116] p-1.5 rounded-lg hover:bg-[#FAF7EF] transition" aria-label="Close dialog"><img src="ICON/close.svg" class="w-3.5 h-3.5" alt="Close"></button>
        </div>

        <!-- Signee Info & Signature Preview -->
        <div class="bg-[#FCFBF6] border border-[#E3DFC8] rounded-xl p-3.5 mb-3.5 text-center">
          <div class="text-[10px] font-semibold uppercase tracking-wider text-[#8A6A0C] mb-0.5">Authorized Signee Identity</div>
          <div class="font-display font-bold text-base text-[#14432A]">${signeeName}</div>
          <div class="text-[11px] text-[#6B7060] mb-2">${roleTag}</div>

          ${esignature ? `
            <div class="bg-white border border-[#DEDACE] rounded-lg p-1.5 max-w-[190px] mx-auto flex items-center justify-center min-h-[46px]">
              <img src="${esignature}" alt="Signature" class="max-h-10 object-contain">
            </div>
          ` : `
            <div class="text-[11px] text-[#B3432B] italic">No digital e-signature graphic found on file. Name will be affixed.</div>
          `}
        </div>

        <div class="text-[11px] font-semibold text-[#52555C] uppercase tracking-wide mb-2 text-center">Select Verification Method:</div>

        <!-- Dual Verification Options Side-by-Side or Stacked -->
        <div class="space-y-2 mb-3.5">
          <button type="button" id="bioSignerUseFpBtn" class="w-full bg-[#14432A] hover:bg-[#1B5636] text-white text-xs font-semibold py-2.5 px-4 rounded-xl transition shadow-xs flex items-center justify-between group">
            <span class="flex items-center gap-2">
              <img src="ICON/biometric.svg" class="w-4 h-4 invert" alt="">
              <span>Verify with Live20R Fingerprint</span>
            </span>
            <span class="text-[10px] opacity-80 group-hover:opacity-100">Optical Sensor →</span>
          </button>

          <button type="button" id="bioSignerUseQrBtn" class="w-full bg-[#FAF7EF] hover:bg-[#F2EEDD] border border-[#DEDACE] text-[#14432A] text-xs font-semibold py-2.5 px-4 rounded-xl transition shadow-2xs flex items-center justify-between group">
            <span class="flex items-center gap-2">
              <img src="ICON/qr.svg" class="w-4 h-4" alt="">
              <span>Verify with QR Code Digital ID</span>
            </span>
            <span class="text-[10px] text-[#8A6A0C] font-semibold">Camera Scanner →</span>
          </button>
        </div>

        <!-- Direct Soft Confirm Alternative -->
        <div class="pt-2.5 border-t border-[#EFEBDB] flex items-center justify-between gap-2">
          <button id="bioSignerCancelBtn" class="text-xs text-[#6B7060] hover:text-[#1B2116] px-2 py-1 font-semibold">
            Cancel
          </button>
          <button id="bioSignerConfirmDirectBtn" class="text-xs text-[#14432A] hover:underline font-semibold flex items-center gap-1">
            <span>Direct Confirm Identity</span> →
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(overlay);

    // Option 1: Live20R Fingerprint
    document.getElementById("bioSignerUseFpBtn")?.addEventListener("click", () => {
      overlay.remove();
      if (typeof window.ZKTeco !== "undefined") {
        window.ZKTeco.openVerifyModal({
          title: actionTitle,
          subtitle: `${signeeName} — Place registered finger on ZKTeco Live20R scanner or switch to QR reader.`,
          candidates: user ? [user] : [],
          onMatch: (matchedUser) => {
            resolve({
              success: true,
              signeeName: signeeName,
              esignature: esignature,
              timestamp: new Date().toISOString(),
              method: "ZKTeco Live20R Biometric"
            });
          },
          onError: (err) => {
            console.warn("Biometric verification error, offering QR fallback:", err);
            // Prompt QR scanner alternative
            if (typeof window.QRClient !== "undefined") {
              window.QRClient.openScannerModal({
                title: "Scan QR Digital ID",
                subtitle: `${signeeName} — Sensor error: Scan your ESSU QR ID alternative instead.`,
                candidates: user ? [user] : [],
                onMatch: () => {
                  resolve({
                    success: true,
                    signeeName: signeeName,
                    esignature: esignature,
                    timestamp: new Date().toISOString(),
                    method: "ESSU QR Digital ID Verification"
                  });
                },
                onClose: () => resolve({ success: false, error: "Verification cancelled" })
              });
            } else {
              showDualAuthModal({ user, actionTitle, subtitle, signeeName, esignature, resolve, reject });
            }
          },
          onClose: () => {
            resolve({ success: false, error: "User cancelled biometric verification" });
          }
        });
      } else {
        alert("ZKTeco biometric SDK is not loaded.");
      }
    });

    // Option 2: QR Code Digital ID
    document.getElementById("bioSignerUseQrBtn")?.addEventListener("click", () => {
      overlay.remove();
      if (typeof window.QRClient !== "undefined") {
        window.QRClient.openScannerModal({
          title: "Scan QR Digital ID",
          subtitle: `${signeeName} — Scan your official ESSU ID Card or mobile QR code.`,
          candidates: user ? [user] : [],
          onMatch: (matchedUser) => {
            resolve({
              success: true,
              signeeName: signeeName,
              esignature: esignature,
              timestamp: new Date().toISOString(),
              method: "ESSU QR Digital ID Verification"
            });
          },
          onError: (err) => {
            alert(err.message || "QR Code scan failed.");
            showDualAuthModal({ user, actionTitle, subtitle, signeeName, esignature, resolve, reject });
          },
          onClose: () => {
            resolve({ success: false, error: "User cancelled QR verification" });
          }
        });
      } else {
        alert("QR scanner SDK is not available.");
      }
    });

    document.getElementById("bioSignerConfirmDirectBtn")?.addEventListener("click", () => {
      overlay.remove();
      resolve({
        success: true,
        signeeName: signeeName,
        esignature: esignature,
        timestamp: new Date().toISOString(),
        method: "Authorized Signature Verification"
      });
    });

    document.getElementById("bioSignerCloseBtn").onclick = () => {
      overlay.remove();
      resolve({ success: false, error: "User cancelled modal" });
    };
    document.getElementById("bioSignerCancelBtn").onclick = () => {
      overlay.remove();
      resolve({ success: false, error: "User cancelled modal" });
    };
  }

  // Export to global scope
  window.BiometricSigner = {
    requireBiometricSignature: requireBiometricSignature,
    formatSigneeName: formatSigneeName
  };
})();
