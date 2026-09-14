"""Exercise the public API with synthetic data only (requires gradio_client)."""

import argparse
import copy
import json
import math

from gradio_client import Client


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--space", default="Dariusfar/pff-pk-api")
    args = parser.parse_args()
    client = Client(args.space)
    health = client.predict(api_name="/health")
    for model in ("pythia", "pythia_dose", "pythia_covariates"):
        assert health["models"][model]["ready"], health
    print("All three model releases available", flush=True)
    synthetic = client.predict(
        {"version": "v1", "seed": 30, "individuals": 3, "observations": 8},
        api_name="/synthetic",
    )
    study = synthetic["study"]
    for model in ("pythia", "pythia_dose", "pythia_covariates"):
        payload = {"modelId": model, "study": study, "doseEvents": study["doseEvents"],
                   "nDraws": 2, "seed": 91425750, "solver": {"method": "heun", "steps": 8}}
        cases = [payload]
        if model == "pythia_covariates":
            assay_study = copy.deepcopy(study)
            positive = [v for s in study["subjects"] for _, v in s["points"] if v > 0]
            limit = sorted(positive)[len(positive) // 3]
            assay_study["assay"] = {"lloq": limit}
            for index, subject in enumerate(assay_study["subjects"]):
                subject["covariates"] = {"weight_kg": 60 + index * 10}
                subject["cens"] = [int(v <= limit) for _, v in subject["points"]]
                subject["points"] = [[t, max(v, limit)] for t, v in subject["points"]]
            cases += [{**payload, "study": assay_study, "provideLloq": known,
                       "targetCovariates": [{"weight_kg": 65}, {"weight_kg": 85}]}
                      for known in (True, False)]
        for request in cases:
            result = client.predict(request, api_name="/inference")
            assert result["request"]["modelId"] == model
            curves = result["generatedConcentration"]
            assert len(curves) == 2
            assert all(len(curve) == len(result["queryTime"]) for curve in curves)
            assert all(math.isfinite(v) and v >= 0 for curve in curves for v in curve)
            json.dumps(result, allow_nan=False)
            print(model, "LLOQ:", request.get("provideLloq", "absent"),
                  "passed", result["provenance"], flush=True)


if __name__ == "__main__":
    main()
