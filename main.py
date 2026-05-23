import os
import uuid
import json
import datetime
from fastapi import FastAPI, BackgroundTasks, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv

# Load environmental configurations
load_dotenv()

from agents.orchestrator import ClinAgentOrchestrator, sessions_state
from agents.audit_agent import AuditAgent

app = FastAPI(title="ClinAgent - Clinical Decision Support Multi-Agent System")

# Initialize orchestrator and audit agent
# If GEMINI_API_KEY is not in env, we will check .env or pass None (agent SDK will look in env)
api_key = os.getenv("GEMINI_API_KEY") or None
orchestrator = ClinAgentOrchestrator(api_key=api_key)
audit_agent = AuditAgent()

# Ensure required directories exist
patients_dir = os.path.join(os.path.dirname(__file__), "patients")
fhir_dir = os.path.join(os.path.dirname(__file__), "fhir_output")
uploads_dir = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(fhir_dir, exist_ok=True)
os.makedirs(uploads_dir, exist_ok=True)

class IntakeRequest(BaseModel):
    patient_id: str
    dictation: str
    image_notes: str

class ApprovalRequest(BaseModel):
    session_id: str
    soap_note: dict
    prior_auth: dict
    discharge_summary: dict
    notes: str = ""

@app.get("/api/patients")
def get_patients():
    """Lists all mock patients from the patients/ directory."""
    patients = []
    if not os.path.exists(patients_dir):
        return patients
        
    for name in os.listdir(patients_dir):
        if name.endswith(".json"):
            try:
                with open(os.path.join(patients_dir, name), "r", encoding="utf-8") as f:
                    patients.append(json.load(f))
            except Exception:
                pass
    return patients

@app.get("/api/patients/{patient_id}")
def get_patient(patient_id: str):
    """Retrieves details of a single patient."""
    path = os.path.join(patients_dir, f"patient_{patient_id}.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Patient not found")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

@app.post("/api/intake")
async def start_intake(
    background_tasks: BackgroundTasks,
    patient_id: str = Form(...),
    dictation: str = Form(...),
    image_notes: str = Form(...),
    image: UploadFile = File(None)
):
    """Starts the intake pipeline by spinning up agents in the background."""
    # 1. Fetch patient EHR data
    patient_path = os.path.join(patients_dir, f"patient_{patient_id}.json")
    if not os.path.exists(patient_path):
        raise HTTPException(status_code=404, detail="Patient not found")
        
    with open(patient_path, "r", encoding="utf-8") as f:
        patient_data = json.load(f)

    # 2. Handle image upload if present
    uploaded_image_path = None
    if image:
        file_ext = os.path.splitext(image.filename)[1]
        unique_filename = f"{uuid.uuid4()}{file_ext}"
        uploaded_image_path = os.path.join(uploads_dir, unique_filename)
        with open(uploaded_image_path, "wb") as f:
            f.write(await image.read())
        # Append image path to log details
        image_notes += f"\n[Uploaded Image Source: {image.filename}]"

    # 3. Create unique session and trigger orchestrator
    session_id = str(uuid.uuid4())
    
    background_tasks.add_task(
        orchestrator.run_workflow,
        session_id=session_id,
        patient_data=patient_data,
        dictation=dictation,
        image_notes=image_notes
    )

    return {"session_id": session_id, "status": "Initiated"}

@app.get("/api/workflow-status/{session_id}")
def get_workflow_status(session_id: str):
    """Fetches real-time status of the multi-agent pipeline."""
    if session_id not in sessions_state:
        # Check if it was already reviewed and saved in audit
        audit = audit_agent.get_audit_trail(session_id)
        if audit:
            return {
                "status": audit.get("status"),
                "progress": 100,
                "patient_name": audit.get("patient_name"),
                "patient_id": audit.get("patient_id"),
                "steps": [{"timestamp": audit.get("completed_at"), "description": "Review completed."}],
                "outputs": audit.get("events")[-1]["data"].get("approved_documentation") if audit.get("status") == "Approved" else None,
                "verification": None
            }
        raise HTTPException(status_code=404, detail="Session not found")
    return sessions_state[session_id]

@app.post("/api/approve")
def approve_documentation(req: ApprovalRequest):
    """Saves verified/edited documentation and logs approval in audit trail."""
    session_id = req.session_id
    
    # Verify session exists
    if session_id not in sessions_state and not audit_agent.get_audit_trail(session_id):
        raise HTTPException(status_code=404, detail="Session not found")

    approved_doc = {
        "soap_note": req.soap_note,
        "prior_auth": req.prior_auth,
        "discharge_summary": req.discharge_summary
    }

    # 1. Log clinician review event in Audit Trail
    audit_agent.log_event(session_id, "clinician_reviewed", {
        "action": "approve",
        "notes": req.notes,
        "approved_documentation": approved_doc
    })

    # 2. Convert to FHIR-compliant bundle output
    fhir_bundle = {
        "resourceType": "Bundle",
        "type": "transaction",
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "entry": [
            {
                "resource": {
                    "resourceType": "ClinicalImpression",
                    "status": "completed",
                    "subject": {"reference": f"Patient/{req.discharge_summary.get('patient_id', '101')}"},
                    "description": "ClinAgent SOAP note assessment",
                    "summary": req.soap_note.get("assessment", "")
                }
            },
            {
                "resource": {
                    "resourceType": "ClaimResponse",
                    "status": "active",
                    "type": {"coding": [{"system": "http://hl7.org/fhir/claim-type", "code": "prior-auth"}]},
                    "patient": {"reference": f"Patient/{req.discharge_summary.get('patient_id', '101')}"},
                    "disposition": f"Prior authorization request generated for {req.prior_auth.get('medication_name', '')}"
                }
            },
            {
                "resource": {
                    "resourceType": "DischargeSummary",
                    "status": "final",
                    "subject": {"reference": f"Patient/{req.discharge_summary.get('patient_id', '101')}"},
                    "note": [
                        {
                            "text": f"Admitting: {req.discharge_summary.get('admitting_diagnosis', '')}\nDischarge: {req.discharge_summary.get('discharge_diagnosis', '')}\nHospital Course: {req.discharge_summary.get('summary_of_hospital_course', '')}\nFollow Up: {req.discharge_summary.get('follow_up_instructions', '')}"
                        }
                    ]
                }
            }
        ]
    }

    # 3. Write FHIR Output file
    fhir_path = os.path.join(fhir_dir, f"fhir_doc_{session_id}.json")
    with open(fhir_path, "w", encoding="utf-8") as f:
        json.dump(fhir_bundle, f, indent=2)

    # 4. Clean up active state
    if session_id in sessions_state:
        del sessions_state[session_id]

    return {"status": "Success", "fhir_file": fhir_path}

@app.get("/api/audit-logs")
def get_all_audit_logs():
    """Lists all audit-logged sessions."""
    return audit_agent.get_all_sessions()

@app.get("/api/audit-logs/{session_id}")
def get_audit_log_details(session_id: str):
    """Retrieves full details of a session audit trail."""
    trail = audit_agent.get_audit_trail(session_id)
    if not trail:
        raise HTTPException(status_code=404, detail="Audit log not found")
    return trail

# Mount Static Files Dashboard
static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
