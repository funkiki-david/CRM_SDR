#!/bin/bash
# SDR CRM — Pull cloud contacts + activities down to local.
# 从云端导出 contacts/activities CSV，导入到本地（按 email 去重）。
#
# 用法 Usage:
#   ./scripts/sync_from_cloud.sh
#
# 环境变量可覆盖:
#   LOCAL_URL / CLOUD_URL / ADMIN_EMAIL / ADMIN_PASSWORD

set -euo pipefail

LOCAL_URL="${LOCAL_URL:-http://localhost:8000}"
CLOUD_URL="${CLOUD_URL:-https://crmsdr-production.up.railway.app}"
ADMIN_EMAIL="${ADMIN_EMAIL:-info@amazonsolutions.us}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

echo "=== sync: ${CLOUD_URL} → ${LOCAL_URL} ==="

login() {
    local url=$1
    curl -sf -X POST "${url}/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
        | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
}

LOCAL_TOK=$(login "${LOCAL_URL}")
CLOUD_TOK=$(login "${CLOUD_URL}")
if [[ -z "${LOCAL_TOK}" ]]; then echo "❌ local login failed"; exit 1; fi
if [[ -z "${CLOUD_TOK}" ]]; then echo "❌ cloud login failed"; exit 1; fi
echo "  ✓ authed both ends"

TMP=$(mktemp -d)
trap "rm -rf ${TMP}" EXIT

# ------------------------------------------------------------
# 1. Contacts
# ------------------------------------------------------------
echo ""
echo "--- contacts ---"
curl -sf -H "Authorization: Bearer ${CLOUD_TOK}" \
    "${CLOUD_URL}/api/contacts/export" -o "${TMP}/contacts.csv"
CLOUD_C_LINES=$(wc -l < "${TMP}/contacts.csv" | tr -d ' ')
echo "  exported ${CLOUD_C_LINES} lines from cloud"

echo "  importing to local (update_existing=true)..."
C_RESULT=$(curl -sf -X POST "${LOCAL_URL}/api/contacts/import?update_existing=true" \
    -H "Authorization: Bearer ${LOCAL_TOK}" \
    -F "file=@${TMP}/contacts.csv" --max-time 300)
echo "  ${C_RESULT}"

# ------------------------------------------------------------
# 2. Activities
# ------------------------------------------------------------
echo ""
echo "--- activities ---"
curl -sf -H "Authorization: Bearer ${CLOUD_TOK}" \
    "${CLOUD_URL}/api/activities/export" -o "${TMP}/activities.csv"
CLOUD_A_LINES=$(wc -l < "${TMP}/activities.csv" | tr -d ' ')
echo "  exported ${CLOUD_A_LINES} lines from cloud"

if [[ "${CLOUD_A_LINES}" -le 1 ]]; then
    echo "  (no activities to sync)"
else
    echo "  importing to local..."
    A_RESULT=$(curl -sf -X POST "${LOCAL_URL}/api/activities/import" \
        -H "Authorization: Bearer ${LOCAL_TOK}" \
        -F "file=@${TMP}/activities.csv" --max-time 300)
    echo "  ${A_RESULT}"
fi

echo ""
echo "=== sync complete ==="
