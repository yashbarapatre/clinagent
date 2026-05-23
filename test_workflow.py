import os
import asyncio
import json
from dotenv import load_dotenv

# Load environmental variables
load_dotenv()

from agents.orchestrator import ClinAgentOrchestrator, sessions_state

async def main():
    print("=== CLINAGENT INTEGRATION WORKFLOW TEST ===")
    
    # 1. Verify GEMINI_API_KEY
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("[WARNING] GEMINI_API_KEY environment variable not set. Live agent execution will fail.")
        print("Please configure GEMINI_API_KEY in a '.env' file or your shell environment.")
        print("Continuing with dry-run verification of structure and mock EHR parsing...\n")
    else:
        print("[INFO] GEMINI_API_KEY found. Proceeding with live pipeline run.\n")

    # 2. Load Patient 101 EHR Data
    project_dir = os.path.dirname(os.path.abspath(__file__))
    patient_path = os.path.join(project_dir, "patients", "patient_101.json")
    if not os.path.exists(patient_path):
        print(f"[ERROR] Mock patient file not found at {patient_path}")
        return
        
    with open(patient_path, "r", encoding="utf-8") as f:
        patient_data = json.load(f)
        
    print(f"[1] Loaded Patient: {patient_data['name']} (Age {patient_data['age']})")
    print(f"    History: {', '.join(patient_data['history'])}")
    print(f"    BNP Lab: {patient_data['labs']['BNP']}")
    
    # 3. Bedside Dictation
    dictation = (
        "Arthur Pendelton is a 72-year-old male presenting with severe shortness of breath at rest, "
        "worsening orthopnea, and significant bilateral ankle swelling over the past 3 days. "
        "Vital signs show respiratory rate of 22 and O2 saturation at 91% on room air. "
        "Labs show BNP is significantly elevated at 850. Standard home lisinopril dose is 10 mg daily. "
        "The clinical picture is highly suggestive of acute decompensated heart failure. "
        "We want to start IV loop diuretics Furosemide 80 mg IV immediately due to fluid overload, "
        "and evaluate transition to oral therapy. Daily BMP check requested. "
        "Target Metoprolol Succinate dosage is 50 mg PO daily."
    )
    image_notes = "ECG reveals normal sinus rhythm. Chest X-Ray indicates mild pulmonary venous congestion."
    
    # 4. Trigger Orchestrator
    session_id = "test-session-12345"
    orchestrator = ClinAgentOrchestrator(api_key=api_key)
    
    if not api_key:
        print("\n[SUCCESS] Dry run setup checks completed. Project files, directories, and agents imported successfully.")
        return
        
    print(f"\n[2] Triggering Multi-Agent workflow for session: {session_id}")
    try:
        # Run workflow in background-like execution
        await orchestrator.run_workflow(
            session_id=session_id,
            patient_data=patient_data,
            dictation=dictation,
            image_notes=image_notes
        )
        
        # Verify Session State Outputs
        status = sessions_state.get(session_id)
        if not status:
            print("[ERROR] Workflow did not register in sessions state.")
            return
            
        print(f"\n[3] Pipeline completed with status: {status['status']}")
        print("=== GENERATED SOAP NOTE ===")
        print(json.dumps(status['outputs']['soap_note'], indent=2))
        
        print("\n=== GENERATED PRIOR AUTH ===")
        print(json.dumps(status['outputs']['prior_auth'], indent=2))
        
        print("\n=== GENERATED DISCHARGE SUMMARY ===")
        print(json.dumps(status['outputs']['discharge_summary'], indent=2))
        
        print("\n=== VERIFICATION AUDIT REPORT ===")
        print(json.dumps(status['verification'], indent=2))
        
        # Verify audit logs created
        audit_path = os.path.join(project_dir, "audit_logs", f"audit_{session_id}.json")
        if os.path.exists(audit_path):
            print(f"\n[SUCCESS] Audit logs successfully written to: {audit_path}")
        else:
            print("\n[ERROR] Audit log file was not generated.")
            
    except Exception as e:
        print(f"\n[FAILURE] Workflow execution failed: {str(e)}")

if __name__ == "__main__":
    asyncio.run(main())
