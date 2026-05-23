// ClinAgent Frontend Application Logic

// API Config
const API_BASE = window.location.origin;

// State management
let activeSessionId = null;
let pollInterval = null;
let activePatient = null;
let currentDocs = null; // Store fetched docs for editing

// DOM Elements
const patientSelect = document.getElementById("patient-select");
const patientEhrCard = document.getElementById("patient-ehr-card");
const runPipelineBtn = document.getElementById("run-pipeline-btn");
const dictationInput = document.getElementById("dictation-input");
const imageNotesInput = document.getElementById("image-notes");
const recordBtn = document.getElementById("record-btn");
const waveform = document.getElementById("audio-waveform");
const imageUpload = document.getElementById("image-upload");
const uploadLabel = document.getElementById("upload-label");

// Screen States
const stateIdle = document.getElementById("state-idle");
const stateRunning = document.getElementById("state-running");
const stateReview = document.getElementById("state-review");
const pipelineProgress = document.getElementById("pipeline-progress");
const consoleOutput = document.getElementById("terminal-console-output");

// Node elements
const nodeIntake = document.getElementById("node-intake");
const nodeRag = document.getElementById("node-rag");
const nodeReasoning = document.getElementById("node-reasoning");
const nodeDoc = document.getElementById("node-documentation");
const nodeVerify = document.getElementById("node-verification");

// Document tabs and inputs
const tabBtns = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

// SOAP Inputs
const soapSubj = document.getElementById("soap-subjective");
const soapObj = document.getElementById("soap-objective");
const soapAssess = document.getElementById("soap-assessment");
const soapPlan = document.getElementById("soap-plan");

// Prior Auth Inputs
const paMed = document.getElementById("pa-medication");
const paIcd = document.getElementById("pa-icd10");
const paJustify = document.getElementById("pa-justification");

// Discharge Inputs
const dcAdmit = document.getElementById("dc-admit");
const dcDischarge = document.getElementById("dc-discharge");
const dcCourse = document.getElementById("dc-course");
const dcMeds = document.getElementById("dc-meds");
const dcFollowup = document.getElementById("dc-followup");

// Safety Elements
const verificationCard = document.getElementById("verification-card");
const safetyShieldIcon = document.getElementById("safety-shield-icon");
const safetyTitle = document.getElementById("safety-title");
const safetyDosingList = document.getElementById("safety-dosing-checks");
const safetyAdherence = document.getElementById("safety-guidelines-adherence");
const safetyFlagsWrapper = document.getElementById("safety-warnings-wrapper");
const safetyFlagsList = document.getElementById("safety-flags");
const safetyRecsWrapper = document.getElementById("safety-recommendations-wrapper");
const safetyRecs = document.getElementById("safety-recommendations");

// Actions
const clinicianNotes = document.getElementById("clinician-notes");
const approveBtn = document.getElementById("approve-btn");
const rejectBtn = document.getElementById("reject-btn");

// Audit Trails
const sessionsList = document.getElementById("sessions-list");
const trailFallback = document.getElementById("trail-details-fallback");
const trailWrapper = document.getElementById("trail-details-wrapper");
const trailSessionId = document.getElementById("trail-session-id");
const trailStatus = document.getElementById("trail-status");
const trailTimeline = document.getElementById("trail-timeline");

// Mock Clinician Bedside Dictations based on selected Patient
const MOCK_DICTATIONS = {
    "101": "Arthur Pendelton is a 72-year-old male presenting with severe shortness of breath at rest, worsening orthopnea, and significant bilateral ankle swelling over the past 3 days. Vital signs show respiratory rate of 22 and O2 saturation at 91% on room air. Labs show BNP is significantly elevated at 850 pg/mL. Standard home lisinopril dose is 10 mg daily. The clinical picture is highly suggestive of acute decompensated heart failure. We want to start IV loop diuretics Furosemide 80 mg IV immediately due to fluid overload, and evaluate transition to oral therapy. Daily BMP check requested. Target Metoprolol Succinate dosage is 50 mg PO daily.",
    "102": "Eleanor Vance is a 68-year-old female with a history of type 2 diabetes who presents with acute onset productive cough, yellow sputum, fever of 101.8 F, tachypnea at 28 breaths/min, and mild confusion. eGFR is 75 mL/min. Current home medications include metformin 1000 mg twice daily. We suspect community-acquired pneumonia. Chest X-ray reveals left lower lobe consolidation. CURB-65 score is calculated at 3. Start Ceftriaxone 1 g IV daily plus Azithromycin 500 mg daily. Continue Metformin 1000 mg twice daily, checking blood glucose regularly."
};

