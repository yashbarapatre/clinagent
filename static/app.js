// ClinAgent Frontend Application Logic — v2

// ─────────────────────────────────────────────────────────────────
// Config & State
// ─────────────────────────────────────────────────────────────────
const API_BASE = window.location.origin;

let activeSessionId      = null;
let pollInterval         = null;
let activePatient        = null;
let currentDocs          = null;
let missingDataCheck     = null;
let allergyCheckResult_state = null;
let allergyOverrideGranted   = false;
let missingDataAcknowledged  = false;

// Speech Recognition
let recognition     = null;
let isRecording     = false;

// ─────────────────────────────────────────────────────────────────
// DOM References
// ─────────────────────────────────────────────────────────────────
const patientSelect      = document.getElementById("patient-select");
const patientEhrCard     = document.getElementById("patient-ehr-card");
const runPipelineBtn     = document.getElementById("run-pipeline-btn");
const dictationInput     = document.getElementById("dictation-input");
const imageNotesInput    = document.getElementById("image-notes");
const recordBtn          = document.getElementById("record-btn");
const waveform           = document.getElementById("audio-waveform");
const recordStatus       = document.getElementById("record-status");
const imageUpload        = document.getElementById("image-upload");
const uploadLabel        = document.getElementById("upload-label");

// Safety Feature 1 — Missing Data
const safetyCheckPanel       = document.getElementById("safety-check-panel");
const safetyCriticalContainer= document.getElementById("safety-critical-container");
const safetyWarningContainer = document.getElementById("safety-warning-container");
const acknowledgeBtn         = document.getElementById("acknowledge-btn");

// Safety Feature 2 — Allergy Check (review portal)
const allergyCheckSection= document.getElementById("allergy-check-section");
const allergyIcon        = document.getElementById("allergy-icon");
const allergyTitle       = document.getElementById("allergy-title");
const allergyCheckSpinner= document.getElementById("allergy-check-spinner");
const allergyCheckResult = document.getElementById("allergy-check-result");
const allergyResultBody  = document.getElementById("allergy-result-body");
const allergyOverrideBox = document.getElementById("allergy-override-box");
const allergyOverrideReason = document.getElementById("allergy-override-reason");
const overrideUnlockBtn  = document.getElementById("override-unlock-btn");

// Pipeline screens
const stateIdle      = document.getElementById("state-idle");
const stateRunning   = document.getElementById("state-running");
const stateReview    = document.getElementById("state-review");
const pipelineProgress = document.getElementById("pipeline-progress");
const consoleOutput  = document.getElementById("terminal-console-output");

// Agent nodes
const nodeIntake    = document.getElementById("node-intake");
const nodeRag       = document.getElementById("node-rag");
const nodeReasoning = document.getElementById("node-reasoning");
const nodeDoc       = document.getElementById("node-documentation");
const nodeVerify    = document.getElementById("node-verification");

// Tabs
const tabBtns     = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

// SOAP
const soapSubj   = document.getElementById("soap-subjective");
const soapObj    = document.getElementById("soap-objective");
const soapAssess = document.getElementById("soap-assessment");
const soapPlan   = document.getElementById("soap-plan");

// Prior Auth
const paMed     = document.getElementById("pa-medication");
const paIcd     = document.getElementById("pa-icd10");
const paJustify = document.getElementById("pa-justification");

// Discharge
const dcAdmit    = document.getElementById("dc-admit");
const dcDischarge= document.getElementById("dc-discharge");
const dcCourse   = document.getElementById("dc-course");
const dcMeds     = document.getElementById("dc-meds");
const dcFollowup = document.getElementById("dc-followup");

// Existing verification card
const verificationCard  = document.getElementById("verification-card");
const safetyShieldIcon  = document.getElementById("safety-shield-icon");
const safetyTitle       = document.getElementById("safety-title");
const safetyDosingList  = document.getElementById("safety-dosing-checks");
const safetyAdherence   = document.getElementById("safety-guidelines-adherence");
const safetyFlagsWrapper= document.getElementById("safety-warnings-wrapper");
const safetyFlagsList   = document.getElementById("safety-flags");
const safetyRecsWrapper = document.getElementById("safety-recommendations-wrapper");
const safetyRecs        = document.getElementById("safety-recommendations");

// Actions
const clinicianNotes = document.getElementById("clinician-notes");
const approveBtn     = document.getElementById("approve-btn");
const rejectBtn      = document.getElementById("reject-btn");

// Audit trail
const sessionsList  = document.getElementById("sessions-list");
const trailFallback = document.getElementById("trail-details-fallback");
const trailWrapper  = document.getElementById("trail-details-wrapper");
const trailSessionId= document.getElementById("trail-session-id");
const trailStatus   = document.getElementById("trail-status");
const trailTimeline = document.getElementById("trail-timeline");

// Add Patient Modal
const addPatientBtn   = document.getElementById("add-patient-btn");
const addPatientModal = document.getElementById("add-patient-modal");
const modalCloseBtn   = document.getElementById("modal-close-btn");
const modalCancelBtn  = document.getElementById("modal-cancel-btn");
const modalSaveBtn    = document.getElementById("modal-save-btn");
const addMedBtn       = document.getElementById("add-med-btn");
const npMedsList      = document.getElementById("np-meds-list");
const npErrorMsg      = document.getElementById("np-error-msg");

// ─────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    fetchPatients();
    loadAuditSessions();
    setupEventListeners();
    setupSpeechRecognition();
});

