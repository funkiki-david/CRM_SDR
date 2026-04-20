#!/bin/bash
# SDR CRM — Cloud data backup (contacts + activities only)
# 只备份核心业务数据：联系人 + 活动记录。
# Users / templates / ai_usage_log / email_accounts 等不备份。
#
# 用法 Usage:
#   ./scripts/backup.sh            # Manual run
#   launchd auto calls daily at 03:00 after --install
#
# Install schedule: ./scripts/backup.sh --install
# Uninstall:        ./scripts/backup.sh --uninstall

set -euo pipefail

# === 配置 Config ===
BACKUP_DIR="${HOME}/CRM_SDR/backups/cloud"
CLOUD_URL="${CLOUD_URL:-https://crmsdr-production.up.railway.app}"
ADMIN_EMAIL="${ADMIN_EMAIL:-info@amazonsolutions.us}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
RETAIN_DAYS=30
LAUNCHD_LABEL="com.sdrcrm.backup"
LAUNCHD_PLIST="${HOME}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"

# === 安装 launchd 定时任务 ===
install_launchd() {
    mkdir -p "${HOME}/Library/LaunchAgents"
    mkdir -p "${BACKUP_DIR}"
    cat > "${LAUNCHD_PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${HOME}/CRM_SDR/scripts/backup.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>3</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${BACKUP_DIR}/backup.log</string>
  <key>StandardErrorPath</key>
  <string>${BACKUP_DIR}/backup.err</string>
</dict>
</plist>
PLIST

    launchctl unload "${LAUNCHD_PLIST}" 2>/dev/null || true
    launchctl load "${LAUNCHD_PLIST}"
    echo "✅ Installed daily cloud backup at 03:00 local time"
    echo "   Plist: ${LAUNCHD_PLIST}"
    echo "   Dir:   ${BACKUP_DIR}"
}

# === 主备份逻辑 ===
do_backup() {
    mkdir -p "${BACKUP_DIR}"
    local date_stamp
    date_stamp=$(date +%Y-%m-%d)

    echo "[$(date +%F\ %T)] Cloud backup starting → ${BACKUP_DIR}"
    echo "[$(date +%F\ %T)] Target: ${CLOUD_URL}"

    # 1. Login to get JWT
    local token
    token=$(curl -sf -X POST "${CLOUD_URL}/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
        | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

    if [[ -z "${token}" ]]; then
        echo "[$(date +%F\ %T)] ❌ Login failed" >&2
        exit 1
    fi

    # 2. Contacts CSV
    local contacts_file="${BACKUP_DIR}/contacts_${date_stamp}.csv"
    curl -sf -H "Authorization: Bearer ${token}" \
        "${CLOUD_URL}/api/contacts/export" -o "${contacts_file}"
    local contacts_lines
    contacts_lines=$(wc -l < "${contacts_file}" | tr -d ' ')
    echo "[$(date +%F\ %T)] ✅ contacts → ${contacts_file} (${contacts_lines} lines)"

    # 3. Activities CSV
    local activities_file="${BACKUP_DIR}/activities_${date_stamp}.csv"
    curl -sf -H "Authorization: Bearer ${token}" \
        "${CLOUD_URL}/api/activities/export" -o "${activities_file}"
    local activities_lines
    activities_lines=$(wc -l < "${activities_file}" | tr -d ' ')
    echo "[$(date +%F\ %T)] ✅ activities → ${activities_file} (${activities_lines} lines)"

    # 4. Retention: remove files older than RETAIN_DAYS
    find "${BACKUP_DIR}" -name "contacts_*.csv"   -mtime +${RETAIN_DAYS} -delete
    find "${BACKUP_DIR}" -name "activities_*.csv" -mtime +${RETAIN_DAYS} -delete
    local kept
    kept=$(find "${BACKUP_DIR}" -name "*.csv" | wc -l | tr -d ' ')
    echo "[$(date +%F\ %T)] 🗑  Retention: kept ${kept} files (last ${RETAIN_DAYS} days)"
}

# === 入口 ===
case "${1:-}" in
    --install)
        install_launchd
        ;;
    --uninstall)
        launchctl unload "${LAUNCHD_PLIST}" 2>/dev/null || true
        rm -f "${LAUNCHD_PLIST}"
        echo "✅ Uninstalled daily backup schedule"
        ;;
    *)
        do_backup
        ;;
esac
