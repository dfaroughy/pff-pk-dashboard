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
DEFAULT_PYTHIA_CONFIG = PFF_ROOT / "configs" / "phase2_sparse.yaml"
DEFAULT_PYTHIA_CHECKPOINT = (
    PFF_ROOT / "artifacts" / "checkpoints" / "digital_square_step120000"
    / "fixed-bank-full-best.ckpt"
)
CACHE_ROOT = Path(
    os.environ.get("PFF_CACHE_ROOT", REPOSITORY_ROOT / ".cache" / "inference")
).resolve()
DEFAULT_ALLOWED_ORIGINS = {
    "https://pff-pk-empirical-dashboard.dariusfar.chatgpt.site",
    "https://dfaroughy.github.io",
}
DEFAULT_GENERATED_INDIVIDUALS = 20
MAX_GENERATED_INDIVIDUALS = 30
DEFAULT_FLOW_STEPS = 8
MAX_FLOW_STEPS = 16
PYTHIA_MODEL = "pythia"
PYTHIA_DOSE_MODEL = "pythia_dose"
DEFAULT_MODEL = PYTHIA_DOSE_MODEL


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


def bounded_integer(value: Any, field: str, low: int, high: int) -> int:
    numeric = finite(value, field)
    if not numeric.is_integer() or not low <= numeric <= high:
        raise ValueError(f"{field} must be a whole number between {low} and {high}")
    return int(numeric)


def requested_model(request: dict[str, Any]) -> str:
    """Resolve a public model identifier with a dose-capable default."""
    model_id = str(request.get("modelId", DEFAULT_MODEL)).strip().lower()
    if model_id not in {PYTHIA_MODEL, PYTHIA_DOSE_MODEL}:
        raise ValueError("modelId must be pythia or pythia_dose")
    return model_id


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


def target_dose_events(
    raw_events: Any, cohort: dict[str, Any]
) -> list[dict[str, float | str]]:
    events = []
    for event in raw_events or []:
        if not isinstance(event, dict):
            raise ValueError("each dose event must be an object")
        if str(event.get("unit", "")).strip() != cohort["dose_units"].strip():
            raise ValueError(
                f"dose event unit must match the context unit {cohort['dose_units']!r}"
            )
        event_time = finite(event.get("time"), "dose-event time")
        event_amount = finite(event.get("amount"), "dose-event amount")
        event_duration = finite(event.get("duration", 0), "dose-event duration")
        if event_time < 0:
            raise ValueError("dose-event time must be at least zero")
        if event_amount <= 0:
            raise ValueError("dose-event amount must be greater than zero")
        if event_duration < 0:
            raise ValueError("dose-event duration must be at least zero")
        if event_time + event_duration > cohort["horizon"]:
            raise ValueError(
                f"dose event must end within the {cohort['horizon']:.6g} "
                f"{cohort['time_units']} observation horizon"
            )
        events.append({
            "time": event_time,
            "amount": event_amount,
            "duration": event_duration,
            "route": route(event.get("route", cohort["route"])),
            "unit": cohort["dose_units"],
        })
    if not events:
        raise ValueError("at least one target dose event is required")
    return sorted(events, key=lambda event: float(event["time"]))


def generation_only_protocol(
    raw_events: Any, cohort: dict[str, Any]
) -> list[dict[str, float | str]]:
    """Accept only the empirical reference protocol for the dose-naive model."""
    events = target_dose_events(raw_events, cohort)
    dose = _finite_reference_dose(cohort)
    matches_reference = (
        len(events) == 1
        and math.isclose(float(events[0]["time"]), 0.0, abs_tol=1.0e-9)
        and math.isclose(float(events[0]["duration"]), 0.0, abs_tol=1.0e-9)
        and math.isclose(float(events[0]["amount"]), dose, rel_tol=1.0e-7, abs_tol=1.0e-9)
        and str(events[0]["route"]) == cohort["route"]
    )
    if not matches_reference:
        raise ValueError(
            "Pythia supports generation at the empirical reference dose only; "
            "select Pythia-Dose for dose counterfactuals or interventions"
        )
    return events


def _finite_reference_dose(cohort: dict[str, Any]) -> float:
    dose = finite(cohort.get("dose", 1.0), "context dose")
    return dose if dose > 0 else 1.0


