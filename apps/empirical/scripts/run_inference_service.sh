#!/usr/bin/env bash
set -euo pipefail

DASHBOARD_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPOSITORY_ROOT="$(cd "$DASHBOARD_ROOT/../.." && pwd)"
PFF_REPOSITORY="${PFF_REPO:-$(cd "$REPOSITORY_ROOT/../pff_pk" && pwd)}"
PYTHON_EXECUTABLE="${PFF_PYTHON:-$PFF_REPOSITORY/.venv/bin/python}"

export PFF_REPO="$PFF_REPOSITORY"
exec "$PYTHON_EXECUTABLE" "$REPOSITORY_ROOT/services/inference/pff_service.py"
