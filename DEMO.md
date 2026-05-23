# ClinAgent — 2-Minute Demo Script

> A spoken walkthrough (~300 words, ≈2 min at a natural pace). Cues in *italics*.

---

**[0:00 — Hook]**

"Clinicians lose hours to documentation, and critical signals hide across
scattered data — the chart, the wearable, the bedside conversation, the imaging.
**ClinAgent** is a multi-agent system that pulls all of that together and drafts
verified clinical documentation in seconds."

**[0:20 — The patient]**

*Select Arthur Pendelton.*

"Here's Arthur, a heart-failure patient. On the right is his EHR — history,
meds, labs. But scroll down to **Wearable Trends**. This is his Fitbit data, and
I can view it over the last week, month, or three months. Watch the three-month
view: resting heart rate climbing, HRV collapsing, SpO₂ and activity dropping.
That's a patient quietly decompensating — exactly the kind of trend a clinician
might miss between visits."

**[0:50 — Multi-modal intake]**

*Record a short dictation; upload a chest X-ray.*

"I'll dictate a quick note — speech-to-text transcribes it live — and upload his
chest film. Now I hit **Run**."

**[1:05 — The agents]**

*Pipeline visualizer animates.*

"Behind the scenes, several Gemini agents fire **in parallel**: one retrieves the
relevant heart-failure guidelines, one analyzes the X-ray and any documents
multi-modally, and one interprets the wearable trends. Their findings flow into a
documentation agent that drafts a **SOAP note, a prior-authorization request, and
a discharge summary** — which a verification agent then audits for dosing safety
and consistency."

**[1:35 — Safety]**

*Point to the safety panel.*

"ClinAgent also runs safety checks — missing data and allergy cross-reactivity.
Notice these are **surfaced, not hidden, and never silently block** the clinician:
full transparency, clinician in control."

**[1:50 — Close]**

"Everything is auditable, and on approval we emit a standards-compliant **FHIR**
document. From scattered, multi-modal data to verified, reviewable documentation —
in about a minute. That's ClinAgent."

---

### Backup one-liners (if asked)

- **Models:** Google Antigravity SDK + Gemini multi-modal.
- **Parallelism:** retrieval, perception, and wearable analysis run concurrently via `asyncio.gather`.
- **Not a medical device:** every output is drafted for clinician review.
