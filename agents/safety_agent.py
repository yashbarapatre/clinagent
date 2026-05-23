"""
ClinAgent Safety Agent
======================
Provides two critical patient safety checks:

1. check_missing_data(patient_data) — synchronous FHIR field validator.
   Returns a dict with 'critical' and 'warnings' lists identifying
   missing fields that could endanger patient care.

2. run_allergy_check(patient_allergies, medications_in_plan) — async AI call.
   Uses Gemini 3.5 Flash to cross-check every medication against documented
   allergies, including cross-reactive and drug-class reactions.
"""

import datetime
from google.antigravity import Agent, LocalAgentConfig


# ─────────────────────────────────────────────────────────────────────────────
# Field definitions
# ─────────────────────────────────────────────────────────────────────────────

CRITICAL_FIELDS = [
    {
        "key": "allergies",
        "label": "Allergies",
        "description": "Patient allergy list is required to prevent adverse drug reactions.",
        "check": lambda p: (
            p.get("allergies") is not None
            and p.get("allergies") != []
            and p.get("allergies") != ""
        ),
    },
    {
        "key": "current_medications",
        "label": "Current Medications",
        "description": "Active medication list is required for drug-drug interaction screening.",
        "check": lambda p: (
            p.get("current_medications") is not None
            and p.get("current_medications") != []
        ),
    },
    {
        "key": "weight",
        "label": "Patient Weight",
        "description": "Weight is required for accurate weight-based drug dosing.",
        "check": lambda p: (
            p.get("weight") is not None
            and p.get("weight") != ""
        ),
    },
    {
        "key": "renal_function",
        "label": "Renal Function (Creatinine/eGFR)",
        "description": "Renal function is required to determine safe drug dosing and contraindications.",
        "check": lambda p: (
            # Accept either explicit renal_function field OR Creatinine/eGFR in labs
            p.get("renal_function") is not None
            or (
                isinstance(p.get("labs"), dict)
                and (
                    any(k.lower() in ("creatinine", "egfr", "gfr") for k in p["labs"])
                )
            )
        ),
    },
]

