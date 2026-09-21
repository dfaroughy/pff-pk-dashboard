#!/usr/bin/env python3
"""Exercise the local synthetic -> conditioning -> checkpoint -> VPC boundary.

This is a wiring check, not a calibration benchmark. Never contacts hosted GPUs.
Writes diagnostic JSON outside source when --output is supplied.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8791")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if urlsplit(args.api).hostname not in {"localhost", "127.0.0.1", "::1"}:
        parser.error("this smoke test only supports a local service")
    args.output.mkdir(parents=True, exist_ok=True)

    def call(path, payload=None):
        data = None if payload is None else json.dumps(payload, allow_nan=False).encode()
        request = urllib.request.Request(args.api.rstrip("/") + path, data=data,
                                         headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"{path}: {error.code}: {error.read().decode()}") from error

    health = call("/health")
    assert health["models"]["pythia_covariates"]["ready"]
    generated = call("/synthetic", {"version": "v7", "seed": 30,
                                    "individuals": 4, "observations": 8})
    study = generated["study"]
    base = {"modelId": "pythia_covariates", "study": study, "nDraws": 2,
            "doseEvents": study["doseEvents"],
            "seed": 420, "solver": {"method": "heun", "steps": 8},
            "targetCovariates": [s["covariates"] for s in study["subjects"][:2]]}
    cases = {"full": base}
    partial = copy.deepcopy(base)
    for row in [s["covariates"] for s in partial["study"]["subjects"]] + partial["targetCovariates"]:
        for key in list(row):
            if key not in {"weight_kg", "sex"}:
                del row[key]
    cases["partial"] = partial
    missing = copy.deepcopy(base)
    for subject in missing["study"]["subjects"]:
        subject["covariates"] = {}
    missing["targetCovariates"] = [{}, {}]
    cases["missing"] = missing
    censored = copy.deepcopy(base)
    floor = .05 * max(p[1] for s in study["subjects"] for p in s["points"])
    censored["study"]["assay"] = {"lloq": floor}
    for subject in censored["study"]["subjects"]:
        subject["cens"] = [int(p[1] < floor) for p in subject["points"]]
        subject["points"] = [[t, max(c, floor)] for t, c in subject["points"]]
    cases["lloq_supplied"] = {**censored, "provideLloq": True}
    cases["lloq_hidden"] = {**censored, "provideLloq": False}
    grid = copy.deepcopy(base)
    horizon = max(p[0] for s in study["subjects"] for p in s["points"])
    grid["targetTimes"] = [horizon * i / 16 for i in range(1, 17)]
    grid["doseEvents"] = copy.deepcopy(study["doseEvents"])
    for event in grid["doseEvents"]:
        event["amount"] *= 1.2
        event["duration"] = .05 * horizon
    cases["dose_infusion_independent_grid"] = grid
    results = []
    for name, payload in cases.items():
        response = call("/inference", payload)
        curves = response["generatedConcentration"]
        times = response["queryTime"]
        assert len(curves) == 2 and len(times) > 0
        assert all(len(curve) == len(times) for curve in curves)
        assert all(math.isfinite(value) for curve in curves for value in curve)
        assert response["vpc"] and response["provenance"]["checkpointSha256"]
        if "targetTimes" in payload:
            assert times == payload["targetTimes"]
        (args.output / f"{name}.json").write_text(
            json.dumps({"request": payload, "response": response}, indent=2, allow_nan=False) + "\n")
        result = {"case": name, "checkpoint": response["checkpointId"],
                  "sha256": response["provenance"]["checkpointSha256"],
                  "draws": len(curves), "times": len(times),
                  "seconds": response["provenance"]["runtimeSeconds"]}
        results.append(result)
        print(json.dumps(result), flush=True)
    (args.output / "summary.json").write_text(json.dumps({
        "purpose": "integration only; not scientific quality validation",
        "syntheticProvenance": generated["provenance"], "results": results,
    }, indent=2) + "\n")


if __name__ == "__main__":
    main()
