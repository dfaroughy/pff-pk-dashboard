"""Public Gradio API for private-model PFF-PK inference."""

from __future__ import annotations

import os
from pathlib import Path

import gradio as gr
from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parent
MODEL_REPO_ID = os.environ.get("MODEL_REPO_ID", "").strip()
MODEL_REVISION = os.environ.get("MODEL_REVISION", "").strip()
if not MODEL_REPO_ID or not MODEL_REVISION:
    raise RuntimeError("MODEL_REPO_ID and MODEL_REVISION must be configured")

token = os.environ.get("HF_TOKEN") or True
checkpoint = hf_hub_download(
    repo_id=MODEL_REPO_ID,
    filename="models/pythia-dose/model.ckpt",
    revision=MODEL_REVISION,
    token=token,
)
config = hf_hub_download(
    repo_id=MODEL_REPO_ID,
    filename="models/pythia-dose/config.yaml",
    revision=MODEL_REVISION,
    token=token,
)
pythia_checkpoint = hf_hub_download(
    repo_id=MODEL_REPO_ID,
    filename="models/pythia/model.ckpt",
    revision=MODEL_REVISION,
    token=token,
)
pythia_config = hf_hub_download(
    repo_id=MODEL_REPO_ID,
    filename="models/pythia/config.yaml",
    revision=MODEL_REVISION,
    token=token,
)

os.environ["PFF_REPO"] = str(ROOT)
os.environ["PFF_DOSE_CHECKPOINT"] = checkpoint
os.environ["PFF_DOSE_CONFIG"] = config
os.environ["PFF_PYTHIA_CHECKPOINT"] = pythia_checkpoint
os.environ["PFF_PYTHIA_CONFIG"] = pythia_config
os.environ.setdefault("PFF_CACHE_ROOT", "/tmp/pff-inference-cache")
os.environ.setdefault("PFF_CPU_THREADS", "2")

from services.inference.pff_service import cached_inference, service_status  # noqa: E402

PUBLIC_SOLVER = {"method": "heun", "steps": 8}


def health() -> dict:
    """Return only non-sensitive deployment metadata."""
    return service_status()


def inference(payload: dict) -> dict:
    """Generate a PK cohort from a validated dashboard request."""
    if not isinstance(payload, dict):
        raise gr.Error("The inference request must be a JSON object")
    try:
        solver = payload.get("solver") or PUBLIC_SOLVER
        if not isinstance(solver, dict):
            raise ValueError("The public demo uses fixed Heun integration with 8 steps")
        if (
            str(solver.get("method", "")).lower() != PUBLIC_SOLVER["method"]
            or float(solver.get("steps", 0)) != PUBLIC_SOLVER["steps"]
        ):
            raise ValueError("The public demo uses fixed Heun integration with 8 steps")
        return cached_inference({**payload, "solver": PUBLIC_SOLVER.copy()})
    except (ValueError, KeyError, TypeError, FileNotFoundError) as error:
        raise gr.Error(str(error)) from error
    except Exception as error:
        raise gr.Error("PFF inference failed") from error


with gr.Blocks(title="PFF-PK inference API") as demo:
    gr.Markdown(
        "# PFF-PK inference API\n"
        "Server-side zero-shot PK cohort generation for the "
        "[PFF dashboard](https://dfaroughy.github.io/pff-pk-dashboard/empirical/)."
    )
    request = gr.JSON(label="Inference request", value={})
    result = gr.JSON(label="Inference response")
    run = gr.Button("Run inference", variant="primary")
    run.click(
        inference,
        inputs=request,
        outputs=result,
        api_name="inference",
        concurrency_limit=1,
        concurrency_id="pff-inference",
    )
    status = gr.JSON(label="Service status")
    check = gr.Button("Check service")
    check.click(health, inputs=None, outputs=status, api_name="health")

demo.queue(max_size=32, default_concurrency_limit=1)

if __name__ == "__main__":
    demo.launch()