// ─────────────────────────────────────────────────────────────────
// Event Listeners
// ─────────────────────────────────────────────────────────────────
function setupEventListeners() {
    patientSelect.addEventListener("change", e => {
        if (e.target.value) fetchPatientDetails(e.target.value);
    });

    recordBtn.addEventListener("click", toggleRecording);

    imageUpload.addEventListener("change", e => {
        const file = e.target.files[0];
        if (file) {
            uploadLabel.innerHTML = `<i class="fa-solid fa-file-image" style="color:#a855f7;"></i> <strong>${file.name}</strong> (${(file.size/1024).toFixed(1)} KB)`;
            imageNotesInput.value = `Image analysis requested for: ${file.name}.\nSuggested findings: Consolidation in left lung base / Cardiomegaly with mild pulmonary venous congestion.`;
        }
    });

    runPipelineBtn.addEventListener("click", startWorkflow);

    acknowledgeBtn.addEventListener("click", () => {
        missingDataAcknowledged = true;
        acknowledgeBtn.innerHTML = `<i class="fa-solid fa-check"></i> Missing Data Acknowledged — Pipeline Unlocked`;
        acknowledgeBtn.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
        acknowledgeBtn.style.animation = "none";
        acknowledgeBtn.disabled = true;
        runPipelineBtn.disabled = false;
        runPipelineBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> Run ClinAgent Orchestrator`;
    });

    overrideUnlockBtn.addEventListener("click", () => {
        const reason = allergyOverrideReason.value.trim();
        if (!reason) {
            allergyOverrideReason.style.borderColor = "#ef4444";
            allergyOverrideReason.focus();
            return;
        }
        allergyOverrideGranted = true;
        allergyOverrideBox.innerHTML = `
            <div style="color:#fca5a5;font-size:0.83rem;font-weight:600;display:flex;gap:0.4rem;align-items:center;">
                <i class="fa-solid fa-exclamation-triangle"></i> Override documented. Clinician assumes responsibility.
            </div>
            <div style="font-size:0.8rem;color:var(--text-secondary);background:rgba(255,255,255,0.02);padding:0.5rem;border-radius:6px;border:1px solid var(--card-border);">
                <strong>Reason:</strong> "${reason}"
            </div>`;
        approveBtn.disabled = false;
        approveBtn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Approve with Override (Allergy Risk Acknowledged)`;
        approveBtn.style.background = "linear-gradient(135deg, #d97706 0%, #b45309 100%)";
    });

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => b.classList.remove("active"));
            tabContents.forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
        });
    });

    approveBtn.addEventListener("click", submitApproval);

    rejectBtn.addEventListener("click", () => {
        if (confirm("Discard this session and all generated documents?")) resetScreens();
    });

    // Add Patient Modal
    addPatientBtn.addEventListener("click", openAddPatientModal);
    modalCloseBtn.addEventListener("click", closeAddPatientModal);
    modalCancelBtn.addEventListener("click", closeAddPatientModal);
    addPatientModal.addEventListener("click", e => {
        if (e.target === addPatientModal) closeAddPatientModal();
    });
    addMedBtn.addEventListener("click", addMedicationRow);
    modalSaveBtn.addEventListener("click", saveNewPatient);
}

// ─────────────────────────────────────────────────────────────────
// Real Speech Recognition (Web Speech API)
// ─────────────────────────────────────────────────────────────────
function showSpeechUnsupportedHint(message) {
    // Show an inline, dismissable banner instead of a blocking alert
    let banner = document.getElementById("speech-unsupported-banner");
    if (!banner) {
        banner = document.createElement("div");
        banner.id = "speech-unsupported-banner";
        banner.style.cssText = [
            "background:rgba(239,68,68,0.12)",
            "border:1px solid rgba(239,68,68,0.4)",
            "color:#fca5a5",
            "border-radius:8px",
            "padding:10px 14px",
            "margin-top:8px",
            "font-size:13px",
            "line-height:1.5",
            "position:relative"
        ].join(";");
        const close = document.createElement("span");
        close.textContent = "✕";
        close.style.cssText = "position:absolute;top:8px;right:12px;cursor:pointer;opacity:0.7";
        close.onclick = () => banner.remove();
        banner.appendChild(close);
        // Insert below the record button
        recordBtn.parentNode.insertBefore(banner, recordBtn.nextSibling);
    }
    banner.firstChild.textContent = "";
    const close = banner.querySelector("span");
    banner.textContent = message;
    banner.appendChild(close);
}

function initSpeechRecognition() {
    // Called lazily on first click so the browser can prompt for mic permission
    if (recognition) return true;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        // Check if the problem might be 127.0.0.1 vs localhost
        const hint = location.hostname === "127.0.0.1"
            ? `Speech recognition requires a secure context. Try opening the app at <a href="http://localhost:${location.port}" style="color:#818cf8">http://localhost:${location.port}</a> instead of 127.0.0.1.`
            : "Speech recognition is not available. Please use Chrome or Edge with microphone permissions enabled.";
        showSpeechUnsupportedHint(hint);
        return false;
    }

    recognition = new SpeechRecognition();
    recognition.continuous    = true;
    recognition.interimResults = true;
    recognition.lang          = "en-US";

    let finalTranscript = "";

    recognition.onstart = () => {
        isRecording = true;
        finalTranscript = dictationInput.value; // preserve existing text
        waveform.classList.remove("hidden");
        recordStatus.style.display = "inline";
        recordBtn.innerHTML = `<i class="fa-solid fa-stop" style="color:#ef4444;"></i> Stop Recording`;
        recordBtn.style.background = "rgba(239,68,68,0.12)";
        recordBtn.style.borderColor = "rgba(239,68,68,0.4)";
        recordBtn.style.color = "#ef4444";
    };

    recognition.onresult = e => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const t = e.results[i][0].transcript;
            if (e.results[i].isFinal) {
                finalTranscript += (finalTranscript ? " " : "") + t.trim();
            } else {
                interim += t;
            }
        }
        dictationInput.value = finalTranscript + (interim ? " " + interim : "");
    };

    recognition.onerror = e => {
        console.error("Speech recognition error:", e.error);
        if (e.error === "not-allowed") {
            showSpeechUnsupportedHint(
                "Microphone access was denied. Click the 🔒 icon in your browser's address bar and allow microphone access, then try again."
            );
        } else if (e.error === "network") {
            showSpeechUnsupportedHint("Speech recognition requires an internet connection for the first use.");
        }
        stopRecording();
    };

    recognition.onend = () => {
        if (isRecording) {
            // Auto-restart for continuous recording
            try { recognition.start(); } catch(e) { stopRecording(); }
        }
    };

    return true;
}

