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
    filename="model.ckpt",
    revision=MODEL_REVISION,
    token=token,
)
config = hf_hub_download(
    repo_id=MODEL_REPO_ID,
    filename="config.yaml",
    revision=MODEL_REVISION,
    token=token,
)

os.environ["PFF_REPO"] = str(ROOT)
os.environ["PFF_CHECKPOINT"] = checkpoint
os.environ["PFF_CONFIG"] = config
os.environ.setdefault("PFF_CACHE_ROOT", "/tmp/pff-inference-cache")
os.environ.setdefault("PFF_CPU_THREADS", "2")

from services.inference.pff_service import RUNTIME, cached_inference  # noqa: E402


def health() -> dict[str, str | bool]:
    """Return only non-sensitive deployment metadata."""
    metadata = RUNTIME.metadata()
    return {
        "ready": bool(metadata["ready"]),
        "loaded": bool(metadata["loaded"]),
        "device": "cpu",
        "checkpointId": str(metadata["checkpointId"]),
    }


def inference(payload: dict) -> dict:
    """Generate a PK cohort from a validated dashboard request."""
    if not isinstance(payload, dict):
        raise gr.Error("The inference request must be a JSON object")
    try:
        return cached_inference(payload)
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
