"""Dashboard adapter for canonical scientific profiles, never a second PK solver.

Biology and numerical acceptance belong to synthetic_priors. This adapter only
validates bounded demo controls, selects stored observation points and projects
the resulting record into the dashboard contract. Failed seeds are not replaced.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
# Local development and the public bundle use the same installed/source package.
_roots = [
    os.environ.get("SYNTHETIC_PRIORS_REPO"),
    Path(__file__).resolve().parents[2],  # packaged Space
    os.environ.get("PFF_REPO"),  # locked bundle validation
    Path(__file__).resolve().parents[3] / "synthetic_priors",  # sibling checkout
]
for _root in _roots:
    if _root and (Path(_root) / "synthetic_priors" / "__init__.py").is_file():
        sys.path.insert(0, str(_root))
        break

from synthetic_priors import generate_profile_study, get_profile  # noqa: E402
from synthetic_priors.corpus.identity import digest  # noqa: E402
from synthetic_priors.schemas.replay import pack_arm, population_from_source  # noqa: E402
from synthetic_priors.schemas.system_reader import system_from_source  # noqa: E402
from synthetic_priors.simulation.arms import simulate_arm  # noqa: E402
from synthetic_priors.simulation.views import observation_view  # noqa: E402

VERSIONS = ("v1", "v6", "v7")
BASE_POINTS = 128
# Bounds constrain the public demo, not the scientific defaults. Unlisted
# parameters are shown in the full configuration but cannot be changed remotely.
COMMON = [
    ("graph.p_oral", "Probability of oral dosing", 0, 1),
    ("graph.n_transit_max", "Maximum transit compartments", 0, 8),
    ("graph.p_recycling_loop", "Probability of recycling", 0, 1),
    ("graph.p_parallel_absorption", "Probability of parallel absorption", 0, 1),
    ("dynamics.p_saturable_edge", "Probability of saturable flux", 0, 1),
    ("dynamics.log_rate_ratio_mean", "Log rate-ratio mean", -2, 2),
    ("dynamics.log_rate_ratio_std", "Log rate-ratio standard deviation", 0.1, 2),
    ("ou.p_active", "Probability of time-varying rates", 0, 1),
    ("cohort.bsv_sigma_min", "Minimum between-person log standard deviation", 0, 0.8),
    ("cohort.bsv_sigma_max", "Maximum between-person log standard deviation", 0, 0.8),
    ("covariate.p_covariate_study", "Probability of anonymous covariates", 0, 1),
    ("covariate.p_observed", "Probability an anonymous covariate is observed", 0, 1),
    ("dosing.p_multidose", "Probability of multiple doses", 0, 1),
    ("dosing.p_infusion", "Probability of infusion", 0, 1),
]
PHYSIOLOGY = [
    ("physiology.observed_probability", "Probability a patient field is observed", 0, 1),
    ("physiology.all_missing_probability", "Probability all patient fields are missing", 0, 1),
    ("physiology.age_min", "Minimum age (years)", 18, 90),
    ("physiology.age_max", "Maximum age (years)", 18, 90),
    ("physiology.weight_min", "Minimum weight (kg)", 40, 180),
    ("physiology.weight_max", "Maximum weight (kg)", 40, 180),
    ("physiology.height_min", "Minimum height (cm)", 145, 205),
    ("physiology.height_max", "Maximum height (cm)", 145, 205),
]
V1_CONTROLS = [
    ("study.num_peripherals_range", "Peripheral compartment count range", 1, 3),
    ("study.log_k_a_mean_range", "Population log absorption-rate mean range", -1, 2),
    ("study.log_k_e_mean_range", "Population log elimination-rate mean range", -5, 0),
    ("study.log_V_mean_range", "Population log volume mean range", 2, 8),
    ("dosing.logdose_mean_range", "Population log dose mean range", -2, 2),
    ("dosing.logdose_std_range", "Between-person log dose standard deviation range", 0.1, 0.5),
]


def _integer(value, name, minimum, maximum):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or int(value) != value
        or not minimum <= value <= maximum
    ):
        raise ValueError(f"{name} must be an integer in [{minimum}, {maximum}]")
    return int(value)


def describe(version):
    profile = get_profile(version)
    configuration = profile.configuration()
    specs = V1_CONTROLS if version == "v1" else COMMON + (PHYSIOLOGY if version == "v7" else [])
    controls = []
    for path, label, low, high in specs:
        section, key = path.split(".")
        value = configuration[section][key]
        controls.append(
            {
                "path": path,
                "label": label,
                "min": low,
                "max": high,
                "default": value,
                "integer": path in ("graph.n_transit_max", "study.num_peripherals_range"),
            }
        )
    return {
        "version": version,
        "profileSha256": profile.sha256,
        "configuration": configuration,
        "controls": controls,
    }


def _profile(version, overrides):
    if not isinstance(overrides, dict):
        raise ValueError("overrides must be an object")
    description = describe(version)
    specs = {c["path"]: c for c in description["controls"]}
    configuration = description["configuration"]
    for path, value in overrides.items():
        if path not in specs:
            raise ValueError(f"unsupported prior control: {path}")
        spec = specs[path]
        expected_list = isinstance(spec["default"], list)
        if expected_list != isinstance(value, list) or (
            expected_list and len(value) != len(spec["default"])
        ):
            raise ValueError(f"invalid shape for {path}")
        values = value if expected_list else [value]
        if any(
            isinstance(v, bool)
            or not isinstance(v, (float, int))
            or not math.isfinite(v)
            or not spec["min"] <= v <= spec["max"]
            or (spec["integer"] and int(v) != v)
            for v in values
        ):
            raise ValueError(f"{path} is outside the demo limits")
        if expected_list and values != sorted(values):
            raise ValueError(f"{path} must be ordered")
        section, key = path.split(".")
        configuration[section][key] = (
            [int(v) for v in value]
            if expected_list and spec["integer"]
            else int(value)
            if spec["integer"]
            else value
        )
    for section, low, high in [
        ("cohort", "bsv_sigma_min", "bsv_sigma_max"),
        *[("physiology", f"{k}_min", f"{k}_max") for k in ("age", "weight", "height")],
    ]:
        if section in configuration and configuration[section][low] > configuration[section][high]:
            raise ValueError(f"{section}: minimum exceeds maximum")
    profile = get_profile(version)
    return (
        replace(
            profile, config_json=json.dumps(configuration, sort_keys=True, separators=(",", ":"))
        )
        if overrides
        else profile
    )


def _indices(count, schedule, shape, rng):
    # Thinning is a presentation/acquisition operation, not a new biological draw.
    if schedule == "unscheduled":
        return np.r_[
            np.sort(rng.choice(BASE_POINTS - 1, count - 1, replace=False)), BASE_POINTS - 1
        ]
    fractions = np.linspace(0, 1, count)
    target = (
        fractions**2
        if shape == "early"
        else 1 - (1 - fractions) ** 2
        if shape == "late"
        else fractions
    )
    if shape == "clustered":
        target = np.where(fractions < 0.5, fractions * 0.4, 0.8 + (fractions - 0.5) * 0.4)
    indexes = np.rint(target * (BASE_POINTS - 1)).astype(int)
    if schedule == "pseudo_scheduled":
        indexes[1:-1] += rng.integers(-2, 3, max(0, count - 2))
    for i in range(count):
        indexes[i] = np.clip(indexes[i], indexes[i - 1] + 1 if i else 0, BASE_POINTS - count + i)
    indexes[-1] = BASE_POINTS - 1
    return indexes


def _replay_edits(record, profile, payload):
    """Use the production arm solver for edits, preserving patients and clock."""
    edits = payload.get("kineticEdits", {})
    events = payload.get("doseEvents")
    if not edits and events is None:
        return False
    if profile.name == "v1":
        raise ValueError("v1 supports its own prior controls, not v6/v7 arm replay")
    if not isinstance(edits, dict):
        raise ValueError("kineticEdits must be an object")
    rates = [*record["truth"]["topology"]["edges"], *record["truth"]["topology"]["elimination"]]
    for key, changes in edits.items():
        if (
            not isinstance(key, str)
            or not key.isdigit()
            or int(key) >= len(rates)
            or not isinstance(changes, dict)
        ):
            raise ValueError("unknown kinetic row")
        for field, value in changes.items():
            if field not in ("kappa", "beta", "hill"):
                raise ValueError("unsupported kinetic field")
            if field == "beta" and value is None:
                rates[int(key)][field] = None
                continue
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                or not 1e-5 <= value <= (3 if field == "hill" else 1000)
            ):
                raise ValueError("kinetic parameter outside demo bounds")
            rates[int(key)][field] = value
    if events is not None:
        if not isinstance(events, list) or not 1 <= len(events) <= 8:
            raise ValueError("use 1–8 dose events")
        for event in events:
            if not isinstance(event, dict) or set(event) != {"time", "amount", "duration"}:
                raise ValueError("each dose requires time, amount and duration")
            for field, low, high in (("time", 0, 1), ("duration", 0, 1), ("amount", 0.001, 100)):
                value = event[field]
                if (
                    isinstance(value, bool)
                    or not isinstance(value, (int, float))
                    or not math.isfinite(value)
                    or not low <= value <= high
                ):
                    raise ValueError(f"invalid dose {field}")
            if event["time"] + event["duration"] > 1:
                raise ValueError("dose must end within the current horizon")
        if events[0]["time"] != 0 or any(
            a["time"] >= b["time"] for a, b in zip(events, events[1:], strict=False)
        ):
            raise ValueError("doses must start at zero and be strictly time ordered")
        if len({e["duration"] for e in events}) != 1:
            raise ValueError("production arm replay requires a shared infusion duration")
        events = [{**e, "route": record["protocol"]["route"]} for e in events]
    else:
        events = record["protocol"]["dose_events"]
    population = population_from_source(record)
    system = system_from_source(record)
    result = simulate_arm(system, population, events, profile.prior_config().observation)
    packed = pack_arm(population, result, record["study_id"])
    for person, new in zip(record["individuals"], packed, strict=True):
        person["observations"] = new["observations"]
        person["dose_events"] = events
    record["protocol"]["dose_events"] = events
    record["truth"]["integration"] = dict(result.diagnostics)
    record["metadata"].update(
        any_saturable=system.any_saturable,
        multidose=len(events) > 1,
        infusion=any(e["duration"] > 0 for e in events),
    )
    return True


def generate(payload):
    if not isinstance(payload, dict):
        raise ValueError("synthetic request must be an object")
    version = payload.get("version", "v6")
    if version not in VERSIONS:
        raise ValueError("choose v1, v6 or v7")
    if payload.get("action") == "describe":
        return describe(version)
    unknown = set(payload) - {
        "version",
        "seed",
        "individuals",
        "observations",
        "schedule",
        "shape",
        "gridSeed",
        "overrides",
        "action",
        "kineticEdits",
        "doseEvents",
    }
    if unknown:
        raise ValueError(f"unsupported synthetic controls: {sorted(unknown)}")
    seed = _integer(payload.get("seed", 46), "seed", 0, 2**31 - 1)
    count = _integer(payload.get("individuals", 10), "individuals", 2, 16)
    observations = _integer(payload.get("observations", 8), "observations", 2, 20)
    grid_seed = _integer(payload.get("gridSeed", 0), "gridSeed", 0, 2**31 - 1)
    schedule, shape = payload.get("schedule", "exact"), payload.get("shape", "early")
    if schedule not in ("exact", "pseudo_scheduled", "unscheduled") or shape not in (
        "uniform",
        "early",
        "late",
        "clustered",
    ):
        raise ValueError("unknown observation schedule")
    profile = _profile(version, payload.get("overrides", {}))
    record = generate_profile_study(
        profile, seed, n_individuals=count, observation_points=BASE_POINTS
    )
    source_hash = digest(record)
    replayed = _replay_edits(record, profile, payload)
    subjects = []
    rng = np.random.default_rng(np.random.SeedSequence([seed, grid_seed, 2047]))
    for person in record["individuals"]:
        times, concentrations, _ = observation_view(
            record, person, "random" if schedule == "unscheduled" else "regular"
        )
        indices = _indices(observations, schedule, shape, rng)
        subjects.append(
            {
                "id": person["id"],
                "points": [[times[i], concentrations[i]] for i in indices],
                "covariates": person.get("covariates", {}),
                "doseEvents": person.get("dose_events", record["protocol"]["dose_events"]),
            }
        )
    events = [{**e, "unit": "relative dose"} for e in record["protocol"]["dose_events"]]
    provenance = {
        **record["metadata"]["scientific_profile"],
        "canonicalProfileSha256": get_profile(version).sha256,
        "modified": profile.sha256 != get_profile(version).sha256 or replayed,
        "sourceRecordSha256": source_hash,
        "kineticEdits": payload.get("kineticEdits", {}),
        "doseOverride": payload.get("doseEvents"),
        "replayed": replayed,
        "recordSha256": digest(record),
        "sampling": "independent (not BO or a stored corpus row)",
        "schedule": schedule,
        "shape": shape,
        "gridSeed": grid_seed,
        "basePoints": BASE_POINTS,
    }
    study = {
        "id": f"synthetic-{version}-{digest([provenance, subjects])[:20]}",
        "origin": f"Synthetic {version}",
        "drug": "Synthetic cohort",
        "administeredDrug": "dimensionless reference compound",
        "study": f"{version} independent draw {seed}",
        "source": f"synthetic_priors/{version}",
        "route": record["protocol"]["route"],
        "dose": events[0]["amount"],
        "doseUnit": "relative dose",
        "doseEvents": events,
        "concentrationUnit": "dimensionless concentration",
        "timeUnit": "τ",
        "medium": "central compartment",
        "unitClass": "dimensionless",
        "subjects": subjects,
        "summary": [],
        "syntheticProvenance": provenance,
    }
    return {
        "study": study,
        "description": describe(version),
        "provenance": provenance,
        "topology": record["truth"]["topology"],
        "population": record["truth"]["population"],
        "individualTruth": record["truth"]["individuals"],
        "native": record["truth"].get("native"),
        "covariateModel": record["truth"].get("covariate_model"),
        "integration": record["truth"]["integration"],
    }


def synthetic_request(payload):
    """Bound expensive/unlucky numerical draws; never hang the public service."""
    if isinstance(payload, dict) and payload.get("action") == "describe":
        return generate(payload)
    result = subprocess.run(
        [sys.executable, str(Path(__file__).resolve())],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        timeout=90,
    )
    if result.returncode:
        raise ValueError(
            result.stdout.strip()
            or "Synthetic draw failed numerical acceptance; choose another seed."
        )
    return json.loads(result.stdout)


if __name__ == "__main__":
    try:
        print(json.dumps(generate(json.load(sys.stdin)), allow_nan=False))
    except Exception as error:
        print(f"Synthetic draw rejected: {error}")
        sys.exit(1)
