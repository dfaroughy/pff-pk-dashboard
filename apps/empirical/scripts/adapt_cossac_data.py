"""Convert the four local COSSAC datasets to the dashboard Corpus/Study contract.

Does not alter the live catalogue. See the generated manifest for provenance.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

SPECS = {
    "warfarin": ("warfarin_data.txt", "\t", "id", "time", "dv", "amt", "oral", 1, 1000, "mg"),
    "tobramycin": ("tobramycin_data.txt", "\t", "ID", "TIME", "CP", "DOSE", "iv", 1, 1000, "mg"),
    "theophylline": ("Theoph_data.csv", ",", "ID", "TIME", "CONC", "AMT", "oral", 1, 1000, "mg"),
    "remifentanil": ("PK_data_remi.csv", ",", "ID", "TIME", "DV", "AMT", "iv", 1/60, 1, "ug"),
}
COVARIATES = {
    "warfarin": {"wt": "weight_kg", "age": "age_years", "sex": "sex_source_code"},
    "tobramycin": {"WT": "weight_kg", "AGE": "age_years", "SEX": "sex_source_code", "CLCR": "creatinine_clearance_ml_min"},
    "theophylline": {"WEIGHT": "weight_kg", "SEX": "sex"},
    "remifentanil": {"AGE": "age_years", "SEX": "sex_source_code", "HT": "height_cm", "WT": "weight_kg", "BSA": "body_surface_area_m2", "LBM": "lean_body_mass_kg"},
}


def numeric(value):
    if value is None or value.strip() in {"", "."}:
        return None
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"Non-finite value: {value!r}")
    return result


def adapt(root: Path, drug: str):
    filename, delimiter, id_col, time_col, value_col, dose_col, route, time_scale, conc_scale, unit = SPECS[drug]
    path = root / filename
    subjects, pd = {}, []
    with path.open(newline="", encoding="utf-8-sig") as stream:
        for row_number, row in enumerate(csv.DictReader(stream, delimiter=delimiter), 2):
            identifier = row[id_col].strip()
            if not identifier:
                raise ValueError(f"{filename}:{row_number}: missing subject ID")
            subject = subjects.setdefault(identifier, {"id": f"cossac-{drug}-{identifier}", "points": [], "covariates": {}, "doseEvents": []})
            for column, name in COVARIATES[drug].items():
                value = row[column].strip()
                if value in {"", "."}:
                    continue
                value = value if name == "sex" else numeric(value)
                previous = subject["covariates"].setdefault(name, value)
                if previous != value:
                    raise ValueError(f"{filename}:{row_number}: time-varying {column} is unsupported")
            time = numeric(row[time_col])
            if time is None or time < 0:
                raise ValueError(f"{filename}:{row_number}: invalid time")
            time *= time_scale
            amount = numeric(row[dose_col])
            event_id = numeric(row["EVID"]) if drug == "tobramycin" else None
            if drug == "tobramycin" and event_id not in {0, 1}:
                raise ValueError(f"Unsupported EVID: {event_id}")
            is_dose = event_id == 1 if drug == "tobramycin" else amount is not None and amount > 0
            if is_dose:
                if amount is None or amount <= 0:
                    raise ValueError(f"{filename}:{row_number}: invalid dose")
                if drug == "theophylline":
                    weight = numeric(row["WEIGHT"])
                    if weight is None or weight <= 0:
                        raise ValueError("Theophylline mg/kg conversion requires positive weight")
                    amount *= weight
                event = {"time": time, "amount": amount, "unit": unit, "route": route, "duration": 0.0}
                if drug == "remifentanil":
                    rate = numeric(row["RATE"])
                    if rate is None or rate <= 0:
                        raise ValueError("Remifentanil infusion requires positive RATE")
                    event["duration"] = amount / rate * time_scale
                subject["doseEvents"].append(event)
            if drug == "tobramycin" and is_dose:
                continue  # CP=0 on these rows is a dose placeholder.
            value = numeric(row[value_col])
            if value is None:
                continue
            if value < 0:
                raise ValueError(f"{filename}:{row_number}: negative observation")
            if drug == "warfarin":
                if row["dvid"] == "2":
                    pd.append({"subjectId": subject["id"], "time": time, "value": value, "sourceRow": row_number})
                    continue
                if row["dvid"] != "1":
                    raise ValueError(f"Unknown DVID: {row['dvid']}")
            subject["points"].append([time, value * conc_scale])
    for subject in subjects.values():
        subject["points"].sort(key=lambda point: point[0])
        subject["doseEvents"].sort(key=lambda event: event["time"])
        if not subject["points"] or not subject["doseEvents"]:
            raise ValueError(f"Missing observations or doses: {subject['id']}")
    study = {
        "id": f"empirical-cossac-{drug}", "origin": "COSSAC reference datasets",
        "drug": drug, "administeredDrug": drug, "study": f"COSSAC {drug} PK",
        "source": f"Monolix/COSSAC/{filename}", "route": route,
        "dose": None, "doseUnit": unit, "concentrationUnit": "ng/mL", "timeUnit": "h",
        "medium": {"theophylline": "serum", "remifentanil": "blood"}.get(drug, "plasma"),
        "unitClass": "mass", "subjects": list(subjects.values()), "summary": [],
    }
    provenance = {
        "file": filename, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "subjects": len(subjects), "pkObservations": sum(len(s["points"]) for s in subjects.values()),
        "doseEvents": sum(len(s["doseEvents"]) for s in subjects.values()),
        "sourceTimeToHours": time_scale, "sourceConcentrationToNgMl": conc_scale,
        "doseConversion": "AMT * WEIGHT (mg/kg to mg)" if drug == "theophylline" else "recorded total amount",
    }
    return study, provenance, pd


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[4] / "corpora/empirical")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    out = args.out or args.root / "dashboard_cossac"
    results = [adapt(args.root, drug) for drug in SPECS]  # Validate all before writing.
    timestamp = datetime.now(timezone.utc).isoformat()
    def corpus(studies):
        return {"schemaVersion": 1, "generatedAt": timestamp, "studies": studies}
    out.mkdir(parents=True, exist_ok=True)
    def write(name, data):
        (out / name).write_text(json.dumps(data, indent=2, allow_nan=False) + "\n")
    for study, _, _ in results:
        write(f"{study['drug']}.json", corpus([study]))
    write("corpus.json", corpus([s for s, _, _ in results]))
    write("warfarin_pd.json", {"endpoint": "Prothrombin Complex Response", "timeUnit": "h", "valueUnit": "source-reported response", "observations": results[0][2]})
    write("manifest.json", {"adapterVersion": 1, "reference": "https://doi.org/10.1002/psp4.12612", "datasets": [p for _, p, _ in results], "warnings": ["Subject doseEvents are authoritative; no shared cohort dose is invented.", "Censoring and LLOQ are unreported; zero observations are preserved without censor labels.", "Numeric sex codes are retained without guessing their semantics.", "Replace overlapping sources; do not append these as independent replicated cohorts."]})
    print(f"Wrote four studies and combined corpus to {out}")


if __name__ == "__main__":
    main()
