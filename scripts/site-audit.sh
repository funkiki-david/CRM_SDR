#!/bin/bash
# SDR CRM — Site Audit
# Wraps site-audit.py with nice terminal output
#
# Usage:
#   ./scripts/site-audit.sh          # Run audit, write audit-report.md
#   ./scripts/site-audit.sh --json   # Output JSON instead
#
# Exit code:
#   0 — no Critical issues
#   1 — Critical issues found (blocking for CI / pre-deploy)

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="${PYTHON:-python3}"

# Prefer venv python if it exists
if [ -x "${ROOT}/backend/.venv/bin/python" ]; then
    PYTHON="${ROOT}/backend/.venv/bin/python"
fi

cd "${ROOT}"
exec "${PYTHON}" scripts/site-audit.py "$@"