class ModelRuntime:
    def __init__(
        self,
        *,
        model_id: str,
        label: str,
        supports_dose: bool,
        config_path: Path,
        checkpoint_path: Path,
    ) -> None:
        self.model_id = model_id
        self.label = label
        self.supports_dose = supports_dose
        self.config_path = config_path.resolve()
        self.checkpoint_path = checkpoint_path.resolve()
        self.device = torch.device("cpu")
        self.loaded = None
        self.checkpoint_sha256: str | None = None
        torch.set_num_threads(int(os.environ.get("PFF_CPU_THREADS", min(os.cpu_count() or 1, 8))))

    def metadata(self) -> dict[str, Any]:
        return {
            "modelId": self.model_id,
            "label": self.label,
            "supportsDose": self.supports_dose,
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
        if requested_model(request) != self.model_id:
            raise ValueError("inference request was routed to the wrong model")
        loaded = self.load()
        cohort = build_cohort(request.get("study") or {})
        n_draws = bounded_integer(
            request.get("nDraws", DEFAULT_GENERATED_INDIVIDUALS),
            "nDraws",
            1,
            MAX_GENERATED_INDIVIDUALS,
        )
        solver = request.get("solver") or {}
        method = str(solver.get("method", "heun"))
        steps = bounded_integer(
            solver.get("steps", DEFAULT_FLOW_STEPS),
            "solver steps",
            1,
            MAX_FLOW_STEPS,
        )
        if method not in {"euler", "heun"}:
            raise ValueError("solver method must be Euler or Heun")
        batch_size = bounded_integer(request.get("batchSize", 8), "batchSize", 1, 32)
        target_events = (
            target_dose_events(request.get("doseEvents"), cohort)
            if self.supports_dose
            else generation_only_protocol(request.get("doseEvents"), cohort)
        )

        cpu_batch, _, _ = empirical_cohort_batch(
            cohort,
            normalization=loaded.normalization,
            # The original Pythia checkpoint predates the dose-event operator.
            # Its reference protocol is validated above but must not be encoded
            # as a model input.
            target_dose_events=target_events if self.supports_dose else None,
        )
        cpu_batch = union_query_batch(cpu_batch)
        query_time = cpu_batch.target_time.numpy()[0, :, 0] * cohort["horizon"]
        seed = bounded_integer(request.get("seed", 161803), "seed", 0, 2**31 - 1)
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
                "modelId": self.model_id,
                "studyId": request.get("study", {}).get("id"),
                "doseEvents": target_events,
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


def configured_path(primary: str, legacy: str | None, default: Path) -> Path:
    value = os.environ.get(primary)
    if value is None and legacy is not None:
        value = os.environ.get(legacy)
    return Path(value) if value else default


RUNTIMES = {
    PYTHIA_MODEL: ModelRuntime(
        model_id=PYTHIA_MODEL,
        label="Pythia",
        supports_dose=False,
        config_path=configured_path("PFF_PYTHIA_CONFIG", None, DEFAULT_PYTHIA_CONFIG),
        checkpoint_path=configured_path(
            "PFF_PYTHIA_CHECKPOINT", None, DEFAULT_PYTHIA_CHECKPOINT
        ),
    ),
    PYTHIA_DOSE_MODEL: ModelRuntime(
        model_id=PYTHIA_DOSE_MODEL,
        label="Pythia-Dose",
        supports_dose=True,
        config_path=configured_path("PFF_DOSE_CONFIG", "PFF_CONFIG", DEFAULT_CONFIG),
        checkpoint_path=configured_path(
            "PFF_DOSE_CHECKPOINT", "PFF_CHECKPOINT", DEFAULT_CHECKPOINT
        ),
    ),
}
# Backward-compatible alias for scripts which explicitly mean the dose model.
RUNTIME = RUNTIMES[DEFAULT_MODEL]


def runtime_for_request(request: dict[str, Any]) -> ModelRuntime:
    return RUNTIMES[requested_model(request)]


def service_status() -> dict[str, Any]:
    """Return public capability and readiness metadata for every model."""
    models = {
        model_id: {
            key: value
            for key, value in runtime.metadata().items()
            if key not in {"config", "checkpoint"}
        }
        for model_id, runtime in RUNTIMES.items()
    }
    default = models[DEFAULT_MODEL]
    return {
        "ready": bool(default["ready"]),
        "loaded": bool(default["loaded"]),
        "device": "cpu",
        "checkpointId": str(default["checkpointId"]),
        "defaultModelId": DEFAULT_MODEL,
        "models": models,
    }


def cached_inference(request: dict[str, Any]) -> dict[str, Any]:
    """Run one validated request and persist the immutable response by content hash."""
    if not isinstance(request, dict):
        raise ValueError("inference request must be a JSON object")
    runtime = runtime_for_request(request)
    runtime.load()
    cache_key = {
        "schemaVersion": 1,
        "request": request,
        "checkpointSha256": runtime.checkpoint_sha256,
        "configSha256": hashlib.sha256(runtime.config_path.read_bytes()).hexdigest(),
    }
    canonical = json.dumps(cache_key, sort_keys=True, separators=(",", ":")).encode()
    inference_id = hashlib.sha256(canonical).hexdigest()[:20]
    destination = CACHE_ROOT / f"{inference_id}.json"
    if destination.exists():
        return json.loads(destination.read_text(encoding="utf-8"))
    result = runtime.infer(request)
    result["inferenceId"] = inference_id
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    temporary.replace(destination)
    return result


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
            self._send(200, service_status())
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
            self._send(200, cached_inference(request))
        except (ValueError, KeyError, TypeError, FileNotFoundError) as error:
            self._send(400, {"error": str(error)})
        except Exception as error:  # keep the local service alive and report cleanly
            self._send(500, {"error": f"inference failed: {error}"})

    def log_message(self, message: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {message % args}", flush=True)


def main() -> None:
    host = os.environ.get("PFF_API_HOST", "127.0.0.1")
    port = int(os.environ.get("PFF_API_PORT", "8791"))
    print(json.dumps({"service": f"http://{host}:{port}", **service_status()}, indent=2))
    HTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
