"""Opt-in loopback research bridge; TabPFN stays in its own Python environment."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

import numpy as np

from services.inference.censored_vpc import DASHBOARD_VPC_VERSION, dashboard_vpc_summary

ROOT = Path(__file__).resolve().parents[2]
VERSION = "tabpfn-local-bridge-v1"


class TabPFNRuntime:
    def __init__(self):
        self.repo = Path(os.environ.get("TABPFN_PK_REPO", ROOT.parent / "tabpfn_pk")).resolve()
        self.python = self.repo / ".venv/bin/python"
        self.model_dir = self.repo / "models/tabpfn-3.5"

    def metadata(self, model_id="tabpfn"):
        ready = self.python.is_file() and (self.model_dir / "model.json").is_file() and (self.repo / "tabpfn_pk/dashboard.py").is_file()
        if ready:
            try:
                receipt = json.loads((self.model_dir / "model.json").read_text())
                ready = (self.model_dir / receipt["filename"]).is_file()
            except (OSError, ValueError, KeyError):
                ready = False
        label = "TabPFN-TS" if model_id == "tabpfn_ts" else "TabPFN"
        return {"modelId": model_id, "label": label, "supportsDose": False,
                "maxGeneratedIndividuals": 1000, "ready": ready, "loaded": False,
                "device": "cpu", "checkpointId": "tabpfn-3.5-20260909"}

    def infer(self, request, cache_root, build_cohort):
        model_id = request.get("modelId", "tabpfn")
        if model_id not in {"tabpfn", "tabpfn_ts"}:
            raise ValueError("Unsupported local TabPFN model")
        if not self.metadata(model_id)["ready"]:
            raise ValueError("The local TabPFN environment or checkpoint is unavailable")
        sources = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((self.repo / "tabpfn_pk").glob("*.py"))}
        signature = {"request": request, "bridge": VERSION,
                     "bridgeSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                     "adapterSources": sources, "vpcVersion": DASHBOARD_VPC_VERSION,
                     "model": json.loads((self.model_dir / "model.json").read_text()),
                     "lockSha256": hashlib.sha256((self.repo / "uv.lock").read_bytes()).hexdigest()}
        identifier = hashlib.sha256(json.dumps(signature, sort_keys=True, allow_nan=False).encode()).hexdigest()[:20]
        destination = cache_root / f"{model_id}-{identifier}.json"
        if destination.exists():
            return json.loads(destination.read_text())
        started = time.perf_counter()
        try:
            process = subprocess.run([str(self.python), "-m", "tabpfn_pk.dashboard", "--model-dir", str(self.model_dir)],
                                     cwd=self.repo, input=json.dumps(request, allow_nan=False), text=True,
                                     capture_output=True, timeout=600)
        except subprocess.TimeoutExpired as error:
            raise ValueError("TabPFN exceeded 10 minutes; reduce the cohort size and retry") from error
        try:
            raw = json.loads(process.stdout)
        except ValueError as error:
            raise ValueError("TabPFN worker exited without a valid result") from error
        if process.returncode != 0 or "error" in raw:
            raise ValueError(raw.get("error", "TabPFN worker failed"))
        times = np.asarray(raw["queryTime"], dtype=float)
        pool = np.asarray(raw["generatedConcentration"], dtype=float)
        if pool.shape != (request["nDraws"], len(times)) or not np.isfinite(pool).all() or (pool <= 0).any() or len(times) < 2 or (np.diff(times) <= 0).any():
            raise ValueError("Invalid TabPFN generated cohort")
        study = request["study"]
        # Match the exact conditioning/evaluation window: never create a time-zero prediction.
        aligned = {**study, "subjects": [
            {**s, "points": [p for p in s["points"] if p[0] > 0],
             **({"cens": [flag for p, flag in zip(s["points"], s["cens"], strict=True) if p[0] > 0]} if s.get("cens") is not None else {})}
            for s in study["subjects"]]}
        cohort = build_cohort(aligned)
        vpc = dashboard_vpc_summary(pool, times, cohort, study=aligned, replicates=200,
                                    seed=request.get("seed", 0) + 104729)
        result = {**raw, "inferenceId": identifier, "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                  "request": {"modelId": model_id, "studyId": study["id"], "nDraws": request["nDraws"],
                              "doseEvents": request.get("doseEvents", []), "seed": request.get("seed", 0)},
                  "vpc": vpc, "units": {"time": study["timeUnit"], "concentration": study["concentrationUnit"]}}
        result["provenance"]["runtimeSeconds"] = time.perf_counter() - started
        cache_root.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(".tmp")
        temporary.write_text(json.dumps(result, allow_nan=False, separators=(",", ":")))
        temporary.replace(destination)
        return result
