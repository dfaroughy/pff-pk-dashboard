#!/usr/bin/env python3
"""Build the browser-safe PK study catalogue from the canonical corpora."""

from __future__ import annotations

import csv
import json
import math
import os
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

PFFF_ROOT = Path(os.environ.get("PFFF_ROOT", Path(__file__).resolve().parents[3])).resolve()
ROOT = Path(os.environ.get("PFFF_EMPIRICAL_ROOT", PFFF_ROOT / "corpora" / "empirical")).resolve()
OUT = Path(__file__).resolve().parents[1] / "public" / "data" / "corpus.json"


def number(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def slug(*parts: Any) -> str:
    raw = "-".join(text(part).lower() for part in parts if text(part))
    return "".join(char if char.isalnum() else "-" for char in raw).strip("-")


def load_individual_studies() -> list[dict[str, Any]]:
    path = ROOT / "empirical_master_individuals_v2.csv"
    groups: dict[tuple[str, ...], dict[str, list[list[float]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    metadata: dict[tuple[str, ...], dict[str, Any]] = {}
    with path.open(encoding="utf-8", newline="") as stream:
        for row in csv.DictReader(stream):
            raw_route = text(row.get("route")).lower()
            if raw_route == "oral":
                normalized_route = "oral"
            elif raw_route in {"iv", "intravenous"}:
                normalized_route = "iv"
            else:
                continue
            time = number(row.get("time"))
            concentration = number(row.get("conc_ng_ml"))
            unit = "ng/mL"
            if concentration is None:
                concentration = number(row.get("concentration"))
                unit = text(row.get("conc_units")) or "reported units"
            subject = text(row.get("subject_id"))
            if time is None or time < 0 or concentration is None or concentration <= 0 or not subject:
                continue
            key = (
                text(row.get("source")), text(row.get("study_id")),
                text(row.get("drug_canonical")) or text(row.get("drug")),
                normalized_route, text(row.get("dose")),
                text(row.get("dose_units")), unit,
            )
            groups[key][subject].append([time, concentration])
            metadata[key] = {
                "medium": text(row.get("medium")),
                "unitClass": text(row.get("unit_class")),
            }

    studies = []
    for key, subjects in groups.items():
        source, study, drug, route, dose_text, dose_unit, concentration_unit = key
        curves = []
        for subject_id, points in subjects.items():
            unique: dict[float, list[float]] = defaultdict(list)
            for time, value in points:
                unique[time].append(value)
            ordered = [[time, sum(values) / len(values)] for time, values in sorted(unique.items())]
            if len(ordered) >= 3:
                curves.append({"id": subject_id, "points": ordered})
        if len(curves) < 2:
            continue
        study_id = f"empirical-individual-{slug(source, study, drug, route, dose_text)}"
        studies.append({
            "id": study_id,
            "origin": "Empirical individuals",
            "drug": drug,
            "administeredDrug": drug,
            "study": study,
            "source": source,
            "route": route or "not reported",
            "dose": number(dose_text),
            "doseUnit": dose_unit or "not reported",
            "concentrationUnit": concentration_unit,
            "timeUnit": "h",
            "medium": metadata[key]["medium"],
            "unitClass": metadata[key]["unitClass"],
            "subjects": curves,
            "summary": [],
        })
    return studies


def load_lenuzza() -> list[dict[str, Any]]:
    try:
        import pyarrow.parquet as parquet
    except ImportError as error:
        raise SystemExit("pyarrow is required to build the Lenuzza catalogue") from error

    name_map = {
        "caffeine (137X)": "caffeine", "paraxanthine (17X)": "paraxanthine",
        "5-hydroxyomeprazole": "5-hydroxy-omeprazole",
        "hydroxy repaglinide": "hydroxy-repaglinide",
        "4-hydroxytolbutamide": "4-hydroxy-tolbutamide",
        "1-hydroxymidazolam": "1-hydroxy-midazolam",
    }
    parent = {
        "5-hydroxy-omeprazole": "omeprazole", "omeprazole sulfone": "omeprazole",
        "hydroxy-repaglinide": "repaglinide", "4-hydroxy-tolbutamide": "tolbutamide",
        "1-hydroxy-midazolam": "midazolam", "paracetamol glucuronide": "paracetamol",
        "dextrorphan": "dextromethorphan", "paraxanthine": "caffeine",
    }
    studies = []
    for record in parquet.read_table(ROOT / "lenuzza2016.parquet").to_pylist():
        meta = record.get("meta_data") or {}
        drug = name_map.get(text(meta.get("substance_name")), text(meta.get("substance_name")))
        curves, doses, events, routes = [], [], [], []
        for individual in record.get("context") or []:
            by_time: dict[float, list[float]] = defaultdict(list)
            for raw_time, raw_value in zip(
                individual.get("observation_times") or [],
                individual.get("observations") or [], strict=True,
            ):
                time, value = number(raw_time), number(raw_value)
                if time is not None and time >= 0 and value is not None and value > 0:
                    by_time[time].append(value * 1e6)  # g/L to ng/mL
            points = [[time, sum(values) / len(values)] for time, values in sorted(by_time.items())]
            if len(points) >= 2:
                curves.append({"id": text(individual.get("name_id")), "points": points})
            individual_doses = individual.get("dosing") or []
            individual_times = individual.get("dosing_times") or []
            individual_types = individual.get("dosing_type") or []
            for index, raw_dose in enumerate(individual_doses):
                dose = number(raw_dose)
                if dose is None:
                    continue
                dose_mg = dose * 1e3
                doses.append(dose_mg)
                event_time = number(individual_times[index]) if index < len(individual_times) else 0
                route = text(individual_types[index]).lower() if index < len(individual_types) else "oral"
                routes.append(route)
                events.append({"time": event_time or 0, "amount": dose_mg, "unit": "mg", "route": route})
        if not curves:
            continue
        unique_events = list({(event["time"], event["amount"], event["route"]): event for event in events}.values())
        route = max(set(routes), key=routes.count) if routes else "oral"
        study = text(meta.get("study_name")) or "Lenuzza2016"
        studies.append({
            "id": f"lenuzza-{slug(drug)}",
            "origin": "Lenuzza 2016",
            "drug": drug,
            "administeredDrug": parent.get(drug, drug),
            "study": study,
            "source": "PK-DB/Lenuzza2016-CIME",
            "route": route,
            "dose": sorted(doses)[len(doses) // 2] if doses else None,
            "doseUnit": "mg",
            "doseEvents": sorted(unique_events, key=lambda event: event["time"]),
            "concentrationUnit": "ng/mL",
            "timeUnit": "h",
            "medium": "plasma",
            "unitClass": "mass",
            "subjects": curves,
            "summary": [],
        })
    return studies


def main() -> None:
    studies = load_lenuzza() + load_individual_studies()
    studies.sort(key=lambda item: (item["drug"], item["origin"], item["study"], item["id"]))
    payload = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "studies": studies,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {len(studies):,} studies to {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