// Keep setupSpeechRecognition as a no-op — init is now lazy (on first click)
function setupSpeechRecognition() { /* lazy init via initSpeechRecognition() */ }

function toggleRecording() {
    // Lazy-init: attempt to create the recognition object on first user gesture
    if (!recognition && !initSpeechRecognition()) return;
    if (isRecording) {
        stopRecording();
    } else {
        try {
            recognition.start();
        } catch (e) {
            console.error("Recognition start error:", e);
        }
    }
}

function stopRecording() {
    isRecording = false;
    if (recognition) {
        try { recognition.stop(); } catch(e) {}
    }
    waveform.classList.add("hidden");
    recordStatus.style.display = "none";
    recordBtn.innerHTML = `<i class="fa-solid fa-microphone"></i> Start Recording`;
    recordBtn.style.background = "";
    recordBtn.style.borderColor = "";
    recordBtn.style.color = "";
}

// ─────────────────────────────────────────────────────────────────
// Fetch Patients
// ─────────────────────────────────────────────────────────────────
async function fetchPatients() {
    try {
        const res = await fetch(`${API_BASE}/api/patients`);
        const patients = await res.json();
        // Clear existing options (keep placeholder)
        while (patientSelect.options.length > 1) patientSelect.remove(1);
        patients.forEach(p => {
            const opt = document.createElement("option");
            opt.value = p.id;
            opt.textContent = `${p.name} (${p.gender}, Age ${p.age})`;
            patientSelect.appendChild(opt);
        });
    } catch (err) {
        console.error("Error loading patients:", err);
    }
}

// ─────────────────────────────────────────────────────────────────
// Fetch Patient Details
// ─────────────────────────────────────────────────────────────────
async function fetchPatientDetails(id) {
    try {
        const res = await fetch(`${API_BASE}/api/patients/${id}`);
        activePatient = await res.json();

        document.getElementById("ehr-name").textContent = activePatient.name;
        document.getElementById("ehr-age").textContent  = activePatient.age;
        document.getElementById("ehr-gender").textContent = activePatient.gender;
        document.getElementById("ehr-dob").textContent  = activePatient.date_of_birth;

        const histList = document.getElementById("ehr-history");
        histList.innerHTML = "";
        (activePatient.history || []).forEach(h => {
            const li = document.createElement("li"); li.textContent = h; histList.appendChild(li);
        });

        const medsList = document.getElementById("ehr-meds");
        medsList.innerHTML = "";
        (activePatient.current_medications || []).forEach(m => {
            const li = document.createElement("li");
            li.textContent = typeof m === "object" ? `${m.name} ${m.dosage} - ${m.frequency}` : m;
            medsList.appendChild(li);
        });

        const vitalsGrid = document.getElementById("ehr-vitals");
        vitalsGrid.innerHTML = "";
        for (const [k, v] of Object.entries(activePatient.vitals || {})) {
            const isHigh = v.toLowerCase().includes("high");
            vitalsGrid.innerHTML += `<div class="vital-tag ${isHigh ? 'high' : ''}"><label>${k.replace(/_/g," ").toUpperCase()}</label><span>${v.replace("(High)","").trim()}</span></div>`;
        }

        const labsGrid = document.getElementById("ehr-labs");
        labsGrid.innerHTML = "";
        for (const [k, v] of Object.entries(activePatient.labs || {})) {
            const isHigh = v.toLowerCase().includes("high") || v.toLowerCase().includes("elevated");
            labsGrid.innerHTML += `<div class="lab-tag ${isHigh ? 'high' : ''}"><label>${k.toUpperCase()}</label><span>${v.replace(/\((High|Elevated|Mildly Elevated)\)/gi,"").trim()}</span></div>`;
        }

        patientEhrCard.classList.remove("hidden");

        // ── SAFETY FEATURE 1: Run missing data check ──
        await runMissingDataCheck(activePatient);

        // Clear dictation for fresh recording
        dictationInput.value = "";
    } catch (err) {
        console.error("Error loading patient details:", err);
    }
}

