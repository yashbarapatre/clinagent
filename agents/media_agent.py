import os
from google.antigravity import Agent, LocalAgentConfig, types
import pydantic


class MediaFindings(pydantic.BaseModel):
    image_findings: str = pydantic.Field(
        description="Objective findings from the uploaded medical image (X-ray, ECG, photo, etc.): what is visible and its clinical significance. Empty string if no image."
    )
    document_findings: str = pydantic.Field(
        description="Key clinical data extracted from the uploaded document (lab report, referral, PDF): values, dates, and impressions. Empty string if no document."
    )
    consolidated_summary: str = pydantic.Field(
        description="A short, integrated summary tying together what the image and document collectively indicate about the patient, in light of the clinician's dictation."
    )
    modalities_processed: list[str] = pydantic.Field(
        description="Which media modalities were actually analyzed, e.g. ['image', 'document']."
    )


# MIME types the SDK media primitives accept (kept in sync with the SDK's
# SUPPORTED_*_MIMES frozensets). Used to route an uploaded file to the right
# primitive and to skip anything Gemini can't ingest.
_IMAGE_MIMES = {"image/bmp", "image/jpeg", "image/png", "image/webp"}
_DOCUMENT_MIMES = {
    "application/pdf", "application/json", "text/css", "text/csv",
    "text/html", "text/javascript", "text/plain", "text/rtf", "text/xml",
}

# `mimetypes.guess_type` returns OS-specific variants (e.g. image/jpg) that the
# SDK's strict validators reject. Normalize the common ones to the canonical
# supported MIME before building a media primitive.
_MIME_ALIASES = {
    "image/jpg": "image/jpeg", "image/x-png": "image/png",
}


class MediaAnalysisAgent:
    """Perception agent that sends raw image / document bytes to Gemini using
    the SDK's multi-modal `chat([...])` content list. Runs alongside the RAG and
    wearable agents in the orchestrator's parallel intake phase. Audio is not
    sent as bytes — the clinician's dictation is already converted to text by
    the browser's speech-to-text and passed straight to the documentation agent."""

    def __init__(self, api_key: str = None):
        self.config = LocalAgentConfig(
            api_key=api_key,
            model="gemini-3.5-flash",
            system_instructions=(
                "You are a Clinical Multi-Modal Perception Agent. You receive raw clinical media — "
                "a medical image (e.g. chest X-ray, ECG, wound photo) and/or a clinical document "
                "(e.g. lab PDF, referral letter) — along with a text transcript of the clinician's "
                "spoken dictation for context.\n"
                "Analyze every media modality provided directly from its bytes:\n"
                "1. IMAGE: describe objective findings and their clinical significance.\n"
                "2. DOCUMENT: extract values, dates, and impressions.\n"
                "Use the dictation transcript only as context to interpret the media. Then produce a "
                "consolidated summary. Be precise and never invent findings that are not present in the "
                "media. Leave a field as an empty string if that modality was not supplied."
            ),
            response_schema=MediaFindings,
        )

    @staticmethod
    def _attach(parts: list, modalities: list, path: str, kind_label: str, description: str):
        """Loads a file into the correct SDK media primitive and appends it to
        the prompt parts. Skips unsupported/missing files without failing."""
        if not path or not os.path.exists(path):
            return
        import mimetypes
        guess, _ = mimetypes.guess_type(path)
        mime = _MIME_ALIASES.get(guess, guess)
        try:
            with open(path, "rb") as f:
                data = f.read()
            if mime in _IMAGE_MIMES:
                parts.append(types.Image(data=data, mime_type=mime, description=description))
                modalities.append("image")
            elif mime in _DOCUMENT_MIMES:
                parts.append(types.Document(data=data, mime_type=mime, description=description))
                modalities.append("document")
            else:
                # Unknown/unsupported type — note it in text so the model knows.
                parts.append(f"[{kind_label} provided but its format ({guess or 'unknown'}) is not machine-readable; rely on text hints.]")
        except Exception as e:
            parts.append(f"[{kind_label} could not be loaded for analysis: {e}]")

    async def analyze(
        self,
        *,
        image_path: str = None,
        document_path: str = None,
        dictation_text: str = "",
        image_notes: str = "",
    ) -> dict:
        """Sends whatever media is available to Gemini and returns structured
        findings. If no media files exist, returns findings derived from the
        provided text hints without making an LLM call."""
        parts: list = []
        modalities: list[str] = []

        self._attach(parts, modalities, image_path, "Image", "Uploaded medical image (X-ray / ECG / photo)")
        self._attach(parts, modalities, document_path, "Document", "Uploaded clinical document (lab report / referral)")

        # No analyzable media: skip the model call, fall back to text hints.
        if not modalities:
            return {
                "image_findings": image_notes or "",
                "document_findings": "",
                "consolidated_summary": (
                    "No image or document supplied; relying on the clinician's dictation transcript only."
                    if (dictation_text or image_notes) else "No image or document provided."
                ),
                "modalities_processed": [],
            }

        instruction = (
            "Analyze the attached clinical media. Report objective findings for any image, extract data "
            "from any document, then give a consolidated summary.\n\n"
            f"Clinician dictation transcript (context): {dictation_text or '(none)'}\n"
            f"Text hint about the image: {image_notes or '(none)'}"
        )
        parts.insert(0, instruction)

        async with Agent(config=self.config) as agent:
            response = await agent.chat(parts)
            data = await response.structured_output()
            if isinstance(data, MediaFindings):
                return data.model_dump()
            return data
