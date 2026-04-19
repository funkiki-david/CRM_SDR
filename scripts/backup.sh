#!/bin/bash
# SDR CRM — 每日 Postgres 备份脚本
# Daily Postgres backup, keeps last 30 days
#
# 用法 Usage:
#   ./scripts/backup.sh            # 手动运行
#   由 launchd 每天自动调用          # automated by launchd
#
# 设置定时 Setup launchd schedule:
#   ./scripts/backup.sh --install

set -euo pipefail

# === 配置 Config ===
BACKUP_DIR="${HOME}/CRM_SDR/backups"
DB_HOST="localhost"
DB_PORT="5432"
DB_USER="sdrcrm"
DB_NAME="sdrcrm"
PGPASSWORD_VAL="sdrcrm_dev"
RETAIN_DAYS=30
LAUNCHD_LABEL="com.sdrcrm.backup"
LAUNCHD_PLIST="${HOME}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"

# === 安装 launchd 定时任务 ===
install_launchd() {
    mkdir -p "${HOME}/Library/LaunchAgents"
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

    mkdir -p "${BACKUP_DIR}"
    launchctl unload "${LAUNCHD_PLIST}" 2>/dev/null || true
    launchctl load "${LAUNCHD_PLIST}"
    echo "✅ Installed daily backup at 03:00 local time"
    echo "   Plist: ${LAUNCHD_PLIST}"
    echo "   Log:   ${BACKUP_DIR}/backup.log"
}

# === 主备份逻辑 ===
do_backup() {
    mkdir -p "${BACKUP_DIR}"
    local timestamp
    timestamp=$(date +%Y-%m-%d_%H-%M)
    local outfile="${BACKUP_DIR}/sdrcrm_${timestamp}.sql.gz"

    echo "[$(date +%F\ %T)] Starting backup → ${outfile}"

    PGPASSWORD="${PGPASSWORD_VAL}" pg_dump \
        -h "${DB_HOST}" -p "${DB_PORT}" \
        -U "${DB_USER}" -d "${DB_NAME}" \
        --no-owner --no-acl \
        | gzip > "${outfile}"

    local size
    size=$(du -h "${outfile}" | cut -f1)
    echo "[$(date +%F\ %T)] ✅ Backup complete: ${size}"

    # 清理 30 天前的备份 Clean up backups older than RETAIN_DAYS
    find "${BACKUP_DIR}" -name "sdrcrm_*.sql.gz" -mtime +${RETAIN_DAYS} -delete
    local kept
    kept=$(find "${BACKUP_DIR}" -name "sdrcrm_*.sql.gz" | wc -l | tr -d ' ')
    echo "[$(date +%F\ %T)] 🗑  Retention: kept ${kept} backups (last ${RETAIN_DAYS} days)"
}

# === 入口 ===
if [[ "${1:-}" == "--install" ]]; then
    install_launchd
elif [[ "${1:-}" == "--uninstall" ]]; then
    launchctl unload "${LAUNCHD_PLIST}" 2>/dev/null || true
    rm -f "${LAUNCHD_PLIST}"
    echo "✅ Uninstalled daily backup schedule"
else
    do_backup
fi
