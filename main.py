import os
import uuid
import json
import datetime
from fastapi import FastAPI, BackgroundTasks, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv

# Load environmental configurations
load_dotenv()

from agents.orchestrator import ClinAgentOrchestrator, sessions_state
from agents.audit_agent import AuditAgent
from agents.safety_agent import SafetyAgent

app = FastAPI(title="ClinAgent - Clinical Decision Support Multi-Agent System")

# Initialize orchestrator, audit agent, and safety agent
# If GEMINI_API_KEY is not in env, we will check .env or pass None (agent SDK will look in env)
api_key = os.getenv("GEMINI_API_KEY") or None
orchestrator = ClinAgentOrchestrator(api_key=api_key)
audit_agent = AuditAgent()
safety_agent = SafetyAgent(api_key=api_key)

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
    allergy_override_reason: Optional[str] = None
    missing_data_acknowledged: Optional[bool] = False
    missing_data_fields_acknowledged: Optional[list] = None

class NewPatientRequest(BaseModel):
    name: str
    age: int
    gender: str
    date_of_birth: str
    history: list = []
    current_medications: list = []
    vitals: dict = {}
    labs: dict = {}
    allergies: list = []
    weight: str = ""
    code_status: str = ""
    pregnancy_status: str = ""
    last_menstrual_period: str = ""
    advance_directives: str = ""


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

@app.post("/api/patients")
def create_patient(req: NewPatientRequest):
    """Creates a new patient JSON file in the patients directory."""
    # Auto-generate numeric ID from existing files
    existing_ids = []
    for fname in os.listdir(patients_dir):
        if fname.startswith("patient_") and fname.endswith(".json"):
            try:
                existing_ids.append(int(fname.replace("patient_", "").replace(".json", "")))
            except ValueError:
                pass
    new_id = str(max(existing_ids) + 1) if existing_ids else "200"

    patient_data = {
        "id": new_id,
        "name": req.name,
        "age": req.age,
        "gender": req.gender,
        "date_of_birth": req.date_of_birth,
        "history": req.history,
        "current_medications": req.current_medications,
        "vitals": req.vitals,
        "labs": req.labs,
    }
    # Only include optional safety fields if non-empty
    if req.allergies:          patient_data["allergies"] = req.allergies
    if req.weight:             patient_data["weight"] = req.weight
    if req.code_status:        patient_data["code_status"] = req.code_status
    if req.pregnancy_status:   patient_data["pregnancy_status"] = req.pregnancy_status
    if req.last_menstrual_period: patient_data["last_menstrual_period"] = req.last_menstrual_period
    if req.advance_directives: patient_data["advance_directives"] = req.advance_directives

    path = os.path.join(patients_dir, f"patient_{new_id}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(patient_data, f, indent=2)

    return {"status": "created", "id": new_id, "patient": patient_data}

@app.post("/api/safety-check/{patient_id}")
def run_safety_check(patient_id: str):
    """Runs the pre-pipeline missing data check on a patient record synchronously."""
    patient_path = os.path.join(patients_dir, f"patient_{patient_id}.json")
    if not os.path.exists(patient_path):
        raise HTTPException(status_code=404, detail="Patient not found")
    with open(patient_path, "r", encoding="utf-8") as f:
        patient_data = json.load(f)
    return safety_agent.check_missing_data(patient_data)


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

    # 2. Run missing data safety check BEFORE spawning background task
    missing_data_check = safety_agent.check_missing_data(patient_data)

    # If CRITICAL fields are missing, block the pipeline immediately
    if missing_data_check["result"] == "blocked":
        audit_agent.log_event("pre-intake", "missing_data_check", {
            "patient_id": patient_id,
            "checked_at": missing_data_check["checked_at"],
            "result": "blocked",
            "critical_fields_missing": [f["label"] for f in missing_data_check["critical"]],
        })
        return JSONResponse(
            status_code=200,
            content={
                "status": "Blocked",
                "reason": "critical_missing_data",
                "missing_data": missing_data_check,
            }
        )

    # 3. Handle image upload if present
    uploaded_image_path = None
    if image:
        file_ext = os.path.splitext(image.filename)[1]
        unique_filename = f"{uuid.uuid4()}{file_ext}"
        uploaded_image_path = os.path.join(uploads_dir, unique_filename)
        with open(uploaded_image_path, "wb") as f:
            f.write(await image.read())
        # Append image path to log details
        image_notes += f"\n[Uploaded Image Source: {image.filename}]"

    # 4. Create unique session and trigger orchestrator
    session_id = str(uuid.uuid4())
    
    background_tasks.add_task(
        orchestrator.run_workflow,
        session_id=session_id,
        patient_data=patient_data,
        dictation=dictation,
        image_notes=image_notes,
        missing_data_check=missing_data_check,
    )

    return {
        "session_id": session_id,
        "status": "Initiated",
        "missing_data": missing_data_check,
    }

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
    review_data = {
        "action": "approve",
        "notes": req.notes,
        "approved_documentation": approved_doc,
    }

    # Log allergy override if clinician overrode a critical conflict
    if req.allergy_override_reason:
        review_data["allergy_override"] = True
        review_data["allergy_override_reason"] = req.allergy_override_reason
        audit_agent.log_event(session_id, "allergy_override", {
            "clinician_id": "Dr. Trailblazer",
            "override_reason": req.allergy_override_reason,
            "override_at": datetime.datetime.utcnow().isoformat() + "Z",
        })

    # Log missing data acknowledgement
    if req.missing_data_acknowledged:
        review_data["missing_data_acknowledged"] = True
        review_data["missing_data_fields_acknowledged"] = req.missing_data_fields_acknowledged or []
        audit_agent.log_event(session_id, "missing_data_acknowledged", {
            "clinician_id": "Dr. Trailblazer",
            "fields_acknowledged": req.missing_data_fields_acknowledged or [],
            "acknowledged_at": datetime.datetime.utcnow().isoformat() + "Z",
        })

    audit_agent.log_event(session_id, "clinician_reviewed", review_data)

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