WARNING_FIELDS = [
    {
        "key": "code_status",
        "label": "Code Status",
        "description": "Code status (Full Code / DNR / DNI) should be documented for all admitted patients.",
        "check": lambda p: p.get("code_status") is not None and p.get("code_status") != "",
    },
    {
        "key": "pregnancy_status",
        "label": "Pregnancy Status",
        "description": "Pregnancy status is critical to avoid teratogenic medications.",
        "check": lambda p: p.get("pregnancy_status") is not None and p.get("pregnancy_status") != "",
    },
    {
        "key": "last_menstrual_period",
        "label": "Last Menstrual Period (if female)",
        "description": "LMP documentation helps assess pregnancy risk in female patients.",
        "check": lambda p: (
            p.get("gender", "").lower() not in ("female", "f")
            or (p.get("last_menstrual_period") is not None and p.get("last_menstrual_period") != "")
        ),
    },
    {
        "key": "advance_directives",
        "label": "Advance Directives",
        "description": "Advance directives (Living Will / Healthcare Proxy) should be documented.",
        "check": lambda p: p.get("advance_directives") is not None and p.get("advance_directives") != "",
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# Safety Agent
# ─────────────────────────────────────────────────────────────────────────────

class SafetyAgent:
    def __init__(self, api_key: str = None):
        self.api_key = api_key
        self.config = LocalAgentConfig(
            api_key=api_key,
            model="gemini-3.5-flash",
            system_instructions=(
                "You are a clinical pharmacist AI safety checker. "
                "Your sole responsibility is to perform a rigorous allergy safety check "
                "on the medications listed in a patient's treatment plan. "
                "You must check for direct allergies, cross-reactive allergies "
                "(e.g., penicillin → cephalosporins), and drug class reactions "
                "(e.g., sulfa drugs → multiple classes). "
                "Be concise, precise, and clinically accurate. "
                "Always identify safer alternatives for any flagged medication."
            ),
        )

    # ─── Feature 1: Missing Data Check (synchronous, no AI) ───────────────────

    def check_missing_data(self, patient_data: dict) -> dict:
        """
        Validates patient FHIR data for required clinical fields.

        Returns:
            {
                "checked_at": ISO timestamp,
                "critical": [{ "key", "label", "description" }, ...],
                "warnings":  [{ "key", "label", "description" }, ...],
                "result":    "blocked" | "warnings" | "passed"
            }
        """
        critical_missing = []
        warnings_missing = []

        for field in CRITICAL_FIELDS:
            try:
                present = field["check"](patient_data)
            except Exception:
                present = False
            if not present:
                critical_missing.append({
                    "key": field["key"],
                    "label": field["label"],
                    "description": field["description"],
                })

        for field in WARNING_FIELDS:
            try:
                present = field["check"](patient_data)
            except Exception:
                present = False
            if not present:
                warnings_missing.append({
                    "key": field["key"],
                    "label": field["label"],
                    "description": field["description"],
                })

        if critical_missing:
            result = "blocked"
        elif warnings_missing:
            result = "warnings"
        else:
            result = "passed"

        return {
            "checked_at": datetime.datetime.utcnow().isoformat() + "Z",
            "critical": critical_missing,
            "warnings": warnings_missing,
            "result": result,
        }

    # ─── Feature 2: Allergy Safety Check (async, Gemini AI) ──────────────────

    async def run_allergy_check(
        self,
        patient_allergies: str,
        medications_in_plan: str,
        patient_id: str = "unknown",
    ) -> dict:
        """
        Runs an AI-powered allergy safety check on the treatment plan.

        Returns:
            {
                "checked_at":   ISO timestamp,
                "raw_response": str (full AI response),
                "has_critical": bool,
                "has_warning":  bool,
                "result_status": "critical" | "warning" | "safe" | "no_allergy_data"
            }
        """
        prompt = (
            f"PATIENT ALLERGIES: {patient_allergies}\n\n"
            f"MEDICATIONS IN TREATMENT PLAN: {medications_in_plan}\n\n"
            "Perform a comprehensive allergy safety check:\n\n"
            "1. Check every medication against every allergy\n"
            "2. Check for cross-reactive allergies\n"
            "   (example: penicillin allergy → cephalosporin risk)\n"
            "3. Check for allergy class reactions\n"
            "   (example: sulfa allergy → multiple drug classes)\n\n"
            "For each conflict found return:\n"
            "- SEVERITY: Critical / Moderate / Low\n"
            "- MEDICATION: name of conflicting drug\n"
            "- ALLERGY: the allergy it conflicts with\n"
            "- REASON: why it is dangerous\n"
            "- ALTERNATIVE: safer medication to use instead\n\n"
            "If no allergies are documented return:\n"
            "⚠️ No allergy data on file. Clinician must verify patient allergies "
            "before approving any medications.\n\n"
            "If no conflicts found return:\n"
            "✅ All medications verified safe against documented allergies."
        )

        checked_at = datetime.datetime.utcnow().isoformat() + "Z"

        async with Agent(config=self.config) as agent:
            response = await agent.chat(prompt)
            raw_text = await response.text()

        # Determine severity from response text
        lower = raw_text.lower()
        no_allergy_data = (
            "no allergy data" in lower
            or "not documented" in lower
            or (patient_allergies.strip() in ("", "none", "unknown", "not documented"))
        )
        has_critical = "severity: critical" in lower
        has_warning = "severity: moderate" in lower or "severity: low" in lower

        if no_allergy_data:
            result_status = "no_allergy_data"
        elif has_critical:
            result_status = "critical"
        elif has_warning:
            result_status = "warning"
        else:
            result_status = "safe"

        return {
            "checked_at": checked_at,
            "patient_id": patient_id,
            "allergies_checked": patient_allergies,
            "medications_checked": medications_in_plan,
            "raw_response": raw_text,
            "has_critical": has_critical,
            "has_warning": has_warning,
            "result_status": result_status,
        }
