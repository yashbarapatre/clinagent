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
        const id = e.target.value;
        if (!id) return;
        // Locally-added (not-yet-persisted) patients live in memory, not the API.
        if (localPatients[id]) displayPatient(localPatients[id]);
        else fetchPatientDetails(id);
    });

    recordBtn.addEventListener("click", toggleRecording);

    imageUpload.addEventListener("change", e => {
        const file = e.target.files[0];
        if (file) {
            // The file's bytes are sent to Gemini for real analysis, so we no
            // longer fabricate findings here — just acknowledge the upload.
            const isPdf = file.type === "application/pdf";
            const icon = isPdf ? "fa-file-pdf" : (file.type.startsWith("image/") ? "fa-file-image" : "fa-file-lines");
            uploadLabel.innerHTML = `<i class="fa-solid ${icon}" style="color:#a855f7;"></i> <strong>${file.name}</strong> (${(file.size/1024).toFixed(1)} KB)`;
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

    // Fitbit range selector (1 week / 1 month / 3 months)
    const fitbitRangeBar = document.getElementById("fitbit-range");
    if (fitbitRangeBar) {
        fitbitRangeBar.addEventListener("click", e => {
            const btn = e.target.closest("button[data-days]");
            if (!btn) return;
            fitbitRangeDays = parseInt(btn.dataset.days, 10);
            fitbitRangeBar.querySelectorAll("button").forEach(b => b.classList.toggle("active", b === btn));
            drawFitbit();
        });
    }

    // Add Patient Modal
    addPatientBtn.addEventListener("click", openAddPatientModal);
    modalCloseBtn.addEventListener("click", closeAddPatientModal);
    modalCancelBtn.addEventListener("click", closeAddPatientModal);
    addPatientModal.addEventListener("click", e => {
        if (e.target === addPatientModal) closeAddPatientModal();
    });
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

        renderFitbit(activePatient.fitbit);

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
                    <p>Proceeding is allowed, but the clinician must verify this before relying on the outputs.<br>
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
                    <p>Clinical decisions may be incomplete. Please review before relying on the outputs.<br>
                    <em style="font-size:0.75rem;opacity:0.75;">${f.description}</em></p>
                </div>
            </div>`;
    });

    // Non-blocking safety policy: criticalities and warnings are displayed for
    // the clinician's awareness, but the pipeline is never hard-blocked.
    runPipelineBtn.disabled = false;
    if (critical.length > 0) {
        runPipelineBtn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Run ClinAgent Orchestrator (Proceed with Caution)`;
    } else {
        runPipelineBtn.innerHTML = `<i class="fa-solid fa-bolt"></i> Run ClinAgent Orchestrator`;
    }
    // Acknowledgement is no longer a gate to running; hide the separate button.
    acknowledgeBtn.classList.add("hidden");
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
// Personal-info fields collected by the modal (no medical data), with sample
// values pre-populated on open so the clinician can edit rather than start blank.
const NEW_PATIENT_DEFAULTS = {
    "np-name":   "Jane Smith",
    "np-dob":    "1985-06-15",
    "np-age":    "40",
    "np-gender": "Female",
    "np-phone":  "(555) 123-4567",
    "np-email":  "jane.smith@example.com",
};

// In-memory store of patients added via the modal but not yet persisted to the
// backend. Keyed by the patient's local id so re-selecting them in the dropdown
// renders from memory instead of hitting the (nonexistent) API record.
const localPatients = {};

function openAddPatientModal() {
    addPatientModal.classList.remove("hidden");
    npErrorMsg.classList.add("hidden");
    // Pre-populate with sample personal info; clinician edits before saving.
    Object.entries(NEW_PATIENT_DEFAULTS).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });
}

function closeAddPatientModal() {
    addPatientModal.classList.add("hidden");
}

