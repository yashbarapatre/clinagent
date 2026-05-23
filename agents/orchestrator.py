import asyncio
import uuid
import datetime
import json
from .rag_agent import RagAgent
from .doc_agent import DocumentationAgent
from .verification_agent import VerificationAgent
from .audit_agent import AuditAgent
from .safety_agent import SafetyAgent
from .media_agent import MediaAnalysisAgent
from .fitbit_agent import FitbitAnalysisAgent

# Global in-memory state dictionary for tracking active sessions
sessions_state = {}

class ClinAgentOrchestrator:
    def __init__(self, api_key: str = None):
        self.api_key = api_key
        self.rag_agent = RagAgent(api_key)
        self.doc_agent = DocumentationAgent(api_key)
        self.verify_agent = VerificationAgent(api_key)
        self.audit_agent = AuditAgent()
        self.safety_agent = SafetyAgent(api_key)
        self.media_agent = MediaAnalysisAgent(api_key)
        self.fitbit_agent = FitbitAnalysisAgent(api_key)

    async def run_workflow(self, session_id: str, patient_data: dict, dictation: str, image_notes: str,
                           missing_data_check: dict = None, image_path: str = None,
                           document_path: str = None):
        """Runs the entire multi-agent clinical documentation pipeline."""
        sessions_state[session_id] = {
            "status": "Starting",
            "progress": 0,
            "steps": [],
            "patient_name": patient_data.get("name"),
            "patient_id": patient_data.get("id"),
            "outputs": None,
            "verification": None,
            "safety": missing_data_check or {},
            "allergy_check": None,
            "media_findings": None,
            "wearable_analysis": None,
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
                "image_notes": image_notes,
                "has_image": bool(image_path),
                "has_document": bool(document_path),
                "has_fitbit": bool((patient_data.get("fitbit") or {}).get("metrics")),
            })

            # Log the pre-run missing data check result (already computed before background task)
            if missing_data_check:
                self.audit_agent.log_event(session_id, "missing_data_check", {
                    "checked_at": missing_data_check.get("checked_at"),
                    "result": missing_data_check.get("result"),
                    "critical_fields_missing": [f["label"] for f in missing_data_check.get("critical", [])],
                    "warning_fields_missing": [f["label"] for f in missing_data_check.get("warnings", [])],
                })

            # 2. Parallel Multi-Modal Perception
            # RAG guideline retrieval, multi-modal media analysis (audio + image +
            # document via Gemini), and wearable/Fitbit trend analysis have no
            # inter-dependencies, so they run concurrently with asyncio.gather.
            update_status("Multi-Modal Perception", 30,
                          "Running RAG retrieval, Gemini multi-modal media analysis (image/document), and wearable trend analysis in parallel...")

            guidelines_task = self.rag_agent.get_guidelines_for_patient(patient_data.get("history", []))
            media_task = self.media_agent.analyze(
                image_path=image_path,
                document_path=document_path,
                dictation_text=dictation,
                image_notes=image_notes,
            )
            fitbit_task = self.fitbit_agent.analyze(patient_data.get("fitbit"))

            guidelines_text, media_findings, wearable_analysis = await asyncio.gather(
                guidelines_task, media_task, fitbit_task
            )

            update_status("Analyzing Findings", 55, "Synthesizing guidelines, multi-modal media findings, and wearable trends against patient status.")
            self.audit_agent.log_event(session_id, "rag_completed", {"retrieved_guidelines": guidelines_text})
            self.audit_agent.log_event(session_id, "media_analysis_completed", {
                "modalities_processed": media_findings.get("modalities_processed", []),
                "image_findings": media_findings.get("image_findings", ""),
                "document_findings": media_findings.get("document_findings", ""),
            })
            self.audit_agent.log_event(session_id, "wearable_analysis_completed", {
                "deteriorating": wearable_analysis.get("deteriorating"),
                "concerning_trends": wearable_analysis.get("concerning_trends", []),
            })
            sessions_state[session_id]["media_findings"] = media_findings
            sessions_state[session_id]["wearable_analysis"] = wearable_analysis

            # 3. Documentation Generation (depends on all perception outputs)
            update_status("Generating Documentation", 70, "Concurrently generating SOAP note, Prior Auth, and Discharge summary...")
            fitbit = patient_data.get("fitbit") or {}
            wearable_line = ("\nWearable trends: " + wearable_analysis.get("summary", "")) if fitbit.get("metrics") else ""
            ehr_str = (
                f"Name: {patient_data['name']}, Age: {patient_data['age']}, Gender: {patient_data['gender']}\n"
                f"History: {', '.join(patient_data['history'])}\n"
                f"Vitals: {patient_data['vitals']}\nLabs: {patient_data['labs']}{wearable_line}"
            )

            doc_data = await self.doc_agent.generate_documentation(
                ehr_data=ehr_str,
                guidelines=guidelines_text,
                media_findings=media_findings,
                wearable_analysis=wearable_analysis,
                dictation=dictation,
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

            # 5. Allergy Safety Check (runs after docs are generated, before clinician review)
            update_status("Running Allergy Safety Check", 92, "Pharmacist AI checking all treatment plan medications against patient allergies...")

            # Build allergy string from patient record
            allergies_raw = patient_data.get("allergies", None)
            if not allergies_raw:
                patient_allergies_str = "Not documented"
            elif isinstance(allergies_raw, list):
                patient_allergies_str = ", ".join(
                    (a.get("substance") or a.get("name") or str(a)) if isinstance(a, dict) else str(a)
                    for a in allergies_raw
                )
            else:
                patient_allergies_str = str(allergies_raw)

            # Extract medications from generated plan
            meds_in_plan = []
            try:
                # From discharge medications
                if isinstance(doc_data, dict):
                    ds = doc_data.get("discharge_summary", {})
                    if isinstance(ds, dict):
                        dc_meds = ds.get("discharge_medications", [])
                        meds_in_plan.extend(dc_meds if isinstance(dc_meds, list) else [str(dc_meds)])
                    # Also pull from prior auth medication
                    pa = doc_data.get("prior_auth", {})
                    if isinstance(pa, dict) and pa.get("medication_name"):
                        meds_in_plan.append(pa["medication_name"])
            except Exception:
                pass

            # Also include current medications from EHR
            current_meds = patient_data.get("current_medications", [])
            if isinstance(current_meds, list):
                for m in current_meds:
                    if isinstance(m, dict):
                        meds_in_plan.append(m.get("name", ""))
                    else:
                        meds_in_plan.append(str(m))

            medications_str = ", ".join(filter(None, meds_in_plan)) or "Not specified"

            self.audit_agent.log_event(session_id, "allergy_check_started", {
                "checked_at": datetime.datetime.utcnow().isoformat() + "Z",
                "patient_allergies": patient_allergies_str,
                "medications_to_check": medications_str,
            })

            allergy_result = await self.safety_agent.run_allergy_check(
                patient_allergies=patient_allergies_str,
                medications_in_plan=medications_str,
                patient_id=str(patient_data.get("id", "unknown")),
            )

            sessions_state[session_id]["allergy_check"] = allergy_result
            self.audit_agent.log_event(session_id, "allergy_check_completed", {
                "checked_at": allergy_result.get("checked_at"),
                "result_status": allergy_result.get("result_status"),
                "has_critical": allergy_result.get("has_critical"),
                "has_warning": allergy_result.get("has_warning"),
                "summary": allergy_result.get("raw_response", "")[:500],
            })

            # 6. Pipeline Finished, waiting for clinician review
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