// ─────────────────────────────────────────────────────────────────
// SAFETY FEATURE 1 — Missing Data Check
// ─────────────────────────────────────────────────────────────────
async function runMissingDataCheck(patient) {
    missingDataAcknowledged = false;
    missingDataCheck = null;
    runPipelineBtn.disabled = true;
    runPipelineBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> Run ClinAgent Orchestrator`;
    acknowledgeBtn.classList.add("hidden");
    acknowledgeBtn.disabled = false;
    acknowledgeBtn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> I Acknowledge Missing Data — Proceed with Caution`;
    acknowledgeBtn.style.background = "";
    acknowledgeBtn.style.animation = "";
    safetyCriticalContainer.innerHTML = "";
    safetyWarningContainer.innerHTML = "";

    try {
        const res = await fetch(`${API_BASE}/api/safety-check/${patient.id}`, { method: "POST" });
        missingDataCheck = await res.json();
    } catch (err) {
        safetyCheckPanel.classList.add("hidden");
        runPipelineBtn.disabled = false;
        return;
    }

    const { critical, warnings, result } = missingDataCheck;
    const hasIssues = critical.length > 0 || warnings.length > 0;
    safetyCheckPanel.classList.toggle("hidden", !hasIssues);

    critical.forEach(f => {
        safetyCriticalContainer.innerHTML += `
            <div class="safety-alert-critical">
                <i class="fa-solid fa-circle-xmark alert-icon"></i>
                <div class="alert-body">
                    <strong>🔴 CRITICAL: ${f.label} is missing.</strong>
                    <p>Pipeline blocked until this is resolved. Please update the patient record before proceeding.<br>
                    <em style="font-size:0.75rem;opacity:0.75;">${f.description}</em></p>
                </div>
            </div>`;
    });

    warnings.forEach(f => {
        safetyWarningContainer.innerHTML += `
            <div class="safety-alert-warning">
                <i class="fa-solid fa-triangle-exclamation alert-icon"></i>
                <div class="alert-body">
                    <strong>🟡 WARNING: ${f.label} not documented.</strong>
                    <p>Clinical decisions may be incomplete. Clinician must acknowledge before proceeding.<br>
                    <em style="font-size:0.75rem;opacity:0.75;">${f.description}</em></p>
                </div>
            </div>`;
    });

    if (result === "blocked") {
        runPipelineBtn.disabled = true;
        runPipelineBtn.innerHTML = `<i class="fa-solid fa-ban"></i> Pipeline Blocked — Resolve Critical Fields First`;
        acknowledgeBtn.classList.add("hidden");
    } else if (result === "warnings") {
        acknowledgeBtn.classList.remove("hidden");
        runPipelineBtn.disabled = true;
    } else {
        runPipelineBtn.disabled = false;
    }
}

// ─────────────────────────────────────────────────────────────────
// Start Workflow
// ─────────────────────────────────────────────────────────────────
async function startWorkflow() {
    if (!activePatient) return;
    stopRecording();

    stateIdle.classList.add("hidden");
    stateReview.classList.add("hidden");
    stateRunning.classList.remove("hidden");
    pipelineProgress.style.width = "0%";
    consoleOutput.innerHTML = "";
    resetNodes();

    const formData = new FormData();
    formData.append("patient_id", activePatient.id);
    formData.append("dictation", dictationInput.value);
    formData.append("image_notes", imageNotesInput.value);
    if (imageUpload.files[0]) formData.append("image", imageUpload.files[0]);

    writeConsole("System", "Initiating parallel multi-agent clinical workflow...");
    if (missingDataCheck?.warnings?.length > 0) {
        writeConsole("Safety", `⚠️ Proceeding with ${missingDataCheck.warnings.length} unresolved warning(s) — clinician acknowledged.`);
    }

    try {
        const res = await fetch(`${API_BASE}/api/intake`, { method: "POST", body: formData });
        const data = await res.json();

        if (data.status === "Blocked") {
            writeConsole("Safety", "🔴 Pipeline blocked by server: critical patient data missing.");
            stateRunning.classList.add("hidden");
            stateIdle.classList.remove("hidden");
            return;
        }

        activeSessionId = data.session_id;
        allergyCheckResult_state = null;
        allergyOverrideGranted = false;
        pollInterval = setInterval(pollWorkflowStatus, 1500);
    } catch (err) {
        writeConsole("Error", `Failed to start pipeline: ${err.message}`);
        stateRunning.classList.add("hidden");
        stateIdle.classList.remove("hidden");
    }
}

// ─────────────────────────────────────────────────────────────────
// Poll Status
// ─────────────────────────────────────────────────────────────────
async function pollWorkflowStatus() {
    if (!activeSessionId) return;
    try {
        const res = await fetch(`${API_BASE}/api/workflow-status/${activeSessionId}`);
        if (!res.ok) { clearInterval(pollInterval); throw new Error("Status fetch failed"); }
        const status = await res.json();

        pipelineProgress.style.width = `${status.progress}%`;

        status.steps.forEach(step => {
            if (!document.getElementById(`step-${step.timestamp}`)) {
                const parts = step.description.split(":");
                writeConsole(parts.length > 1 ? parts[0] : "Agent",
                             parts.length > 1 ? parts.slice(1).join(":") : step.description,
                             step.timestamp);
            }
        });

        updatePipelineNodes(status.progress, status.status);

        if (status.status === "Pending Review") {
            clearInterval(pollInterval);
            writeConsole("System", "Documentation generated. Clinician review required.");
            setTimeout(() => renderReviewWorkspace(status.outputs, status.verification, status.allergy_check), 800);
        } else if (status.status === "Failed") {
            clearInterval(pollInterval);
            writeConsole("Error", "Pipeline failed. Check inputs and try again.");
        }
    } catch (err) {
        clearInterval(pollInterval);
        writeConsole("Error", `Polling error: ${err.message}`);
    }
}

