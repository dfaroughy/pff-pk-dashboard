#!/usr/bin/env bash
set -euo pipefail

DASHBOARD_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DASHBOARD_ROOT"

npm run inference &
PFF_SERVICE_PID=$!
trap 'kill "$PFF_SERVICE_PID" 2>/dev/null || true' EXIT INT TERM
npm run dev
