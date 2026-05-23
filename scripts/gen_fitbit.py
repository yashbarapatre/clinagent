"""One-off generator: writes ~90 days of daily Fitbit trends into the patient
JSON files. The decline is back-loaded (mostly stable early, worsening in the
recent weeks) so the dashboard's 1w / 1m / 3m windows each tell a story.

Run: .venv/bin/python scripts/gen_fitbit.py
"""
import json
import math
import os
import random
from datetime import date, timedelta

DAYS = 90
END_DATE = date(2026, 5, 22)
PATIENTS_DIR = os.path.join(os.path.dirname(__file__), "..", "patients")


def dates():
    start = END_DATE - timedelta(days=DAYS - 1)
    return [(start + timedelta(days=i)).isoformat() for i in range(DAYS)]


def series(start, end, *, k, noise, decimals, lo=None, hi=None):
    """Daily values from `start` to `end` along an ease-in curve (t**k, k>1
    concentrates the change near the end) plus mild gaussian noise."""
    out = []
    for i in range(DAYS):
        t = i / (DAYS - 1)
        base = start + (end - start) * (t ** k)
        val = base + random.gauss(0, noise)
        if lo is not None:
            val = max(lo, val)
        if hi is not None:
            val = min(hi, val)
        out.append(round(val, decimals) if decimals else int(round(val)))
    return out


# metric spec: (key, label, unit, direction, start, end, k, noise, decimals, lo, hi)
PROFILES = {
    "101": {
        "device": "Fitbit Charge 6",
        "metrics": [
            ("resting_hr", "Resting Heart Rate", "bpm", "up_bad", 56, 82, 2.4, 1.3, 0, None, None),
            ("hrv", "Heart Rate Variability", "ms", "down_bad", 48, 19, 2.2, 1.6, 0, 5, None),
            ("spo2", "SpO₂ (overnight avg)", "%", "down_bad", 97, 90, 2.6, 0.6, 0, 80, 100),
            ("steps", "Daily Steps", "", "down_bad", 6500, 1500, 2.0, 320, 0, 0, None),
            ("sleep", "Sleep Duration", "h", "down_bad", 7.4, 4.6, 2.3, 0.35, 1, 2.5, 10),
            ("active_minutes", "Active Minutes", "min", "down_bad", 45, 7, 2.1, 3, 0, 0, None),
        ],
    },
    "102": {
        "device": "Fitbit Sense 2",
        "metrics": [
            ("resting_hr", "Resting Heart Rate", "bpm", "up_bad", 63, 99, 3.0, 1.4, 0, None, None),
            ("skin_temp", "Skin Temp Variation", "°F", "up_bad", 0.0, 1.9, 3.2, 0.12, 1, -0.5, None),
            ("breathing_rate", "Breathing Rate", "br/min", "up_bad", 14, 23, 3.0, 0.6, 0, None, None),
            ("spo2", "SpO₂ (overnight avg)", "%", "down_bad", 98, 89, 3.0, 0.6, 0, 80, 100),
            ("steps", "Daily Steps", "", "down_bad", 5600, 1400, 2.6, 300, 0, 0, None),
            ("sleep", "Sleep Duration", "h", "down_bad", 7.0, 4.2, 2.8, 0.35, 1, 2.5, 10),
        ],
    },
}


def build(pid, profile):
    random.seed(int(pid))  # reproducible
    metrics = []
    for key, label, unit, direction, start, end, k, noise, dec, lo, hi in profile["metrics"]:
        metrics.append({
            "key": key, "label": label, "unit": unit, "direction": direction,
            "series": series(start, end, k=k, noise=noise, decimals=dec, lo=lo, hi=hi),
        })
    return {
        "device": profile["device"],
        "last_synced": END_DATE.isoformat(),
        "granularity": "daily",
        "dates": dates(),
        "metrics": metrics,
    }


for pid, profile in PROFILES.items():
    path = os.path.join(PATIENTS_DIR, f"patient_{pid}.json")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    data["fitbit"] = build(pid, profile)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"updated {path}: {DAYS} daily points x {len(profile['metrics'])} metrics")
