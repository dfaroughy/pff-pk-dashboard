#!/usr/bin/env python3
"""Adapt preserved external simulated PK benchmarks to the dashboard contract.

The adapter deliberately excludes simulator-only individual parameters (for
example CL, V, KA, VM and KM from nlmixr2data).  Those are ground truth for
evaluation, not covariates that a zero-shot PFF is allowed to see.
"""

from __future__ import annotations

import csv
import hashlib
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def numeric(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def adapt_nlmixr2(root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """Adapt the ACOP oral 2-compartment Michaelis--Menten benchmark."""
    path = root / "nlmixr2_oral_2cptmm.csv"
    subjects: dict[str, dict[str, Any]] = {}
    with path.open(encoding="utf-8", newline="") as stream:
        for row_number, row in enumerate(csv.DictReader(stream), 2):
            identifier = row["ID"].strip()
            subject = subjects.setdefault(identifier, {
                "id": f"nlmixr2-oral-2cptmm-{identifier}",
                "points": [], "doseEvents": [],
            })
            time = numeric(row["TIME"])
            if time is None or time < 0:
                raise ValueError(f"{path.name}:{row_number}: invalid TIME")
            if row["EVID"].strip() == "1":
                amount = numeric(row["AMT"])
                if amount is None or amount <= 0:
                    raise ValueError(f"{path.name}:{row_number}: invalid oral amount")
                subject["doseEvents"].append({
                    "time": time, "amount": amount, "unit": "ug", "route": "oral", "duration": 0.0,
                })
                continue
            if row["MDV"].strip() != "0":
                continue
            value = numeric(row["DV"])
            if value is not None and value > 0:
                subject["points"].append([time, value])

    retained: dict[float, list[dict[str, Any]]] = {}
    for subject in subjects.values():
        subject["points"].sort()
        subject["doseEvents"].sort(key=lambda event: event["time"])
        if len(subject["points"]) < 2 or not subject["doseEvents"]:
            raise ValueError(f"{path.name}: incomplete subject {subject['id']}")
        dose_ug = subject["doseEvents"][0]["amount"]
        if any(event["amount"] != dose_ug for event in subject["doseEvents"]):
            raise ValueError(f"{path.name}: variable dose within {subject['id']}")
        for event in subject["doseEvents"]:
            event["amount"] /= 1000.0
            event["unit"] = "mg"
        retained.setdefault(dose_ug, []).append(subject)
    if sorted((dose, len(group)) for dose, group in retained.items()) != [(10000.0, 30), (20000.0, 30), (40000.0, 30), (80000.0, 30)]:
        raise ValueError(f"{path.name}: unexpected dose-arm layout")

    studies = []
    for dose_ug, group in sorted(retained.items()):
        dose_mg = dose_ug / 1000.0
        studies.append({
            "id": f"synthetic-nlmixr2-oral-2cptmm-{int(dose_mg)}mg",
            "origin": "External simulated benchmark",
            "benchmark": {
                "provider": "nlmixr2data", "model": "Oral_2CPTMM",
                "description": "ACOP 2016 simulated oral PK: two compartments, first-order absorption, Michaelis–Menten elimination, 30 subjects in this dose arm.",
                "sourceUrl": "https://github.com/nlmixr2/nlmixr2data",
            },
            "drug": f"simulated oral PK (2CPT-MM, {int(dose_mg)} mg)",
            "administeredDrug": "simulated compound",
            "study": f"ACOP 2016 oral two-compartment Michaelis–Menten · {int(dose_mg)} mg",
            "source": "nlmixr2data::Oral_2CPTMM", "route": "oral", "dose": dose_mg, "doseUnit": "mg",
            # The source's ug/L concentration scale is numerically ng/mL.
            "concentrationUnit": "ng/mL", "timeUnit": "h", "medium": "simulated plasma",
            "unitClass": "mass", "subjects": group, "summary": [],
        })
    return studies, {
        "file": path.name, "sha256": _digest(path), "subjects": sum(map(len, retained.values())),
        "observations": sum(len(subject["points"]) for group in retained.values() for subject in group),
        "doseEvents": sum(len(subject["doseEvents"]) for group in retained.values() for subject in group),
        "excludedColumns": ["V1", "VM", "KM", "Q", "V2", "KA"],
    }


def adapt_pumas(root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """Adapt the active arms of Pumas' simulated repeated-dose trial."""
    path = root / "raw" / "pumas_intro_paper_data.csv"
    subjects: dict[str, dict[str, Any]] = {}
    with path.open(encoding="utf-8", newline="") as stream:
        for row_number, row in enumerate(csv.DictReader(stream), 2):
            dose = numeric(row["DOSE"])
            if dose is None or dose <= 0:  # Placebo cannot identify PK kinetics.
                continue
            identifier = row["ID"].strip()
            subject = subjects.setdefault(identifier, {
                "id": f"pumas-repeated-dose-{identifier}", "points": [], "doseEvents": [],
                "covariates": {"sex": row["SEX"].strip(), "weight_kg": numeric(row["WEIGHTB"])},
            })
            if subject["covariates"]["weight_kg"] is None:
                raise ValueError(f"{path.name}:{row_number}: missing WEIGHTB")
            time = numeric(row["NOMTIME"])
            if time is None:
                raise ValueError(f"{path.name}:{row_number}: invalid NOMTIME")
            if row["EVID"].strip() == "1":
                amount = numeric(row["AMT"])
                if amount is None or amount <= 0:
                    raise ValueError(f"{path.name}:{row_number}: invalid oral amount")
                subject["doseEvents"].append({
                    "time": time, "amount": amount, "unit": "mg", "route": "oral", "duration": 0.0,
                })
                continue
            value = numeric(row["CONC"])
            if value is not None and value > 0 and time >= 0:
                subject["points"].append([time, value])

    retained: dict[float, list[dict[str, Any]]] = {}
    for subject in subjects.values():
        subject["points"].sort()
        subject["doseEvents"].sort(key=lambda event: event["time"])
        if len(subject["points"]) < 2 or not subject["doseEvents"]:
            raise ValueError(f"{path.name}: incomplete subject {subject['id']}")
        dose_mg = subject["doseEvents"][0]["amount"]
        if any(event["amount"] != dose_mg for event in subject["doseEvents"]):
            raise ValueError(f"{path.name}: variable dose within {subject['id']}")
        retained.setdefault(dose_mg, []).append(subject)
    if sorted((dose, len(group)) for dose, group in retained.items()) != [(100.0, 10), (200.0, 10), (400.0, 10), (800.0, 10), (1600.0, 10)]:
        raise ValueError(f"{path.name}: unexpected active-arm layout")

    studies = []
    for dose_mg, group in sorted(retained.items()):
        studies.append({
            "id": f"synthetic-pumas-repeated-dose-{int(dose_mg)}mg",
            "origin": "External simulated benchmark",
            "benchmark": {
                "provider": "Pumas", "model": "Pumas introductory repeated-dose PK/PD trial (PK endpoint)",
                "description": f"Simulated oral repeated-dose trial: {int(dose_mg)} mg active arm, 10 subjects, rich PK sampling, sex and baseline weight.",
                "sourceUrl": "https://github.com/PumasAI-Labs/PumasIntroTutorial-ContinuousData",
            },
            "drug": f"simulated repeated-dose PK ({int(dose_mg)} mg)",
            "administeredDrug": "simulated compound",
            "study": f"Pumas simulated repeated-dose trial · {int(dose_mg)} mg",
            "source": "PumasAI-Labs/PumasIntroTutorial-ContinuousData",
            "route": "oral", "dose": dose_mg, "doseUnit": "mg", "concentrationUnit": "ng/mL",
            "timeUnit": "h", "medium": "simulated plasma", "unitClass": "mass",
            "subjects": group, "summary": [],
        })
    return studies, {
        "file": "raw/pumas_intro_paper_data.csv", "sha256": _digest(path), "subjects": sum(map(len, retained.values())),
        "observations": sum(len(subject["points"]) for group in retained.values() for subject in group),
        "doseEvents": sum(len(subject["doseEvents"]) for group in retained.values() for subject in group),
        "excludedArms": ["Placebo"], "retainedCovariates": ["sex", "weight_kg"],
    }


def adapt(root: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    results = [adapt_nlmixr2(root), adapt_pumas(root)]
    return [study for studies, _ in results for study in studies], [provenance for _, provenance in results]


def main() -> None:
    root = Path(__file__).resolve().parents[4] / "corpora" / "external_simulated"
    studies, provenance = adapt(root)
    payload = {"schemaVersion": 1, "generatedAt": datetime.now(UTC).isoformat(), "studies": studies}
    (root / "dashboard_corpus.json").write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    (root / "manifest.json").write_text(json.dumps({"adapterVersion": 1, "datasets": provenance}, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(studies)} external simulated studies")


if __name__ == "__main__":
    main()