// Builds a patient object from the modal's personal-info fields and renders it
// on screen. This is intentionally a client-side placeholder: nothing is
// persisted yet — see the TODO below for where the real save would happen.
function saveNewPatient() {
    npErrorMsg.classList.add("hidden");

    const name   = document.getElementById("np-name").value.trim();
    const dob    = document.getElementById("np-dob").value;
    const age    = parseInt(document.getElementById("np-age").value, 10);
    const gender = document.getElementById("np-gender").value;
    const phone  = document.getElementById("np-phone").value.trim();
    const email  = document.getElementById("np-email").value.trim();

    if (!name || !dob || !age || !gender) {
        npErrorMsg.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Name, Date of Birth, Age, and Gender are required.`;
        npErrorMsg.classList.remove("hidden");
        return;
    }

    // Personal info only — medical data is captured later in the pipeline.
    const patient = {
        id: `local-${Date.now()}`,
        name,
        age,
        gender,
        date_of_birth: dob,
        phone,
        email,
    };

    // TODO: persist `patient` to the backend (POST ${API_BASE}/api/patients)
    //       once the save endpoint is ready. For now we only render it.
    renderNewPatient(patient);
    closeAddPatientModal();
}

// Adds a (not-yet-persisted) patient to the in-memory store and dropdown, then
// selects and displays it as the active patient.
function renderNewPatient(patient) {
    localPatients[patient.id] = patient;

    const opt = document.createElement("option");
    opt.value = patient.id;
    opt.textContent = `${patient.name} (${patient.gender}, Age ${patient.age})`;
    patientSelect.appendChild(opt);
    patientSelect.value = patient.id;

    displayPatient(patient);
}

// Fills the EHR card with a patient's personal info. Medical sections are
// cleared since a locally-added patient has no medical data yet.
function displayPatient(patient) {
    activePatient = patient;
    document.getElementById("ehr-name").textContent   = patient.name;
    document.getElementById("ehr-age").textContent    = patient.age;
    document.getElementById("ehr-gender").textContent = patient.gender;
    document.getElementById("ehr-dob").textContent    = patient.date_of_birth;

    ["ehr-history", "ehr-meds", "ehr-vitals", "ehr-labs"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = "";
    });
    renderFitbit(patient.fitbit);

    patientEhrCard.classList.remove("hidden");
}

// ─────────────────────────────────────────────────────────────────
// Fitbit / Wearable Trends
// ─────────────────────────────────────────────────────────────────
// The active patient's wearable payload and the doctor-selected window (in
// days). Kept in module state so the range buttons can re-render on click
// without re-fetching the patient.
let currentFitbit = null;
let fitbitRangeDays = 90;

const FITBIT_RANGE_LABELS = { 7: "last week", 30: "last month", 90: "last 3 months" };

// Stores the patient's wearable data and draws it for the current window.
function renderFitbit(fitbit) {
    currentFitbit = (fitbit && Array.isArray(fitbit.metrics) && fitbit.metrics.length) ? fitbit : null;
    drawFitbit();
}

// Renders the metric cards for the currently-selected range. Trends moving in a
// clinically concerning direction are flagged red so a clinician can spot a
// gradual decline at a glance.
function drawFitbit() {
    const meta = document.getElementById("ehr-fitbit-meta");
    const grid = document.getElementById("ehr-fitbit");
    const rangeBar = document.getElementById("fitbit-range");
    if (!meta || !grid) return;

    if (!currentFitbit) {
        meta.innerHTML = "";
        grid.innerHTML = `<p class="fitbit-empty">No wearable data on file for this patient.</p>`;
        if (rangeBar) rangeBar.style.visibility = "hidden";
        return;
    }
    if (rangeBar) rangeBar.style.visibility = "visible";

    const dates = currentFitbit.dates || [];
    const days = Math.min(fitbitRangeDays, dates.length || fitbitRangeDays);
    const windowDates = dates.slice(-days);
    const rangeStart = windowDates[0];
    const rangeEnd = windowDates[windowDates.length - 1] || currentFitbit.last_synced;

    meta.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${currentFitbit.device || "Wearable"} · ` +
        `${FITBIT_RANGE_LABELS[fitbitRangeDays] || days + " days"}` +
        (rangeStart ? ` (${rangeStart} → ${rangeEnd})` : "") +
        ` · synced ${currentFitbit.last_synced || "—"}`;

    grid.innerHTML = currentFitbit.metrics.map(m => buildFitbitCard(m, days)).join("");
}

function buildFitbitCard(m, days) {
    const full = m.series || [];
    if (full.length === 0) return "";
    const series = full.slice(-days);

    const first = series[0];
    const last  = series[series.length - 1];
    const delta = last - first;
    const worsening = (m.direction === "up_bad" && delta > 0) ||
                      (m.direction === "down_bad" && delta < 0);
    const color = worsening ? "#ef4444" : "#10b981";
    const arrow = delta > 0 ? "▲" : (delta < 0 ? "▼" : "▸");
    const deltaTxt = `${delta > 0 ? "+" : ""}${Number(delta.toFixed(1))}`;
    const window = FITBIT_RANGE_LABELS[fitbitRangeDays] || `${days} days`;

    return `
        <div class="fitbit-card ${worsening ? 'worsening' : ''}">
            <div class="fitbit-card-head">
                <span class="fitbit-label">${m.label}</span>
                ${worsening ? '<i class="fa-solid fa-triangle-exclamation fitbit-flag" title="Concerning trend"></i>' : ''}
            </div>
            <div class="fitbit-value">${last}<span class="fitbit-unit">${m.unit || ""}</span></div>
            ${buildSparkline(series, color)}
            <div class="fitbit-delta" style="color:${color}">${arrow} ${deltaTxt}${m.unit ? " " + m.unit : ""} over ${window}</div>
        </div>`;
}

// Builds an inline SVG sparkline scaled to the series' own min/max range.
function buildSparkline(series, color) {
    const w = 150, h = 38, pad = 4;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const range = (max - min) || 1;
    const step = (w - pad * 2) / (series.length - 1);

    const coords = series.map((v, i) => {
        const x = pad + i * step;
        const y = h - pad - ((v - min) / range) * (h - pad * 2);
        return [x, y];
    });
    const points = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const [lastX, lastY] = coords[coords.length - 1];

    return `
        <svg class="fitbit-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
            <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            <circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.8" fill="${color}"/>
        </svg>`;
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
    uploadLabel.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i><span>Drag and drop or click to upload a clinical image or document (PNG/JPG/PDF)</span>`;
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
