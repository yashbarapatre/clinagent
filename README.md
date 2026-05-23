# ClinAgent

**ClinAgent** is a multi-agent clinical decision-support system. Given a patient's
EHR, wearable data, a clinician's bedside dictation, and any uploaded medical
images or documents, it runs a team of specialized AI agents — in parallel — to
produce verified clinical documentation (SOAP note, prior authorization, and
discharge summary) for clinician review.

It is built on the **Google Antigravity SDK** with **Gemini** multi-modal models.

> ⚠️ Research/demo software. Not a medical device; outputs require clinician review.

---

## Highlights

- **Parallel multi-agent pipeline** — retrieval, perception, and wearable analysis
  run concurrently, then feed documentation → verification → safety checks.
- **Gemini multi-modal perception** — uploaded medical **images** (X-ray, ECG,
  photo) and **documents** (lab PDF, referral) are sent to Gemini as raw bytes
  for real analysis.
- **Voice dictation** — the browser's speech-to-text transcribes the clinician's
  notes; the transcript is passed to the model for inference.
- **Wearable / Fitbit trends** — longitudinal vitals (resting HR, HRV, SpO₂,
  sleep, steps, etc.) are charted on the dashboard with a **1 week / 1 month /
  3 month** range selector, and analyzed for signs of deterioration.
- **Layered safety** — a synchronous missing-data check and an AI allergy
  cross-reactivity check. Both are **surfaced but non-blocking**; the clinician
  proceeds with full visibility of warnings and criticalities.
- **Auditability** — every pipeline step is logged; a FHIR document bundle is
  emitted on approval.

---

## Architecture

```
            ┌──────────────────── Orchestrator ────────────────────┐
            │                                                       │
  Intake ──▶│   ╔═ Parallel perception (asyncio.gather) ═╗          │
            │   ║  RagAgent        — guideline retrieval ║          │
            │   ║  MediaAnalysis   — image/doc (Gemini)  ║          │
            │   ║  FitbitAnalysis  — wearable trends     ║          │
            │   ╚════════════════════╤═══════════════════╝          │
            │                        ▼                              │
            │   DocumentationAgent  → SOAP / PriorAuth / Discharge  │
            │                        ▼                              │
            │   VerificationAgent   → safety & consistency audit    │
            │                        ▼                              │
            │   SafetyAgent         → allergy cross-check           │
            └────────────────────────┬──────────────────────────────┘
                                     ▼
                       Clinician review → approve → FHIR bundle
```

### Agents (`agents/`)

| Agent | Role |
|-------|------|
| `orchestrator.py` | Drives the workflow; runs the perception agents in parallel and sequences the rest. |
| `rag_agent.py` | Retrieves guideline-directed therapy from the local `guidelines/` library (tool-using). |
| `media_agent.py` | Multi-modal perception of uploaded **images** and **documents** via Gemini. |
| `fitbit_agent.py` | Interprets the wearable time series for clinically concerning trends. |
| `doc_agent.py` | Generates the SOAP note, prior-auth request, and discharge summary. |
| `verification_agent.py` | Audits the generated docs for dosing safety and consistency. |
| `safety_agent.py` | Synchronous missing-data validation + AI allergy cross-reactivity check. |
| `audit_agent.py` | Structured event logging for every session. |

---

## Project layout

```
main.py            FastAPI app + REST endpoints; serves the static dashboard
agents/            The multi-agent system (see table above)
static/            Dashboard UI (index.html, app.js, styles.css)
patients/          Mock patient EHR + Fitbit data (patient_*.json)
guidelines/        Markdown clinical guideline library (RAG source)
fhir_output/       Generated FHIR document bundles (created at runtime)
uploads/           Uploaded images/documents (created at runtime)
audit_logs/        Per-session audit trails
scripts/           Utilities (e.g. gen_fitbit.py — regenerates wearable data)
```

---

## Setup

Requires **Python 3.13** and a **Gemini API key**
([Google AI Studio](https://aistudio.google.com/app/api-keys)).

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Create a `.env` file in the project root:

```
GEMINI_API_KEY=your_key_here
```

---

## Running

```bash
.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Then open **http://localhost:8000** (use `localhost`, not `127.0.0.1`, so the
browser's speech-to-text works).

### Using the dashboard

1. Select a patient (Arthur Pendelton or Eleanor Vance), or add one with **New Patient**.
2. Review the EHR card, including **Wearable Trends** (toggle 1w / 1m / 3m).
3. Optionally record a dictation and/or upload a clinical image or PDF.
4. Click **Run ClinAgent Orchestrator** — watch the agents work in real time.
5. Review the generated documents and safety flags, then **Approve** to emit the FHIR bundle.

---

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/api/patients` | List patients |
| GET  | `/api/patients/{id}` | Patient detail (EHR + Fitbit) |
| POST | `/api/patients` | Create a patient |
| POST | `/api/safety-check/{id}` | Run the missing-data safety check |
| POST | `/api/intake` | Start the pipeline (multipart: `patient_id`, `dictation`, `image_notes`, `image`) |
| GET  | `/api/workflow-status/{session_id}` | Poll pipeline progress/outputs |
| POST | `/api/approve` | Approve documentation → write FHIR bundle |
| GET  | `/api/audit-logs` / `/api/audit-logs/{session_id}` | Audit trails |

---

## Notes

- **Safety checks are non-blocking by design** — missing critical fields and
  allergy conflicts are displayed and audited, but the clinician decides whether
  to proceed.
- **Regenerating wearable data:** `.venv/bin/python scripts/gen_fitbit.py`.
- Backend (Python) changes require a server restart; static files are served
  fresh on reload.

See [DEMO.md](DEMO.md) for a 2-minute walkthrough script.
