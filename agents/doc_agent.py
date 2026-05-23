from google.antigravity import Agent, LocalAgentConfig
import pydantic

class SOAPNote(pydantic.BaseModel):
    subjective: str = pydantic.Field(description="Symptom history, patient complains, voice transcript notes.")
    objective: str = pydantic.Field(description="Vital signs, lab values, physical exam findings, and image/ECG results.")
    assessment: str = pydantic.Field(description="Clinical reasoning, differential diagnoses, and diagnostic summary.")
    plan: str = pydantic.Field(description="Action steps: medication changes, diagnostic orders, monitoring, and patient education.")

class PriorAuthRequest(pydantic.BaseModel):
    medication_name: str = pydantic.Field(description="The name of the drug or treatment requiring authorization.")
    icd_10_code: str = pydantic.Field(description="The primary diagnosis code.")
    medical_necessity_justification: str = pydantic.Field(description="Detailed clinical justification for this medication based on NIH/CDC guidelines and patient contraindications.")

class DischargeSummary(pydantic.BaseModel):
    admitting_diagnosis: str = pydantic.Field(description="Reason for admission.")
    discharge_diagnosis: str = pydantic.Field(description="Final diagnoses.")
    summary_of_hospital_course: str = pydantic.Field(description="Chronological log of what happened (intake, labs, imaging, treatment response).")
    discharge_medications: list[str] = pydantic.Field(description="List of medications patient should take after discharge, with specific dosages.")
    follow_up_instructions: str = pydantic.Field(description="Detailed follow-up appointments and warning symptoms.")

class DocumentationOutput(pydantic.BaseModel):
    soap_note: SOAPNote
    prior_auth: PriorAuthRequest
    discharge_summary: DischargeSummary

class DocumentationAgent:
    def __init__(self, api_key: str = None):
        self.config = LocalAgentConfig(
            api_key=api_key,
            model="gemini-3.5-flash",
            system_instructions=(
                "You are an expert Clinical Documentation Agent. "
                "You will receive a consolidated clinical context containing: "
                "1. Patient EHR Data (demographics, medications, labs, vitals) "
                "2. Clinician Dictation Transcript (speech-to-text of the clinician's bedside notes) "
                "3. Multi-Modal Perception Findings (objective findings from any medical image, and data "
                "extracted from any uploaded document) "
                "4. Wearable / Fitbit Trend Analysis (longitudinal vitals trends and any signs of deterioration) "
                "5. Guideline-Directed Medical Therapy (GDMT) guidelines retrieved via RAG. "
                "Your job is to generate three clean, professional clinical outputs: "
                "a SOAP Note, a Prior Authorization Request, and a Discharge Summary. "
                "Incorporate the dictation-derived subjective history, the image/document objective findings, and the "
                "wearable trends into the appropriate sections (e.g. wearable deterioration belongs in Objective/Assessment). "
                "Ensure all data points (vitals, dates, lab values, specific drug dosages) match the input perfectly. "
                "Format the output strictly according to the provided schema."
            ),
            response_schema=DocumentationOutput
        )

    async def generate_documentation(self, ehr_data: str, guidelines: str,
                                     media_findings: dict = None, wearable_analysis: dict = None,
                                     dictation: str = "") -> dict:
        """Generates structured SOAP note, prior auth request, and discharge
        summary from the consolidated multi-modal perception findings."""
        media_findings = media_findings or {}
        wearable_analysis = wearable_analysis or {}

        transcript = dictation or "(none)"
        image_findings = media_findings.get("image_findings") or "(none)"
        document_findings = media_findings.get("document_findings") or "(none)"
        media_summary = media_findings.get("consolidated_summary") or "(none)"

        wearable_summary = wearable_analysis.get("summary") or "(none)"
        wearable_trends = wearable_analysis.get("concerning_trends") or []
        wearable_focus = wearable_analysis.get("suggested_focus") or "(none)"

        prompt = (
            f"=== PATIENT EHR DATA ===\n{ehr_data}\n\n"
            f"=== CLINICIAN DICTATION TRANSCRIPT (speech-to-text) ===\n{transcript}\n\n"
            f"=== MULTI-MODAL PERCEPTION FINDINGS ===\n"
            f"Image findings: {image_findings}\n"
            f"Document findings: {document_findings}\n"
            f"Integrated media summary: {media_summary}\n\n"
            f"=== WEARABLE / FITBIT TREND ANALYSIS ===\n"
            f"Summary: {wearable_summary}\n"
            f"Concerning trends: {', '.join(wearable_trends) if wearable_trends else '(none)'}\n"
            f"Suggested clinical focus: {wearable_focus}\n\n"
            f"=== RAG RETRIEVED GUIDELINES ===\n{guidelines}\n\n"
            "Please generate the SOAP Note, Prior Authorization Request, and Discharge Summary."
        )
        async with Agent(config=self.config) as agent:
            response = await agent.chat(prompt)
            data = await response.structured_output()
            # If the parser failed or returned None, return a fallback dictionary or raw text.
            # But the SDK guarantees schema validation.
            return data
