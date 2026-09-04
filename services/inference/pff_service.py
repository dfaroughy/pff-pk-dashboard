#!/usr/bin/env python3
"""Local CPU inference service for the PFF pharmacokinetic dashboard.

The web client sends physical observations and dose events.  All normalization,
source-process construction, flow integration, and inverse transformation remain
inside pff_pk/PyTorch.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import time
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
EMPIRICAL_APP_ROOT = REPOSITORY_ROOT / "apps" / "empirical"
PFF_ROOT = Path(os.environ.get("PFF_REPO", REPOSITORY_ROOT.parent / "pff_pk")).resolve()
sys.path.insert(0, str(PFF_ROOT))

import numpy as np  # noqa: E402
import torch  # noqa: E402
import yaml  # noqa: E402

from pff_pk.config import training_config_from_mapping  # noqa: E402
from pff_pk.data.tasks import inverse_concentration  # noqa: E402
from pff_pk.inference.empirical import (  # noqa: E402
    batch_to_device,
    empirical_cohort_batch,
    repeat_batch,
    union_query_batch,
)
from pff_pk.inference.model import load_inference_model  # noqa: E402

DEFAULT_CONFIG = PFF_ROOT / "configs" / "amarel_v6_protocol_counterfactual_phase2_sparse.yaml"
DEFAULT_CHECKPOINT = (
    PFF_ROOT / "artifacts" / "checkpoints" / "lucid_marten_v6_step750"
    / "lucid_marten_step750_last.ckpt"
)
CACHE_ROOT = Path(
    os.environ.get("PFF_CACHE_ROOT", REPOSITORY_ROOT / ".cache" / "inference")
).resolve()
DEFAULT_ALLOWED_ORIGINS = {
    "https://pff-pk-empirical-dashboard.dariusfar.chatgpt.site",
    "https://dfaroughy.github.io",
}


def allowed_origins() -> set[str]:
    configured = os.environ.get("PFF_ALLOWED_ORIGINS", "")
    return DEFAULT_ALLOWED_ORIGINS | {
        origin.strip().rstrip("/")
        for origin in configured.split(",")
        if origin.strip()
    }


def load_model_config(path: Path):
    """Read either a base-training or curriculum-training configuration."""
    with path.open(encoding="utf-8") as stream:
        raw = yaml.safe_load(stream) or {}
    if not isinstance(raw, dict):
        raise TypeError("PFF configuration must be a mapping")
    return training_config_from_mapping(
        {key: value for key, value in raw.items() if key != "post_training"}
    )


def finite(value: Any, field: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{field} must be numeric") from error
    if not math.isfinite(result):
        raise ValueError(f"{field} must be finite")
    return result


def route(value: Any) -> str:
    normalized = str(value).strip().lower()
    if normalized in {"oral", "po"}:
        return "oral"
    if normalized in {"iv", "intravenous"}:
        return "iv"
    if normalized:
        # The trained event operator is binary: oral versus generic non-oral.
        # Preserve the reported route in the request/provenance, but encode any
        # other route through the dimensionless non-oral branch.
        return "iv"
    raise ValueError("the empirical administration route is missing")


def build_cohort(study: dict[str, Any]) -> dict[str, Any]:
    subjects: dict[str, list[tuple[float, float]]] = {}
    for subject in study.get("subjects") or []:
        identifier = str(subject.get("id") or "").strip()
        points = []
        for index, point in enumerate(subject.get("points") or []):
            if not isinstance(point, list) or len(point) != 2:
                raise ValueError(f"invalid point for subject {identifier!r}")
            observation_time = finite(point[0], f"subject time {index}")
            concentration = finite(point[1], f"subject concentration {index}")
            if observation_time >= 0 and concentration > 0:
                points.append((observation_time, concentration))
        if identifier and len(points) >= 2:
            subjects[identifier] = sorted(points)
    if len(subjects) < 2:
        raise ValueError("PFF generation requires at least two individual trajectories")
    horizon = max(point[0] for curve in subjects.values() for point in curve)
    if horizon <= 0:
        raise ValueError("the empirical observation horizon must be positive")
    raw_dose = study.get("dose")
    dose = 1.0 if raw_dose is None else finite(raw_dose, "context dose")
    if dose <= 0:
        dose = 1.0
    return {
        "key": (str(study.get("id")),),
        "source": str(study.get("source") or "dashboard"),
        "study": str(study.get("study") or study.get("id") or "empirical"),
        "drug": str(study.get("drug") or "unknown"),
        "route": route(study.get("route")),
        "dose": f"{dose:.12g}",
        "dose_units": str(study.get("doseUnit") or "reported dose units"),
        "concentration_units": str(
            study.get("concentrationUnit") or "reported concentration units"
        ),
        "time_units": str(study.get("timeUnit") or "h"),
        "subjects": subjects,
        "horizon": horizon,
    }


class ModelRuntime:
    def __init__(self) -> None:
        self.config_path = Path(os.environ.get("PFF_CONFIG", DEFAULT_CONFIG)).resolve()
        self.checkpoint_path = Path(
            os.environ.get("PFF_CHECKPOINT", DEFAULT_CHECKPOINT)
        ).resolve()
        self.device = torch.device("cpu")
        self.loaded = None
        self.checkpoint_sha256: str | None = None
        torch.set_num_threads(int(os.environ.get("PFF_CPU_THREADS", min(os.cpu_count() or 1, 8))))

    def metadata(self) -> dict[str, Any]:
        return {
            "ready": self.config_path.is_file() and self.checkpoint_path.is_file(),
            "loaded": self.loaded is not None,
            "device": "cpu",
            "config": str(self.config_path),
            "checkpoint": str(self.checkpoint_path),
            "checkpointId": self.checkpoint_path.stem,
        }

    def load(self):
        if self.loaded is None:
            if not self.config_path.is_file():
                raise FileNotFoundError(f"PFF config not found: {self.config_path}")
            if not self.checkpoint_path.is_file():
                raise FileNotFoundError(f"PFF checkpoint not found: {self.checkpoint_path}")
            # Training-only paths are irrelevant at inference but remain part of the
            # serialized training config contract.
            os.environ.setdefault("PFFF_CORPUS", str(EMPIRICAL_APP_ROOT / "public" / "data"))
            os.environ.setdefault("PFFF_RUN_ROOT", str(REPOSITORY_ROOT / ".cache" / "runs"))
            os.environ.setdefault(
                "PFFF_VALIDATION_BANK",
                str(REPOSITORY_ROOT / ".cache" / "unused-validation-bank"),
            )
            config = load_model_config(self.config_path)
            self.loaded = load_inference_model(
                config, self.checkpoint_path, device=self.device, normalization="auto"
            )
            self.checkpoint_sha256 = hashlib.sha256(self.checkpoint_path.read_bytes()).hexdigest()
        return self.loaded

    def infer(self, request: dict[str, Any]) -> dict[str, Any]:
        loaded = self.load()
        cohort = build_cohort(request.get("study") or {})
        n_draws = int(request.get("nDraws", 100))
        if not 1 <= n_draws <= 500:
            raise ValueError("nDraws must lie between 1 and 500")
        solver = request.get("solver") or {}
        method = str(solver.get("method", "heun"))
        steps = int(solver.get("steps", 8))
        if method not in {"euler", "heun"} or not 1 <= steps <= 100:
            raise ValueError("solver must be Euler/Heun with 1–100 steps")
        batch_size = int(request.get("batchSize", 8))
        if not 1 <= batch_size <= 32:
            raise ValueError("batchSize must lie between 1 and 32")

        target_events = []
        for event in request.get("doseEvents") or []:
            if str(event.get("unit")) != cohort["dose_units"]:
                raise ValueError(
                    f"dose event unit must match the context unit {cohort['dose_units']!r}"
                )
            target_events.append({
                "time": finite(event.get("time"), "dose-event time"),
                "amount": finite(event.get("amount"), "dose-event amount"),
                "duration": finite(event.get("duration", 0), "dose-event duration"),
                "route": route(event.get("route", cohort["route"])),
            })
        if not target_events:
            raise ValueError("at least one target dose event is required")
        target_events.sort(key=lambda event: event["time"])

        cpu_batch, _, _ = empirical_cohort_batch(
            cohort,
            normalization=loaded.normalization,
            target_dose_events=target_events,
        )
        cpu_batch = union_query_batch(cpu_batch)
        query_time = cpu_batch.target_time.numpy()[0, :, 0] * cohort["horizon"]
        seed = int(request.get("seed", 161803))
        started = time.perf_counter()
        chunks = []
        for start in range(0, n_draws, batch_size):
            count = min(batch_size, n_draws - start)
            repeated = batch_to_device(repeat_batch(cpu_batch, count), self.device)
            torch.manual_seed(seed + start)
            with torch.inference_mode():
                normalized = loaded.model.sample(
                    repeated,
                    steps=steps,
                    integration_method=method,
                    shared_inference=True,
                )
                physical = inverse_concentration(normalized, repeated).float().cpu().numpy()
            chunks.append(physical[..., 0])
        samples = np.concatenate(chunks, axis=0)
        elapsed = time.perf_counter() - started
        return {
            "inferenceId": "",
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "checkpointId": self.checkpoint_path.stem,
            "request": {
                "studyId": request.get("study", {}).get("id"),
                "doseEvents": request.get("doseEvents"),
                "nDraws": n_draws,
                "solver": {"method": method, "steps": steps},
                "seed": seed,
            },
            "queryTime": query_time.tolist(),
            "generatedConcentration": samples.tolist(),
            "units": {"time": cohort["time_units"], "concentration": cohort["concentration_units"]},
            "provenance": {
                "checkpointSha256": self.checkpoint_sha256,
                "normalization": loaded.normalization,
                "sourceProcess": loaded.source_process,
                "device": "cpu",
                "runtimeSeconds": elapsed,
            },
        }


RUNTIME = ModelRuntime()


class Handler(BaseHTTPRequestHandler):
    server_version = "PFFDashboard/1.0"

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        origin = self.headers.get("origin", "")
        if (
            origin.startswith("http://localhost:")
            or origin.startswith("http://127.0.0.1:")
            or origin.rstrip("/") in allowed_origins()
        ):
            self.send_header("access-control-allow-origin", origin)
            self.send_header("vary", "origin")
        self.send_header("access-control-allow-headers", "content-type")
        self.send_header("access-control-allow-methods", "GET, POST, OPTIONS")
        if self.headers.get("access-control-request-private-network") == "true":
            self.send_header("access-control-allow-private-network", "true")
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, RUNTIME.metadata())
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/inference":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > 10_000_000:
                raise ValueError("invalid request size")
            request = json.loads(self.rfile.read(length))
            RUNTIME.load()
            cache_key = {
                "schemaVersion": 1,
                "request": request,
                "checkpointSha256": RUNTIME.checkpoint_sha256,
                "configSha256": hashlib.sha256(RUNTIME.config_path.read_bytes()).hexdigest(),
            }
            canonical = json.dumps(cache_key, sort_keys=True, separators=(",", ":")).encode()
            inference_id = hashlib.sha256(canonical).hexdigest()[:20]
            destination = CACHE_ROOT / f"{inference_id}.json"
            if destination.exists():
                self._send(200, json.loads(destination.read_text(encoding="utf-8")))
                return
            result = RUNTIME.infer(request)
            result["inferenceId"] = inference_id
            CACHE_ROOT.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_suffix(".tmp")
            temporary.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
            temporary.replace(destination)
            self._send(200, result)
        except (ValueError, KeyError, TypeError, FileNotFoundError) as error:
            self._send(400, {"error": str(error)})
        except Exception as error:  # keep the local service alive and report cleanly
            self._send(500, {"error": f"inference failed: {error}"})

    def log_message(self, message: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {message % args}", flush=True)


def main() -> None:
    host = os.environ.get("PFF_API_HOST", "127.0.0.1")
    port = int(os.environ.get("PFF_API_PORT", "8791"))
    print(json.dumps({"service": f"http://{host}:{port}", **RUNTIME.metadata()}, indent=2))
    HTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
