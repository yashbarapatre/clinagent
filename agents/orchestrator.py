import asyncio
import uuid
import datetime
from .rag_agent import RagAgent
from .doc_agent import DocumentationAgent
from .verification_agent import VerificationAgent
from .audit_agent import AuditAgent

# Global in-memory state dictionary for tracking active sessions
sessions_state = {}

class ClinAgentOrchestrator:
    def __init__(self, api_key: str = None):
        self.api_key = api_key
        self.rag_agent = RagAgent(api_key)
        self.doc_agent = DocumentationAgent(api_key)
        self.verify_agent = VerificationAgent(api_key)
        self.audit_agent = AuditAgent()

    async def run_workflow(self, session_id: str, patient_data: dict, dictation: str, image_notes: str):
        """Runs the entire multi-agent clinical documentation pipeline."""
        sessions_state[session_id] = {
            "status": "Starting",
            "progress": 0,
            "steps": [],
            "patient_name": patient_data.get("name"),
            "patient_id": patient_data.get("id"),
            "outputs": None,
            "verification": None
        }

        def update_status(status: str, progress: int, step_desc: str):
            sessions_state[session_id]["status"] = status
            sessions_state[session_id]["progress"] = progress
            sessions_state[session_id]["steps"].append({
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                "description": step_desc
            })
            self.audit_agent.log_event(session_id, f"step_{status.lower().replace(' ', '_')}", {
                "progress": progress,
                "description": step_desc
            })

        try:
            # 1. Intake
            update_status("Intake Processing", 10, "Parsed patient chart and clinician voice notes.")
            self.audit_agent.log_event(session_id, "intake_completed", {
                "patient_id": patient_data.get("id"),
                "patient_name": patient_data.get("name"),
                "history": patient_data.get("history"),
                "vitals": patient_data.get("vitals"),
                "labs": patient_data.get("labs"),
                "dictation": dictation,
                "image_notes": image_notes
            })

            # 2. Parallel RAG Retrieval & Reasoning
            update_status("Retrieving Guidelines", 30, "Querying CDC, NIH, and WHO clinical databases in parallel...")
            
            # Formulate query based on patient diagnosis and history
            search_query = patient_data.get("history", ["General"])[0]
            # Parallel tasks:
            # Retrieve guidelines using RAG Agent
            # Simultaneously, we simulate reasoning preparations.
            guidelines_task = self.rag_agent.get_guidelines_for_patient(patient_data.get("history", []))
            
            # Await the parallel execution
            guidelines_text = await guidelines_task
            
            update_status("Analyzing Guidelines", 50, "Synthesizing retrieved clinical evidence against patient status.")
            self.audit_agent.log_event(session_id, "rag_completed", {
                "retrieved_guidelines": guidelines_text
            })

            # 3. Documentation Generation
            update_status("Generating Documentation", 70, "Concurrently generating SOAP note, Prior Auth, and Discharge summary...")
            ehr_str = f"Name: {patient_data['name']}, Age: {patient_data['age']}, Gender: {patient_data['gender']}\nHistory: {', '.join(patient_data['history'])}\nVitals: {patient_data['vitals']}\nLabs: {patient_data['labs']}"
            
            doc_data = await self.doc_agent.generate_documentation(
                ehr_data=ehr_str,
                dictation=dictation,
                image_notes=image_notes,
                guidelines=guidelines_text
            )
            
            self.audit_agent.log_event(session_id, "docs_generated", doc_data)

            # 4. Verification Check
            update_status("Verifying Accuracy", 85, "Verification Agent auditing outputs for drug safety and consistency...")
            
            verification_report = await self.verify_agent.verify_documentation(
                ehr_data=ehr_str,
                guidelines=guidelines_text,
                doc_output=doc_data
            )
            
            self.audit_agent.log_event(session_id, "verification_completed", verification_report)

            # 5. Pipeline Finished, waiting for clinician review
            sessions_state[session_id]["outputs"] = doc_data
            sessions_state[session_id]["verification"] = verification_report
            update_status("Pending Review", 100, "Multi-agent processing completed. Documentation ready for clinician review.")

        except Exception as e:
            error_msg = f"Workflow failed: {str(e)}"
            sessions_state[session_id]["status"] = "Failed"
            sessions_state[session_id]["steps"].append({
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                "description": error_msg
            })
            self.audit_agent.log_event(session_id, "workflow_failed", {"error": error_msg})
            raise e
