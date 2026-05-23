from google.antigravity import Agent, LocalAgentConfig
import pydantic

class VerificationResult(pydantic.BaseModel):
    is_safe: bool = pydantic.Field(description="True if the documentation is safe, accurate, and consistent. False if there are critical safety/dosage issues.")
    flags: list[str] = pydantic.Field(description="List of specific safety warnings, dosage concerns, or discrepancy flags (e.g., 'Metformin contraindicated due to eGFR < 30').")
    dosing_checks: list[str] = pydantic.Field(description="Details of drug dosing checks completed (e.g., 'Furosemide IV dose verified', 'Metoprolol target check').")
    guideline_adherence: str = pydantic.Field(description="A review of whether the generated documentation aligns with the CDC/NIH/WHO guidelines.")
    recommendations: str = pydantic.Field(description="Specific suggestions for the clinician to review or correct.")

class VerificationAgent:
    def __init__(self, api_key: str = None):
        self.config = LocalAgentConfig(
            api_key=api_key,
            model="gemini-3.5-flash",
            system_instructions=(
                "You are an expert Clinical Verification Agent. "
                "Your role is to rigorously audit clinician documentation (SOAP Note, Prior Auth, Discharge Summary) "
                "against patient health records, vital signs, labs, and clinical guidelines. "
                "You must check for:\n"
                "1. Drug dosing safety (e.g., check if prescribed doses exceed or match guidelines, or if drugs are contraindicated by labs like low eGFR or high Potassium).\n"
                "2. Consistency between documents (e.g. make sure vital signs, active diagnoses, and medications align across the SOAP note and Discharge summary).\n"
                "3. Completeness of the discharge plan and follow-up criteria.\n"
                "Provide a structured safety verification report."
            ),
            response_schema=VerificationResult
        )

    async def verify_documentation(self, ehr_data: str, guidelines: str, doc_output: dict) -> dict:
        """Verifies clinical safety and accuracy of generated documentation."""
        prompt = (
            f"=== PATIENT EHR DATA ===\n{ehr_data}\n\n"
            f"=== RETRIEVED GUIDELINES ===\n{guidelines}\n\n"
            f"=== GENERATED DOCUMENTATION ===\n{doc_output}\n\n"
            "Please perform a complete safety audit and verify the clinical documentation."
        )
        async with Agent(config=self.config) as agent:
            response = await agent.chat(prompt)
            return await response.structured_output()
