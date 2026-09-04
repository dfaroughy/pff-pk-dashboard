#!/usr/bin/env python3
"""Create a minimal, auditable Pythia checkpoint release for Hugging Face."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import torch

INFERENCE_KEYS = {
    "state_dict",
    "hyper_parameters",
    "hparams_name",
    "pytorch-lightning_version",
    "pff_pk_concentration_normalization",
    "pff_pk_operator_measure",
    "pff_pk_source_process",
    "pff_pk_protocol_encoding",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--training-run", required=True)
    parser.add_argument("--supports-dose", action="store_true")
    args = parser.parse_args()

    source = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
    if "state_dict" not in source or "hyper_parameters" not in source:
        raise ValueError("checkpoint is missing inference model state")
    release = {key: source[key] for key in INFERENCE_KEYS if key in source}

    args.output.mkdir(parents=True, exist_ok=True)
    checkpoint = args.output / "model.ckpt"
    config = args.output / "config.yaml"
    torch.save(release, checkpoint)
    shutil.copyfile(args.config, config)
    manifest = {
        "schema_version": 1,
        "model_id": args.model_id,
        "training_run": args.training_run,
        "checkpoint_global_step": source.get("global_step"),
        "normalization": source.get("pff_pk_concentration_normalization"),
        "operator_measure": source.get("pff_pk_operator_measure"),
        "source_process": source.get("pff_pk_source_process"),
        "protocol_encoding": source.get(
            "pff_pk_protocol_encoding", "normalized_cumulative_v1"
        ),
        "capabilities": {
            "generation": True,
            "dose_counterfactuals": args.supports_dose,
            "dose_interventions": args.supports_dose,
        },
        "files": {
            "model.ckpt": sha256(checkpoint),
            "config.yaml": sha256(config),
        },
        "source_checkpoint_sha256": sha256(args.checkpoint),
    }
    (args.output / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