// ─────────────────────────────────────────────────────────────────
// Render Review Workspace
// ─────────────────────────────────────────────────────────────────
function renderReviewWorkspace(outputs, verification, allergyData) {
    stateRunning.classList.add("hidden");
    stateReview.classList.remove("hidden");
    currentDocs = outputs;

    soapSubj.value   = outputs.soap_note.subjective;
    soapObj.value    = outputs.soap_note.objective;
    soapAssess.value = outputs.soap_note.assessment;
    soapPlan.value   = outputs.soap_note.plan;

    paMed.value     = outputs.prior_auth.medication_name;
    paIcd.value     = outputs.prior_auth.icd_10_code;
    paJustify.value = outputs.prior_auth.medical_necessity_justification;

    dcAdmit.value    = outputs.discharge_summary.admitting_diagnosis;
    dcDischarge.value= outputs.discharge_summary.discharge_diagnosis;
    dcCourse.value   = outputs.discharge_summary.summary_of_hospital_course;
    dcMeds.value     = outputs.discharge_summary.discharge_medications.join(", ");
    dcFollowup.value = outputs.discharge_summary.follow_up_instructions;
    clinicianNotes.value = "";

    // Existing verification card
    const isSafe = verification.is_safe;
    verificationCard.className = `verification-alert-card ${isSafe ? "" : "warning-state"}`;
    safetyShieldIcon.className = `fa-solid ${isSafe ? "fa-shield-halved" : "fa-triangle-exclamation"}`;
    safetyTitle.textContent = isSafe
        ? "Safety Audit Complete: No issues found"
        : `Clinical Safety Risk: ${verification.flags.length} Flag(s) Raised`;

    safetyDosingList.innerHTML = "";
    verification.dosing_checks.forEach(d => { safetyDosingList.innerHTML += `<li>${d}</li>`; });
    safetyAdherence.textContent = verification.guideline_adherence;

    if (!isSafe) {
        safetyFlagsWrapper.classList.remove("hidden");
        safetyFlagsList.innerHTML = "";
        verification.flags.forEach(f => { safetyFlagsList.innerHTML += `<li>${f}</li>`; });
        safetyRecsWrapper.classList.remove("hidden");
        safetyRecs.textContent = verification.recommendations;
    } else {
        safetyFlagsWrapper.classList.add("hidden");
        safetyRecsWrapper.classList.add("hidden");
    }

    // SAFETY FEATURE 2 — Allergy Check
    if (allergyData) {
        renderAllergyCheck(allergyData);
    } else {
        allergyCheckSection.classList.remove("hidden");
        allergyCheckSpinner.classList.remove("hidden");
        allergyCheckResult.classList.add("hidden");
        approveBtn.disabled = true;

        const allergyPoll = setInterval(async () => {
            try {
                const r = await fetch(`${API_BASE}/api/workflow-status/${activeSessionId}`);
                if (!r.ok) { clearInterval(allergyPoll); approveBtn.disabled = false; return; }
                const st = await r.json();
                if (st.allergy_check) { clearInterval(allergyPoll); renderAllergyCheck(st.allergy_check); }
            } catch { clearInterval(allergyPoll); approveBtn.disabled = false; }
        }, 2000);
    }
}

