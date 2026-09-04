#!/usr/bin/env bash
set -euo pipefail

DASHBOARD_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PFFF_ROOT="${PFFF_ROOT:-$(cd "$DASHBOARD_ROOT/../../.." && pwd)}"
PYTHON_EXECUTABLE="${PFF_PYTHON:-$PFFF_ROOT/pff_pk/.venv/bin/python}"

export PFFF_ROOT
exec "$PYTHON_EXECUTABLE" "$DASHBOARD_ROOT/scripts/build_dashboard_data.py"
