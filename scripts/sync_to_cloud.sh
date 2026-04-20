#!/bin/bash
# SDR CRM — Push local contacts + activities to cloud.
# 只同步这两张表：contacts 和 activities。其他数据不动。
#
# 工作方式:
#   1. 从本地 /api/contacts/export 拉 CSV
#   2. POST 到云端 /api/contacts/import（按 email 自动去重）
#   3. 对 activities 做同样操作（按 contact_email + user_email 关联）
#
# 用法 Usage:
#   ./scripts/sync_to_cloud.sh
#
# 环境变量可覆盖:
#   LOCAL_URL / CLOUD_URL / ADMIN_EMAIL / ADMIN_PASSWORD

set -euo pipefail

LOCAL_URL="${LOCAL_URL:-http://localhost:8000}"
CLOUD_URL="${CLOUD_URL:-https://crmsdr-production.up.railway.app}"
ADMIN_EMAIL="${ADMIN_EMAIL:-info@amazonsolutions.us}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

echo "=== sync: ${LOCAL_URL} → ${CLOUD_URL} ==="

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
curl -sf -H "Authorization: Bearer ${LOCAL_TOK}" \
    "${LOCAL_URL}/api/contacts/export" -o "${TMP}/contacts.csv"
LOCAL_C_LINES=$(wc -l < "${TMP}/contacts.csv" | tr -d ' ')
echo "  exported ${LOCAL_C_LINES} lines from local"

echo "  importing to cloud (update_existing=true)..."
C_RESULT=$(curl -sf -X POST "${CLOUD_URL}/api/contacts/import?update_existing=true" \
    -H "Authorization: Bearer ${CLOUD_TOK}" \
    -F "file=@${TMP}/contacts.csv" --max-time 300)
echo "  ${C_RESULT}"

# ------------------------------------------------------------
# 2. Activities
# ------------------------------------------------------------
echo ""
echo "--- activities ---"
curl -sf -H "Authorization: Bearer ${LOCAL_TOK}" \
    "${LOCAL_URL}/api/activities/export" -o "${TMP}/activities.csv"
LOCAL_A_LINES=$(wc -l < "${TMP}/activities.csv" | tr -d ' ')
echo "  exported ${LOCAL_A_LINES} lines from local"

# 只有表头（1 行）时不上传
if [[ "${LOCAL_A_LINES}" -le 1 ]]; then
    echo "  (no activities to sync)"
else
    echo "  importing to cloud..."
    A_RESULT=$(curl -sf -X POST "${CLOUD_URL}/api/activities/import" \
        -H "Authorization: Bearer ${CLOUD_TOK}" \
        -F "file=@${TMP}/activities.csv" --max-time 300)
    echo "  ${A_RESULT}"
fi

echo ""
echo "=== sync complete ==="