// ─────────────────────────────────────────────────────────────────
// SAFETY FEATURE 2 — Allergy Check Renderer
// ─────────────────────────────────────────────────────────────────
function renderAllergyCheck(data) {
    allergyCheckResult_state = data;
    allergyCheckSection.classList.remove("hidden");
    allergyCheckSpinner.classList.add("hidden");
    allergyCheckResult.classList.remove("hidden");

    const status  = data.result_status;
    const rawText = data.raw_response || "";

    allergyCheckSection.className = `allergy-check-section allergy-${status}`;

    const iconMap = {
        critical:        "fa-circle-xmark",
        warning:         "fa-triangle-exclamation",
        safe:            "fa-shield-check",
        no_allergy_data: "fa-triangle-exclamation",
    };
    const titleMap = {
        critical:        "🔴 Critical Allergy Conflict Detected — Approve Blocked",
        warning:         "🟡 Allergy Warning — Review Before Approving",
        safe:            "✅ All Medications Verified Safe Against Documented Allergies",
        no_allergy_data: "⚠️ No Allergy Data on File — Verify Before Approving",
    };

    allergyIcon.className  = `fa-solid ${iconMap[status] || "fa-flask-vial"}`;
    allergyTitle.textContent = titleMap[status] || "Allergy Check Complete";
    allergyResultBody.innerHTML = "";

    if (status === "safe") {
        allergyResultBody.innerHTML = `<div class="allergy-safe-msg"><i class="fa-solid fa-check-circle"></i> All medications verified safe against documented allergies.</div>`;
    } else if (status === "no_allergy_data") {
        allergyResultBody.innerHTML = `
            <div class="allergy-no-data-msg">
                <i class="fa-solid fa-triangle-exclamation" style="margin-top:2px;flex-shrink:0;"></i>
                <span>No allergy data on file. Clinician must verify patient allergies before approving any medications.</span>
            </div>
            <div class="allergy-raw-text">${escapeHtml(rawText)}</div>`;
    } else {
        const conflicts = parseAllergyConflicts(rawText);
        if (conflicts.length > 0) {
            conflicts.forEach(c => {
                const sevClass = (c.severity || "").toLowerCase();
                allergyResultBody.innerHTML += `
                    <div class="conflict-card severity-${sevClass}">
                        <div class="conflict-card-header">
                            <span class="severity-badge ${sevClass}">${c.severity || "Unknown"}</span>
                            <span>${c.medication || "Unknown medication"}</span>
                        </div>
                        <div class="conflict-row"><strong>Allergy:</strong><span>${c.allergy || "—"}</span></div>
                        <div class="conflict-row"><strong>Reason:</strong><span>${c.reason || "—"}</span></div>
                        <div class="conflict-row"><strong>Alternative:</strong><span style="color:#10b981;">${c.alternative || "Consult pharmacist"}</span></div>
                    </div>`;
            });
        } else {
            allergyResultBody.innerHTML = `<div class="allergy-raw-text">${escapeHtml(rawText)}</div>`;
        }
    }

    if (status === "critical") {
        approveBtn.disabled = true;
        approveBtn.innerHTML = `<i class="fa-solid fa-ban"></i> Approve Blocked — Critical Allergy Conflict`;
        allergyOverrideBox.classList.remove("hidden");
        allergyOverrideGranted = false;
    } else {
        approveBtn.disabled = false;
        approveBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> Approve & Push to EHR (FHIR)`;
        allergyOverrideBox.classList.add("hidden");
        approveBtn.style.background = "";
    }
}

function parseAllergyConflicts(text) {
    const conflicts = [];
    const blocks = text.split(/\n(?=SEVERITY:)/i);
    for (const block of blocks) {
        if (!block.trim() || !block.match(/SEVERITY:/i)) continue;
        const get = label => { const m = block.match(new RegExp(`${label}:\\s*(.+)`, "i")); return m ? m[1].trim() : ""; };
        conflicts.push({ severity: get("SEVERITY"), medication: get("MEDICATION"), allergy: get("ALLERGY"), reason: get("REASON"), alternative: get("ALTERNATIVE") });
    }
    return conflicts;
}

function escapeHtml(str) {
    return (str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ─────────────────────────────────────────────────────────────────
// Submit Approval
// ─────────────────────────────────────────────────────────────────
async function submitApproval() {
    if (!activeSessionId) return;
    const payload = {
        session_id: activeSessionId,
        soap_note: { subjective: soapSubj.value, objective: soapObj.value, assessment: soapAssess.value, plan: soapPlan.value },
        prior_auth: { medication_name: paMed.value, icd_10_code: paIcd.value, medical_necessity_justification: paJustify.value },
        discharge_summary: {
            patient_id: activePatient.id,
            admitting_diagnosis: dcAdmit.value,
            discharge_diagnosis: dcDischarge.value,
            summary_of_hospital_course: dcCourse.value,
            discharge_medications: dcMeds.value.split(",").map(m => m.trim()),
            follow_up_instructions: dcFollowup.value
        },
        notes: clinicianNotes.value,
        allergy_override_reason: allergyOverrideGranted ? allergyOverrideReason.value.trim() : null,
        missing_data_acknowledged: missingDataAcknowledged,
        missing_data_fields_acknowledged: missingDataCheck ? (missingDataCheck.warnings || []).map(w => w.label) : [],
    };

    try {
        approveBtn.disabled = true;
        approveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Pushing to EHR...`;
        const res = await fetch(`${API_BASE}/api/approve`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
        const data = await res.json();
        if (data.status === "Success") {
            alert(`✅ Approved and pushed to EHR!\nFHIR bundle saved to: ${data.fhir_file}`);
            resetScreens();
            loadAuditSessions();
        } else {
            alert("Failed to submit approval.");
        }
    } catch (err) {
        alert(`Error: ${err.message}`);
    } finally {
        approveBtn.disabled = false;
        approveBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> Approve & Push to EHR (FHIR)`;
    }
}

// ─────────────────────────────────────────────────────────────────
// Add New Patient Modal
// ─────────────────────────────────────────────────────────────────
function openAddPatientModal() {
    addPatientModal.classList.remove("hidden");
    npMedsList.innerHTML = "";
    npErrorMsg.classList.add("hidden");
    // Clear all fields
    ["np-name","np-dob","np-age","np-history","np-allergies","np-weight","np-directives","np-lmp",
     "vit-temp","vit-hr","vit-rr","vit-bp","vit-o2",
     "lab-creat","lab-egfr","lab-bnp","lab-na","lab-k","lab-bun","lab-gluc","lab-hba1c","lab-wbc"
    ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    document.getElementById("np-gender").value = "";
    document.getElementById("np-code-status").value = "";
    document.getElementById("np-pregnancy").value = "";
}

function closeAddPatientModal() {
    addPatientModal.classList.add("hidden");
}

function addMedicationRow() {
    const row = document.createElement("div");
    row.className = "med-row";
    row.innerHTML = `
        <input type="text" placeholder="Medication name" class="med-name">
        <input type="text" placeholder="Dosage" class="med-dose">
        <input type="text" placeholder="Frequency" class="med-freq">
        <button class="remove-med-btn" title="Remove"><i class="fa-solid fa-xmark"></i></button>
    `;
    row.querySelector(".remove-med-btn").addEventListener("click", () => row.remove());
    npMedsList.appendChild(row);
    row.querySelector(".med-name").focus();
}

async function saveNewPatient() {
    npErrorMsg.classList.add("hidden");

    const name   = document.getElementById("np-name").value.trim();
    const dob    = document.getElementById("np-dob").value;
    const age    = parseInt(document.getElementById("np-age").value);
    const gender = document.getElementById("np-gender").value;

    if (!name || !dob || !age || !gender) {
        npErrorMsg.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Name, Date of Birth, Age, and Gender are required.`;
        npErrorMsg.classList.remove("hidden");
        return;
    }

    // Collect medications
    const meds = [];
    npMedsList.querySelectorAll(".med-row").forEach(row => {
        const name = row.querySelector(".med-name").value.trim();
        const dose = row.querySelector(".med-dose").value.trim();
        const freq = row.querySelector(".med-freq").value.trim();
        if (name) meds.push({ name, dosage: dose || "—", frequency: freq || "—" });
    });

    // Allergies
    const allergyRaw = document.getElementById("np-allergies").value.trim();
    const allergies = allergyRaw ? allergyRaw.split(",").map(a => a.trim()).filter(Boolean) : [];

    // Vitals
    const vitals = {};
    if (document.getElementById("vit-temp").value) vitals.temperature = document.getElementById("vit-temp").value;
    if (document.getElementById("vit-hr").value)   vitals.heart_rate  = document.getElementById("vit-hr").value;
    if (document.getElementById("vit-rr").value)   vitals.respiratory_rate = document.getElementById("vit-rr").value;
    if (document.getElementById("vit-bp").value)   vitals.blood_pressure   = document.getElementById("vit-bp").value;
    if (document.getElementById("vit-o2").value)   vitals.oxygen_saturation = document.getElementById("vit-o2").value;

    // Labs
    const labs = {};
    const labMap = { "lab-creat": "Creatinine", "lab-egfr": "eGFR", "lab-bnp": "BNP",
                     "lab-na": "Sodium", "lab-k": "Potassium", "lab-bun": "BUN",
                     "lab-gluc": "Glucose", "lab-hba1c": "HbA1c", "lab-wbc": "WBC" };
    for (const [id, label] of Object.entries(labMap)) {
        const val = document.getElementById(id).value.trim();
        if (val) labs[label] = val;
    }

    // History
    const historyRaw = document.getElementById("np-history").value.trim();
    const history = historyRaw ? historyRaw.split("\n").map(h => h.trim()).filter(Boolean) : [];

    const payload = {
        name, age, gender,
        date_of_birth: dob,
        history,
        current_medications: meds,
        vitals, labs, allergies,
        weight:             document.getElementById("np-weight").value.trim(),
        code_status:        document.getElementById("np-code-status").value,
        pregnancy_status:   document.getElementById("np-pregnancy").value,
        last_menstrual_period: document.getElementById("np-lmp").value,
        advance_directives: document.getElementById("np-directives").value.trim(),
    };

    modalSaveBtn.disabled = true;
    modalSaveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

    try {
        const res = await fetch(`${API_BASE}/api/patients`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status === "created") {
            closeAddPatientModal();
            await fetchPatients();
            // Auto-select the new patient
            patientSelect.value = data.id;
            patientSelect.dispatchEvent(new Event("change"));
        } else {
            throw new Error("Server returned unexpected response");
        }
    } catch (err) {
        npErrorMsg.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Failed to save patient: ${err.message}`;
        npErrorMsg.classList.remove("hidden");
    } finally {
        modalSaveBtn.disabled = false;
        modalSaveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Patient`;
    }
}

// ─────────────────────────────────────────────────────────────────
// Pipeline Helpers
// ─────────────────────────────────────────────────────────────────
function writeConsole(source, text, timestamp = null) {
    const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = "console-line";
    if (timestamp) line.id = `step-${timestamp}`;
    const color = source === "Safety" ? "#f59e0b" : source === "Error" ? "#ef4444" : "#6366f1";
    line.innerHTML = `<span class="timestamp">[${time}]</span> <strong style="color:${color};">${source}:</strong> ${text}`;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function updatePipelineNodes(progress, status) {
    resetNodes();
    if (progress >= 10) { nodeIntake.className    = "agent-node completed"; nodeRag.className = "agent-node active"; }
    if (progress >= 30) { nodeRag.className        = "agent-node completed"; nodeReasoning.className = "agent-node active"; }
    if (progress >= 50) { nodeReasoning.className  = "agent-node completed"; nodeDoc.className = "agent-node active"; }
    if (progress >= 70) { nodeDoc.className        = "agent-node completed"; nodeVerify.className = "agent-node active"; }
    if (progress >= 85) { nodeVerify.className     = "agent-node completed"; }
}

function resetNodes() {
    [nodeIntake, nodeRag, nodeReasoning, nodeDoc, nodeVerify].forEach(n => {
        n.className = "agent-node";
        n.querySelector("small").textContent = "Pending";
    });
}

function resetScreens() {
    activeSessionId = null; currentDocs = null; missingDataCheck = null;
    allergyCheckResult_state = null; allergyOverrideGranted = false; missingDataAcknowledged = false;

    stateReview.classList.add("hidden");
    stateRunning.classList.add("hidden");
    stateIdle.classList.remove("hidden");

    patientSelect.value = "";
    patientEhrCard.classList.add("hidden");
    safetyCheckPanel.classList.add("hidden");
    safetyCriticalContainer.innerHTML = "";
    safetyWarningContainer.innerHTML = "";
    acknowledgeBtn.classList.add("hidden");
    acknowledgeBtn.disabled = false;
    acknowledgeBtn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> I Acknowledge Missing Data — Proceed with Caution`;
    acknowledgeBtn.style.cssText = "";

    allergyCheckSection.classList.add("hidden");
    allergyCheckSection.className = "allergy-check-section hidden";
    allergyCheckSpinner.classList.remove("hidden");
    allergyCheckResult.classList.add("hidden");
    allergyOverrideBox.classList.add("hidden");
    allergyOverrideReason.value = "";

    approveBtn.disabled = false;
    approveBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> Approve & Push to EHR (FHIR)`;
    approveBtn.style.background = "";

    runPipelineBtn.disabled = true;
    runPipelineBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> Run ClinAgent Orchestrator`;
    dictationInput.value = "";
    imageNotesInput.value = "";
    imageUpload.value = "";
    uploadLabel.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i><span>Drag and drop or click to upload clinical images</span>`;
    stopRecording();
}

// ─────────────────────────────────────────────────────────────────
// Audit Trails
// ─────────────────────────────────────────────────────────────────
async function loadAuditSessions() {
    try {
        const res = await fetch(`${API_BASE}/api/audit-logs`);
        const sessions = await res.json();
        sessionsList.innerHTML = "";
        if (!sessions.length) {
            sessionsList.innerHTML = `<li style="padding:1rem;color:var(--text-muted);text-align:center;">No clinical runs logged yet.</li>`;
            return;
        }
        sessions.forEach(s => {
            const time = new Date(s.created_at).toLocaleString();
            const bc = s.status.toLowerCase() === "approved" ? "completed" : s.status.toLowerCase() === "rejected" ? "rejected" : "pending";
            const li = document.createElement("li");
            li.className = "audit-list-item";
            li.innerHTML = `<div class="session-info"><h4>${s.patient_name}</h4><span>Intake: ${time}</span></div><span class="badge ${bc}">${s.status}</span>`;
            li.addEventListener("click", () => {
                document.querySelectorAll(".audit-list-item").forEach(i => i.classList.remove("selected"));
                li.classList.add("selected");
                loadAuditTrailDetails(s.session_id);
            });
            sessionsList.appendChild(li);
        });
    } catch (err) { console.error("Error loading audit sessions:", err); }
}

async function loadAuditTrailDetails(sessionId) {
    try {
        const res = await fetch(`${API_BASE}/api/audit-logs/${sessionId}`);
        const trail = await res.json();
        trailFallback.classList.add("hidden");
        trailWrapper.classList.remove("hidden");
        trailSessionId.textContent = trail.session_id;
        const bc = trail.status.toLowerCase() === "approved" ? "completed" : trail.status.toLowerCase() === "rejected" ? "rejected" : "pending";
        trailStatus.className = `badge ${bc}`;
        trailStatus.textContent = trail.status;
        trailTimeline.innerHTML = "";

        trail.events.forEach(evt => {
            const date = new Date(evt.timestamp).toLocaleString();
            let html = "", evtClass = "";

            switch (evt.event_type) {
                case "intake_completed":
                    evtClass = "success";
                    html = `<strong>Patient:</strong> ${evt.data.patient_name} (ID: ${evt.data.patient_id})<br><strong>Dictation:</strong> "${evt.data.dictation}"`;
                    break;
                case "missing_data_check":
                    const hasCrit = (evt.data.critical_fields_missing||[]).length>0;
                    evtClass = hasCrit ? "danger" : (evt.data.warning_fields_missing||[]).length>0 ? "" : "success";
                    html = `<strong>Result:</strong> ${(evt.data.result||"").toUpperCase()}<br>
                            ${hasCrit ? `<strong style="color:#ef4444;">Critical Missing:</strong> ${evt.data.critical_fields_missing.join(", ")}<br>` : ""}
                            ${(evt.data.warning_fields_missing||[]).length ? `<strong style="color:#f59e0b;">Warnings:</strong> ${evt.data.warning_fields_missing.join(", ")}` : ""}
                            ${!hasCrit && !(evt.data.warning_fields_missing||[]).length ? `<span style="color:#10b981;">✅ All required fields present.</span>` : ""}`;
                    break;
                case "missing_data_acknowledged":
                    html = `<strong>Clinician:</strong> ${evt.data.clinician_id}<br><strong>Fields:</strong> ${(evt.data.fields_acknowledged||[]).join(", ")||"None listed"}`;
                    break;
                case "rag_completed":
                    evtClass = "success";
                    html = `<strong>Guidelines Retrieved:</strong><br><pre style="white-space:pre-wrap;font-size:0.75rem;">${evt.data.retrieved_guidelines.substring(0,300)}...</pre>`;
                    break;
                case "docs_generated":
                    evtClass = "success";
                    html = `SOAP Note, Prior Auth, Discharge Summary — all generated.`;
                    break;
                case "verification_completed":
                    evtClass = evt.data.is_safe ? "success" : "danger";
                    html = `<strong>Result:</strong> ${evt.data.is_safe ? "✅ SAFE" : "🔴 RISKS DETECTED"}<br><strong>Adherence:</strong> "${evt.data.guideline_adherence}"`;
                    break;
                case "allergy_check_started":
                    html = `<strong>Allergies:</strong> ${evt.data.patient_allergies}<br><strong>Medications:</strong> ${evt.data.medications_to_check}`;
                    break;
                case "allergy_check_completed":
                    evtClass = evt.data.has_critical ? "danger" : evt.data.has_warning ? "" : "success";
                    html = `<strong>Result:</strong> ${(evt.data.result_status||"").toUpperCase()}<br>
                            <strong>Critical:</strong> ${evt.data.has_critical ? "🔴 YES" : "✅ No"} &nbsp;
                            <strong>Warning:</strong> ${evt.data.has_warning ? "🟡 YES" : "✅ No"}<br>
                            <pre style="white-space:pre-wrap;font-size:0.75rem;">${(evt.data.summary||"").substring(0,400)}</pre>`;
                    break;
                case "allergy_override":
                    evtClass = "danger";
                    html = `<strong style="color:#ef4444;">⚠️ CLINICIAN OVERRIDE — Allergy Conflict Bypassed</strong><br>
                            <strong>Clinician:</strong> ${evt.data.clinician_id}<br>
                            <strong>Reason:</strong> "${evt.data.override_reason}"`;
                    break;
                case "clinician_reviewed":
                    evtClass = evt.data.action === "approve" ? "success" : "danger";
                    html = `<strong>Notes:</strong> "${evt.data.notes||"None"}"<br>
                            ${evt.data.allergy_override ? `<strong style="color:#f59e0b;">Allergy Override:</strong> "${evt.data.allergy_override_reason}"<br>` : ""}
                            ${evt.data.missing_data_acknowledged ? `<strong style="color:#f59e0b;">Missing Data Acknowledged</strong><br>` : ""}
                            <strong>FHIR Push:</strong> Completed`;
                    break;
                default:
                    html = `<strong>Data:</strong> ${JSON.stringify(evt.data)}`;
            }

            trailTimeline.innerHTML += `
                <div class="timeline-event ${evtClass}">
                    <div class="event-header">
                        <span>${evt.event_type.replace(/_/g," ").toUpperCase()}</span>
                        <span class="time">${date}</span>
                    </div>
                    <div class="event-details">${html}</div>
                </div>`;
        });
    } catch (err) { console.error("Error loading audit trail:", err); }
}
