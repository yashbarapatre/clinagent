from google.antigravity import Agent, LocalAgentConfig
import pydantic


class WearableTrendAnalysis(pydantic.BaseModel):
    summary: str = pydantic.Field(
        description="A concise clinical summary of the patient's wearable trends over the observed period."
    )
    concerning_trends: list[str] = pydantic.Field(
        description="Specific metrics trending in a clinically concerning direction, with magnitude (e.g. 'Resting HR up 58→80 bpm over 8 weeks')."
    )
    deteriorating: bool = pydantic.Field(
        description="True if the overall wearable picture suggests a meaningful decline in health."
    )
    suggested_focus: str = pydantic.Field(
        description="What the clinician should pay attention to or correlate with the chart/exam, given these trends."
    )


def _summarize_metrics(fitbit: dict) -> str:
    """Builds a compact textual digest of the daily series so the model can
    reason over trends without ingesting hundreds of raw points."""
    lines = []
    dates = fitbit.get("dates", [])
    span = f"{dates[0]} to {dates[-1]}" if dates else "unknown period"
    lines.append(f"Device: {fitbit.get('device', 'wearable')} | Period: {span} | Points: {len(dates)}")
    for m in fitbit.get("metrics", []):
        s = m.get("series", [])
        if not s:
            continue
        first, last = s[0], s[-1]
        lo, hi = min(s), max(s)
        delta = round(last - first, 1)
        direction = m.get("direction", "")
        # Downsample to ~8 evenly spaced points to convey shape cheaply.
        n = len(s)
        step = max(1, n // 8)
        sampled = s[::step]
        if sampled[-1] != last:
            sampled.append(last)
        lines.append(
            f"- {m.get('label', m.get('key'))} ({m.get('unit') or 'units'}): "
            f"start {first}, latest {last}, change {delta:+}, range [{lo}–{hi}], "
            f"worse-if={direction or 'n/a'}; trajectory ~{sampled}"
        )
    return "\n".join(lines)


class FitbitAnalysisAgent:
    """Perception agent that interprets the patient's Fitbit time series for
    signs of gradual deterioration. Runs in parallel with the media and RAG
    agents during intake."""

    def __init__(self, api_key: str = None):
        self.config = LocalAgentConfig(
            api_key=api_key,
            model="gemini-3.5-flash",
            system_instructions=(
                "You are a Wearable Data Analysis Agent. You receive a digest of a patient's Fitbit "
                "time series (resting heart rate, HRV, SpO2, steps, sleep, breathing rate, skin temperature, etc.). "
                "Each metric notes whether an upward or downward move is the clinically concerning direction "
                "(worse-if=up_bad means rising is bad; down_bad means falling is bad). "
                "Identify whether the patient is gradually deteriorating, cite the specific worsening trends with "
                "magnitudes, and tell the clinician what to focus on. Be objective and do not over-call: only flag "
                "trends that are clearly moving in the concerning direction."
            ),
            response_schema=WearableTrendAnalysis,
        )

    async def analyze(self, fitbit: dict) -> dict:
        """Returns a structured wearable-trend analysis, or a neutral result if
        the patient has no wearable data on file."""
        if not fitbit or not fitbit.get("metrics"):
            return {
                "summary": "No wearable data on file for this patient.",
                "concerning_trends": [],
                "deteriorating": False,
                "suggested_focus": "",
            }

        prompt = (
            "Analyze the following wearable trend digest and assess whether this patient is deteriorating:\n\n"
            + _summarize_metrics(fitbit)
        )
        async with Agent(config=self.config) as agent:
            response = await agent.chat(prompt)
            data = await response.structured_output()
            if isinstance(data, WearableTrendAnalysis):
                return data.model_dump()
            return data