// 1. INITIALIZE & FETCH PATIENTS
document.addEventListener("DOMContentLoaded", () => {
    fetchPatients();
    loadAuditSessions();
    setupEventListeners();
});

// Event Listeners Setup
function setupEventListeners() {
    // Patient Select Change
    patientSelect.addEventListener("change", (e) => {
        const val = e.target.value;
        if (val) {
            fetchPatientDetails(val);
        }
    });

    // Audio recording simulation
    recordBtn.addEventListener("click", () => {
        waveform.classList.toggle("hidden");
        if (!waveform.classList.contains("hidden")) {
            recordBtn.innerHTML = `<i class="fa-solid fa-stop"></i> Stop Audio Recording`;
            recordBtn.style.background = "var(--danger-gradient)";
            // Simulate voice typing
            const patientId = patientSelect.value;
            const text = MOCK_DICTATIONS[patientId] || "Patient presents for routine clinical checkup...";
            let i = 0;
            dictationInput.value = "";
            const interval = setInterval(() => {
                if (i < text.length && !waveform.classList.contains("hidden")) {
                    dictationInput.value += text[i];
                    i++;
                } else {
                    clearInterval(interval);
                    stopRecording();
                }
            }, 10);
        } else {
            stopRecording();
        }
    });

    // Image Upload Change
    imageUpload.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            uploadLabel.innerHTML = `<i class="fa-solid fa-file-image" style="color: #a855f7;"></i> <strong>${file.name}</strong> (${(file.size / 1024).toFixed(1)} KB)`;
            imageNotesInput.value = `Image analysis requested for: ${file.name}.\nSuggested findings: Consolidation in left lung base (for Eleanor) / Cardiomegaly with mild pulmonary venous congestion (for Arthur).`;
        }
    });

    // Run Pipeline
    runPipelineBtn.addEventListener("click", startWorkflow);

    // Tab Buttons
    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => b.classList.remove("active"));
            tabContents.forEach(c => c.classList.remove("active"));
            
            btn.classList.add("active");
            const tabId = `tab-${btn.dataset.tab}`;
            document.getElementById(tabId).classList.add("active");
        });
    });

    // Approve
    approveBtn.addEventListener("click", submitApproval);

    // Reject
    rejectBtn.addEventListener("click", () => {
        if (confirm("Are you sure you want to discard this session? all generated documents will be deleted.")) {
            resetScreens();
        }
    });
}

function stopRecording() {
    waveform.classList.add("hidden");
    recordBtn.innerHTML = `<i class="fa-solid fa-microphone-lines"></i> Simulate Audio Intake`;
    recordBtn.style.background = "";
}

