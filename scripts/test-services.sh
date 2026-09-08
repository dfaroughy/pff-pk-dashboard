#!/usr/bin/env bash
set -euo pipefail
dashboard_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$dashboard_root"
model_root="${PFF_REPO:-$dashboard_root/../pff_pk}"
python_executable="${PFF_PYTHON:-$model_root/.venv/bin/python}"
export PFF_REPO="$model_root"
"$python_executable" -m unittest services.inference.test_pff_service services.inference.test_synthetic_service services.huggingface_space.test_space_bundle -v