// Fetch Patients
async function fetchPatients() {
    try {
        const res = await fetch(`${API_BASE}/api/patients`);
        const patients = await res.json();
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

// Fetch Patient Details
async function fetchPatientDetails(id) {
    try {
        const res = await fetch(`${API_BASE}/api/patients/${id}`);
        activePatient = await res.json();
        
        // Render Bio
        document.getElementById("ehr-name").textContent = activePatient.name;
        document.getElementById("ehr-age").textContent = activePatient.age;
        document.getElementById("ehr-gender").textContent = activePatient.gender;
        document.getElementById("ehr-dob").textContent = activePatient.date_of_birth;

        // Render History
        const histList = document.getElementById("ehr-history");
        histList.innerHTML = "";
        activePatient.history.forEach(h => {
            const li = document.createElement("li");
            li.textContent = h;
            histList.appendChild(li);
        });

        // Render Medications
        const medsList = document.getElementById("ehr-meds");
        medsList.innerHTML = "";
        activePatient.current_medications.forEach(m => {
            const li = document.createElement("li");
            li.textContent = `${m.name} ${m.dosage} - ${m.frequency}`;
            medsList.appendChild(li);
        });

        // Render Vitals
        const vitalsGrid = document.getElementById("ehr-vitals");
        vitalsGrid.innerHTML = "";
        for (const [k, v] of Object.entries(activePatient.vitals)) {
            const isHigh = v.toLowerCase().includes("high");
            const cleanVal = v.replace("(High)", "").trim();
            vitalsGrid.innerHTML += `
                <div class="vital-tag ${isHigh ? 'high' : ''}">
                    <label>${k.replace("_", " ").toUpperCase()}</label>
                    <span>${cleanVal}</span>
                </div>
            `;
        }

        // Render Labs
        const labsGrid = document.getElementById("ehr-labs");
        labsGrid.innerHTML = "";
        for (const [k, v] of Object.entries(activePatient.labs)) {
            const isHigh = v.toLowerCase().includes("high") || v.toLowerCase().includes("elevated");
            const cleanVal = v.replace("(High)", "").replace("(Elevated)", "").replace("(Mildly Elevated)", "").trim();
            labsGrid.innerHTML += `
                <div class="lab-tag ${isHigh ? 'high' : ''}">
                    <label>${k.toUpperCase()}</label>
                    <span>${cleanVal}</span>
                </div>
            `;
        }

        patientEhrCard.classList.remove("hidden");
        runPipelineBtn.disabled = false;
        
        // Auto-simulate default dictation matching patient type
        dictationInput.value = MOCK_DICTATIONS[id] || "";
    } catch (err) {
        console.error("Error loading patient details:", err);
    }
}

// 2. RUN WORKFLOW PIPELINE
async function startWorkflow() {
    if (!activePatient) return;
    
    // Toggle screens
    stateIdle.classList.add("hidden");
    stateReview.classList.add("hidden");
    stateRunning.classList.remove("hidden");
    
    // Reset visualizer status
    pipelineProgress.style.width = "0%";
    consoleOutput.innerHTML = "";
    resetNodes();
    
    // Prep payload
    const formData = new FormData();
    formData.append("patient_id", activePatient.id);
    formData.append("dictation", dictationInput.value);
    formData.append("image_notes", imageNotesInput.value);
    
    if (imageUpload.files[0]) {
        formData.append("image", imageUpload.files[0]);
    }
    
    writeConsole("System", "Initiating parallel multi-agent clinical workflow...");
    
    try {
        const res = await fetch(`${API_BASE}/api/intake`, {
            method: "POST",
            body: formData
        });
        
        const data = await res.json();
        activeSessionId = data.session_id;
        
        // Start Polling Status
        pollInterval = setInterval(pollWorkflowStatus, 1500);
    } catch (err) {
        writeConsole("Error", `Failed to start pipeline: ${err.message}`);
        stateRunning.classList.add("hidden");
        stateIdle.classList.remove("hidden");
    }
}

// Poll Status
async function pollWorkflowStatus() {
    if (!activeSessionId) return;
    
    try {
        const res = await fetch(`${API_BASE}/api/workflow-status/${activeSessionId}`);
        if (!res.ok) {
            clearInterval(pollInterval);
            throw new Error("Session status fetch failed");
        }
        
        const status = await res.json();
        
        // Update Progress bar
        pipelineProgress.style.width = `${status.progress}%`;
        
        // Render step log entries
        status.steps.forEach(step => {
            const hasStep = document.getElementById(`step-${step.timestamp}`);
            if (!hasStep) {
                const parts = step.description.split(":");
                const agent = parts.length > 1 ? parts[0] : "Agent";
                const msg = parts.length > 1 ? parts.slice(1).join(":") : step.description;
                writeConsole(agent, msg, step.timestamp);
            }
        });

        // Update active/completed nodes based on progress threshold
        updatePipelineNodes(status.progress, status.status);

        if (status.status === "Pending Review") {
            clearInterval(pollInterval);
            writeConsole("System", "Documentation generated successfully. Review Authority requested.");
            setTimeout(() => {
                renderReviewWorkspace(status.outputs, status.verification);
            }, 800);
        } else if (status.status === "Failed") {
            clearInterval(pollInterval);
            writeConsole("Error", "Pipeline execution failed. Check clinical rules or inputs.");
        }
    } catch (err) {
        clearInterval(pollInterval);
        writeConsole("Error", `Polling status error: ${err.message}`);
    }
}

// Render Review Workspace
function renderReviewWorkspace(outputs, verification) {
    stateRunning.classList.add("hidden");
    stateReview.classList.remove("hidden");
    
    currentDocs = outputs;
    
    // Set SOAP Inputs
    soapSubj.value = outputs.soap_note.subjective;
    soapObj.value = outputs.soap_note.objective;
    soapAssess.value = outputs.soap_note.assessment;
    soapPlan.value = outputs.soap_note.plan;
    
    // Set PA Inputs
    paMed.value = outputs.prior_auth.medication_name;
    paIcd.value = outputs.prior_auth.icd_10_code;
    paJustify.value = outputs.prior_auth.medical_necessity_justification;
    
    // Set Discharge Inputs
    dcAdmit.value = outputs.discharge_summary.admitting_diagnosis;
    dcDischarge.value = outputs.discharge_summary.discharge_diagnosis;
    dcCourse.value = outputs.discharge_summary.summary_of_hospital_course;
    dcMeds.value = outputs.discharge_summary.discharge_medications.join(", ");
    dcFollowup.value = outputs.discharge_summary.follow_up_instructions;
    
    // Clear review overrides
    clinicianNotes.value = "";

    // Render safety audits
    const isSafe = verification.is_safe;
    verificationCard.className = `verification-alert-card ${isSafe ? '' : 'warning-state'}`;
    
    safetyShieldIcon.className = `fa-solid ${isSafe ? 'fa-shield-halved' : 'fa-triangle-exclamation'}`;
    safetyTitle.textContent = isSafe ? "Safety Audit Complete: No issues found" : `Clinical Safety Risk: ${verification.flags.length} Flag(s) Raised`;
    
    // Render Dosing list
    safetyDosingList.innerHTML = "";
    verification.dosing_checks.forEach(d => {
        safetyDosingList.innerHTML += `<li>${d}</li>`;
    });
    
    safetyAdherence.textContent = verification.guideline_adherence;
    
    // Show warnings if unsafe
    if (!isSafe) {
        safetyFlagsWrapper.classList.remove("hidden");
        safetyFlagsList.innerHTML = "";
        verification.flags.forEach(f => {
            safetyFlagsList.innerHTML += `<li>${f}</li>`;
        });
        
        safetyRecsWrapper.classList.remove("hidden");
        safetyRecs.textContent = verification.recommendations;
    } else {
        safetyFlagsWrapper.classList.add("hidden");
        safetyRecsWrapper.classList.add("hidden");
    }
}

// 3. SUBMIT APPROVAL
async function submitApproval() {
    if (!activeSessionId) return;
    
    // Build payload of edited values
    const approvedPayload = {
        session_id: activeSessionId,
        soap_note: {
            subjective: soapSubj.value,
            objective: soapObj.value,
            assessment: soapAssess.value,
            plan: soapPlan.value
        },
        prior_auth: {
            medication_name: paMed.value,
            icd_10_code: paIcd.value,
            medical_necessity_justification: paJustify.value
        },
        discharge_summary: {
            patient_id: activePatient.id,
            admitting_diagnosis: dcAdmit.value,
            discharge_diagnosis: dcDischarge.value,
            summary_of_hospital_course: dcCourse.value,
            discharge_medications: dcMeds.value.split(",").map(m => m.trim()),
            follow_up_instructions: dcFollowup.value
        },
        notes: clinicianNotes.value
    };

    try {
        approveBtn.disabled = true;
        approveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Pushing...`;
        
        const res = await fetch(`${API_BASE}/api/approve`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(approvedPayload)
        });
        
        const data = await res.json();
        if (data.status === "Success") {
            alert(`Clinician review recorded successfully!\nFHIR Output saved to: ${data.fhir_file}`);
            resetScreens();
            loadAuditSessions();
        } else {
            alert("Failed to submit approval.");
        }
    } catch (err) {
        alert(`Error submitting review: ${err.message}`);
    } finally {
        approveBtn.disabled = false;
        approveBtn.innerHTML = `<i class="fa-solid fa-check-double"></i> Approve & Push to EHR (FHIR)`;
    }
}

// Helper methods for visualizer console
function writeConsole(source, text, timestamp = null) {
    const time = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = "console-line";
    if (timestamp) line.id = `step-${timestamp}`;
    line.innerHTML = `<span class="timestamp">[${time}]</span> <strong style="color: #6366f1;">${source}:</strong> ${text}`;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function updatePipelineNodes(progress, status) {
    resetNodes();
    
    // Progression nodes
    if (progress >= 10) {
        nodeIntake.className = "agent-node completed";
        nodeRag.className = "agent-node active";
    }
    if (progress >= 30) {
        nodeRag.className = "agent-node completed";
        nodeReasoning.className = "agent-node active";
    }
    if (progress >= 50) {
        nodeReasoning.className = "agent-node completed";
        nodeDoc.className = "agent-node active";
    }
    if (progress >= 70) {
        nodeDoc.className = "agent-node completed";
        nodeVerify.className = "agent-node active";
    }
    if (progress >= 85) {
        nodeVerify.className = "agent-node completed";
    }
}

function resetNodes() {
    nodeIntake.className = "agent-node";
    nodeRag.className = "agent-node";
    nodeReasoning.className = "agent-node";
    nodeDoc.className = "agent-node";
    nodeVerify.className = "agent-node";
    
    nodeIntake.querySelector("small").textContent = "Pending";
    nodeRag.querySelector("small").textContent = "Pending";
    nodeReasoning.querySelector("small").textContent = "Pending";
    nodeDoc.querySelector("small").textContent = "Pending";
    nodeVerify.querySelector("small").textContent = "Pending";
}

function resetScreens() {
    activeSessionId = null;
    currentDocs = null;
    stateReview.classList.add("hidden");
    stateRunning.classList.add("hidden");
    stateIdle.classList.remove("hidden");
    
    // Clear selector
    patientSelect.value = "";
    patientEhrCard.classList.add("hidden");
    runPipelineBtn.disabled = true;
    dictationInput.value = "";
    imageNotesInput.value = "";
    imageUpload.value = "";
    uploadLabel.innerHTML = `
        <i class="fa-solid fa-cloud-arrow-up"></i>
        <span>Drag and drop or click to upload clinical images</span>
    `;
    stopRecording();
}

// 4. AUDIT TRAILS MANAGEMENT
async function loadAuditSessions() {
    try {
        const res = await fetch(`${API_BASE}/api/audit-logs`);
        const sessions = await res.json();
        
        sessionsList.innerHTML = "";
        
        if (sessions.length === 0) {
            sessionsList.innerHTML = `<li style="padding: 1rem; color: var(--text-muted); text-align: center;">No clinical runs logged yet.</li>`;
            return;
        }
        
        sessions.forEach(s => {
            const time = new Date(s.created_at).toLocaleString();
            const badgeClass = s.status.toLowerCase() === "approved" ? "completed" : s.status.toLowerCase() === "rejected" ? "rejected" : "pending";
            
            const li = document.createElement("li");
            li.className = "audit-list-item";
            li.innerHTML = `
                <div class="session-info">
                    <h4>${s.patient_name}</h4>
                    <span>Intake: ${time}</span>
                </div>
                <span class="badge ${badgeClass}">${s.status}</span>
            `;
            
            li.addEventListener("click", () => {
                // Remove selected class
                document.querySelectorAll(".audit-list-item").forEach(item => item.classList.remove("selected"));
                li.classList.add("selected");
                loadAuditTrailDetails(s.session_id);
            });
            
            sessionsList.appendChild(li);
        });
    } catch (err) {
        console.error("Error loading audit sessions:", err);
    }
}

async function loadAuditTrailDetails(sessionId) {
    try {
        const res = await fetch(`${API_BASE}/api/audit-logs/${sessionId}`);
        const trail = await res.json();
        
        trailFallback.classList.add("hidden");
        trailWrapper.classList.remove("hidden");
        
        trailSessionId.textContent = trail.session_id;
        
        const badgeClass = trail.status.toLowerCase() === "approved" ? "completed" : trail.status.toLowerCase() === "rejected" ? "rejected" : "pending";
        trailStatus.className = `badge ${badgeClass}`;
        trailStatus.textContent = trail.status;
        
        trailTimeline.innerHTML = "";
        
        trail.events.forEach(evt => {
            const date = new Date(evt.timestamp).toLocaleString();
            let detailsHtml = "";
            let eventClass = "";
            
            if (evt.event_type === "intake_completed") {
                eventClass = "success";
                detailsHtml = `
                    <strong>Patient:</strong> ${evt.data.patient_name} (ID: ${evt.data.patient_id})<br>
                    <strong>Dictation:</strong> "${evt.data.dictation}"<br>
                    <strong>Image Notes:</strong> "${evt.data.image_notes || 'None'}"
                `;
            } else if (evt.event_type === "rag_completed") {
                eventClass = "success";
                detailsHtml = `
                    <strong>Retrieved Guideline Snippet:</strong><br>
                    <pre style="white-space: pre-wrap; font-size: 0.75rem;">${evt.data.retrieved_guidelines.substring(0, 300)}...</pre>
                `;
            } else if (evt.event_type === "docs_generated") {
                eventClass = "success";
                detailsHtml = `
                    <strong>Documentation Generated Concurrently:</strong><br>
                    - SOAP Note: generated<br>
                    - Prior Authorization Request: generated<br>
                    - Discharge Summary: generated
                `;
            } else if (evt.event_type === "verification_completed") {
                eventClass = evt.data.is_safe ? "success" : "danger";
                detailsHtml = `
                    <strong>Clinician Verification:</strong> ${evt.data.is_safe ? 'SAFE' : 'RISKS DETECTED'}<br>
                    <strong>Dosing Checks:</strong> ${evt.data.dosing_checks.join("; ")}<br>
                    <strong>Adherence Evaluation:</strong> "${evt.data.guideline_adherence}"
                `;
            } else if (evt.event_type === "clinician_reviewed") {
                eventClass = evt.data.action === "approve" ? "success" : "danger";
                detailsHtml = `
                    <strong>Clinician Override Notes:</strong> "${evt.data.notes || 'None'}"<br>
                    <strong>Final EHR Update:</strong> Verified FHIR Push Completed
                `;
            } else {
                detailsHtml = `<strong>Log details:</strong> ${JSON.stringify(evt.data)}`;
            }
            
            trailTimeline.innerHTML += `
                <div class="timeline-event ${eventClass}">
                    <div class="event-header">
                        <span>${evt.event_type.replace("_", " ").toUpperCase()}</span>
                        <span class="time">${date}</span>
                    </div>
                    <div class="event-details">
                        ${detailsHtml}
                    </div>
                </div>
            `;
        });
    } catch (err) {
        console.error("Error loading audit trail:", err);
    }
}
